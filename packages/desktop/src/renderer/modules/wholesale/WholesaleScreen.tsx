import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Action } from '../../actions/Action.js'
import { Icon } from '../../shell/Icon.js'
import { DateField } from '../../components/DateField.js'
import { EmptyState } from '../../components/EmptyState.js'
import { useMessages } from '../../components/Messages.js'
import { Modal } from '../../components/Modal.js'
import { toDisplayDate } from '../../format/dates.js'
import { PartySelector } from './PartySelector.js'
import { SettlementPanel } from './SettlementPanel.js'
import type {
  LedgerRowDto,
  LineInputDto,
  PartyBalanceDto,
  PartyDto,
  PreviewDto,
  ShopProfileDto,
  WholesaleEntryDto,
  WholesaleNeighboursDto,
} from '../../../shared/ipc.js'

/**
 * The Whole Sale screen.
 *
 * The layout is the approved one. The grid model is the real slip's, not the
 * mockup's: **Gross · Katt (ratti/tola) · Khalis**, with no purity column and no
 * per-row remaining weight. Katt IS how purity is expressed here, and remaining
 * exists only as a ledger balance.
 *
 * Nothing on this screen calculates anything. Every figure shown — khalis,
 * amount, totals, balances — is computed in the main process by the same code
 * that will post the slip, and arrives preformatted. That is why what the
 * operator sees while typing is exactly what gets saved.
 *
 * ── The height budget ──────────────────────────────────────────────────────
 * The window height is a budget and the item table is what it is spent on. Head
 * and the fixed cards take what they need; the table absorbs the rest and is the
 * only region allowed to scroll. The party ledger is deliberately NOT on this
 * tab — it is the whole content of the Whole Sale Ledger tab, and the same rows
 * shown twice cost the table a third of its height to tell the operator nothing
 * new.
 */

const EMPTY_ROW: LineInputDto = {
  itemName: '',
  grossGrams: '',
  kattRatti: '',
  remarks: null,
  // Empty, not 'K22': a row that has not named a karat keeps whatever the SLIP
  // is priced at, and defaulting here would pin every row to 22K the moment it
  // was created. See `purityOf` in wholesaleIpc.
  purity: '',
  male: null,
}

/** The karats a line can be priced at, in the order the counter reads them. */
const RATE_PURITY_OPTIONS = ['K24', 'K22', 'K21', 'K18'] as const

/** The typeable columns, in tab order. Khalis, rate and amount are computed. */
const COLUMNS = ['itemName', 'grossGrams', 'kattRatti', 'male', 'remarks'] as const

/**
 * Whether a preformatted figure is worth colouring.
 *
 * A zero is not a positive. Every khalis figure on this screen was rendering in
 * the positive green whether or not anything had been entered, so an empty slip
 * showed a column of green noughts and the colour stopped meaning anything by
 * the time a real figure arrived. Semantic colour is for values that are
 * genuinely non-zero; everything else is ordinary text.
 */
function isSignificant(display: string | undefined): boolean {
  if (!display) return false
  return /[1-9]/.test(display)
}

type Tab = 'new' | 'ledger' | 'settle' | 'history'

/** Nowhere to go, which is what four disabled arrows look like. */
const NOWHERE: WholesaleNeighboursDto = {
  first: null,
  previous: null,
  next: null,
  last: null,
}

/**
 * A navigation the operator has been asked about but not yet answered.
 *
 * `what` is shown in the dialog so the question names the destination — "go to
 * slip WS-10004", not "leave this page". `run` is the move itself, held until an
 * answer arrives, so nothing about the destination has to be recomputed after.
 */
interface Guarded {
  readonly what: string
  readonly run: () => void | Promise<void>
}

/**
 * The party a stored slip was posted against, as the selector wants it.
 *
 * A slip carries the party's id, name and code; mobile and city are not part of
 * what was posted and are not invented here. The box shows who the slip is for,
 * which is the whole of what it is being asked to do.
 */
function partyOf(entry: WholesaleEntryDto): PartyDto | null {
  if (!entry.draft.partyId) return null
  return {
    id: entry.draft.partyId,
    code: entry.draft.partyCode,
    name: entry.draft.partyName,
    mobile: null,
    city: null,
  }
}

