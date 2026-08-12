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
import { useMessages } from '../../components/Messages.js'
import { Icon } from '../../shell/Icon.js'
import { RateCard } from '../../components/RateCard.js'
import { CustomerSelector } from './CustomerSelector.js'
import type {
  CustomerDto,
  RateDto,
  RetailBillCalculationDto,
  RetailBillDraftDto,
  RetailCalculationDto,
  RetailDraftFoundDto,
  RetailItemDto,
  RetailLineDto,
  RetailSlipDto,
  WeightDto,
  WeightFieldDto,
  WeightUnit,
} from '../../../shared/ipc.js'

/**
 * The Sale (Retail) screen.
 *
 * ── Nothing here calculates anything ───────────────────────────────────────
 * Not a net weight, not the polish, not a line amount, not the grand total, not
 * the amount in words. Every figure on this screen is produced by
 * RetailSaleService in the main process and arrives preformatted, because the
 * screen calls `retail:bill:calculate` on every keystroke with the whole bill
 * and the row currently being typed. That call is pure and writes nothing, so
 * it is cheaper to ask than to keep a second implementation of the arithmetic
 * here — and a second implementation is one that will eventually disagree with
 * the one that prices the invoice.
 *
 * The renderer's entire job is: hold what was typed, hand it over, and render
 * the strings that come back.
 *
 * ── One invoice, one set of items ──────────────────────────────────────────
 * The screen holds exactly ONE slip and never shows that word. A bill still
 * wraps it — every invoice is a bill with a single implicit slip, numbered 1 and
 * labelled 'Full Bill' — because that is what the schema already stores and what
 * makes the posting atomic. What went is the TAB STRIP: the counter serves one
 * customer, one invoice at a time.
 *
 * Bills written before this change can still hold several slips. Those load, and
 * they load READ-ONLY with a note saying so, rather than silently showing the
 * first slip as though it were the whole visit.
 *
 * ── Slips, as the schema still sees them ───────────────────────────────────
 * One customer visit produces several slips, each its own printable document.
 * What belongs to the VISIT — customer, mobile, salesman, date, time, rate —
 * lives on the bill and is typed once. What belongs to the DOCUMENT — items,
 * charges, discount, payment — lives on the slip. Saving posts every draft slip
 * in one transaction: the whole bill, or none of it.
 *
 * ── The three states that are easy to get wrong ────────────────────────────
 *
 *   1. **Edit in place.** A column loaded back into DETAILS is an unresolved
 *      edit. The column stays visibly marked, ADD ITEM becomes UPDATE ITEM, and
 *      SAVE is REFUSED until it is resolved. A line silently dropped mid-edit is
 *      the worst bug this screen can have, so it is made impossible rather than
 *      unlikely.
 *   2. **The Gram ⇄ Tola toggle.** It re-expresses what is displayed and never
 *      re-parses it: each weight carries the exact milligram main computed, so a
 *      toggle cannot walk a stored weight (see WeightFieldDto).
 *   3. **Saving twice.** Each slip carries a draft id minted when it is created
 *      and sent on every attempt. A retry after a reply that never arrived finds
 *      the bill that already exists instead of writing a second.
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
  purityDeduction: EMPTY_WEIGHT,
  wastagePercent: '',
  labourCharges: '',
  labourMode: 'fixed',
  stoneCharges: '',
}

/** Slip 1's label unless the operator renames it. Matches DEFAULT_SLIP_LABEL. */
const FIRST_SLIP_LABEL = 'Full Bill'

/**
 * How many item columns are visible before the card scrolls sideways.
 *
 * Four, as the mockup draws. Beyond that the columns scroll HORIZONTALLY inside
 * the card — never the page, which is the whole no-page-scroll contract.
 */
const VISIBLE_COLUMNS = 4

interface BillForm {
  saleDate: string
  saleTime: string
  customerId: string | null
  customerName: string
  customerMobile: string
  ratePurity: string
  ratePerTolaOverride: string
  weightUnit: WeightUnit
}

