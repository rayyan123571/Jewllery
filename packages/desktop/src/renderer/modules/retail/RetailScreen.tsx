import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Action } from '../../actions/Action.js'
import { DateField } from '../../components/DateField.js'
import { useMessages } from '../../components/Messages.js'
import { Modal } from '../../components/Modal.js'
import { Icon } from '../../shell/Icon.js'
import { RateCard } from '../../components/RateCard.js'
import { CustomerSelector } from './CustomerSelector.js'
import { ItemsGrid } from './ItemsGrid.js'
import type {
  CustomerDto,
  RateDto,
  RetailBillCalculationDto,
  RetailBillDraftDto,
  RetailCalculationDto,
  RetailDraftFoundDto,
  RetailInvoiceDto,
  RetailItemDto,
  RetailNeighboursDto,
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


const PAYMENT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'credit', label: 'Credit — customer account' },
]

const EMPTY_WEIGHT: WeightFieldDto = { text: '', exactMg: null }

const EMPTY_ITEM: RetailItemDto = {
  itemName: '',
  purity: 'K22',
  grossWeight: EMPTY_WEIGHT,
  stoneWeight: EMPTY_WEIGHT,
  purityDeduction: EMPTY_WEIGHT,
  wastagePercent: '',
  labourCharges: '',
  labourMode: 'fixed',
  stoneCharges: '',
  ratePerTola: '',
}

/** Slip 1's label unless the operator renames it. Matches DEFAULT_SLIP_LABEL. */
const FIRST_SLIP_LABEL = 'Full Bill'


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
/** Nowhere to go, which is what four disabled arrows look like. */
const NOWHERE: RetailNeighboursDto = {
  first: null,
  previous: null,
  next: null,
  last: null,
}

/**
 * A navigation the operator has been asked about but not yet answered.
 *
 * `what` is shown in the dialog so the question names the destination — "go to
 * invoice 4", not "leave this page". `run` is the move itself, held until an
 * answer arrives, so nothing about the destination has to be recomputed after.
 */