export function WholesaleScreen({
  today,
  shop,
  receiptFooter,
  onPosted,
}: {
  today: string
  /** The shop's own details, from Settings. Printed at the top of the slip. */
  shop: ShopProfileDto
  receiptFooter: string
  onPosted: () => void
}) {
  const [tab, setTab] = useState<Tab>('new')
  const [party, setParty] = useState<PartyDto | null>(null)
  const [balance, setBalance] = useState<PartyBalanceDto | null>(null)
  const [rows, setRows] = useState<LineInputDto[]>([{ ...EMPTY_ROW }, { ...EMPTY_ROW }])
  const [entryDate, setEntryDate] = useState(today)
  // Empty means "use the rate recorded for this date". A typed value overrides it.
  const [rateOverride, setRateOverride] = useState('')
  const [preview, setPreview] = useState<PreviewDto | null>(null)
  const [invoiceNo, setInvoiceNo] = useState('—')
  const [ledger, setLedger] = useState<readonly LedgerRowDto[]>([])
  const [busy, setBusy] = useState(false)
  const { push } = useMessages()

  // ── the book, and where the screen is in it ───────────────────────────────
  /**
   * The stored slip on screen, or null when this is a new one.
   *
   * Null is not "slip zero" — it is the slip being typed, which sits one PAST
   * the end of the book. That is why `neighbours` is asked with null and answers
   * with PREV pointing at the newest slip and NEXT pointing nowhere.
   */
  const [stored, setStored] = useState<WholesaleEntryDto | null>(null)
  const [neighbours, setNeighbours] = useState<WholesaleNeighboursDto>(NOWHERE)
  const [showReversed, setShowReversed] = useState(false)
  /**
   * A posted slip is shown locked. EDIT unlocks it for a CORRECTION, which saves
   * as a NEW slip — a posted row is never amended in place, here or anywhere
   * else (DECISIONS §6). `correcting` is what puts the note on screen saying so,
   * so nobody believes they are editing WS-10002.
   */
  const [correcting, setCorrecting] = useState(false)
  /** The navigation waiting on the operator's answer. Null when nothing is. */
  const [guard, setGuard] = useState<Guarded | null>(null)
  const [jumpText, setJumpText] = useState('')
  const [jumpError, setJumpError] = useState<string | null>(null)
  /**
   * Bumped whenever the SCREEN drops or replaces the party.
   *
   * The selector holds the typed text itself, so clearing it from out here means
   * remounting it. A key change cannot race with what is being typed, which an
   * effect that followed the selection back to null would.
   */
  const [partyKey, setPartyKey] = useState(0)
  /**
   * The slip as it was when it was loaded or started, serialized.
   *
   * `dirty` is a comparison against this rather than a flag set by every
   * handler, because a flag has to be remembered in a dozen places and is wrong
   * the first time somebody forgets one. Typing a character and deleting it
   * again correctly leaves the slip clean.
   */
  const [baseline, setBaseline] = useState('')

  // Cell focus, for the two keyboard behaviours that matter at a counter.
  const cells = useRef(new Map<string, HTMLInputElement | null>())
  const [pendingFocus, setPendingFocus] = useState<string | null>(null)

  const refreshParty = useCallback(async (id: string | null) => {
    if (!id) {
      setBalance(null)
      setLedger([])
      return
    }
    const [b, l] = await Promise.all([window.api.partyBalance(id), window.api.partyLedger(id)])
    setBalance(b)
    setLedger(l)
  }, [])

  useEffect(() => {
    void window.api.nextInvoiceNo().then(setInvoiceNo)
  }, [])

  useEffect(() => {
    void refreshParty(party?.id ?? null)
  }, [party, refreshParty])

  /**
   * The slip being typed, as ONE value.
   *
   * The preview asks with it, the save posts it and `dirty` compares against it,
   * so the three cannot disagree about what is on screen — which is what a guard
   * comparing a separately-assembled object would eventually do.
   */
  const draft = useMemo(
    () => ({
      partyId: party?.id ?? '',
      entryDate,
      lines: rows,
      notes: null,
      ratePerTolaOverride: rateOverride,
    }),
    [party, entryDate, rows, rateOverride],
  )

  // Live preview. The main process runs the same computeLine/totalsOf the post
  // path runs, so this is not an approximation of what will be saved — it is it.
  useEffect(() => {
    void window.api.previewWholesale(draft).then(setPreview)
  }, [draft])

  // A row added by Tab has to exist before it can be focused, so the focus is
  // deferred to the render that contains it.
  useEffect(() => {
    if (!pendingFocus) return
    cells.current.get(pendingFocus)?.focus()
    setPendingFocus(null)
  }, [pendingFocus, rows.length])

  const setRow = (index: number, patch: Partial<LineInputDto>): void =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const addRow = useCallback(() => setRows((c) => [...c, { ...EMPTY_ROW }]), [])
  const clearRows = useCallback(() => setRows([{ ...EMPTY_ROW }, { ...EMPTY_ROW }]), [])
  const deleteRow = (index: number): void =>
    setRows((current) =>
      current.length <= 1 ? [{ ...EMPTY_ROW }] : current.filter((_, i) => i !== index),
    )

  // ── walking the book ──────────────────────────────────────────────────────

  /**
   * A stored slip that has not been unlocked. Nothing on it can be typed into,
   * and its controls are disabled rather than hidden.
   */
  const isLocked = stored !== null && !correcting

  /** Marks whatever is on screen as the clean state to compare against. */
  const markClean = useCallback((of: unknown) => {
    setBaseline(JSON.stringify(of))
  }, [])

  /**
   * Has the operator changed anything since this slip was loaded or started?
   *
   * A locked slip is never dirty: nothing on it can be typed into, so the guard
   * must not stop the operator simply paging through the book.
   */
  const dirty = useMemo(
    () => !isLocked && baseline !== '' && JSON.stringify(draft) !== baseline,
    [draft, isLocked, baseline],
  )

  /**
   * Seeds the clean baseline the first time a slip exists.
   *
   * Without this an untouched screen compares its draft against the empty
   * string, reads as dirty, and the guard fires on the very first press of an
   * arrow — training the operator to click through the question that exists to
   * protect them. An empty baseline is the signal to re-seed, which is how
   * `startNewSlip` gets a clean slate too.
   */
  useEffect(() => {
    setBaseline((current) => (current === '' ? JSON.stringify(draft) : current))
  }, [draft])

  useEffect(() => {
    void window.api
      .wholesaleNeighbours(stored?.invoiceNumber ?? null, showReversed)
      .then(setNeighbours)
  }, [stored, showReversed, invoiceNo])

  /**
   * The jump box shows the slip on screen, and is typed over to leave it.
   *
   * Seeded rather than falling back to a display value when empty: a box whose
   * displayed value reappears the moment it is cleared cannot be cleared, and
   * typing into it appends to a number the operator thought they had deleted.
   */
  useEffect(() => {
    setJumpText(stored?.invoiceNo ?? invoiceNo)
    setJumpError(null)
  }, [stored, invoiceNo])

  /** Puts a stored slip on screen, locked. Returns false if there is none. */
  const openSlip = useCallback(
    async (invoiceNumber: number): Promise<boolean> => {
      const loaded = await window.api.wholesaleLoadAsDraft(invoiceNumber)
      if (!loaded) return false

      const next = loaded.draft
      setParty(partyOf(loaded))
      // A posted slip always has rows; the fallback is for a settlement or a
      // corrupted row, which must not leave the grid with nothing to render.
      setRows(next.lines.length > 0 ? next.lines.map((line) => ({ ...line })) : [{ ...EMPTY_ROW }])
      setEntryDate(next.entryDate)
      // The rate this slip was PRICED at, pinned as an override. Without it a
      // slip from last week reprices itself at today's rate the moment it is
      // opened, and the screen disagrees with the paper.
      setRateOverride(next.ratePerTolaOverride)
      setStored(loaded)
      setCorrecting(false)
      setPartyKey((key) => key + 1)
      setTab('new')
      setJumpError(null)
      markClean({
        partyId: next.partyId ?? '',
        entryDate: next.entryDate,
        lines: next.lines.length > 0 ? next.lines : [{ ...EMPTY_ROW }],
        notes: null,
        ratePerTolaOverride: next.ratePerTolaOverride,
      })
      return true
    },
    [markClean],
  )

  /**
   * Runs a navigation, or stops and asks first.
   *
   * EVERY way off this slip goes through here — the four arrows, the number box
   * and NEW — because a guard with one exception is a guard that loses work
   * through that exception.
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
        const opened = await openSlip(target)
        if (!opened) push('bad', `Slip ${target} could not be opened.`)
      })
    },
    [guarded, openSlip, push],
  )

  /**
   * Starts a fresh slip.
   *
   * Back to the end of the book: a new slip is not a stored one, so nothing is
   * locked and PREV points at the newest posted slip again.
   */
  const startNewSlip = useCallback(() => {
    clearRows()
    setParty(null)
    setPartyKey((key) => key + 1)
    setRateOverride('')
    setStored(null)
    setCorrecting(false)
    setJumpError(null)
    setBaseline('')
    void window.api.nextInvoiceNo().then(setInvoiceNo)
  }, [clearRows])

  /**
   * The slip-number box: type a number, press Enter, go straight there.
   *
   * How the counter finds an old slip fast. An unknown number says so beside the
   * box and does NOT navigate — moving to something else would leave the
   * operator looking at a slip they did not ask for and did not notice arriving.
   * The prefix is not typed: "WS-" is on every number in the book, so requiring
   * it would only be a way to get the lookup wrong.
   */
  const jumpToTyped = useCallback(() => {
    const typed = jumpText.trim().replace(/^[A-Za-z]+-?/, '')
    if (typed === '') {
      setJumpError(null)
      return
    }
    if (!/^\d+$/.test(typed)) {
      setJumpError('Numbers only.')
      return
    }
    const wanted = Number(typed)
    guarded(`slip ${wanted}`, async () => {
      const opened = await openSlip(wanted)
      if (!opened) setJumpError(`No slip ${wanted}.`)
    })
  }, [jumpText, guarded, openSlip])

  /**
   * Unlocks a posted slip — for a CORRECTION, not an amendment.
   *
   * A posted row is never edited in place: `postIssue` only ever inserts, and it
   * deliberately never will do anything else. Saving from here writes a NEW slip
   * with a new number, and the original stands until it is reversed. The banner
   * says exactly that while the screen is unlocked, because an operator who
   * believes they are amending WS-10002 will not think to reverse it.
   */
  const startCorrection = useCallback(() => {
    if (!stored) return
    setCorrecting(true)
    push(
      'ok',
      `${stored.invoiceNo} is unlocked for a correction. Saving writes a NEW slip — ` +
        `${stored.invoiceNo} stands, and its gold is still on the party's ledger, ` +
        `until you reverse it.`,
    )
  }, [stored, push])

  /**
   * The two keyboard behaviours a counter operator actually uses.
   *
   * Enter walks ACROSS the row — name, then gross, then katt — and off the last
   * cell it opens the next row and lands in its first. That finishes one item
   * before starting the next, which is how the operator here reads a slip out.
   *
   * It used to walk DOWN the column instead, on the reasoning that a slip is
   * entered a column at a time (six gross weights, then six katts). Changed on
   * the shop's own instruction: whichever is right in general, the counter that
   * runs this is entering item by item. Tab is unchanged and still opens a new
   * row off the last cell, so the old habit still has a key.
   */
  const onCellKeyDown = (
    rowIndex: number,
    columnIndex: number,
    event: KeyboardEvent<HTMLInputElement>,
  ): void => {
    const lastCell = rowIndex === rows.length - 1 && columnIndex === COLUMNS.length - 1

    if (event.key === 'Enter') {
      event.preventDefault()
      if (columnIndex < COLUMNS.length - 1) {
        const next = cells.current.get(`${rowIndex}:${columnIndex + 1}`)
        next?.focus()
        next?.select()
        return
      }
      // Off the end of the row: the next one down, opening it if it is the last.
      if (lastCell) {
        addRow()
        setPendingFocus(`${rowIndex + 1}:0`)
        return
      }
      const nextRow = cells.current.get(`${rowIndex + 1}:0`)
      nextRow?.focus()
      nextRow?.select()
      return
    }

    if (event.key === 'Tab' && !event.shiftKey && lastCell) {
      event.preventDefault()
      addRow()
      setPendingFocus(`${rowIndex + 1}:0`)
    }
  }

  /**
   * Posts the slip. Answers whether it actually went.
   *
   * The boolean is what the guard's "Save, then go" needs: a save that was
   * REFUSED — no party, no rate for the date, a row with no weight — must not be
   * followed by the navigation, or the dialog that exists to protect the
   * operator's rows is the thing that throws them away.
   */
  const save = useCallback(
    async (thenPrint: boolean): Promise<boolean> => {
      if (busy) return false
      // A locked slip is being READ. SAVE is disabled on screen, but F5 and
      // Ctrl+S reach this directly, and a keyboard path that posts a copy of the
      // slip somebody is only looking at is the worst kind of accident here.
      if (isLocked) {
        push('bad', `${stored?.invoiceNo ?? 'This slip'} is posted. Press EDIT to correct it.`)
        return false
      }
      setBusy(true)
      try {
        if (!party) {
          push('bad', 'Choose a party before saving.')
          return false
        }
        const correctionOf = correcting ? stored?.invoiceNo : null
        const result = await window.api.postIssue({ ...draft, partyId: party.id })
        if (!result.ok) {
          push('bad', result.message)
          return false
        }
        push(
          'ok',
          `Saved ${result.invoiceNo}. ${party.name} now ${result.balanceAfter.text}.` +
            (correctionOf
              ? ` ${correctionOf} still stands — reverse it from the ledger if it was wrong.`
              : '') +
            (thenPrint ? ' Sent to printer.' : ''),
        )
        clearRows()
        setRateOverride('')
        // Back to the end of the book. Without this a correction would leave the
        // ORIGINAL still on screen and still locked, with the arrows pointing
        // from a slip the operator has already replaced.
        setStored(null)
        setCorrecting(false)
        setBaseline('')
        await Promise.all([
          refreshParty(party.id),
          window.api.nextInvoiceNo().then(setInvoiceNo),
        ])
        onPosted()
        return true
      } finally {
        setBusy(false)
      }
    },
    [
      busy,
      isLocked,
      stored,
      correcting,
      party,
      draft,
      clearRows,
      refreshParty,
      onPosted,
      push,
    ],
  )

  // Published so the shell's action registry can drive these buttons.
  useEffect(() => {
    const handlers: Record<string, () => void> = {
      'wholesale.row.add': addRow,
      'wholesale.row.clear': clearRows,
      'wholesale.save': () => void save(false),
      'wholesale.save-and-print': () => void save(true),
      'wholesale.print': () => window.print(),
      'wholesale.cancel': () => {
        clearRows()
        setRateOverride('')
      },
      // Refresh drops a typed override and goes back to the recorded rate.
      'rate.refresh': () => setRateOverride(''),
      'wholesale.tab.new': () => setTab('new'),
      'wholesale.tab.ledger': () => setTab('ledger'),
      'wholesale.tab.return': () => setTab('settle'),
      'wholesale.tab.history': () => setTab('history'),
      'wholesale.ledger.view-full': () => setTab('ledger'),
      // ── the toolbar ─────────────────────────────────────────────────────
      'wholesale.new': () => guarded('a new slip', startNewSlip),
      'wholesale.nav.first': () =>
        goTo(neighbours.first?.number ?? null, `slip ${neighbours.first?.display}`),
      'wholesale.nav.prev': () =>
        goTo(neighbours.previous?.number ?? null, `slip ${neighbours.previous?.display}`),
      'wholesale.nav.next': () =>
        goTo(neighbours.next?.number ?? null, `slip ${neighbours.next?.display}`),
      'wholesale.nav.last': () =>
        goTo(neighbours.last?.number ?? null, `slip ${neighbours.last?.display}`),
      'wholesale.invoice.jump': jumpToTyped,
      'wholesale.invoice.search': jumpToTyped,
      'wholesale.edit': startCorrection,
      'wholesale.reversed.toggle': () => setShowReversed((current) => !current),
    }
    const listener = (event: Event): void => {
      const id = (event as CustomEvent<string>).detail
      handlers[id]?.()
    }
    window.addEventListener('jewellery:action', listener)
    return () => window.removeEventListener('jewellery:action', listener)
  }, [
    addRow,
    clearRows,
    save,
    guarded,
    goTo,
    neighbours,
    jumpToTyped,
    startCorrection,
    startNewSlip,
  ])

  /**
   * The keys a counter operator actually reaches for.
   *
   * The same chords the retail screen answers, over the same kind of book: it is
   * one pair of hands moving between two screens, and a shortcut that means
   * "previous invoice" on one and nothing on the other is worse than no shortcut
   * at all.
   */
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      // A dialog owns the keyboard while it is open. Checked FIRST, so the
      // guard's own question cannot be answered by a shortcut behind it.
      if (document.querySelector('.modal')) return

      if (event.ctrlKey && !event.altKey) {
        const chords: Record<string, () => void> = {
          Home: () =>
            goTo(neighbours.first?.number ?? null, `slip ${neighbours.first?.display}`),
          End: () => goTo(neighbours.last?.number ?? null, `slip ${neighbours.last?.display}`),
          ArrowLeft: () =>
            goTo(neighbours.previous?.number ?? null, `slip ${neighbours.previous?.display}`),
          ArrowRight: () =>
            goTo(neighbours.next?.number ?? null, `slip ${neighbours.next?.display}`),
          s: () => void save(false),
          S: () => void save(false),
        }
        const chord = chords[event.key]
        if (!chord) return
        event.preventDefault()
        chord()
        return
      }

      const keys: Record<string, () => void> = {
        F2: addRow,
        F5: () => void save(false),
        F6: () => void save(true),
        F9: () => guarded('a new slip', startNewSlip),
      }
      const handler = keys[event.key]
      if (!handler) return
      event.preventDefault()
      handler()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save, addRow, guarded, goTo, neighbours, startNewSlip])

  const totals = useMemo(
    () => ({
      gross: preview?.grossTotalDisplay ?? '0.000',
      khalis: preview?.khalisTotalDisplay ?? '0.000',
      amount: preview?.amountTotalDisplay ?? '0.00',
    }),
    [preview],
  )

  return (
    <div className="screen wholesale">
      {/*
        ── the toolbar ──────────────────────────────────────────────────────
        The retail toolbar, over the wholesale book: party · NEW | the four
        navigation controls | SAVE | the slip-number box. One component
        vocabulary across the two screens, because it is one pair of hands.

        The party combo and the slip number moved UP here out of the ENTRY
        DETAILS card. They were the two things on that card that say WHICH slip
        this is rather than what is on it, and repeating them in both places
        cost the item table a row of height to tell the operator nothing twice.
      */}
      <div className="invoice-toolbar wholesale__toolbar">
        <PartySelector
          key={partyKey}
          selected={party}
          onSelect={setParty}
          disabled={isLocked}
          variant="toolbar"
        />

        <Action
          id="wholesale.new"
          variant="outline"
          className="toolbar__new"
          onActivate={() => guarded('a new slip', startNewSlip)}
        >
          NEW
        </Action>

        <span className="toolbar__rule" aria-hidden="true" />

        {/* FIRST and LAST are dead only when the book is empty. PREV and NEXT
            go dead at the ends, which is what tells the operator where they
            are — disabled, never hidden. */}
        <div className="toolbar__nav" role="group" aria-label="Move between slips">
          <Action
            id="wholesale.nav.first"
            variant="outline"
            className="toolbar__step"
            unavailable={
              neighbours.first === null ||
              neighbours.first.number === stored?.invoiceNumber
            }
            onActivate={() =>
              goTo(neighbours.first?.number ?? null, `slip ${neighbours.first?.display}`)
            }
          >
            <span aria-hidden="true">|◀</span>
            <span>FIRST</span>
          </Action>
          <Action
            id="wholesale.nav.prev"
            variant="outline"
            className="toolbar__step"
            unavailable={neighbours.previous === null}
            onActivate={() =>
              goTo(
                neighbours.previous?.number ?? null,
                `slip ${neighbours.previous?.display}`,
              )
            }
          >
            <span aria-hidden="true">◀</span>
            <span>PREV</span>
          </Action>
          <Action
            id="wholesale.nav.next"
            variant="outline"
            className="toolbar__step"
            unavailable={neighbours.next === null}
            onActivate={() =>
              goTo(neighbours.next?.number ?? null, `slip ${neighbours.next?.display}`)
            }
          >
            <span>NEXT</span>
            <span aria-hidden="true">▶</span>
          </Action>
          <Action
            id="wholesale.nav.last"
            variant="outline"
            className="toolbar__step"
            unavailable={
              neighbours.last === null || neighbours.last.number === stored?.invoiceNumber
            }
            onActivate={() =>
              goTo(neighbours.last?.number ?? null, `slip ${neighbours.last?.display}`)
            }
          >
            <span>LAST</span>
            <span aria-hidden="true">▶|</span>
          </Action>
        </div>

        <Action
          id="wholesale.save"
          variant="primary"
          className="toolbar__save"
          busy={busy}
          unavailable={isLocked}
        >
          SAVE
        </Action>

        <span className="toolbar__rule" aria-hidden="true" />

        {/* Editable, and that is the point: this is how the counter finds an old
            slip fast. An unknown number says so beside the box and does not
            move — landing somewhere unasked-for is worse than not moving. */}
        <label className="toolbar__jump">
          <span className="toolbar__jump-label">Invoice No :</span>
          <input
            className="input toolbar__jump-input"
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
            aria-label="Slip number — type one and press Enter to open it"
          />
          <Action id="wholesale.invoice.search" variant="segment" ariaLabel="Find slip">
            <Icon name="search" size={16} />
          </Action>
        </label>
        {jumpError ? (
          <span className="toolbar__jump-error" role="alert">
            {jumpError}
          </span>
        ) : null}
      </div>

      <div className="screen__head">
        {/* The rate board lives on the Dashboard now. What this screen keeps
            is the rate it is PRICING with — the header rate box — and this
            banner for the day nothing has been set. */}
        {preview?.rateMissing ? (
          <div className="banner">
            No gold rate is recorded for {toDisplayDate(entryDate)}. Set the 24K rate on
            the Dashboard before saving — every amount depends on it.
          </div>
        ) : null}
      </div>

      {/* What the operator is looking at, whenever it is not a new slip. */}
      {stored ? (
        <div className={`record-state${stored.isReversed ? ' is-void' : ''}`}>
          <span className="record-state__what">
            {stored.invoiceNo} · {stored.isReversed ? 'REVERSED' : 'POSTED'}
            {isLocked ? ' · read-only' : ' · correcting'}
          </span>
          {isLocked ? (
            <Action
              id="wholesale.edit"
              variant="outline"
              className="record-state__edit"
              onActivate={startCorrection}
            >
              EDIT
            </Action>
          ) : (
            <span className="record-state__why">
              Saving writes a NEW slip with a new number. {stored.invoiceNo} stands, and its
              gold stays on the party&apos;s ledger, until you reverse it — a posted slip is
              never amended in place.
            </span>
          )}
          <Action
            id="wholesale.reversed.toggle"
            variant="ghost"
            className="record-state__voided"
            active={showReversed}
            onActivate={() => setShowReversed((current) => !current)}
          >
            {showReversed ? 'Hiding nothing' : 'Show reversed'}
          </Action>
        </div>
      ) : null}

      <div className="workspace__split screen__body">
        <div className="entry-column">
          <div className="panel">
            <div className="tabs">
              <Action id="wholesale.tab.new" variant="tab" active={tab === 'new'}>
                New Whole Sale
              </Action>
              <Action id="wholesale.tab.ledger" variant="tab" active={tab === 'ledger'}>
                Whole Sale Ledger
              </Action>
              <Action id="wholesale.tab.return" variant="tab" active={tab === 'settle'}>
                Return / Receive
              </Action>
              <Action id="wholesale.tab.history" variant="tab" active={tab === 'history'}>
                History
              </Action>
            </div>

            <div className="panel__title">ENTRY DETAILS</div>

            {/* The party and the slip number are on the toolbar now. What is
                left here is what belongs to THIS slip's pricing: who it is for
                by code, when it is dated, and what rate it is priced at. */}
            <div className="field-row">
              {/* Derived, not broken. It fills itself in from the party on the
                  toolbar, so it shows a dash and a dashed, flat ground rather
                  than the same grey an unavailable control uses. */}
              <label className="field">
                <span className="field__label">Code</span>
                <input
                  className="input input--derived"
                  value={party?.code ?? ''}
                  readOnly
                  disabled
                  placeholder="—"
                  aria-label="Party code"
                />
              </label>

              <DateField
                value={entryDate}
                onChange={setEntryDate}
                label="Date"
                ariaLabel="Entry date"
              />

              <label className="field">
                <span className="field__label">Gold Rate (Per Tola)</span>
                <span className="input-group">
                  {/* Editable. It was read-only, which made the service's
                      rate-override support unreachable — a shop quoting a party
                      a rate different from the day's board rate had no way to
                      enter it. Empty falls back to the recorded rate. */}
                  <input
                    className="input input--numeric"
                    value={rateOverride}
                    onChange={(e) => setRateOverride(e.target.value)}
                    placeholder={preview?.rateDisplay ?? 'No rate set'}
                    inputMode="decimal"
                    aria-label="Gold rate per tola"
                    disabled={isLocked}
                  />
                  <Action id="rate.refresh" variant="segment" ariaLabel="Refresh rate">
                    <Icon name="refresh" size={16} />
                  </Action>
                </span>
              </label>
            </div>

            {tab === 'new' ? <ActionBar busy={busy} locked={isLocked} /> : null}
          </div>

          {tab === 'new' ? (
            <>
              <div className="panel panel--fill">
                <div className="panel__title">
                  <span>ITEM DETAILS</span>
                  {/* The row tools live in the card header rather than under the
                      table. Below it they cost 56px of table height on every
                      screen size, and they are used once per slip. */}
                  <span className="toolbar__end">
                    <Action id="wholesale.row.add" variant="toolbar" unavailable={isLocked}>
                      <Icon name="plus" size={16} /> Add Row
                    </Action>
                    <Action id="wholesale.row.clear" variant="toolbar" unavailable={isLocked}>
                      <Icon name="cross" size={16} /> Clear Row
                    </Action>
                    <Action id="wholesale.import-from-stock" variant="toolbar">
                      <Icon name="upload" size={16} /> Import
                    </Action>
                    <Action id="wholesale.scan-barcode" variant="toolbar">
                      <Icon name="barcode" size={16} /> Scan
                    </Action>
                  </span>
                </div>
                <div className="panel__body panel__body--flush">
                  <div className="table-scroll">
                    <table className="grid grid--fixed">
                      <colgroup>
                        <col className="col--index" />
                        <col />
                        <col className="col--gross" />
                        <col className="col--katt" />
                        <col className="col--khalis" />
                        <col className="col--rate" />
                        <col className="col--amount" />
                        <col className="col--remarks" />
                        <col className="col--remarks" />
                        <col className="col--action" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th className="grid__index">#</th>
                          <th>Item Name</th>
                          {/* Short forms. At 11px uppercase with tracking the
                              parenthesised units grew past their own columns
                              and every heading ellipsised. The units are on the
                              figures themselves. */}
                          <th className="numeric">Gross g</th>
                          <th className="numeric">Katt r/t</th>
                          <th className="numeric">Khalis g</th>
                          {/* The rate, and the karat it came from. One cell:
                              237,970 at 22K and 237,970 at 24K are different
                              claims about the same figure. */}
                          <th className="numeric">Rate</th>
                          <th className="numeric">Amount</th>
                          <th>Male</th>
                          <th>Remarks</th>
                          <th className="grid__action">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, index) => {
                          const computed = preview?.lines[index]
                          const cell = (columnIndex: number) => ({
                            ref: (node: HTMLInputElement | null) => {
                              cells.current.set(`${index}:${columnIndex}`, node)
                            },
                            onKeyDown: (event: KeyboardEvent<HTMLInputElement>) =>
                              onCellKeyDown(index, columnIndex, event),
                          })
                          return (
                            <tr key={index} className={computed?.error ? 'row--error' : undefined}>
                              <td className="grid__index">{index + 1}</td>
                              <td>
                                <input
                                  className="input input--cell"
                                  value={row.itemName}
                                  onChange={(e) => setRow(index, { itemName: e.target.value })}
                                  placeholder="Item name"
                                  aria-label={`Item name row ${index + 1}`}
                                  disabled={isLocked}
                                  {...cell(0)}
                                />
                              </td>
                              <td>
                                <input
                                  className="input input--cell input--numeric"
                                  value={row.grossGrams}
                                  onChange={(e) => setRow(index, { grossGrams: e.target.value })}
                                  placeholder="0.000"
                                  inputMode="decimal"
                                  aria-label={`Gross weight row ${index + 1}`}
                                  disabled={isLocked}
                                  {...cell(1)}
                                />
                              </td>
                              <td>
                                <input
                                  className="input input--cell input--numeric"
                                  value={row.kattRatti}
                                  onChange={(e) => setRow(index, { kattRatti: e.target.value })}
                                  placeholder="0.000"
                                  inputMode="decimal"
                                  aria-label={`Katt row ${index + 1}`}
                                  disabled={isLocked}
                                  {...cell(2)}
                                />
                              </td>
                              <td
                                className={`numeric${
                                  isSignificant(computed?.khalisDisplay) ? ' positive' : ' muted'
                                }`}
                                title={computed?.purityDisplay}
                              >
                                {computed?.khalisDisplay ?? '—'}
                              </td>
                              {/* The rate, with the karat that produced it
                                  beside it. Picking a karat reprices THIS row
                                  only — the figure itself stays computed by
                                  main, like every other figure here. */}
                              <td className="numeric muted cell-rate">
                                <select
                                  className="cell-purity"
                                  value={row.purity ?? ''}
                                  onChange={(e) => setRow(index, { purity: e.target.value })}
                                  disabled={isLocked}
                                  aria-label={`Rate purity row ${index + 1}`}
                                >
                                  {/* Blank means "whatever the slip is priced
                                      at", which is what an untouched row and
                                      every slip typed before this did. */}
                                  <option value="">—</option>
                                  {RATE_PURITY_OPTIONS.map((purity) => (
                                    <option key={purity} value={purity}>
                                      {purity.slice(1)}K
                                    </option>
                                  ))}
                                </select>
                                <span>{computed?.rateDisplay ?? '—'}</span>
                              </td>
                              <td className="numeric muted">{computed?.amountDisplay ?? '—'}</td>
                              <td>
                                <input
                                  className="input input--cell"
                                  value={row.male ?? ''}
                                  onChange={(e) => setRow(index, { male: e.target.value })}
                                  placeholder="—"
                                  aria-label={`Male row ${index + 1}`}
                                  disabled={isLocked}
                                  {...cell(3)}
                                />
                              </td>
                              <td>
                                <input
                                  className="input input--cell"
                                  value={row.remarks ?? ''}
                                  onChange={(e) => setRow(index, { remarks: e.target.value })}
                                  placeholder="—"
                                  aria-label={`Remarks row ${index + 1}`}
                                  disabled={isLocked}
                                  {...cell(4)}
                                />
                              </td>
                              <td className="grid__action">
                                <Action
                                  id="wholesale.row.delete"
                                  variant="icon"
                                  className="is-danger"
                                  ariaLabel={`Delete row ${index + 1}`}
                                  unavailable={isLocked}
                                  onActivate={() => deleteRow(index)}
                                >
                                  <Icon name="trash" size={16} />
                                </Action>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      {/* No parentheses. In accounting a bracketed figure means a
                          negative one, and these were bracketed AND green — two
                          contradictory signals on a number that is neither. */}
                      <tfoot>
                        <tr>
                          <td className="grid__index" />
                          <td>Total</td>
                          <td className="numeric">{totals.gross}</td>
                          <td />
                          <td
                            className={`numeric${isSignificant(totals.khalis) ? ' positive' : ''}`}
                          >
                            {totals.khalis}
                          </td>
                          <td />
                          <td className="numeric">{totals.amount}</td>
                          {/* Male and Remarks: two note columns, no total. */}
                          <td />
                          <td />
                          <td className="grid__action" />
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {preview?.lines.some((l) => l.error) ? (
                    <p className="hint hint--bad">{preview.lines.find((l) => l.error)?.error}</p>
                  ) : null}
                </div>
              </div>

              {/* One strip, three figures. Gross is already in the totals row,
                  the rate is in the entry card and the top bar, and the previous
                  balance is in the rail — so nothing left this screen when the
                  three stacked cards became one 60px strip. */}
              <div className="stat-strip">
                <div className="stat-cell">
                  <span className="stat-cell__label">Total Khalis</span>
                  <span
                    className={`stat-cell__value${
                      isSignificant(totals.khalis) ? ' positive' : ''
                    }`}
                  >
                    {totals.khalis} g
                  </span>
                </div>
                <div className="stat-cell">
                  <span className="stat-cell__label">Total Amount</span>
                  <span className="stat-cell__value">Rs. {totals.amount}</span>
                </div>
                <div className="stat-cell">
                  <span className="stat-cell__label">End Balance</span>
                  <span
                    className={`stat-cell__value ${
                      !isSignificant(preview?.endBalance?.text)
                        ? ''
                        : preview?.endBalance?.direction === 'shop-owes-party'
                          ? 'negative'
                          : 'positive'
                    }`}
                  >
                    {preview?.endBalance?.text ?? '—'}
                    {preview?.endBalance?.drCr ? ` /${preview.endBalance.drCr}` : ''}
                  </span>
                </div>
              </div>
            </>
          ) : null}

          {tab === 'settle' ? (
            <SettlementPanel
              party={party}
              balance={balance}
              entryDate={entryDate}
              onSettled={async () => {
                await refreshParty(party?.id ?? null)
                onPosted()
              }}
            />
          ) : null}

          {tab === 'ledger' || tab === 'history' ? (
            <LedgerTable rows={ledger} party={party} />
          ) : null}
        </div>

        <aside className="rail">
          <InvoicePreview
            invoiceNo={invoiceNo}
            date={entryDate}
            party={party}
            preview={preview}
            shop={shop}
            footer={receiptFooter}
          />

          <div className="panel">
            <div className="panel__title">QUICK ACTIONS</div>
            <div className="panel__body">
              <div className="quick-actions">
                <Action id="quick.wholesale-ledger" variant="quick">
                  Whole Sale Ledger
                </Action>
                <Action id="quick.return-receive" variant="quick">
                  Return / Receive
                </Action>
                <Action id="quick.print-last-invoice" variant="quick">
                  Print Last Invoice
                </Action>
                <Action id="quick.party-balance" variant="quick">
                  Party Balance
                </Action>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel__title">PARTY SUMMARY</div>
            <div className="panel__body">
              {balance ? (
                <>
                  <div className="summary-line">
                    <span>Party</span>
                    <span className="summary-line__value">{balance.party.name}</span>
                  </div>
                  <div className="summary-line">
                    <span>Gold balance</span>
                    <span
                      className={`summary-line__value ${
                        balance.gold.direction === 'shop-owes-party' ? 'negative' : 'positive'
                      }`}
                    >
                      {balance.gold.text} {balance.gold.drCr ? `/${balance.gold.drCr}` : ''}
                    </span>
                  </div>
                  <div className="summary-line">
                    <span>Cash balance</span>
                    <span className="summary-line__value">{balance.cash.text}</span>
                  </div>
                </>
              ) : (
                <EmptyState
                  title="No party chosen"
                  line="Search for a party above to see what they owe."
                />
              )}
            </div>
          </div>
        </aside>
      </div>

      {guard ? (
        <Modal label="This slip has unsaved changes" onClose={() => setGuard(null)}>
          <h2 className="modal__title">Save this slip first?</h2>
          <p className="hint">
            This slip has rows that have not been posted. Going to {guard.what} now would
            leave them behind — the screen holds one slip at a time, so it cannot be parked
            and come back to later.
          </p>
          <div className="confirm__actions">
            {/* Three real answers. Cancel is a control the operator presses on
                purpose: if the safe answer were only reachable by pressing
                Escape and hoping, it would be the one nobody chose. */}
            <Action
              id="wholesale.guard.cancel"
              variant="ghost"
              onActivate={() => setGuard(null)}
            >
              Stay here
            </Action>
            <Action
              id="wholesale.guard.discard"
              variant="outline"
              className="is-cancel"
              onActivate={() => {
                const go = guard.run
                setGuard(null)
                // Nothing to discard on disk — a wholesale slip is not autosaved
                // — so the rows are simply dropped and the destination opened.
                setBaseline('')
                void go()
              }}
            >
              Discard changes
            </Action>
            <Action
              id="wholesale.guard.save"
              variant="primary"
              busy={busy}
              onActivate={() => {
                const go = guard.run
                setGuard(null)
                // Only on a save that actually WENT. A refused post — no party,
                // no rate for the date, a row with no weight — leaves the rows
                // exactly where they are, because navigating after a failure
                // would make this dialog the thing that loses them.
                void save(false).then((saved) => {
                  if (saved) void go()
                })
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
 * The five slip actions.
 *
 * One solid button and four outlined ones. Five solid colour blocks is a
 * toolbar — every control shouting at the same volume, so none of them is the
 * answer. Save is the answer; the rest keep their semantic colour on the border
 * and the label, which is enough to tell them apart without competing.
 */
function ActionBar({ busy, locked }: { busy: boolean; locked: boolean }) {
  return (
    <div className="action-bar">
      {/* The three that WRITE go unavailable on a posted slip, and stay visible
          while they do. A control that disappears when a stored slip is opened
          is one the operator stops expecting to be there. PRINT does not: a
          posted slip is exactly the thing you print. */}
      <Action
        id="wholesale.save"
        variant="primary"
        className="is-save"
        busy={busy}
        unavailable={locked}
      >
        <Icon name="save" size={18} />
        <span>SAVE (F5)</span>
      </Action>
      <Action
        id="wholesale.save-and-print"
        variant="outline"
        className="is-save-print"
        busy={busy}
        unavailable={locked}
      >
        <Icon name="print" size={18} />
        <span>SAVE &amp; PRINT (F6)</span>
      </Action>
      <Action id="wholesale.print" variant="outline" className="is-print">
        <Icon name="print" size={18} />
        <span>PRINT (F7)</span>
      </Action>
      <Action id="wholesale.hold" variant="outline" className="is-hold" unavailable={locked}>
        <Icon name="pause" size={18} />
        <span>HOLD (F8)</span>
      </Action>
      <Action id="wholesale.cancel" variant="outline" className="is-cancel">
        <Icon name="cross" size={18} />
        <span>CANCEL</span>
      </Action>
    </div>
  )
}

/** The 80mm slip, showing what will actually print. */
function InvoicePreview({
  invoiceNo,
  date,
  party,
  preview,
  shop,
  footer,
}: {
  invoiceNo: string
  date: string
  party: PartyDto | null
  preview: PreviewDto | null
  shop: ShopProfileDto
  footer: string
}) {
  const items = (preview?.lines ?? []).filter((line) => !line.error)
  return (
    <div className="panel">
      <div className="panel__title">INVOICE PREVIEW (80MM)</div>
      <div className="panel__body slip">
        {/* The shop's own, from Settings. This was typed in, so the preview
            promised AL-HARAM at the top of every slip whoever the shop was —
            and the paper it is a facsimile of has said something else since the
            details became editable. A blank tagline takes its line with it. */}
        <div className="slip__brand">{shop.name.trim() || 'GOLD JEWELLERS'}</div>
        {shop.tagline.trim() ? (
          <div className="slip__tagline">{shop.tagline}</div>
        ) : null}
        <div className="slip__rule" />
        <div className="slip__row">
          <span>Invoice No.</span>
          <span>{invoiceNo}</span>
        </div>
        <div className="slip__row">
          <span>Date</span>
          <span>{toDisplayDate(date)}</span>
        </div>
        <div className="slip__row">
          <span>Party</span>
          <span>{party?.name ?? '—'}</span>
        </div>
        <div className="slip__row">
          <span>Rate</span>
          <span>{preview?.rateDisplay ? `${preview.rateDisplay}/tola` : '—'}</span>
        </div>
        {/* The item block only prints when there are items. On the settle and
            ledger tabs an empty table with ( 0.000 ) totals would be a slip
            claiming nothing was issued, which is not what is happening. */}
        {items.length > 0 ? (
          <>
            <div className="slip__rule" />
            {/* `slip__row--cols` puts the heading, the items and the totals on
                ONE shared four-column grid. Without it each row spaced itself
                by its own content and no figure sat under its own heading. */}
            <div className="slip__row slip__row--cols slip__head">
              <span>ITEM</span>
              <span>GR</span>
              <span>KATT</span>
              <span>PR</span>
            </div>
            {items.map((line, index) => (
              <div className="slip__row slip__row--cols slip__item" key={index}>
                <span>{line.itemName}</span>
                <span>{line.grossDisplay}</span>
                <span>{line.kattDisplay}</span>
                <span>{line.khalisDisplay}</span>
              </div>
            ))}
            <div className="slip__rule" />
            {/* The parentheses stay HERE and only here: this is a facsimile of
                the paper, and the thermal renderer prints them. The on-screen
                totals row does not. */}
            <div className="slip__row slip__row--cols">
              <span>Total</span>
              <span>( {preview?.grossTotalDisplay ?? '0.000'} )</span>
              <span />
              <span>( {preview?.khalisTotalDisplay ?? '0.000'} )</span>
            </div>
          </>
        ) : null}
        <div className="slip__rule" />
        <div className="slip__row">
          <span>Previous</span>
          <span>{preview?.previousBalance?.text ?? '—'}</span>
        </div>
        <div className="slip__row">
          <span>Current Issued</span>
          <span>{preview?.khalisTotalDisplay ?? '0.000'} g</span>
        </div>
        <div className="slip__row slip__total">
          <span>End Balance</span>
          <span>
            {preview?.endBalance?.text ?? '—'}
            {preview?.endBalance?.drCr ? ` /${preview.endBalance.drCr}` : ''}
          </span>
        </div>
        <div className="slip__rule" />
        {footer.trim() ? <div className="slip__centre">{footer}</div> : null}
      </div>
    </div>
  )
}

function LedgerTable({ rows, party }: { rows: readonly LedgerRowDto[]; party: PartyDto | null }) {
  return (
    <div className="panel panel--fill">
      <div className="panel__title">
        <span>PARTY WHOLE SALE LEDGER {party ? `(${party.name})` : ''}</span>
        <span className="toolbar__end">
          <Action id="wholesale.ledger.view-full" variant="toolbar">
            View Full Ledger
          </Action>
        </span>
      </div>
      <div className="panel__body panel__body--flush">
        {rows.length === 0 ? (
          <EmptyState
            title={party ? 'No entries yet' : 'No party chosen'}
            line={
              party
                ? `Nothing has been posted for ${party.name}. Saved slips and settlements appear here.`
                : 'Choose a party on the New Whole Sale tab to see their ledger.'
            }
            actionId="wholesale.tab.new"
            actionLabel="Go to New Whole Sale"
          />
        ) : (
          <div className="table-scroll">
            <table className="grid grid--fixed">
              <colgroup>
                <col className="col--rate" />
                <col />
                <col className="col--khalis" />
                <col className="col--gross" />
                <col className="col--gross" />
                <col className="col--katt" />
                <col className="col--amount" />
                <col className="col--katt" />
                <col className="col--katt" />
                <col className="col--action" />
              </colgroup>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Invoice No.</th>
                  <th>Type</th>
                  <th className="numeric">Gross (g)</th>
                  <th className="numeric">Khalis (g)</th>
                  <th className="numeric">Settled Gold</th>
                  <th className="numeric">Settled Cash</th>
                  <th className="numeric">Previous</th>
                  <th className="numeric">End Balance</th>
                  <th className="grid__action">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.entryId} className={row.isReversed ? 'row--reversed' : undefined}>
                    <td className="numeric">{toDisplayDate(row.date)}</td>
                    <td>{row.invoiceNo}</td>
                    <td>
                      {row.kind}
                      {row.isOverReturn ? <span className="badge badge--warn">over</span> : null}
                      {row.isReversed ? <span className="badge">reversed</span> : null}
                    </td>
                    <td className="numeric">{row.grossDisplay}</td>
                    <td className="numeric">{row.khalisDisplay}</td>
                    <td className="numeric">{row.settledGoldDisplay}</td>
                    <td className="numeric">{row.settledCashDisplay}</td>
                    <td className="numeric">{row.previousDisplay}</td>
                    <td className={`numeric ${row.endDrCr === 'CR' ? 'negative' : 'positive'}`}>
                      {row.endDisplay} {row.endDrCr ? `/${row.endDrCr}` : ''}
                    </td>
                    <td className="grid__action">
                      <Action
                        id="wholesale.ledger.view-entry"
                        variant="icon"
                        ariaLabel={`View ${row.invoiceNo}`}
                      >
                        <Icon name="eye" size={16} />
                      </Action>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