/**
 * The idempotency key, minted once per slip.
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

function emptySlip(slipNo: number, slipLabel: string): RetailSlipDto {
  return {
    slipNo,
    slipLabel,
    draftId: newDraftId(),
    items: [],
    customerGold: EMPTY_WEIGHT,
    customerGoldPurity: 'K22',
    hallmarkCharges: '',
    otherCharges: '',
    discount: '',
    amountPaid: '',
    paymentMethod: 'cash',
    remarks: null,
  }
}

/** A weight in whichever unit the toggle is showing. Chosen, never converted. */
function show(weight: WeightDto | undefined, unit: WeightUnit): string {
  if (!weight) return '0.000'
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

export function RetailScreen({
  today,
  rates,
  onRateSaved,
  onPosted,
}: {
  today: string
  rates: readonly RateDto[]
  onRateSaved: () => void
  onPosted: () => void
}) {
  const [form, setForm] = useState<BillForm>(() => ({
    saleDate: today,
    saleTime: nowHhMm(),
    customerId: null,
    customerName: '',
    customerMobile: '',
    ratePurity: 'K22',
    ratePerTolaOverride: '',
    weightUnit: 'tola',
  }))
  const [slips, setSlips] = useState<readonly RetailSlipDto[]>(() => [
    emptySlip(1, FIRST_SLIP_LABEL),
  ])
  const [activeSlipNo, setActiveSlipNo] = useState(1)
  const [customer, setCustomer] = useState<CustomerDto | null>(null)
  const [entry, setEntry] = useState<RetailItemDto>(EMPTY_ENTRY)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [calc, setCalc] = useState<RetailBillCalculationDto | null>(null)
  const [invoiceNo, setInvoiceNo] = useState('—')
  const [busy, setBusy] = useState(false)
  const [confirmHighWastage, setConfirmHighWastage] = useState<string | null>(null)
  const [lastBillId, setLastBillId] = useState<string | null>(null)
  const [lastSlipSaleIds, setLastSlipSaleIds] = useState<ReadonlyMap<number, string>>(
    new Map(),
  )
  /** A bill somebody was part-way through when the app last closed. */
  const [recovered, setRecovered] = useState<RetailDraftFoundDto | null>(null)
  const { push } = useMessages()

  // A ref as well as state: a second click can arrive before React has
  // re-rendered with a disabled button, and the ref is already set.
  const saving = useRef(false)
  const itemNameRef = useRef<HTMLInputElement>(null)

  const unit = form.weightUnit
  const set = <K extends keyof BillForm>(key: K, value: BillForm[K]): void =>
    setForm((current) => ({ ...current, [key]: value }))

  const activeSlip = slips.find((slip) => slip.slipNo === activeSlipNo) ?? slips[0]

  const setActiveSlip = useCallback(
    (change: (slip: RetailSlipDto) => RetailSlipDto) =>
      setSlips((current) =>
        current.map((slip) => (slip.slipNo === activeSlipNo ? change(slip) : slip)),
      ),
    [activeSlipNo],
  )

  const draft = useMemo<RetailBillDraftDto>(
    () => ({
      saleDate: form.saleDate,
      saleTime: form.saleTime,
      customerId: form.customerId,
      customerName: form.customerName,
      customerMobile: form.customerMobile.trim() || null,
      ratePurity: form.ratePurity,
      ratePerTolaOverride: form.ratePerTolaOverride,
      weightUnit: form.weightUnit,
      slips,
    }),
    [form, slips],
  )

  useEffect(() => {
    void window.api.retailNextInvoiceNo().then(setInvoiceNo)
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
      void window.api
        .retailBillCalculate({ draft, activeSlipNo, entry })
        .then(setCalc)
    }, 120)
    return () => clearTimeout(timer)
  }, [draft, activeSlipNo, entry])

  /**
   * The bill in progress, written to SQLite.
   *
   * 400 ms, longer than the calculate debounce on purpose: a calculation is
   * free and a disk write is not, and nothing on screen waits for this. What it
   * buys is that a crash or a power cut at the counter costs at most the last
   * 400 ms of typing rather than the whole visit.
   *
   * It carries the EDIT position as well as the figures. An unresolved edit
   * blocks a save, so a draft that came back without it would resume into a
   * screen that refuses to save and cannot say which line is at fault.
   *
   * Suppressed while the resume card is up: until the operator has said Resume
   * or Discard, the screen is showing an empty bill that must not be written
   * over the draft it is offering to restore.
   */
  useEffect(() => {
    if (recovered) return
    const timer = setTimeout(() => {
      void window.api.retailDraftSave({
        draft,
        activeSlipNo,
        editingSlipNo: editingIndex === null ? null : activeSlipNo,
        editingLineNo: editingIndex === null ? null : editingIndex + 1,
      })
    }, 400)
    return () => clearTimeout(timer)
  }, [draft, activeSlipNo, editingIndex, recovered])

  /**
   * On launch: is there a bill somebody was part-way through?
   *
   * Never reopened silently and never binned silently. The card names the
   * customer, the slips, the items and the total, and the operator chooses.
   */
  useEffect(() => {
    void window.api.retailDraftFind().then(setRecovered)
  }, [])

  const resumeDraft = useCallback((found: RetailDraftFoundDto) => {
    const state = found.state
    setForm({
      saleDate: state.draft.saleDate,
      saleTime: state.draft.saleTime,
      customerId: state.draft.customerId,
      customerName: state.draft.customerName,
      customerMobile: state.draft.customerMobile ?? '',
      ratePurity: state.draft.ratePurity,
      ratePerTolaOverride: state.draft.ratePerTolaOverride,
      weightUnit: state.draft.weightUnit,
    })
    setSlips(state.draft.slips)
    setActiveSlipNo(state.activeSlipNo)
    // The edit comes back with the rest of it, or the resumed screen would
    // refuse to save and name a line that no longer looks like it is open.
    setEditingIndex(state.editingLineNo === null ? null : state.editingLineNo - 1)
    if (state.editingLineNo !== null) {
      const slip = state.draft.slips.find((s) => s.slipNo === state.editingSlipNo)
      const item = slip?.items[state.editingLineNo - 1]
      if (item) setEntry(item)
    }
    setRecovered(null)
    push('ok', `Resumed the bill for ${found.customerName}. Nothing was lost.`)
  }, [push])

  const discardDraft = useCallback(async () => {
    await window.api.retailDraftDiscard()
    setRecovered(null)
    push('ok', 'That draft has been discarded. Starting a new bill.')
  }, [push])

  const active: RetailCalculationDto | null = calc?.active ?? null
  const lines = active?.lines ?? []

  const setEntryWeight = (key: 'grossWeight' | 'stoneWeight' | 'purityDeduction', text: string) =>
    // exactMg is cleared: the operator has typed, so the text is authoritative
    // again. It is only ever set by the unit toggle.
    setEntry((current) => ({ ...current, [key]: { text, exactMg: null } }))

  const clearEntry = useCallback(() => {
    setEntry(EMPTY_ENTRY)
    setEditingIndex(null)
    itemNameRef.current?.focus()
  }, [])

  /**
   * Adds the typed row to the active slip, or writes it back over the one being
   * edited.
   *
   * The line that goes into the list is the row AS TYPED, not the computed one:
   * the computed figures are re-derived on the next calculate from the same
   * inputs by the same service, so storing them here would be a second copy of
   * the answer that could drift from the first.
   */
  const commitEntry = useCallback(() => {
    if (!entry.itemName.trim() && !entry.grossWeight.text.trim()) {
      push('bad', 'Fill in DETAILS (SELECTED ITEM) before adding it to the slip.')
      return
    }
    const line = entry
    const index = editingIndex
    setActiveSlip((slip) => ({
      ...slip,
      items:
        index === null
          ? [...slip.items, line]
          : slip.items.map((row, i) => (i === index ? line : row)),
    }))
    setEntry(EMPTY_ENTRY)
    setEditingIndex(null)
    itemNameRef.current?.focus()
  }, [entry, editingIndex, push, setActiveSlip])

  const editLine = useCallback(
    (index: number) => {
      const row = activeSlip?.items[index]
      if (!row) return
      setEntry(row)
      setEditingIndex(index)
      itemNameRef.current?.focus()
    },
    [activeSlip],
  )

  const deleteLine = useCallback(
    (index: number) => {
      setActiveSlip((slip) => ({
        ...slip,
        items: slip.items.filter((_, i) => i !== index),
      }))
      // Deleting the column that is open for editing would leave DETAILS
      // holding a line that no longer exists anywhere.
      setEditingIndex((current) =>
        current === null
          ? null
          : current === index
            ? null
            : current > index
              ? current - 1
              : current,
      )
    },
    [setActiveSlip],
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
      setSlips((rows) =>
        rows.map((slip) => {
          const computed = current.slips.find((s) => s.slipNo === slip.slipNo)
          if (!computed) return slip
          return {
            ...slip,
            items: slip.items.map((row, index) => {
              const line = computed.calculation.lines[index]
              if (!line) return row
              return {
                ...row,
                grossWeight: fieldFrom(line.gross, next),
                stoneWeight: fieldFrom(line.stone, next),
                purityDeduction: fieldFrom(line.purityDeduction, next),
              }
            }),
            customerGold: fieldFrom(computed.calculation.customerGold, next),
          }
        }),
      )
      if (current.active.entry) {
        setEntry((row) => ({
          ...row,
          grossWeight: fieldFrom(current.active.entry?.gross, next),
          stoneWeight: fieldFrom(current.active.entry?.stone, next),
          purityDeduction: fieldFrom(current.active.entry?.purityDeduction, next),
        }))
      }
      setForm((f) => ({ ...f, weightUnit: next }))
      return
    }
    set('weightUnit', next)
  }, [unit, calc])

  const startNewBill = useCallback(
    (keepRate: boolean) => {
      setSlips([emptySlip(1, FIRST_SLIP_LABEL)])
      setActiveSlipNo(1)
      setEntry(EMPTY_ENTRY)
      setEditingIndex(null)
      setCustomer(null)
      setLastBillId(null)
      setLastSlipSaleIds(new Map())
      setConfirmHighWastage(null)
      setForm((current) => ({
        ...current,
        saleTime: nowHhMm(),
        customerId: null,
        customerName: '',
        customerMobile: '',
        ratePurity: keepRate ? current.ratePurity : 'K22',
        ratePerTolaOverride: keepRate ? current.ratePerTolaOverride : '',
      }))
      void window.api.retailNextInvoiceNo().then(setInvoiceNo)
    },
    [],
  )

  /**
   * Sends a stored document to the printer.
   *
   * The HTML comes from `@jewellery/printing` over IPC — the same 576-dot
   * document the thermal printer gets — so what prints is the paper, not a
   * screenshot of the screen. It is read back from the SAVED bill, which is why
   * PRINT refuses before a save rather than printing a draft that does not
   * exist in the books.
   */
  const printHtml = useCallback(async (html: string | null): Promise<boolean> => {
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
  }, [])

  const printSlip = useCallback(
    async (slipNo: number) => {
      const saleId = lastSlipSaleIds.get(slipNo)
      if (!saleId) {
        push('bad', `Slip ${slipNo} has not been saved yet. Save the bill first.`)
        return
      }
      const printed = await printHtml(await window.api.retailReceipt(saleId))
      if (!printed) push('bad', 'That slip could not be read back for printing.')
    },
    [lastSlipSaleIds, printHtml, push],
  )

  const printBill = useCallback(async () => {
    if (!lastBillId) {
      push('bad', 'There is nothing to print yet. Save the bill first.')
      return
    }
    const printed = await printHtml(await window.api.retailBillReceipt(lastBillId))
    if (!printed) push('bad', 'That bill could not be read back for printing.')
  }, [lastBillId, printHtml, push])

  const commit = useCallback(
    async (thenPrint: boolean, confirmed = false) => {
      if (saving.current) return
      // The refusal that matters most on this screen. A column loaded back into
      // DETAILS is an edit nobody has resolved; saving now would write the bill
      // WITHOUT the change and nothing on screen would say so.
      if (editingIndex !== null) {
        push(
          'bad',
          `Item ${editingIndex + 1} is open for editing. Press UPDATE ITEM to write your ` +
            `changes back, or ABANDON EDIT to leave that item exactly as it was. ` +
            `Saving now would drop what you have typed.`,
        )
        return
      }
      saving.current = true
      setBusy(true)
      try {
        const result = await window.api.retailBillSave({
          draft: confirmed ? { ...draft, confirmedHighWastage: true } : draft,
        })

        if (!result.ok) {
          if ('needsConfirmation' in result) {
            setConfirmHighWastage(result.message)
            return
          }
          push('bad', result.message)
          return
        }

        setConfirmHighWastage(null)
        setLastBillId(result.billId)
        setLastSlipSaleIds(new Map(result.slips.map((slip) => [slip.slipNo, slip.saleId])))

        const printed = thenPrint
          ? await printHtml(await window.api.retailBillReceipt(result.billId))
          : false
        push(
          'ok',
          `Saved ${result.billNo} — ${result.slips.length} slip` +
            `${result.slips.length === 1 ? '' : 's'} ` +
            `(${result.slips.map((slip) => slip.invoiceNo).join(', ')}). ` +
            `Rs ${result.billTotal}.` +
            (printed ? ' Sent to the printer.' : ''),
        )
        // A fresh bill with the RATE kept: the next customer is served at the
        // same rate, and retyping it on every sale is how a counter ends up
        // with the wrong one.
        startNewBill(true)
        onPosted()
      } finally {
        saving.current = false
        setBusy(false)
      }
    },
    [draft, editingIndex, onPosted, printHtml, push, startNewBill],
  )

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
      `${form.customerName || 'Customer'} — ${invoiceNo}\n` +
      (calc?.slips ?? [])
        .map((slip) => `${slip.slipLabel}: Rs ${slip.total}`)
        .join('\n') +
      `\nTotal: Rs ${calc?.billTotal.rupees ?? '0.00'}`
    const result = await window.api.openExternal(
      `https://wa.me/${international}?text=${encodeURIComponent(summary)}`,
    )
    if (!result.ok) push('bad', result.message)
  }, [calc, form.customerMobile, form.customerName, invoiceNo, push])

  // Published so the shell's action registry can drive these controls.
  useEffect(() => {
    const handlers: Record<string, () => void> = {
      'retail.item.add': commitEntry,
      'retail.item.clear': clearEntry,
      'retail.unit.toggle': toggleUnit,
      'retail.rate.refresh': () => set('ratePerTolaOverride', ''),
      'retail.save': () => void commit(false),
      'retail.save-and-print': () => void commit(true),
      'retail.print': () => void printBill(),
      'retail.bill.print': () => void printBill(),
      'retail.new': () => startNewBill(true),
      'retail.cancel': () => startNewBill(false),
      'retail.wastage.confirm': () => void commit(false, true),
      'retail.wastage.back': () => setConfirmHighWastage(null),
      'quick.retail-whatsapp': () => void sendOnWhatsApp(),
    }
    const listener = (event: Event): void => {
      handlers[(event as CustomEvent<string>).detail]?.()
    }
    window.addEventListener('jewellery:action', listener)
    return () => window.removeEventListener('jewellery:action', listener)
  }, [
    commit,
    commitEntry,
    clearEntry,
    printBill,
    sendOnWhatsApp,
    startNewBill,
    toggleUnit,
  ])

  /**
   * The function keys the action bar advertises.
   *
   * F2 is the one that matters most: at a counter an item is added dozens of
   * times a sale, and reaching for the mouse each time is the difference between
   * typing a sale and operating a form.
   */
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      const keys: Record<string, () => void> = {
        F2: commitEntry,
        F5: () => void commit(false),
        F6: () => void printBill(),
        F9: () => startNewBill(true),
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
  }, [commit, commitEntry, printBill, startNewBill])

  const rateMissing = calc?.rateMissing ?? false
  const editing = editingIndex !== null

  return (
    <div className="retail">
      {/* ── the header strip, replacing the deleted top bar ───────────────── */}
      <div className="retail__head">
        <div className="bill-fields">
          <label className="stack-field">
            <span className="stack-field__label">Invoice No :</span>
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
            label="Date :"
            ariaLabel="Sale date"
          />
          <label className="stack-field">
            <span className="stack-field__label">Time :</span>
            <span className="input-group">
              <input
                className="input input--numeric"
                value={form.saleTime}
                onChange={(e) => set('saleTime', e.target.value)}
                placeholder="HH:MM"
                inputMode="numeric"
                aria-label="Sale time"
              />
              <span className="input-group__glyph" aria-hidden="true">
                <Icon name="clock" size={16} />
              </span>
            </span>
          </label>
        </div>

        {/* Underlined baseline fields, as the mockup draws them: a label and a
            rule, with no box. They are the visit's facts, shared by every slip. */}
        <div className="bill-party">
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
                // Auto-filled from the customer, and still editable: a walk-in
                // gives a number that belongs to nobody on file.
                customerMobile: picked?.mobile ?? current.customerMobile,
              }))
            }}
            variant="baseline"
          />
          <label className="baseline-field">
            <span className="baseline-field__label">Mobile :</span>
            <input
              className="baseline-field__input"
              value={form.customerMobile}
              onChange={(e) => set('customerMobile', e.target.value)}
              placeholder="0300-0000000"
              aria-label="Customer mobile"
            />
          </label>
        </div>

        <RateCard rates={rates} onSaved={onRateSaved} />
      </div>

      <div className="retail__notices">
        {/*
          A bill somebody was part-way through.

          Never reopened silently and never binned silently: the operator is
          told what is there and chooses. Until they do, the debounced save is
          suppressed, so the empty screen behind this card cannot overwrite the
          draft it is offering to restore.
        */}
        {recovered ? (
          <div className="confirm">
            <p className="confirm__text">
              A bill for <strong>{recovered.customerName}</strong> was still open when
              the application last closed — {recovered.slipCount} slip
              {recovered.slipCount === 1 ? '' : 's'}, {recovered.itemCount} item
              {recovered.itemCount === 1 ? '' : 's'}, Rs {recovered.total}. Nothing has
              been posted.
            </p>
            <div className="confirm__actions">
              <Action
                id="retail.draft.discard"
                variant="ghost"
                onActivate={() => void discardDraft()}
              >
                Discard it
              </Action>
              <Action
                id="retail.draft.resume"
                className="login__submit"
                onActivate={() => resumeDraft(recovered)}
              >
                Resume this bill
              </Action>
            </div>
          </div>
        ) : null}

        {rateMissing ? (
        <div className="banner">
          No {form.ratePurity.slice(1)}K gold rate is recorded on or before this date. Set
          it in the GOLD RATE card above before saving — every amount here depends on it.
        </div>
      ) : null}

      {active?.warnings.map((warning) => (
        <div className="banner" key={warning}>
          {warning}
        </div>
      ))}

      {/* High wastage is a QUESTION, not an error, so it carries a Continue
          button rather than only being dismissable. */}
      {confirmHighWastage ? (
        <div className="confirm">
          <p className="confirm__text">{confirmHighWastage}</p>
          <div className="confirm__actions">
            <Action id="retail.wastage.back" variant="ghost">
              Go back and check it
            </Action>
            <Action id="retail.wastage.confirm" className="login__submit" busy={busy}>
              Save this bill anyway
            </Action>
          </div>
        </div>
      ) : null}
      </div>

      {/* ── the working area ──────────────────────────────────────────────── */}
      <div className="retail__body">
        <div className="retail__left">
          <ItemColumns
            slipNo={activeSlipNo}
            slipLabel={activeSlip?.slipLabel ?? FIRST_SLIP_LABEL}
            lines={lines}
            unit={unit}
            editingIndex={editingIndex}
            onEdit={editLine}
            onDelete={deleteLine}
            onPrint={() => void printSlip(activeSlipNo)}
            editing={editing}
            onItemPurity={(index, purity) =>
              setActiveSlip((slip) => ({
                ...slip,
                items: slip.items.map((row, i) =>
                  i === index ? { ...row, purity } : row,
                ),
              }))
            }
          />

          <div className="details-row">
            <DetailsCard
              entry={entry}
              computed={active?.entry ?? null}
              unit={unit}
              itemNameRef={itemNameRef}
              onName={(value) => setEntry((c) => ({ ...c, itemName: value }))}
              onWeight={setEntryWeight}
              onPercent={(value) => setEntry((c) => ({ ...c, wastagePercent: value }))}
              onLabour={(value) => setEntry((c) => ({ ...c, labourCharges: value }))}
              onLabourMode={() =>
                setEntry((c) => ({
                  ...c,
                  labourMode: c.labourMode === 'fixed' ? 'per_tola' : 'fixed',
                }))
              }
              onStoneCharges={(value) => setEntry((c) => ({ ...c, stoneCharges: value }))}
              onCommit={commitEntry}
            />

            <div className="details-side">
              <Action id="retail.unit.toggle" variant="outline" className="unit-toggle">
                <Icon name="refresh" size={16} />
                <span>Gram ⇄ Tola</span>
              </Action>
              <Action
                id="retail.save"
                variant="outline"
                className="is-save-print"
                busy={busy}
              >
                <Icon name="save" size={18} />
                <span>SAVE (F5)</span>
              </Action>
              <Action id="retail.item.clear" variant="outline">
                <Icon name="refresh" size={18} />
                <span>{editing ? 'ABANDON EDIT' : 'REFRESH'}</span>
              </Action>
            </div>
          </div>

          <PaymentBlock
            slip={activeSlip}
            balance={active?.balance.rupees ?? '0.00'}
            outstanding={(active?.balance.paisa ?? 0) !== 0}
            onChange={(patch) => setActiveSlip((slip) => ({ ...slip, ...patch }))}
          />
        </div>

        <aside className="retail__rail">
          <SummaryCard
            calc={active}
            slip={activeSlip}
            unit={unit}
            onChange={(patch) => setActiveSlip((slip) => ({ ...slip, ...patch }))}
          />
          <BillCalculationsCard
            calc={active}
            slip={activeSlip}
            onChange={(patch) => setActiveSlip((slip) => ({ ...slip, ...patch }))}
          />
        </aside>
      </div>

      {/* ── the action bar ────────────────────────────────────────────────── */}
      <div className="retail__actions">
        <Action id="retail.print" variant="outline" className="is-print">
          <Icon name="print" size={18} />
          <span>PRINT (F6)</span>
        </Action>
        <Action id="quick.retail-whatsapp" variant="outline" className="is-whatsapp">
          <Icon name="whatsapp" size={18} />
          {/* Marked as leaving the app, in the label itself rather than only in
              a note somebody has to find. */}
          <span>WHATSAPP ↗</span>
        </Action>
        <Action id="retail.save" variant="primary" className="is-save" busy={busy}>
          <Icon name="save" size={18} />
          <span>SAVE (F5)</span>
        </Action>
        <Action id="retail.new" variant="outline" className="is-cancel">
          <Icon name="cross" size={18} />
          <span>NEW SALE</span>
        </Action>
      </div>

    </div>
  )
}