interface Guarded {
  readonly what: string
  readonly run: () => void | Promise<void>
}

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
  /** Set by ADD ITEM so the new column takes the caret, cleared once it has. */
  const [focusNewColumn, setFocusNewColumn] = useState(false)
  /** The column whose deletion is waiting on an answer. */
  const [confirmDeleteItem, setConfirmDeleteItem] = useState<number | null>(null)
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

  // ── the book, and where the screen is in it ───────────────────────────────
  /**
   * The stored invoice on screen, or null when this is a new bill.
   *
   * Null is not "invoice zero" — it is the bill being typed, which sits one
   * PAST the end of the book. That is why `neighbours` is asked with null and
   * answers with PREV pointing at the newest invoice and NEXT pointing nowhere.
   */
  const [stored, setStored] = useState<RetailInvoiceDto | null>(null)
  const [neighbours, setNeighbours] = useState<RetailNeighboursDto>(NOWHERE)
  const [showVoided, setShowVoided] = useState(false)
  /**
   * A posted invoice is shown locked. EDIT unlocks it for a CORRECTION, which
   * saves as a NEW invoice — a posted row is never amended in place, here or
   * anywhere else (DECISIONS §6). `correcting` is what puts the note on screen
   * saying so, so nobody believes they are editing the original.
   */
  const [correcting, setCorrecting] = useState(false)
  /** The navigation waiting on the operator's answer. Null when nothing is. */
  const [guard, setGuard] = useState<Guarded | null>(null)
  const [jumpText, setJumpText] = useState('')
  const [jumpError, setJumpError] = useState<string | null>(null)
  const { push } = useMessages()

  /**
   * The bill as it was when it was loaded or started, serialized.
   *
   * `dirty` is a comparison against this rather than a flag set by every
   * handler, because a flag has to be remembered in a dozen places and is
   * wrong the first time somebody forgets one. Typing a character and deleting
   * it again correctly leaves the bill clean.
   *
   * STATE, not a ref, and that distinction is load-bearing: `dirty` is a memo,
   * and a memo reading a ref keeps whatever the ref held on the render that
   * built it. As a ref this read '' on the first render, made every untouched
   * bill dirty, and fired the guard on the very first press of an arrow.
   */
  const [baseline, setBaseline] = useState('')

  // A ref as well as state: a second click can arrive before React has
  // re-rendered with a disabled button, and the ref is already set.
  const saving = useRef(false)

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
        .retailBillCalculate({ draft, activeSlipNo })
        .then(setCalc)
    }, 120)
    return () => clearTimeout(timer)
  }, [draft, activeSlipNo])

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
    // SUSPENDED while a stored invoice is displayed, and this is the whole
    // reason the guard can be trusted. `retail_draft_bills` holds ONE draft per
    // branch (migration 011 replaces it wholesale on every write), so an
    // autosave running while invoice 3 is on screen would overwrite the
    // half-finished bill the operator was typing — the exact loss the guard
    // exists to prevent, arriving 400ms after it was prevented.
    if (stored) return
    const timer = setTimeout(() => {
      void window.api.retailDraftSave({ draft, activeSlipNo })
    }, 400)
    return () => clearTimeout(timer)
  }, [draft, activeSlipNo, recovered, stored])

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
    setRecovered(null)
    // Re-seed: a resumed bill is exactly what was left, so it is not dirty
    // until the operator touches it again.
    setBaseline('')
    push('ok', `Resumed the bill for ${found.customerName}. Nothing was lost.`)
  }, [push])

  const discardDraft = useCallback(async () => {
    await window.api.retailDraftDiscard()
    setRecovered(null)
    push('ok', 'That draft has been discarded. Starting a new bill.')
  }, [push])

  const active: RetailCalculationDto | null = calc?.active ?? null
  const lines = active?.lines ?? []

  /**
   * Appends an empty item and puts the cursor in its Item Name.
   *
   * What ADD ITEM means now. There is no form to fill in and commit — the grid
   * IS the form, so adding an item is making a column for one and focusing it.
   * The focus is what makes the button worth pressing at all: without it the
   * operator would have to reach for the mouse to find the new column, which is
   * the thing this whole screen exists to avoid.
   */
  /** Stable, so the grid's focus effect does not re-run on every render. */
  const clearNewColumnFocus = useCallback(() => setFocusNewColumn(false), [])

  const appendItem = useCallback(() => {
    setActiveSlip((slip) => ({ ...slip, items: [...slip.items, EMPTY_ITEM] }))
    setFocusNewColumn(true)
  }, [setActiveSlip])

  const deleteLine = useCallback(
    (index: number) => {
      setActiveSlip((slip) => ({
        ...slip,
        items: slip.items.filter((_, i) => i !== index),
      }))
    },
    [setActiveSlip],
  )

  /**
   * Asks before deleting a column that has anything in it.
   *
   * A blank column goes without a question — there is nothing to lose and a
   * dialog for it is the kind of prompt people learn to dismiss unread. One
   * with figures in it is somebody's typing, and Ctrl+Z does not exist here.
   */
  const askDeleteItem = useCallback(
    (index: number) => {
      const row = activeSlip?.items[index]
      const hasData =
        !!row &&
        (row.itemName.trim() !== '' ||
          row.grossWeight.text.trim() !== '' ||
          row.stoneWeight.text.trim() !== '' ||
          row.labourCharges.trim() !== '' ||
          row.stoneCharges.trim() !== '')
      if (hasData) setConfirmDeleteItem(index)
      else deleteLine(index)
    },
    [activeSlip, deleteLine],
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
    /*
     * With items on the bill the flip needs the computed figures, because each
     * cell is re-seeded from the exact milligram main sent rather than by
     * re-parsing the text on screen. Before the grid became editable this could
     * not bite — the cells rendered from the computation itself, so a flip with
     * nothing computed showed nothing either way. Now the cells hold TYPED
     * text, and flipping without the figures would relabel the column Tola
     * while leaving grams in it. So it waits.
     */
    if (!current && (activeSlip?.items.length ?? 0) > 0) return
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
      setForm((f) => ({ ...f, weightUnit: next }))
      return
    }
    set('weightUnit', next)
  }, [unit, calc, activeSlip])


  // ── walking the book ──────────────────────────────────────────────────────

  /**
   * A stored invoice that has not been unlocked. Nothing on it can be typed
   * into, and the item and payment controls are disabled rather than hidden.
   */
  const isLocked = stored !== null && !correcting
  /** An old multi-slip bill can be READ, never unlocked — see loadAsDraft. */
  const isLegacyBill = (stored?.slipCount ?? 1) > 1


  /** Marks whatever is on screen as the clean state to compare against. */
  const markClean = useCallback((of: RetailBillDraftDto) => {
    setBaseline(JSON.stringify(of))
  }, [])

  /**
   * Has the operator changed anything since this bill was loaded or started?
   *
   * A locked invoice is never dirty: nothing on it can be typed into, so the
   * guard must not stop the operator simply paging through the book.
   */
  const dirty = useMemo(
    () => !isLocked && baseline !== '' && JSON.stringify(draft) !== baseline,
    [draft, isLocked, baseline],
  )

  useEffect(() => {
    void window.api
      .retailNeighbours(stored?.invoiceNumber ?? null, showVoided)
      .then(setNeighbours)
  }, [stored, showVoided, invoiceNo])

  /**
   * Seeds the clean baseline the first time a bill exists.
   *
   * Without this an untouched screen compares its draft against the empty
   * string, reads as dirty, and the guard fires on the very first press of an
   * arrow — training the operator to click through the question that exists to
   * protect them. An empty baseline is the signal to re-seed, which is how
   * `startNewBill` and a resumed draft get a clean slate too.
   */
  useEffect(() => {
    setBaseline((current) => (current === '' ? JSON.stringify(draft) : current))
  }, [draft])

  /**
   * The jump box shows the invoice on screen, and is typed over to leave it.
   *
   * Seeded rather than falling back to a display value when empty: a box whose
   * displayed value reappears the moment it is cleared cannot be cleared, and
   * typing into it appends to a number the operator thought they had deleted.
   */
  useEffect(() => {
    setJumpText(stored?.invoiceNo ?? invoiceNo)
    setJumpError(null)
  }, [stored, invoiceNo])

  /** Puts a stored invoice on screen, locked. Returns false if there is none. */
  const openInvoice = useCallback(
    async (invoiceNumber: number): Promise<boolean> => {
      const loaded = await window.api.retailLoadAsDraft(invoiceNumber)
      if (!loaded) return false

      const next = loaded.draft
      setForm({
        saleDate: next.saleDate,
        saleTime: next.saleTime,
        customerId: next.customerId,
        customerName: next.customerName,
        customerMobile: next.customerMobile ?? '',
        ratePurity: next.ratePurity,
        ratePerTolaOverride: next.ratePerTolaOverride,
        weightUnit: next.weightUnit,
      })
      setSlips(next.slips)
      setActiveSlipNo(1)
      setCustomer(null)
      setStored(loaded)
      setCorrecting(false)
      setJumpError(null)
      setJumpText('')
      markClean(next)
      return true
    },
    [markClean],
  )

  /**
   * Runs a navigation, or stops and asks first.
   *
   * EVERY way off this bill goes through here — the four arrows, the invoice
   * jump and NEW — because a guard with one exception is a guard that loses
   * work through that exception.
   */
  const guarded = useCallback(
    (what: string, run: () => void | Promise<void>) => {
      if (!dirty) {
        void run()
        return
      }
      setGuard({ what, run })
    },
    [dirty],
  )

  const goTo = useCallback(
    (target: number | null, what: string) => {
      if (target === null) return
      guarded(what, async () => {
        const opened = await openInvoice(target)
        if (!opened) push('bad', `Invoice ${target} could not be opened.`)
      })
    },
    [guarded, openInvoice, push],
  )

  /**
   * The invoice-number box: type a number, press Enter, go straight there.
   *
   * How the counter finds an old bill fast. An unknown number says so beside
   * the box and does NOT navigate — moving to something else would leave the
   * operator looking at a bill they did not ask for and did not notice
   * arriving.
   */
  const jumpToTyped = useCallback(() => {
    const typed = jumpText.trim()
    if (typed === '') {
      setJumpError(null)
      return
    }
    if (!/^\d+$/.test(typed)) {
      setJumpError('Numbers only.')
      return
    }
    const wanted = Number(typed)
    guarded(`invoice ${wanted}`, async () => {
      const opened = await openInvoice(wanted)
      if (!opened) setJumpError(`No invoice ${wanted}.`)
    })
  }, [jumpText, guarded, openInvoice])

  /**
   * Unlocks a posted invoice — for a CORRECTION, not an amendment.
   *
   * A posted row is never edited in place. There is no `update` on the sale
   * repository and there deliberately never will be, so saving from here issues
   * a NEW invoice number and leaves the original standing until it is voided.
   * The banner says exactly that while the screen is unlocked, because an
   * operator who believes they are amending invoice 3 will not think to void it.
   */
  const startCorrection = useCallback(() => {
    if (!stored) return
    setCorrecting(true)
    push(
      'ok',
      `Invoice ${stored.invoiceNo} is unlocked for a correction. Saving issues a ` +
        `NEW invoice number — invoice ${stored.invoiceNo} stands until you void it.`,
    )
  }, [stored, push])

  const startNewBill = useCallback(
    (keepRate: boolean) => {
      setSlips([emptySlip(1, FIRST_SLIP_LABEL)])
      setActiveSlipNo(1)
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
        // A stored invoice pinned its own rate as an override. Starting a new
        // bill must drop that pin, or every sale after opening an old one would
        // silently be priced at last week's rate.
        ratePerTolaOverride: keepRate && !stored ? current.ratePerTolaOverride : '',
      }))
      // Back to the end of the book: a new bill is not a stored invoice, so
      // nothing is locked, the draft resumes saving and PREV points at the
      // newest posted invoice again.
      setStored(null)
      setCorrecting(false)
      setJumpText('')
      setJumpError(null)
      setBaseline('')
      void window.api.retailNextInvoiceNo().then(setInvoiceNo)
    },
    [stored],
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
    [draft, onPosted, printHtml, push, startNewBill],
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
      'retail.item.add': appendItem,
      'retail.unit.toggle': toggleUnit,
      'retail.rate.refresh': () => set('ratePerTolaOverride', ''),
      'retail.save': () => void commit(false),
      'retail.save-and-print': () => void commit(true),
      'retail.print': () => void printBill(),
      'retail.bill.print': () => void printBill(),
      'retail.new': () => guarded('a new invoice', () => startNewBill(true)),
      'retail.nav.first': () =>
        goTo(neighbours.first?.number ?? null, `invoice ${neighbours.first?.display}`),
      'retail.nav.prev': () =>
        goTo(neighbours.previous?.number ?? null, `invoice ${neighbours.previous?.display}`),
      'retail.nav.next': () =>
        goTo(neighbours.next?.number ?? null, `invoice ${neighbours.next?.display}`),
      'retail.nav.last': () =>
        goTo(neighbours.last?.number ?? null, `invoice ${neighbours.last?.display}`),
      'retail.invoice.jump': jumpToTyped,
      'retail.edit': startCorrection,
      'retail.voided.toggle': () => setShowVoided((current) => !current),
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
    guarded,
    goTo,
    neighbours,
    jumpToTyped,
    startCorrection,
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
      // A dialog owns the keyboard while it is open. Checked FIRST, so the
      // guard's own question cannot be answered by a shortcut behind it.
      if (document.querySelector('.modal')) return

      // Ctrl-chords: navigation, and the save the brief advertises as Ctrl+S.
      if (event.ctrlKey && !event.altKey) {
        const chords: Record<string, () => void> = {
          Home: () =>
            goTo(neighbours.first?.number ?? null, `invoice ${neighbours.first?.display}`),
          End: () =>
            goTo(neighbours.last?.number ?? null, `invoice ${neighbours.last?.display}`),
          ArrowLeft: () =>
            goTo(
              neighbours.previous?.number ?? null,
              `invoice ${neighbours.previous?.display}`,
            ),
          ArrowRight: () =>
            goTo(neighbours.next?.number ?? null, `invoice ${neighbours.next?.display}`),
          s: () => void commit(false),
          S: () => void commit(false),
        }
        const chord = chords[event.key]
        if (!chord) return
        event.preventDefault()
        chord()
        return
      }

      const keys: Record<string, () => void> = {
        F2: appendItem,
        // F5 still fires SAVE. The toolbar advertises Ctrl+S because that is
        // what the brief asks it to show; both reach the same handler, and
        // taking F5 away would retrain a counter for no gain.
        F5: () => void commit(false),
        F6: () => void printBill(),
        F9: () => guarded('a new invoice', () => startNewBill(true)),
      }
      const handler = keys[event.key]
      if (!handler) return
      event.preventDefault()
      handler()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [commit, appendItem, printBill, startNewBill, guarded, goTo, neighbours])

  const rateMissing = calc?.rateMissing ?? false

  return (
    <div className="retail">
      {/* ── the header strip, replacing the deleted top bar ───────────────── */}
      {/*
        ── the toolbar ────────────────────────────────────────────────────────
        GoldLab's CustomerEntry row, mirrored to LTR and set in our own tokens.
        Its two rows are folded into one: add · customer · NEW | the four
        navigation controls | SAVE | the invoice-number box.

        Two things about the reference are deliberately NOT copied. Its "نام"
        chip beside the combo is a label, not a control, so there is nothing
        here to stand in for it — the ▼ opens the customer list, which is what
        that control actually does. And its receipt-number box is read-only,
        with the editable lookup living in a separate status bar; the two are
        merged here, because finding an old bill fast is the reason the box is
        worth a place on the toolbar at all.
      */}
      <div className="retail__toolbar">
        <Action
          id="retail.customer.add"
          variant="primary"
          className="toolbar__add"
          ariaLabel="Add a new customer"
          unavailable={isLocked}
        >
          <Icon name="plus" size={18} />
        </Action>

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
          variant="toolbar"
          disabled={isLocked}
        />

        <Action
          id="retail.new"
          variant="outline"
          className="toolbar__new"
          onActivate={() => guarded('a new invoice', () => startNewBill(true))}
        >
          NEW
        </Action>

        <span className="toolbar__rule" aria-hidden="true" />

        {/* FIRST and LAST are dead only when the book is empty. PREV and NEXT
            go dead at the ends, which is what tells the operator where they
            are — disabled, never hidden. */}
        <div className="toolbar__nav" role="group" aria-label="Move between invoices">
          <Action
            id="retail.nav.first"
            variant="outline"
            className="toolbar__step"
            unavailable={
              neighbours.first === null ||
              neighbours.first.number === stored?.invoiceNumber
            }
            onActivate={() =>
              goTo(neighbours.first?.number ?? null, `invoice ${neighbours.first?.display}`)
            }
          >
            <span aria-hidden="true">|◀</span>
            <span>FIRST</span>
          </Action>
          <Action
            id="retail.nav.prev"
            variant="outline"
            className="toolbar__step"
            unavailable={neighbours.previous === null}
            onActivate={() =>
              goTo(
                neighbours.previous?.number ?? null,
                `invoice ${neighbours.previous?.display}`,
              )
            }
          >
            <span aria-hidden="true">◀</span>
            <span>PREV</span>
          </Action>
          <Action
            id="retail.nav.next"
            variant="outline"
            className="toolbar__step"
            unavailable={neighbours.next === null}
            onActivate={() =>
              goTo(neighbours.next?.number ?? null, `invoice ${neighbours.next?.display}`)
            }
          >
            <span>NEXT</span>
            <span aria-hidden="true">▶</span>
          </Action>
          <Action
            id="retail.nav.last"
            variant="outline"
            className="toolbar__step"
            unavailable={
              neighbours.last === null || neighbours.last.number === stored?.invoiceNumber
            }
            onActivate={() =>
              goTo(neighbours.last?.number ?? null, `invoice ${neighbours.last?.display}`)
            }
          >
            <span>LAST</span>
            <span aria-hidden="true">▶|</span>
          </Action>
        </div>

        <Action
          id="retail.save"
          variant="primary"
          className="toolbar__save"
          busy={busy}
          unavailable={isLocked}
        >
          SAVE
        </Action>

        <span className="toolbar__rule" aria-hidden="true" />

        {/* Editable, which GoldLab's is not: this is how the counter finds an
            old bill fast. An unknown number says so beside the box and does not
            move — landing somewhere unasked-for is worse than not moving. */}
        <label className="toolbar__jump">
          <span className="toolbar__jump-label">Invoice No :</span>
          <input
            className="input input--numeric toolbar__jump-input"
            value={jumpText}
            onChange={(e) => {
              setJumpText(e.target.value)
              setJumpError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                jumpToTyped()
              }
              if (e.key === 'Escape') {
                setJumpText('')
                setJumpError(null)
              }
            }}
            inputMode="numeric"
            aria-label="Invoice number — type one and press Enter to open it"
          />
        </label>
        {jumpError ? (
          <span className="toolbar__jump-error" role="alert">
            {jumpError}
          </span>
        ) : null}
      </div>

      {/* The visit's remaining facts, on their own row. */}
      <div className="retail__head">
        <div className="bill-fields">
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
                disabled={isLocked}
              />
              <span className="input-group__glyph" aria-hidden="true">
                <Icon name="clock" size={16} />
              </span>
            </span>
          </label>
          <label className="stack-field">
            <span className="stack-field__label">Mobile :</span>
            <input
              className="input"
              value={form.customerMobile}
              onChange={(e) => set('customerMobile', e.target.value)}
              placeholder="0300-0000000"
              aria-label="Customer mobile"
              disabled={isLocked}
            />
          </label>
        </div>

        <RateCard rates={rates} onSaved={onRateSaved} />
      </div>

      {/* What the operator is looking at, whenever it is not a new bill. */}
      {stored ? (
        <div className={`record-state${stored.status === 'void' ? ' is-void' : ''}`}>
          <span className="record-state__what">
            Invoice {stored.invoiceNo} · {stored.status.toUpperCase()}
            {isLocked ? ' · read-only' : ' · correcting'}
          </span>
          {stored.voidReason ? (
            <span className="record-state__why">Voided: {stored.voidReason}</span>
          ) : null}
          {isLegacyBill ? (
            <span className="record-state__why">
              This bill holds {stored.slipCount} slips, from before one invoice meant one
              set of items. It can be read and printed, and it cannot be unlocked here —
              correcting it means voiding it and entering the slips as separate invoices.
            </span>
          ) : null}
          {isLocked && !isLegacyBill ? (
            <Action
              id="retail.edit"
              variant="outline"
              className="record-state__edit"
              onActivate={startCorrection}
            >
              EDIT
            </Action>
          ) : null}
          {!isLocked ? (
            <span className="record-state__why">
              Saving issues a NEW invoice number. Invoice {stored.invoiceNo} stands until
              you void it — a posted bill is never amended in place.
            </span>
          ) : null}
          <Action
            id="retail.voided.toggle"
            variant="ghost"
            className="record-state__voided"
            active={showVoided}
            onActivate={() => setShowVoided((current) => !current)}
          >
            {showVoided ? 'Hiding nothing' : 'Show voided'}
          </Action>
        </div>
      ) : null}

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
          <ItemsGrid
            items={activeSlip?.items ?? []}
            lines={lines}
            unit={unit}
            locked={isLocked}
            focusLast={focusNewColumn}
            onFocusedLast={clearNewColumnFocus}
            onPatch={(index, patch) =>
              setActiveSlip((slip) => ({
                ...slip,
                items: slip.items.map((row, i) => (i === index ? { ...row, ...patch } : row)),
              }))
            }
            onAppend={(patch) =>
              setActiveSlip((slip) => ({
                ...slip,
                items: [...slip.items, { ...EMPTY_ITEM, ...patch }],
              }))
            }
            onDelete={askDeleteItem}
            onPrint={() => void printSlip(activeSlipNo)}
            onAddItem={appendItem}
            customerNames={[]}
          />

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


      {confirmDeleteItem !== null ? (
        <Modal
          label={`Delete item ${confirmDeleteItem + 1}?`}
          onClose={() => setConfirmDeleteItem(null)}
        >
          <h2 className="modal__title">Delete item {confirmDeleteItem + 1}?</h2>
          <p className="hint">
            This column has figures typed into it. Deleting it removes them, and the
            items after it are renumbered — item {confirmDeleteItem + 2} becomes item{' '}
            {confirmDeleteItem + 1}. Nothing has been posted; no invoice number is spent.
          </p>
          <div className="confirm__actions">
            <Action
              id="retail.item.delete"
              variant="ghost"
              onActivate={() => setConfirmDeleteItem(null)}
            >
              Keep it
            </Action>
            <Action
              id="retail.item.delete"
              variant="primary"
              className="is-cancel"
              onActivate={() => {
                deleteLine(confirmDeleteItem)
                setConfirmDeleteItem(null)
              }}
            >
              Delete this item
            </Action>
          </div>
        </Modal>
      ) : null}

      {guard ? (
        <Modal label="This invoice has unsaved changes" onClose={() => setGuard(null)}>
          <h2 className="modal__title">Save this invoice first?</h2>
          <p className="hint">
            This bill has changes that have not been saved. Going to {guard.what} now
            would leave them behind — there is one draft per counter, so it cannot be
            parked and come back later.
          </p>
          <div className="confirm__actions">
            {/* Three real answers. Cancel is a control the operator presses on
                purpose: if the safe answer were only reachable by pressing
                Escape and hoping, it would be the one nobody chose. */}
            <Action
              id="retail.guard.cancel"
              variant="ghost"
              onActivate={() => setGuard(null)}
            >
              Stay here
            </Action>
            <Action
              id="retail.guard.discard"
              variant="outline"
              className="is-cancel"
              onActivate={() => {
                const go = guard.run
                setGuard(null)
                void window.api.retailDraftDiscard().then(() => go())
              }}
            >
              Discard changes
            </Action>
            <Action
              id="retail.guard.save"
              variant="primary"
              busy={busy}
              onActivate={() => {
                const go = guard.run
                setGuard(null)
                void commit(false).then(() => go())
              }}
            >
              Save, then go
            </Action>
          </div>
        </Modal>
      ) : null}
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
