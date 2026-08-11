import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { Action } from '../../actions/Action.js'
import { DateField } from '../../components/DateField.js'
import { EmptyState } from '../../components/EmptyState.js'
import { useMessages } from '../../components/Messages.js'
import { Icon } from '../../shell/Icon.js'
import { toDisplayDate } from '../../format/dates.js'
import { CustomerSelector } from './CustomerSelector.js'
import type {
  CustomerDto,
  MoneyDto,
  RetailCalculationDto,
  RetailDraftDto,
  RetailItemDto,
  RetailLineDto,
  SalesmanDto,
  WeightDto,
  WeightFieldDto,
  WeightUnit,
} from '../../../shared/ipc.js'

/**
 * The Sale (Retail) screen.
 *
 * ── Nothing here calculates anything ───────────────────────────────────────
 * Not the net weight, not the wastage, not a line amount, not the grand total,
 * not the amount in words. Every figure on this screen is produced by
 * RetailSaleService in the main process and arrives preformatted, because the
 * screen calls `retail:calculate` on every keystroke with the whole draft and
 * the row currently being typed. That call is pure and writes nothing, so it is
 * cheaper to ask than to keep a second implementation of the arithmetic here —
 * and a second implementation is one that will eventually disagree with the one
 * that prices the invoice.
 *
 * The renderer's entire job is: hold what was typed, hand it over, and render
 * the strings that come back.
 *
 * ── The three states that are easy to get wrong ────────────────────────────
 *
 *   1. **Edit in place.** A row loaded back into the entry form is an unresolved
 *      edit. The row stays in the table, visibly marked, and SAVE is REFUSED
 *      until the operator resolves it. A line silently dropped mid-edit is the
 *      worst bug this screen can have, so it is made impossible rather than
 *      unlikely.
 *   2. **The Gram ⇄ Tola toggle.** It re-expresses what is displayed and never
 *      re-parses it: each weight carries the exact milligram main computed, so
 *      a toggle cannot walk a stored weight (see WeightFieldDto).
 *   3. **Saving twice.** The draft id is minted once when the sale is started
 *      and sent on every attempt. A retry after a reply that never arrived
 *      finds the sale that already exists instead of writing a second invoice.
 */

const PURITY_OPTIONS = ['K24', 'K22', 'K21', 'K18'] as const

const PAYMENT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'credit', label: 'Credit — customer account' },
]

const EMPTY_WEIGHT: WeightFieldDto = { text: '', exactMg: null }

const EMPTY_ENTRY: RetailItemDto = {
  itemName: '',
  purity: 'K22',
  grossWeight: EMPTY_WEIGHT,
  stoneWeight: EMPTY_WEIGHT,
  cutPerTola: EMPTY_WEIGHT,
  wastagePercent: '',
  labourCharges: '',
  labourMode: 'fixed',
  stoneCharges: '',
}

interface RetailForm {
  saleDate: string
  saleTime: string
  customerId: string | null
  customerName: string
  customerMobile: string
  salesmanId: string
  ratePurity: string
  ratePerTolaOverride: string
  weightUnit: WeightUnit
  customerGold: WeightFieldDto
  customerGoldPurity: string
  hallmarkCharges: string
  otherCharges: string
  discount: string
  amountPaid: string
  paymentMethod: string
  remarks: string
}

/**
 * The idempotency key, minted once per sale.
 *
 * `crypto.randomUUID` needs a secure context and a sandboxed `file://` renderer
 * is not guaranteed one, so there is a fallback. It does not have to be globally
 * unique — it has to be unique among the drafts one counter has open, which the
 * timestamp alone very nearly achieves.
 */