/**
 * Items as COLUMNS, not rows.
 *
 * The left-most column is a fixed label stack on ink; each item is a column
 * beside it. That is what the mockup draws, and it suits the shape of the data:
 * a retail line has ten attributes and a sale usually has two or three items, so
 * a table would be three rows of ten columns — mostly heading, mostly empty.
 *
 * More than four items scroll the COLUMNS sideways inside this card. The page
 * itself never scrolls; that is the contract in Section 5.
 */
const ROW_LABELS = [
  'Item Name',
  'Weight',
  'Stone',
  'Purity Deduction',
  'Net Weight',
  'Polish %',
  'Polish',
  'Rate (PKR)',
  'Amount (PKR)',
  'Action',
] as const

function ItemColumns({
  slipNo,
  slipLabel,
  lines,
  unit,
  editingIndex,
  onEdit,
  onDelete,
  onPrint,
  editing,
  onItemPurity,
}: {
  slipNo: number
  slipLabel: string
  lines: readonly RetailLineDto[]
  unit: WeightUnit
  editingIndex: number | null
  onEdit: (index: number) => void
  onDelete: (index: number) => void
  onPrint: () => void
  editing: boolean
  onItemPurity: (index: number, purity: string) => void
}) {
  const unitWord = unit === 'tola' ? 'Tola' : 'Gram'
  // Always at least the mockup's four column slots, so an empty slip still reads
  // as a place items go rather than as a blank card.
  const slots = Math.max(VISIBLE_COLUMNS, lines.length)

  return (
    <div className="items-card">
      <div className="items-card__head">
        <span>
          {/* An unnamed slip gets no empty parentheses after its number. */}
          ITEMS IN SLIP {slipNo}
          {slipLabel.trim() ? ` (${slipLabel.toUpperCase()})` : ''}
        </span>
        {/* In the label stack this cost 44px of a region whose ten label rows
            are a fixed cost — and it is not one of the ten. */}
        <Action id="retail.item.add" variant="outline" className="item-labels__add">
          <Icon name="plus" size={14} />
          <span>{editing ? 'UPDATE ITEM' : 'ADD ITEM'}</span>
        </Action>
      </div>

      <div className="items-card__body">
        <div className="item-labels">
          {/* Aligns the stack with the columns, which begin with a numbered
              header. Without it every label sits against the wrong figure. */}
          <div className="item-labels__spacer" aria-hidden="true" />
          {ROW_LABELS.map((label) => (
            <div className="item-labels__cell" key={label}>
              {label === 'Weight' ||
              label === 'Stone' ||
              label === 'Purity Deduction' ||
              label === 'Net Weight' ||
              label === 'Polish'
                ? `${label} (${unitWord})`
                : label}
            </div>
          ))}
        </div>

        {/* The ONE region on this screen allowed to scroll sideways. */}
        <div className="item-columns">
          {Array.from({ length: slots }, (_, index) => {
            const line = lines[index]
            const isEditing = editingIndex === index
            return (
              <div
                className={`item-column${isEditing ? ' is-editing' : ''}${
                  line ? '' : ' is-empty'
                }`}
                key={index}
              >
                <div className="item-column__head">
                  {index + 1}. {line?.itemName?.trim() || 'Item'}
                  {isEditing ? <span className="row-badge">editing</span> : null}
                </div>
                <div className="item-column__cell">{line?.itemName || '-'}</div>
                <div className="item-column__cell numeric">{show(line?.gross, unit)}</div>
                <div className="item-column__cell numeric">{show(line?.stone, unit)}</div>
                {/*
                  The COMPUTED deduction, not the per-tola figure that was typed.
                  The cut is quoted per tola of gross, so on a 2.000-tola piece a
                  0.090 cut removes 0.180 — and this row has to be the number the
                  Net Weight beneath it was actually reduced by, or the column
                  does not add up in the operator's hand.
                */}
                <div className="item-column__cell numeric">
                  {line ? show(deductionOf(line), unit) : '0.000'}
                </div>
                <div className="item-column__cell numeric is-emphasis">
                  {show(line?.net, unit)}
                </div>
                <div className="item-column__cell numeric">
                  {line?.wastagePercent ?? '0.00'}
                </div>
                <div className="item-column__cell numeric">{show(line?.wastage, unit)}</div>
                {/* Purity is per-item data, so the select lives HERE rather
                    than in the label stack — every other cell in that stack is
                    a static label, and one item may be 22K while the next is
                    18K. The rate fills in from the chosen purity. */}
                <div className="item-column__cell item-column__rate">
                  {line ? (
                    <>
                      <select
                        className="item-column__purity"
                        value={line.purityCode}
                        onChange={(e) => onItemPurity(index, e.target.value)}
                        aria-label={`Item ${index + 1} purity`}
                      >
                        {PURITY_OPTIONS.map((purity) => (
                          <option key={purity} value={purity}>
                            {purity.slice(1)}K
                          </option>
                        ))}
                      </select>
                      <span className="numeric">{line.rateDisplay ?? '—'}</span>
                    </>
                  ) : (
                    <span className="numeric">0</span>
                  )}
                </div>
                <div className="item-column__cell numeric is-amount">
                  {line?.amount.rupees ?? '0.00'}
                </div>
                <div className="item-column__cell item-column__actions">
                  {line ? (
                    <>
                      <Action
                        id="retail.item.print"
                        variant="icon"
                        ariaLabel={`Print item ${index + 1}`}
                        onActivate={onPrint}
                      >
                        <Icon name="print" size={16} />
                      </Action>
                      <Action
                        id="retail.item.edit"
                        variant="icon"
                        ariaLabel={`Edit item ${index + 1}`}
                        onActivate={() => onEdit(index)}
                      >
                        <Icon name="pencil" size={16} />
                      </Action>
                      <Action
                        id="retail.item.delete"
                        variant="icon"
                        className="is-danger"
                        ariaLabel={`Delete item ${index + 1}`}
                        onActivate={() => onDelete(index)}
                      >
                        <Icon name="trash" size={16} />
                      </Action>
                    </>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * The deduction actually taken off this line, as a weight.
 *
 * gross − stone − net, which is exactly what `computeRetailLine` subtracted.
 * Derived from figures main computed rather than recomputed here: the renderer
 * does no arithmetic, and this is a subtraction of two integers it was handed.
 */
function deductionOf(line: RetailLineDto): WeightDto {
  const mg = line.gross.mg - line.stone.mg - line.net.mg
  // Formatting is the one thing the renderer may do with a milligram, and it
  // borrows the strings main already produced for the two units.
  return {
    mg,
    gram: formatMg(mg, 1000),
    tola: formatMg(mg, 11_664),
  }
}

/** Three decimals of a unit, from an exact milligram. Display only. */
function formatMg(mg: number, per: number): string {
  const sign = mg < 0 ? '-' : ''
  const magnitude = Math.abs(mg)
  const thousandths = Math.round((magnitude * 1000) / per)
  const whole = Math.trunc(thousandths / 1000)
  const fraction = (thousandths % 1000).toString().padStart(3, '0')
  return `${sign}${whole.toLocaleString('en-US')}.${fraction}`
}

/** The eight numbered fields, in two columns of four, as the mockup numbers them. */
function DetailsCard({
  entry,
  computed,
  unit,
  itemNameRef,
  onName,
  onWeight,
  onPercent,
  onLabour,
  onLabourMode,
  onStoneCharges,
  onCommit,
}: {
  entry: RetailItemDto
  computed: RetailLineDto | null
  unit: WeightUnit
  itemNameRef: React.RefObject<HTMLInputElement | null>
  onName: (value: string) => void
  onWeight: (key: 'grossWeight' | 'stoneWeight' | 'purityDeduction', text: string) => void
  onPercent: (value: string) => void
  onLabour: (value: string) => void
  onLabourMode: () => void
  onStoneCharges: (value: string) => void
  onCommit: () => void
}) {
  const unitWord = unit === 'tola' ? 'Tola' : 'Gram'
  return (
    <div className="details-card">
      <div className="details-card__head">DETAILS (SELECTED ITEM)</div>
      <div className="details-grid">
        <NumberedField n={1} label="Item Name">
          <input
            ref={itemNameRef}
            className="input"
            value={entry.itemName}
            onChange={(e) => onName(e.target.value)}
            placeholder="Ring"
            aria-label="Item name"
          />
        </NumberedField>
        <NumberedField n={5} label={`Net Weight (${unitWord})`}>
          <input
            className="input input--computed numeric"
            value={show(computed?.net, unit)}
            readOnly
            tabIndex={-1}
            aria-label="Net weight"
          />
        </NumberedField>

        <NumberedField n={2} label={`Weight (${unitWord})`}>
          <input
            className="input input--numeric"
            value={entry.grossWeight.text}
            onChange={(e) => onWeight('grossWeight', e.target.value)}
            placeholder="0.000"
            inputMode="decimal"
            aria-label="Gross weight"
          />
        </NumberedField>
        <NumberedField n={6} label="Polish %">
          <input
            className="input input--numeric"
            value={entry.wastagePercent}
            onChange={(e) => onPercent(e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            aria-label="Polish percent"
          />
        </NumberedField>

        <NumberedField n={3} label={`Stone (${unitWord})`}>
          <input
            className="input input--numeric"
            value={entry.stoneWeight.text}
            onChange={(e) => onWeight('stoneWeight', e.target.value)}
            placeholder="0.000"
            inputMode="decimal"
            aria-label="Stone weight"
          />
        </NumberedField>
        <NumberedField n={7} label={`Polish (${unitWord})`}>
          <input
            className="input input--computed numeric"
            value={show(computed?.wastage, unit)}
            readOnly
            tabIndex={-1}
            aria-label="Polish weight"
          />
        </NumberedField>

        <NumberedField
          n={4}
          label={`Purity Deduction (${unitWord})`}
          /* The implied share of gross, computed on main. A deduction is typed
             as an absolute figure, so nothing on the screen would otherwise say
             whether 0.900 on a 2.000-tola piece was a slip of the finger — this
             turns it into "45.00%", which is obviously wrong at a glance. */
          hint={
            computed && computed.gross.mg > 0
              ? `${show(computed.purityDeduction, unit)} of ${show(computed.gross, unit)} = ${computed.purityDeductionPercent}%`
              : undefined
          }
        >
          <input
            className="input input--numeric"
            value={entry.purityDeduction.text}
            onChange={(e) => onWeight('purityDeduction', e.target.value)}
            placeholder="0.000"
            inputMode="decimal"
            aria-label="Purity deduction"
          />
        </NumberedField>
        <NumberedField n={8} label="Total Gold (After Polish)">
          <input
            className="input input--computed numeric is-emphasis"
            value={show(computed?.fine, unit)}
            readOnly
            tabIndex={-1}
            aria-label="Total gold after polish"
          />
        </NumberedField>

        {/* Labour and stone charges are not in the mockup's eight, and a line
            cannot be priced without them — so they sit beneath the numbered
            grid rather than being dropped or renumbered into it. */}
        <NumberedField label="Labour Charges">
          <span className="input-group">
            <input
              className="input input--numeric"
              value={entry.labourCharges}
              onChange={(e) => onLabour(e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              aria-label="Labour charges"
            />
            <Action
              id="retail.labour.mode"
              variant="mode"
              className={entry.labourMode === 'per_tola' ? 'is-active' : ''}
              ariaLabel="Labour charge mode"
              onActivate={onLabourMode}
            >
              {entry.labourMode === 'per_tola' ? '/tola' : 'fixed'}
            </Action>
          </span>
        </NumberedField>
        <NumberedField label="Stone Charges">
          <input
            className="input input--numeric"
            value={entry.stoneCharges}
            onChange={(e) => onStoneCharges(e.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              // Enter in the last field does what F2 does.
              if (event.key === 'Enter') {
                event.preventDefault()
                onCommit()
              }
            }}
            placeholder="0.00"
            inputMode="decimal"
            aria-label="Stone charges"
          />
        </NumberedField>
      </div>
      {computed?.error ? <p className="hint hint--bad">{computed.error}</p> : null}
    </div>
  )
}

function NumberedField({
  n,
  label,
  hint,
  children,
}: {
  n?: number
  label: string
  hint?: string | undefined
  children: React.ReactNode
}) {
  return (
    <label className={`numbered-field${hint ? ' has-hint' : ''}`}>
      <span className="numbered-field__label">
        {n === undefined ? label : `${n}. ${label}`}
      </span>
      {children}
      {hint ? <span className="numbered-field__hint">{hint}</span> : null}
    </label>
  )
}

/** SUMMARY: the weights, then what the customer brings, then payable gold. */
function SummaryCard({
  calc,
  slip,
  unit,
  onChange,
}: {
  calc: RetailCalculationDto | null
  slip: RetailSlipDto | undefined
  unit: WeightUnit
  onChange: (patch: Partial<RetailSlipDto>) => void
}) {
  const lines = calc?.lines ?? []
  // Totals of the two columns the summary shows per item. Both are figures main
  // already computed; adding integers it was handed is not a calculation the
  // renderer is doing on the operator's behalf.
  const totalGross = lines.reduce((sum, line) => sum + line.gross.mg, 0)
  const totalStone = lines.reduce((sum, line) => sum + line.stone.mg, 0)
  const totalDeduction = lines.reduce(
    (sum, line) => sum + (line.gross.mg - line.stone.mg - line.net.mg),
    0,
  )
  const totalNet = lines.reduce((sum, line) => sum + line.net.mg, 0)
  const totalPolish = lines.reduce((sum, line) => sum + line.wastage.mg, 0)
  const per = unit === 'tola' ? 11_664 : 1000

  return (
    <div className="panel panel--summary">
      <div className="panel__title">SUMMARY</div>
      <div className="panel__body">
        {/*
          Each item by name and weight, as the mockup lists them.

          This region scrolls on its own once there are more items than fit. The
          totals chain BELOW it must never be pushed off — those are the figures
          the sale exists to produce, and a summary that hides them to show a
          seventh item name has its priorities backwards.
        */}
        <div className="sum-items">
          {lines.length === 0 ? (
            <div className="sum-line sum-line--muted">
              <span className="sum-line__label">No items yet</span>
              <span className="sum-line__value">0.000</span>
            </div>
          ) : (
            lines.map((line, index) => (
              <div className="sum-line" key={index}>
                <span className="sum-line__label">
                  {line.itemName || `Item ${index + 1}`}
                </span>
                <span className="sum-line__value">{show(line.gross, unit)}</span>
              </div>
            ))
          )}
        </div>

        <div className="calc-rule" />

        <div className="sum-line">
          <span className="sum-line__label">Total Weight</span>
          <span className="sum-line__value">{formatMg(totalGross, per)}</span>
        </div>
        <Deduction label="Stone" value={formatMg(totalStone, per)} />
        <Deduction label="Purity Deduction" value={formatMg(totalDeduction, per)} />
        <div className="sum-line">
          <span className="sum-line__label">Net Weight (Before Polish)</span>
          <span className="sum-line__value positive">{formatMg(totalNet, per)}</span>
        </div>
        {/* Polish is ADDED under the locked rule, so it carries no minus. */}
        <div className="sum-line">
          <span className="sum-line__label">Polish</span>
          <span className="sum-line__value">{formatMg(totalPolish, per)}</span>
        </div>
        <div className="sum-line sum-line--highlight">
          <span className="sum-line__label">Total Weight After Polish</span>
          <span className="sum-line__value">{show(calc?.totalFine, unit)}</span>
        </div>

        <div className="calc-rule" />

        <div className="sum-line sum-line--input">
          <span className="sum-line__label">Rupees (Customer Amount)</span>
          <input
            className="input input--numeric"
            value={slip?.amountPaid ?? ''}
            onChange={(e) => onChange({ amountPaid: e.target.value })}
            placeholder="0"
            inputMode="decimal"
            aria-label="Customer amount"
          />
          <span className="minus-marker" aria-hidden="true">
            −
          </span>
        </div>
        <div className="sum-line sum-line--input">
          <span className="sum-line__label">Advance Gold (Customer Gold)</span>
          <input
            className="input input--numeric"
            value={slip?.customerGold.text ?? ''}
            onChange={(e) => onChange({ customerGold: { text: e.target.value, exactMg: null } })}
            placeholder="0.000"
            inputMode="decimal"
            aria-label="Advance gold"
          />
          <span className="minus-marker" aria-hidden="true">
            −
          </span>
        </div>

        <div className="sum-total">
          <span className="sum-total__label">TOTAL (PAYABLE GOLD)</span>
          <span className="sum-total__value">{show(calc?.remainingGold, unit)}</span>
        </div>
      </div>
    </div>
  )
}

/** A row whose figure is taken away. The marker is muted, and never on a plus. */
function Deduction({ label, value }: { label: string; value: string }) {
  return (
    <div className="sum-line">
      <span className="sum-line__label">{label}</span>
      <span className="sum-line__value">{value}</span>
      <span className="minus-marker" aria-hidden="true">
        −
      </span>
    </div>
  )
}

function BillCalculationsCard({
  calc,
  slip,
  onChange,
}: {
  calc: RetailCalculationDto | null
  slip: RetailSlipDto | undefined
  onChange: (patch: Partial<RetailSlipDto>) => void
}) {
  const outstanding = (calc?.balance.paisa ?? 0) !== 0
  const derived = (value: string) => (
    <input className="input input--computed numeric" value={value} readOnly tabIndex={-1} />
  )

  return (
    <div className="panel panel--bill">
      <div className="panel__title">BILL CALCULATIONS</div>
      <div className="panel__body">
        <div className="sum-line sum-line--input">
          <span className="sum-line__label">Gold Value</span>
          {derived(calc?.goldValue.rupees ?? '0.00')}
        </div>
        <div className="sum-line sum-line--input">
          <span className="sum-line__label">Labour Charges</span>
          {derived(calc?.totalLabour.rupees ?? '0.00')}
        </div>
        <div className="sum-line sum-line--input">
          <span className="sum-line__label">Stone Charges</span>
          {derived(calc?.totalStone.rupees ?? '0.00')}
        </div>
        <div className="sum-line sum-line--input">
          <span className="sum-line__label">Hallmark Charges</span>
          <input
            className="input input--numeric"
            value={slip?.hallmarkCharges ?? ''}
            onChange={(e) => onChange({ hallmarkCharges: e.target.value })}
            placeholder="0"
            inputMode="decimal"
            aria-label="Hallmark charges"
          />
        </div>
        <div className="sum-line sum-line--input">
          <span className="sum-line__label">Other Charges</span>
          <input
            className="input input--numeric"
            value={slip?.otherCharges ?? ''}
            onChange={(e) => onChange({ otherCharges: e.target.value })}
            placeholder="0"
            inputMode="decimal"
            aria-label="Other charges"
          />
        </div>
        <div className="sum-line sum-line--input">
          <span className="sum-line__label">Discount</span>
          <input
            className="input input--numeric"
            value={slip?.discount ?? ''}
            onChange={(e) => onChange({ discount: e.target.value })}
            placeholder="0"
            inputMode="decimal"
            aria-label="Discount"
          />
          <span className="minus-marker" aria-hidden="true">
            −
          </span>
        </div>

        <div className="grand-total">
          <span className="grand-total__label">GRAND TOTAL AMOUNT</span>
          <span className="grand-total__value">{calc?.invoiceTotal.rupees ?? '0.00'}</span>
        </div>

        <div className="sum-line sum-line--input">
          <span className="sum-line__label">Customer Amount Paid</span>
          {derived(calc?.amountPaid.rupees ?? '0.00')}
          <span className="minus-marker" aria-hidden="true">
            −
          </span>
        </div>

        <div className="balance-row">
          <span className="balance-row__label">Remaining Balance (PKR)</span>
          <span className={`balance-row__value${outstanding ? ' is-outstanding' : ''}`}>
            {calc?.balance.rupees ?? '0.00'}
          </span>
        </div>
      </div>
    </div>
  )
}

function PaymentBlock({
  slip,
  balance,
  outstanding,
  onChange,
}: {
  slip: RetailSlipDto | undefined
  balance: string
  outstanding: boolean
  onChange: (patch: Partial<RetailSlipDto>) => void
}) {
  return (
    <div className="payment-block">
      <div className="payment-block__title">PAYMENT</div>
      <div className="payment-block__grid">
        {/* Stacked on the left, as the mockup draws them… */}
        <div className="payment-block__fields">
          <label className="payment-field">
            <span className="payment-field__label">Payment Amount (PKR)</span>
            <input
              className="input input--numeric"
              value={slip?.amountPaid ?? ''}
              onChange={(e) => onChange({ amountPaid: e.target.value })}
              placeholder="0.00"
              inputMode="decimal"
              aria-label="Payment amount"
            />
          </label>
          <label className="payment-field">
            <span className="payment-field__label">Payment Method</span>
            <select
              className="select"
              value={slip?.paymentMethod ?? 'cash'}
              onChange={(e) => onChange({ paymentMethod: e.target.value })}
              aria-label="Payment method"
            >
              {PAYMENT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {/* …and the figure they produce on the right, at figure size. */}
        <div className="payment-balance">
          <span className="payment-balance__label">Remaining Balance (PKR)</span>
          <span className={`payment-balance__value${outstanding ? ' is-outstanding' : ''}`}>
            {balance}
          </span>
        </div>
      </div>
    </div>
  )
}