function newDraftId(): string {
  const webCrypto = globalThis.crypto
  if (webCrypto && typeof webCrypto.randomUUID === 'function') return webCrypto.randomUUID()
  return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function nowHhMm(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/** A weight in whichever unit the toggle is showing. Chosen, never converted. */
function show(weight: WeightDto | undefined, unit: WeightUnit): string {
  if (!weight) return '—'
  return unit === 'tola' ? weight.tola : weight.gram
}

/**
 * Re-expresses a computed weight as a typed field, carrying the exact
 * milligram. This is the whole of the unit toggle: no arithmetic, and the
 * stored integer travels with the text so it cannot be re-rounded.
 */
function fieldFrom(weight: WeightDto | undefined, unit: WeightUnit): WeightFieldDto {
  if (!weight) return EMPTY_WEIGHT
  return { text: unit === 'tola' ? weight.tola : weight.gram, exactMg: weight.mg }
}

/** A figure worth colouring. A nought is not a value. */
function isSignificant(display: string | undefined): boolean {
  return display ? /[1-9]/.test(display) : false
}

export function RetailScreen({ today, onPosted }: { today: string; onPosted: () => void }) {
  const [draftId, setDraftId] = useState(newDraftId)
  const [form, setForm] = useState<RetailForm>(() => ({
    saleDate: today,
    saleTime: nowHhMm(),
    customerId: null,
    customerName: '',
    customerMobile: '',
    salesmanId: '',
    ratePurity: 'K22',
    ratePerTolaOverride: '',
    weightUnit: 'gram',
    customerGold: EMPTY_WEIGHT,
    customerGoldPurity: 'K22',
    hallmarkCharges: '',
    otherCharges: '',
    discount: '',
    amountPaid: '',
    paymentMethod: 'cash',
    remarks: '',
  }))
  const [customer, setCustomer] = useState<CustomerDto | null>(null)
  const [items, setItems] = useState<readonly RetailItemDto[]>([])
  const [entry, setEntry] = useState<RetailItemDto>(EMPTY_ENTRY)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [calc, setCalc] = useState<RetailCalculationDto | null>(null)
  const [invoiceNo, setInvoiceNo] = useState('—')
  const [salesmen, setSalesmen] = useState<readonly SalesmanDto[]>([])
  const [busy, setBusy] = useState(false)
  const [confirmHighWastage, setConfirmHighWastage] = useState<string | null>(null)
  const [lastSaleId, setLastSaleId] = useState<string | null>(null)
  const { push } = useMessages()

  // A ref as well as state: a second click can arrive before React has
  // re-rendered with a disabled button, and the ref is already set.
  const saving = useRef(false)
  const itemNameRef = useRef<HTMLInputElement>(null)

  const unit = form.weightUnit
  const set = <K extends keyof RetailForm>(key: K, value: RetailForm[K]): void =>
    setForm((current) => ({ ...current, [key]: value }))

  const draft = useMemo<RetailDraftDto>(
    () => ({
      draftId,
      saleDate: form.saleDate,
      saleTime: form.saleTime,
      customerId: form.customerId,
      customerName: form.customerName,
      customerMobile: form.customerMobile.trim() || null,
      salesmanId: form.salesmanId || null,
      ratePurity: form.ratePurity,
      ratePerTolaOverride: form.ratePerTolaOverride,
      weightUnit: form.weightUnit,
      items,
      customerGold: form.customerGold,
      customerGoldPurity: form.customerGoldPurity,
      hallmarkCharges: form.hallmarkCharges,
      otherCharges: form.otherCharges,
      discount: form.discount,
      amountPaid: form.amountPaid,
      paymentMethod: form.paymentMethod,
      remarks: form.remarks.trim() || null,
    }),
    [draftId, form, items],
  )

  useEffect(() => {
    void window.api.retailNextInvoiceNo().then(setInvoiceNo)
    void window.api.listSalesmen().then(setSalesmen)
  }, [])

  /**
   * The live calculation. Debounced 120 ms, which is under the gap between two
   * keystrokes of a fast typist and over the gap between two of a key repeat.
   *
   * The same service that will price the invoice answers this, so what the
   * operator sees while typing is not an approximation of the sale — it is it.
   */
  useEffect(() => {
    const timer = setTimeout(() => {
      void window.api.retailCalculate({ draft, entry }).then(setCalc)
    }, 120)
    return () => clearTimeout(timer)
  }, [draft, entry])

  const setEntryWeight = (key: 'grossWeight' | 'stoneWeight' | 'cutPerTola', text: string) =>
    // exactMg is cleared: the operator has typed, so the text is authoritative
    // again. It is only ever set by the unit toggle.
    setEntry((current) => ({ ...current, [key]: { text, exactMg: null } }))

  const clearEntry = useCallback(() => {
    setEntry(EMPTY_ENTRY)
    setEditingIndex(null)
    itemNameRef.current?.focus()
  }, [])

  /**
   * Adds the typed row as a line, or writes it back over the one being edited.
   *
   * The line that goes into the list is the row AS TYPED, not the computed one:
   * the computed figures are re-derived on the next calculate from the same
   * inputs by the same service, so storing them here would be a second copy of
   * the answer that could drift from the first.
   */
  const commitEntry = useCallback(() => {
    if (!entry.itemName.trim() && !entry.grossWeight.text.trim()) {
      push('bad', 'Fill in the item entry above before adding it to the sale.')
      return
    }
    const line = entry
    setItems((current) =>
      editingIndex === null
        ? [...current, line]
        : current.map((row, index) => (index === editingIndex ? line : row)),
    )
    setEntry(EMPTY_ENTRY)
    setEditingIndex(null)
    itemNameRef.current?.focus()
  }, [entry, editingIndex, push])

  const editLine = useCallback(
    (index: number) => {
      const row = items[index]
      if (!row) return
      setEntry(row)
      setEditingIndex(index)
      itemNameRef.current?.focus()
    },
    [items],
  )

  const deleteLine = useCallback(
    (index: number) => {
      setItems((current) => current.filter((_, i) => i !== index))
      // Deleting the row that is open for editing would leave the entry card
      // holding a line that no longer exists anywhere.
      setEditingIndex((current) =>
        current === null ? null : current === index ? null : current > index ? current - 1 : current,
      )
    },
    [],
  )

  /**
   * Gram ⇄ Tola. Converts what is DISPLAYED and nothing else.
   *
   * Every field is re-seeded from the figures main just computed, each carrying
   * its exact milligram, so no stored number passes through a decimal string on
   * the way. Flipping the toggle ten times leaves every weight byte-identical.
   */
  const toggleUnit = useCallback(() => {
    const next: WeightUnit = unit === 'gram' ? 'tola' : 'gram'
    const current = calc
    if (current) {
      setItems((rows) =>
        rows.map((row, index) => {
          const line = current.lines[index]
          if (!line) return row
          return {
            ...row,
            grossWeight: fieldFrom(line.gross, next),
            stoneWeight: fieldFrom(line.stone, next),
            cutPerTola: fieldFrom(line.cutPerTola, next),
          }
        }),
      )
      if (current.entry) {
        setEntry((row) => ({
          ...row,
          grossWeight: fieldFrom(current.entry?.gross, next),
          stoneWeight: fieldFrom(current.entry?.stone, next),
          cutPerTola: fieldFrom(current.entry?.cutPerTola, next),
        }))
      }
      setForm((f) => ({
        ...f,
        weightUnit: next,
        customerGold: fieldFrom(current.customerGold, next),
      }))
      return
    }
    set('weightUnit', next)
  }, [unit, calc])

  const startNewSale = useCallback(
    (keepRateAndSalesman: boolean) => {
      setDraftId(newDraftId())
      setItems([])
      setEntry(EMPTY_ENTRY)
      setEditingIndex(null)
      setCustomer(null)
      setLastSaleId(null)
      setConfirmHighWastage(null)
      setForm((current) => ({
        ...current,
        saleTime: nowHhMm(),
        customerId: null,
        customerName: '',
        customerMobile: '',
        salesmanId: keepRateAndSalesman ? current.salesmanId : '',
        ratePurity: keepRateAndSalesman ? current.ratePurity : 'K22',
        ratePerTolaOverride: keepRateAndSalesman ? current.ratePerTolaOverride : '',
        customerGold: EMPTY_WEIGHT,
        hallmarkCharges: '',
        otherCharges: '',
        discount: '',
        amountPaid: '',
        paymentMethod: 'cash',
        remarks: '',
      }))
      void window.api.retailNextInvoiceNo().then(setInvoiceNo)
    },
    [],
  )

  /**
   * Sends the stored document to the printer.
   *
   * The HTML comes from `@jewellery/printing` over IPC — the same 576-dot
   * document the thermal printer gets — so what prints is the paper, not a
   * screenshot of the screen. It is read back from the SAVED sale, which is why
   * PRINT refuses before a save rather than printing a draft that does not
   * exist in the books.
   */
  const printSale = useCallback(
    async (saleId: string): Promise<boolean> => {
      const html = await window.api.retailReceipt(saleId)
      if (!html) return false
      const frame = document.createElement('iframe')
      frame.setAttribute('aria-hidden', 'true')
      frame.style.position = 'fixed'
      frame.style.width = '0'
      frame.style.height = '0'
      frame.style.border = '0'
      frame.srcdoc = html
      document.body.appendChild(frame)
      await new Promise<void>((resolve) => {
        frame.addEventListener('load', () => resolve(), { once: true })
      })
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
      setTimeout(() => frame.remove(), 2000)
      return true
    },
    [],
  )

  const commit = useCallback(
    async (mode: 'save' | 'save-print' | 'hold', confirmed = false) => {
      if (saving.current) return
      // The refusal that matters most on this screen. A line loaded back into
      // the entry card is an edit nobody has resolved; saving now would write
      // the sale WITHOUT the change and nothing on screen would say so.
      if (editingIndex !== null) {
        push(
          'bad',
          `Line ${editingIndex + 1} is open for editing. Press UPDATE ITEM to write your ` +
            `changes back, or CLEAR ENTRY to leave that line exactly as it was. ` +
            `Saving now would drop what you have typed.`,
        )
        return
      }
      saving.current = true
      setBusy(true)
      try {
        const request = {
          draft: confirmed ? { ...draft, confirmedHighWastage: true } : draft,
        }
        const result =
          mode === 'hold'
            ? await window.api.retailHold(request)
            : await window.api.retailSave(request)

        if (!result.ok) {
          if ('needsConfirmation' in result) {
            setConfirmHighWastage(result.message)
            return
          }
          push('bad', result.message)
          return
        }

        setConfirmHighWastage(null)
        setLastSaleId(result.saleId)

        if (mode === 'hold') {
          push(
            'ok',
            `Held as ${result.invoiceNo}. That number is now spent — a held sale is a ` +
              `real document in the sequence.`,
          )
          onPosted()
          return
        }

        const printed = mode === 'save-print' ? await printSale(result.saleId) : false
        push(
          'ok',
          `Saved ${result.invoiceNo}. Rs ${result.grandTotal}, ` +
            `${result.balance === '0.00' ? 'paid in full' : `Rs ${result.balance} outstanding`}.` +
            (printed ? ' Sent to the printer.' : ''),
        )
        // A fresh sale, with the rate and the salesman kept: the next customer
        // is served by the same person at the same rate, and retyping both on
        // every sale is how a counter ends up with the wrong one.
        startNewSale(true)
        onPosted()
      } finally {
        saving.current = false
        setBusy(false)
      }
    },
    [draft, editingIndex, onPosted, printSale, push, startNewSale],
  )

  const print = useCallback(async () => {
    if (!lastSaleId) {
      push('bad', 'There is nothing to print yet. Save the sale first.')
      return
    }
    const printed = await printSale(lastSaleId)
    if (!printed) push('bad', 'That sale could not be read back for printing.')
  }, [lastSaleId, printSale, push])

  /** The WhatsApp summary. Composed here, sent by main, checked against a host allowlist. */
  const sendOnWhatsApp = useCallback(async () => {
    const digits = form.customerMobile.replace(/\D/g, '')
    if (digits.length < 7) {
      push('bad', 'Add the customer’s mobile number before sending on WhatsApp.')
      return
    }
    // 03xx… is how a Pakistani number is written locally; wa.me wants the
    // international form, so the leading zero becomes the country code.
    const international = digits.startsWith('0') ? `92${digits.slice(1)}` : digits
    const summary =
      `${form.customerName || 'Customer'} — invoice ${invoiceNo}\n` +
      `Total fine: ${show(calc?.totalFine, unit)} ${unit === 'tola' ? 'tola' : 'g'}\n` +
      `Grand total: Rs ${calc?.grandTotal.rupees ?? '0.00'}\n` +
      `Balance: Rs ${calc?.balance.rupees ?? '0.00'}`
    const result = await window.api.openExternal(
      `https://wa.me/${international}?text=${encodeURIComponent(summary)}`,
    )
    if (!result.ok) push('bad', result.message)
  }, [calc, form.customerMobile, form.customerName, invoiceNo, push, unit])

  // Published so the shell's action registry can drive these controls.
  useEffect(() => {
    const handlers: Record<string, () => void> = {
      'retail.item.add': commitEntry,
      'retail.item.clear': clearEntry,
      'retail.unit.toggle': toggleUnit,
      'retail.rate.refresh': () => set('ratePerTolaOverride', ''),
      'retail.save': () => void commit('save'),
      'retail.save-and-print': () => void commit('save-print'),
      'retail.print': () => void print(),
      'retail.hold': () => void commit('hold'),
      'retail.new': () => startNewSale(true),
      'retail.cancel': () => startNewSale(false),
      'retail.wastage.confirm': () => void commit('save', true),
      'retail.wastage.back': () => setConfirmHighWastage(null),
      'quick.retail-whatsapp': () => void sendOnWhatsApp(),
    }
    const listener = (event: Event): void => {
      handlers[(event as CustomEvent<string>).detail]?.()
    }
    window.addEventListener('jewellery:action', listener)
    return () => window.removeEventListener('jewellery:action', listener)
  }, [commit, commitEntry, clearEntry, print, sendOnWhatsApp, startNewSale, toggleUnit])

  /**
   * The function keys the action bar advertises.
   *
   * They were labels on buttons and nothing else until now, which is a promise
   * the application was not keeping. F2 is the one that matters: at a counter a
   * line is added dozens of times a sale, and reaching for the mouse each time
   * is the difference between typing a sale and operating a form.
   */
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      const keys: Record<string, () => void> = {
        F2: commitEntry,
        F5: () => void commit('save'),
        F6: () => void commit('save-print'),
        F7: () => void print(),
        F8: () => void commit('hold'),
        F9: () => startNewSale(true),
      }
      const handler = keys[event.key]
      if (!handler) return
      // A dialog owns the keyboard while it is open.
      if (document.querySelector('.modal')) return
      event.preventDefault()
      handler()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [commit, commitEntry, print, startNewSale])

  const rateMissing = calc?.rateMissing ?? false
  const balanceOutstanding = (calc?.balance.paisa ?? 0) !== 0
  const editing = editingIndex !== null

  return (
    <div className="screen">
      <div className="screen__head">
        <h1 className="module-title">SALE (RETAIL)</h1>

        {rateMissing ? (
          <div className="banner">
            No {form.ratePurity.slice(1)}K gold rate is recorded on or before{' '}
            {toDisplayDate(form.saleDate)}. Set the rate that applied that day in Gold Rate
            before saving — every amount on this sale depends on it, and using today&apos;s
            would price the invoice wrongly.
          </div>
        ) : null}

        {calc?.warnings.map((warning) => (
          <div className="banner" key={warning}>
            {warning}
          </div>
        ))}

        {/* High wastage is a QUESTION, not an error. It sits at the top of the
            screen with a Continue button, because the operator has to be able
            to act on it rather than only dismiss it (the same shape as the
            wholesale over-return confirmation). */}
        {confirmHighWastage ? (
          <div className="confirm">
            <p className="confirm__text">{confirmHighWastage}</p>
            <div className="confirm__actions">
              <Action id="retail.wastage.back" variant="ghost">
                Go back and check it
              </Action>
              <Action id="retail.wastage.confirm" className="login__submit" busy={busy}>
                Save this sale anyway
              </Action>
            </div>
          </div>
        ) : null}
      </div>

      <div className="workspace__split screen__body">
        <div className="entry-column">
          <div className="panel">
            <div className="panel__title">SALE DETAILS</div>
            <div className="field-row">
              <label className="field">
                <span className="field__label">Invoice No.</span>
                <input
                  className="input input--derived"
                  value={invoiceNo}
                  readOnly
                  disabled
                  aria-label="Invoice number"
                />
              </label>

              <DateField
                value={form.saleDate}
                onChange={(iso) => set('saleDate', iso)}
                label="Date"
                ariaLabel="Sale date"
              />

              <label className="field">
                <span className="field__label">Time</span>
                <input
                  className="input input--numeric"
                  value={form.saleTime}
                  onChange={(e) => set('saleTime', e.target.value)}
                  placeholder="HH:MM"
                  inputMode="numeric"
                  aria-label="Sale time"
                />
              </label>

              <CustomerSelector
                selected={customer}
                typedName={form.customerName}
                onTypedName={(name) => set('customerName', name)}
                onSelect={(picked) => {
                  setCustomer(picked)
                  setForm((current) => ({
                    ...current,
                    customerId: picked?.id ?? null,
                    customerName: picked?.name ?? current.customerName,
                    // Auto-filled from the customer, and still editable: a
                    // walk-in gives a number that belongs to nobody on file.
                    customerMobile: picked?.mobile ?? current.customerMobile,
                  }))
                }}
              />

              <label className="field">
                <span className="field__label">Mobile</span>
                <input
                  className="input"
                  value={form.customerMobile}
                  onChange={(e) => set('customerMobile', e.target.value)}
                  placeholder="0300 0000000"
                  aria-label="Customer mobile"
                />
              </label>

              <label className="field">
                <span className="field__label">Salesman</span>
                <select
                  className="select"
                  value={form.salesmanId}
                  onChange={(e) => set('salesmanId', e.target.value)}
                  aria-label="Salesman"
                >
                  <option value="">
                    {salesmen.length === 0 ? 'None recorded' : 'Not attributed'}
                  </option>
                  {salesmen.map((salesman) => (
                    <option key={salesman.id} value={salesman.id}>
                      {salesman.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="field__label">Gold Rate purity</span>
                <select
                  className="select"
                  value={form.ratePurity}
                  onChange={(e) => set('ratePurity', e.target.value)}
                  aria-label="Gold rate purity"
                >
                  {PURITY_OPTIONS.map((purity) => (
                    <option key={purity} value={purity}>
                      {purity.slice(1)}K
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="field__label">Rate (per tola)</span>
                <span className="input-group">
                  <input
                    className={`input input--numeric${rateMissing ? ' input--bad' : ''}`}
                    value={form.ratePerTolaOverride}
                    onChange={(e) => set('ratePerTolaOverride', e.target.value)}
                    placeholder={
                      rateMissing
                        ? `No ${form.ratePurity.slice(1)}K rate for this date`
                        : (calc?.rateDisplay ?? '—')
                    }
                    inputMode="decimal"
                    aria-label="Gold rate per tola"
                  />
                  <Action
                    id="retail.rate.refresh"
                    variant="segment"
                    ariaLabel="Use the recorded rate"
                  >
                    <Icon name="refresh" size={16} />
                  </Action>
                </span>
              </label>
            </div>

            {/* Inside the details card, exactly as the wholesale bar is. Below
                the item table it would be off the bottom of an 830px window on
                a long sale, which is when it is most needed. */}
            <RetailActionBar busy={busy} />
          </div>

          <div className="panel">
            <div className="panel__title">
              <span>ITEM ENTRY</span>
              <span className="toolbar__end">
                <Action id="retail.unit.toggle" variant="toolbar">
                  <Icon name="scale" size={16} />
                  {unit === 'gram' ? 'Showing GRAM' : 'Showing TOLA'}
                </Action>
              </span>
            </div>

            <div className="entry-grid">
              <label className="field">
                <span className="field__label">Item Name</span>
                <input
                  ref={itemNameRef}
                  className="input"
                  value={entry.itemName}
                  onChange={(e) => setEntry((c) => ({ ...c, itemName: e.target.value }))}
                  placeholder="GOLD BANGLE"
                  aria-label="Item name"
                />
              </label>

              <label className="field">
                <span className="field__label">Purity</span>
                <select
                  className="select"
                  value={entry.purity}
                  onChange={(e) => setEntry((c) => ({ ...c, purity: e.target.value }))}
                  aria-label="Item purity"
                >
                  {PURITY_OPTIONS.map((purity) => (
                    <option key={purity} value={purity}>
                      {purity.slice(1)}K
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="field__label">Weight ({unit})</span>
                <input
                  className="input input--numeric"
                  value={entry.grossWeight.text}
                  onChange={(e) => setEntryWeight('grossWeight', e.target.value)}
                  placeholder="0.000"
                  inputMode="decimal"
                  aria-label="Gross weight"
                />
              </label>

              <label className="field">
                <span className="field__label">Stone ({unit})</span>
                <input
                  className="input input--numeric"
                  value={entry.stoneWeight.text}
                  onChange={(e) => setEntryWeight('stoneWeight', e.target.value)}
                  placeholder="0.000"
                  inputMode="decimal"
                  aria-label="Stone weight"
                />
              </label>

              <label className="field">
                <span className="field__label">Net Weight ({unit})</span>
                <input
                  className="input input--computed"
                  value={show(calc?.entry?.net, unit)}
                  readOnly
                  aria-label="Net weight"
                />
              </label>

              <label className="field">
                <span className="field__label">Wastage %</span>
                <input
                  className="input input--numeric"
                  value={entry.wastagePercent}
                  onChange={(e) => setEntry((c) => ({ ...c, wastagePercent: e.target.value }))}
                  placeholder="0.00"
                  inputMode="decimal"
                  aria-label="Wastage percent"
                />
              </label>

              <label className="field">
                <span className="field__label">Wastage ({unit})</span>
                <input
                  className="input input--computed"
                  value={show(calc?.entry?.wastage, unit)}
                  readOnly
                  aria-label="Wastage weight"
                />
              </label>

              <label className="field">
                <span className="field__label">Fine Weight ({unit})</span>
                <input
                  className="input input--computed is-emphasis"
                  value={show(calc?.entry?.fine, unit)}
                  readOnly
                  aria-label="Fine weight"
                />
              </label>

              <label className="field">
                <span className="field__label">Cut / Kaat (per tola)</span>
                <input
                  className="input input--numeric"
                  value={entry.cutPerTola.text}
                  onChange={(e) => setEntryWeight('cutPerTola', e.target.value)}
                  placeholder="0.000"
                  inputMode="decimal"
                  aria-label="Cut per tola"
                />
                <span className="field__hint">Normally 0 on a retail sale.</span>
              </label>
            </div>

            <div className="entry-grid entry-grid--charges">
              <label className="field">
                <span className="field__label">Labour Charges</span>
                <span className="input-group">
                  <input
                    className="input input--numeric"
                    value={entry.labourCharges}
                    onChange={(e) => setEntry((c) => ({ ...c, labourCharges: e.target.value }))}
                    placeholder="0.00"
                    inputMode="decimal"
                    aria-label="Labour charges"
                  />
                  {/* Per-tola labour is charged on the FINE weight — the metal
                      the customer is billed for. The mode is part of the same
                      control because the number means nothing without it. */}
                  <Action
                    id="retail.labour.mode"
                    variant="mode"
                    className={entry.labourMode === 'per_tola' ? 'is-active' : ''}
                    ariaLabel="Labour charge mode"
                    onActivate={() =>
                      setEntry((c) => ({
                        ...c,
                        labourMode: c.labourMode === 'fixed' ? 'per_tola' : 'fixed',
                      }))
                    }
                  >
                    {entry.labourMode === 'per_tola' ? '/tola' : 'fixed'}
                  </Action>
                </span>
              </label>

              <label className="field">
                <span className="field__label">Stone Charges</span>
                <input
                  className="input input--numeric"
                  value={entry.stoneCharges}
                  onChange={(e) => setEntry((c) => ({ ...c, stoneCharges: e.target.value }))}
                  onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                    // Enter in the last entry field does what F2 does.
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commitEntry()
                    }
                  }}
                  placeholder="0.00"
                  inputMode="decimal"
                  aria-label="Stone charges"
                />
              </label>

              <label className="field">
                <span className="field__label">Line Amount</span>
                <input
                  className="input input--computed"
                  value={calc?.entry?.amount.rupees ?? '0.00'}
                  readOnly
                  aria-label="Line amount"
                />
              </label>
            </div>

            {calc?.entry?.error ? <p className="hint hint--bad">{calc.entry.error}</p> : null}

            <div className="action-bar action-bar--entry">
              <Action id="retail.item.add" variant="outline" className="is-save-print">
                <Icon name="plus" size={18} />
                <span>{editing ? `UPDATE ITEM (F2)` : 'ADD ITEM (F2)'}</span>
              </Action>
              <Action id="retail.item.clear" variant="outline">
                <Icon name="cross" size={18} />
                <span>{editing ? 'ABANDON EDIT' : 'CLEAR ENTRY'}</span>
              </Action>
            </div>
          </div>

          <ItemsTable
            lines={calc?.lines ?? []}
            unit={unit}
            editingIndex={editingIndex}
            onEdit={editLine}
            onDelete={deleteLine}
            totalFine={calc?.totalFine}
            totalLabour={calc?.totalLabour}
            totalStone={calc?.totalStone}
            itemsTotal={calc?.itemsTotal}
          />
        </div>

        <aside className="rail">
          <CalculationsPanel
            calc={calc}
            form={form}
            unit={unit}
            onChange={set}
          />

          <div className="panel">
            <div className="panel__title">PAYMENT</div>
            <div className="panel__body">
              <div className="calc-line">
                <span className="calc-line__label">Payment Amount</span>
                <input
                  className="input input--numeric"
                  value={form.amountPaid}
                  onChange={(e) => set('amountPaid', e.target.value)}
                  placeholder="0.00"
                  inputMode="decimal"
                  aria-label="Payment amount"
                />
              </div>
              <div className="calc-line">
                <span className="calc-line__label">Payment Method</span>
                <select
                  className="select"
                  value={form.paymentMethod}
                  onChange={(e) => set('paymentMethod', e.target.value)}
                  aria-label="Payment method"
                >
                  {PAYMENT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="calc-total">
                <span className="calc-total__label">Remaining Balance</span>
              </div>
              <span
                className={`balance-figure${balanceOutstanding ? ' is-outstanding' : ''}`}
              >
                Rs {calc?.balance.rupees ?? '0.00'}
              </span>
            </div>
          </div>

          <InvoicePreview
            invoiceNo={invoiceNo}
            form={form}
            calc={calc}
            customerName={form.customerName}
          />

          <div className="panel">
            <div className="panel__title">QUICK ACTIONS</div>
            <div className="panel__body">
              <div className="quick-actions">
                <Action id="quick.retail-whatsapp" variant="quick">
                  Send on WhatsApp ↗
                </Action>
                <Action id="quick.print-last-invoice" variant="quick">
                  Print Last Invoice
                </Action>
                <p className="quick-actions__note">
                  WhatsApp opens outside this application, in your browser. Nothing is sent
                  from here and no data leaves the shop&apos;s PC until you press send there.
                </p>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Outside the scrolling column on purpose.
       *
       * Measured: this screen's left column wants 1108 CSS pixels and has 611
       * at a 1550×830 window, so it is the region that gives way — and inside
       * it, these three figures sit below the item table, which is exactly
       * where they are least useful. They are the figures the whole sale exists
       * to produce, so they are pinned to the foot of the screen and are always
       * on screen while the numbers that produce them are being typed. The page
       * itself still never scrolls. */}
      <div className="stat-strip">
        <div className="stat-cell">
          <span className="stat-cell__label">Total Fine (tola)</span>
          <span
            className={`stat-cell__value${
              isSignificant(calc?.totalFine.tola) ? ' positive' : ''
            }`}
          >
            {calc?.totalFine.tola ?? '0.000'}
          </span>
        </div>
        <div className="stat-cell">
          <span className="stat-cell__label">Grand Total</span>
          <span className="stat-cell__value">Rs {calc?.grandTotal.rupees ?? '0.00'}</span>
        </div>
        <div className="stat-cell">
          <span className="stat-cell__label">Balance</span>
          <span className={`stat-cell__value${balanceOutstanding ? ' negative' : ''}`}>
            Rs {calc?.balance.rupees ?? '0.00'}
          </span>
        </div>
      </div>
    </div>
  )
}

/** SAVE · SAVE &amp; PRINT · PRINT · HOLD · NEW SALE · CANCEL. */
function RetailActionBar({ busy }: { busy: boolean }) {
  return (
    <div className="action-bar action-bar--six">
      <Action id="retail.save" variant="primary" className="is-save" busy={busy}>
        <Icon name="save" size={18} />
        <span>SAVE (F5)</span>
      </Action>
      <Action id="retail.save-and-print" variant="outline" className="is-save-print" busy={busy}>
        <Icon name="print" size={18} />
        <span>SAVE &amp; PRINT (F6)</span>
      </Action>
      <Action id="retail.print" variant="outline" className="is-print">
        <Icon name="print" size={18} />
        <span>PRINT (F7)</span>
      </Action>
      <Action id="retail.hold" variant="outline" className="is-hold" busy={busy}>
        <Icon name="pause" size={18} />
        <span>HOLD (F8)</span>
      </Action>
      <Action id="retail.new" variant="outline">
        <Icon name="plus" size={18} />
        <span>NEW SALE (F9)</span>
      </Action>
      <Action id="retail.cancel" variant="outline" className="is-cancel">
        <Icon name="cross" size={18} />
        <span>CANCEL</span>
      </Action>
    </div>
  )
}

function ItemsTable({
  lines,
  unit,
  editingIndex,
  onEdit,
  onDelete,
  totalFine,
  totalLabour,
  totalStone,
  itemsTotal,
}: {
  lines: readonly RetailLineDto[]
  unit: WeightUnit
  editingIndex: number | null
  onEdit: (index: number) => void
  onDelete: (index: number) => void
  totalFine: WeightDto | undefined
  totalLabour: MoneyDto | undefined
  totalStone: MoneyDto | undefined
  itemsTotal: MoneyDto | undefined
}) {
  return (
    <div className="panel panel--fill">
      <div className="panel__title">
        <span>ITEMS IN THIS SALE</span>
        <span className="toolbar__end">{lines.length} line{lines.length === 1 ? '' : 's'}</span>
      </div>
      <div className="panel__body panel__body--flush">
        {lines.length === 0 ? (
          <EmptyState
            title="No items yet"
            line="Fill in the ITEM ENTRY card above and press ADD ITEM (F2). Each line you add appears here with its fine weight and amount."
          />
        ) : (
          <div className="table-scroll table-scroll--retail">
            <table className="grid grid--retail">
              <colgroup>
                <col className="col--index" />
                <col />
                <col className="col--purity" />
                <col className="col--weight" />
                <col className="col--weight" />
                <col className="col--weight" />
                <col className="col--fine" />
                <col className="col--charge" />
                <col className="col--charge" />
                <col className="col--retail-amount" />
                <col className="col--action" />
              </colgroup>
              <thead>
                <tr>
                  <th className="grid__index">#</th>
                  <th>Item</th>
                  <th>Purity</th>
                  <th className="numeric">Gross</th>
                  <th className="numeric">Net</th>
                  <th className="numeric">Wastage</th>
                  <th className="numeric">Fine</th>
                  <th className="numeric">Labour</th>
                  <th className="numeric">Stone</th>
                  <th className="numeric">Amount</th>
                  <th className="grid__action">Action</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr
                    key={index}
                    className={
                      line.error
                        ? 'row--error'
                        : editingIndex === index
                          ? 'row--editing'
                          : undefined
                    }
                  >
                    <td className="grid__index">{index + 1}</td>
                    <td title={line.itemName}>
                      {line.itemName || '—'}
                      {editingIndex === index ? (
                        <span className="row-badge">editing</span>
                      ) : null}
                    </td>
                    <td>{line.purity}</td>
                    <td className="numeric">{show(line.gross, unit)}</td>
                    <td className="numeric">{show(line.net, unit)}</td>
                    <td className="numeric">{show(line.wastage, unit)}</td>
                    <td className="numeric is-fine">{show(line.fine, unit)}</td>
                    <td className="numeric">{line.labour.rupees}</td>
                    <td className="numeric">{line.stoneCharges.rupees}</td>
                    <td className="numeric">{line.amount.rupees}</td>
                    <td className="grid__action">
                      {/* No whitespace text node between the two buttons: at
                          this column width it is the difference between one row
                          of controls and two. */}
                      <span className="row-actions">
                        <Action
                          id="retail.item.edit"
                          variant="icon"
                          ariaLabel={`Edit line ${index + 1}`}
                          onActivate={() => onEdit(index)}
                        >
                          <Icon name="pencil" size={16} />
                        </Action>
                        <Action
                          id="retail.item.delete"
                          variant="icon"
                          className="is-danger"
                          ariaLabel={`Delete line ${index + 1}`}
                          onActivate={() => onDelete(index)}
                        >
                          <Icon name="trash" size={16} />
                        </Action>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="grid__index" />
                  <td>Total</td>
                  <td />
                  <td />
                  <td />
                  <td />
                  <td className="numeric">{show(totalFine, unit)}</td>
                  <td className="numeric">{totalLabour?.rupees ?? '0.00'}</td>
                  <td className="numeric">{totalStone?.rupees ?? '0.00'}</td>
                  <td className="numeric">{itemsTotal?.rupees ?? '0.00'}</td>
                  <td className="grid__action" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function CalculationsPanel({
  calc,
  form,
  unit,
  onChange,
}: {
  calc: RetailCalculationDto | null
  form: RetailForm
  unit: WeightUnit
  onChange: <K extends keyof RetailForm>(key: K, value: RetailForm[K]) => void
}) {
  // A derived figure still renders as an input, so the rail reads as one column
  // of controls rather than a column of controls with text dropped between them.
  // The parchment fill and the missing tab stop are what say "not typed here".
  const derived = (value: string) => (
    <input className="input input--computed" value={value} readOnly tabIndex={-1} />
  )

  return (
    <div className="panel">
      <div className="panel__title">CALCULATIONS</div>
      <div className="panel__body">
        {/* The gold group. Kept apart from the money group by a brass rule,
            because they are two different quantities and netting them in the
            eye is the mistake the sign convention exists to prevent. */}
        <div className="calc-line">
          <span className="calc-line__label">Total Fine ({unit})</span>
          {derived(show(calc?.totalFine, unit))}
        </div>
        <div className="calc-line">
          <span className="calc-line__label">Customer Gold ({unit})</span>
          <span className="calc-line__pair">
            <select
              className="select"
              value={form.customerGoldPurity}
              onChange={(e) => onChange('customerGoldPurity', e.target.value)}
              aria-label="Customer gold purity"
            >
              {PURITY_OPTIONS.map((purity) => (
                <option key={purity} value={purity}>
                  {purity.slice(1)}K
                </option>
              ))}
            </select>
            <input
              className="input input--numeric"
              value={form.customerGold.text}
              onChange={(e) => onChange('customerGold', { text: e.target.value, exactMg: null })}
              placeholder="0.000"
              inputMode="decimal"
              aria-label="Customer gold"
            />
          </span>
        </div>
        <div className="calc-line">
          <span className="calc-line__label">Remaining Gold ({unit})</span>
          {derived(show(calc?.remainingGold, unit))}
        </div>

        <div className="calc-rule" />

        <div className="calc-line">
          <span className="calc-line__label">Gold Value</span>
          {derived(calc?.goldValue.rupees ?? '0.00')}
        </div>
        <div className="calc-line">
          <span className="calc-line__label">Labour</span>
          {derived(calc?.totalLabour.rupees ?? '0.00')}
        </div>
        <div className="calc-line">
          <span className="calc-line__label">Stone</span>
          {derived(calc?.totalStone.rupees ?? '0.00')}
        </div>
        <div className="calc-line">
          <span className="calc-line__label">Hallmark</span>
          <input
            className="input input--numeric"
            value={form.hallmarkCharges}
            onChange={(e) => onChange('hallmarkCharges', e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            aria-label="Hallmark charges"
          />
        </div>
        <div className="calc-line">
          <span className="calc-line__label">Other Charges</span>
          <input
            className="input input--numeric"
            value={form.otherCharges}
            onChange={(e) => onChange('otherCharges', e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            aria-label="Other charges"
          />
        </div>
        <div className="calc-line">
          <span className="calc-line__label">Discount</span>
          <input
            className="input input--numeric"
            value={form.discount}
            onChange={(e) => onChange('discount', e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            aria-label="Discount"
          />
        </div>
        {calc && calc.customerGoldValue.paisa !== 0 ? (
          <div className="calc-line">
            <span className="calc-line__label">Less old gold</span>
            {derived(calc.customerGoldValue.rupees)}
          </div>
        ) : null}

        <div className="calc-total">
          <span className="calc-total__label">Grand Total</span>
          <span className="calc-total__value">Rs {calc?.grandTotal.rupees ?? '0.00'}</span>
        </div>
        {/* Live, and the same string that will be stored on the row and printed
            on the paper — rendered once, by the application layer. */}
        <p className="calc-words">{calc?.amountInWords ?? 'Rupees Zero Only'}</p>
      </div>
    </div>
  )
}

/** The 80mm paper artefact, showing what will actually print. */
function InvoicePreview({
  invoiceNo,
  form,
  calc,
  customerName,
}: {
  invoiceNo: string
  form: RetailForm
  calc: RetailCalculationDto | null
  customerName: string
}) {
  const lines = (calc?.lines ?? []).filter((line) => !line.error)
  return (
    <div className="panel">
      <div className="panel__title">INVOICE PREVIEW (80MM)</div>
      <div className="panel__body slip">
        <div className="slip__brand">
          AL-HARAM
          <br />
          GOLD JEWELLERS
        </div>
        <div className="slip__tagline">Trust in Purity</div>
        <div className="slip__rule" />
        <div className="slip__row">
          <span>Invoice No.</span>
          <span>{invoiceNo}</span>
        </div>
        <div className="slip__row">
          <span>Date</span>
          <span>
            {toDisplayDate(form.saleDate)} {form.saleTime}
          </span>
        </div>
        <div className="slip__row">
          <span>Customer</span>
          <span>{customerName || '—'}</span>
        </div>
        <div className="slip__row">
          <span>Rate</span>
          <span>{calc?.rateDisplay ? `${calc.rateDisplay}/tola` : '—'}</span>
        </div>
        {lines.length > 0 ? (
          <>
            <div className="slip__rule" />
            <div className="slip__row slip__head">
              <span>ITEM</span>
              <span>WT</span>
              <span>FINE</span>
              <span>AMOUNT</span>
            </div>
            {lines.map((line, index) => (
              <div className="slip__row slip__item" key={index}>
                <span>{line.itemName}</span>
                <span>{line.gross.gram}</span>
                <span>{line.fine.gram}</span>
                <span>{line.amount.whole}</span>
              </div>
            ))}
            <div className="slip__rule" />
            <div className="slip__row">
              <span>Total Fine</span>
              <span>{calc?.totalFine.gram ?? '0.000'} g</span>
            </div>
          </>
        ) : null}
        <div className="slip__rule" />
        <div className="slip__row">
          <span>Items</span>
          <span>{calc?.itemsTotal.whole ?? '0'}</span>
        </div>
        <div className="slip__row slip__total">
          <span>Grand Total</span>
          <span>Rs {calc?.grandTotal.whole ?? '0'}</span>
        </div>
        <div className="slip__row">
          <span>Paid</span>
          <span>{calc?.amountPaid.whole ?? '0'}</span>
        </div>
        <div className="slip__row slip__total">
          <span>Balance</span>
          <span>Rs {calc?.balance.whole ?? '0'}</span>
        </div>
        <div className="slip__words">{calc?.amountInWords ?? 'Rupees Zero Only'}</div>
        <div className="slip__rule" />
        <div className="slip__centre">Thank You! Visit Again</div>
      </div>
    </div>
  )
}
