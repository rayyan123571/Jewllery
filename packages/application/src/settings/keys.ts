import type { SettingsRepository } from '../abstractions/repositories.js'

/**
 * Every setting the application reads, in one place, with its default.
 *
 * Settings are stored as TEXT and parsed here, so adding one never needs a
 * migration. Each accessor validates and falls back rather than throwing: a
 * corrupt settings row must not stop the shop trading.
 */

export const SETTING_KEYS = {
  /** Over-return tolerance, in milligrams. DECISIONS §7. */
  overReturnToleranceMg: 'wholesale.overReturnToleranceMg',
  /** Whether the katt sanity check is on at all. Ships OFF. */
  kattCheckEnabled: 'wholesale.kattCheckEnabled',
  kattMinMilliRatti: 'wholesale.kattMinMilliRatti',
  kattMaxMilliRatti: 'wholesale.kattMaxMilliRatti',
  /** Prefix for wholesale slip numbers, e.g. "WS-". */
  wholesaleInvoicePrefix: 'wholesale.invoicePrefix',
  settlementInvoicePrefix: 'wholesale.settlementPrefix',

  // ── retail ────────────────────────────────────────────────────────────────
  /** See RETAIL_WASTAGE_* below. Both ship as a decision the shop must make. */
  retailWastageDirection: 'retail.wastage.direction',
  retailWastageBasis: 'retail.wastage.basis',
  retailInvoicePrefix: 'retail.invoicePrefix',
  /** Prefix for BILL numbers, which are a separate sequence from invoices. */
  retailBillPrefix: 'retail.billPrefix',
  /** 1 | 100 | 1000 whole rupees. See RETAIL_ROUNDING_STEPS below. */
  retailRoundingNearest: 'retail.rounding.nearest',

  // ── the shell's own state ─────────────────────────────────────────────────
  //
  // Not business rules, and kept here anyway rather than in a second store: a
  // shop's PC already has exactly one place that survives a restart, and adding
  // a preferences file beside it would mean two things to back up and one of
  // them not covered by the backup we already take.
  /** Absent means "follow the window width". See App.tsx. */
  uiSidebarCollapsed: 'ui.sidebar.collapsed',
  /** 'maximized' | 'fullscreen' | 'normal'. */
  uiWindowMode: 'ui.window.mode',
  /** JSON {x,y,width,height} for the restored size. */
  uiWindowBounds: 'ui.window.bounds',
} as const

/** How the window was last left. Restored on the next launch. */
export type WindowMode = 'maximized' | 'fullscreen' | 'normal'

export interface WindowBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface WindowState {
  readonly mode: WindowMode
  /** Null when the window has never been restored down. */
  readonly bounds: WindowBounds | null
}

/**
 * How wastage enters a retail sale — and why this is a setting, not a constant.
 *
 * A reference mockup implied that wastage is SUBTRACTED from net weight and
 * taken on GROSS rather than net. Both are unusual for a retail sale, and the
 * two choices multiply out to four different invoices from the same inputs.
 *
 * The difference is not cosmetic. On a 4.050-tola sale at Rs 237,970/tola the
 * spread between the four combinations is tens of thousands of rupees, so
 * picking one silently would mean every invoice this shop issues is wrong in a
 * way nobody notices until a customer disputes one. It is a business decision
 * the shop owner has to make, and until they do, the software must be explicit
 * about which rule it is applying rather than quietly assuming.
 *
 * The defaults below are the conventional retail reading — wastage is a charge
 * ADDED to the metal the customer receives, calculated on the NET weight they
 * are actually paying for. That is the reading most Pakistani retail jewellers
 * use. It is a default, not a claim about this shop.
 */
export type WastageDirection = 'add' | 'subtract'
export type WastageBasis = 'gross' | 'net'

export const DEFAULT_RETAIL_WASTAGE_DIRECTION: WastageDirection = 'add'
export const DEFAULT_RETAIL_WASTAGE_BASIS: WastageBasis = 'net'

/**
 * How the invoice total is rounded, in whole rupees — and why 1 is the default.
 *
 * A reference mockup priced every amount on a round hundred (454,300 / 908,600).
 * Round hundreds do not fall out of any arithmetic; they are a shop's rounding
 * habit, and inferring one from two figures on a picture would mean every
 * invoice quietly disagreeing with the sum of its own lines.
 *
 * So the habit is a setting the shop states, and **1 means no rounding at all**:
 * the total stands exactly as computed, to the paisa. That is not the same as
 * "round to the nearest rupee" — the point of the default is that nothing is
 * invented until somebody chooses. 100 gives the mockup's round hundreds; 1000
 * gives round thousands.
 *
 * It applies to ONE figure, the invoice total, at the LAST step. See
 * `computeRetailInvoice`.
 */
export type RoundingStep = 1 | 100 | 1000

export const RETAIL_ROUNDING_STEPS: readonly RoundingStep[] = [1, 100, 1000]

export const DEFAULT_RETAIL_ROUNDING: RoundingStep = 1

/**
 * 0.050 g. Below this a negative remaining is allowed with a quiet note rather
 * than a modal: two scales genuinely disagree at the third decimal, and a
 * dialog on every 20 mg discrepancy trains people to click through it.
 */
export const DEFAULT_OVER_RETURN_TOLERANCE_MG = 50

/**
 * The katt sanity range ships **disabled**, and that is deliberate.
 *
 * Katt is not wastage — it is the alloy deduction that expresses purity — so
 * the original "cut percentage" check does not apply to it. What replaces it is
 * a plausibility band on katt itself. The suggested 4–24 ratti/tola brackets
 * 23K down to 18K, and the two real values we have (11.5 and 13) sit
 * comfortably inside it.
 *
 * Two values from one slip on one day is not a range, so the check is off until
 * someone has looked at a month of real slips and set it themselves. Katt
 * outside 0–96 is refused regardless — that is arithmetic, not judgement, and
 * it is enforced by the Katt value type and by a CHECK constraint.
 */
export const SUGGESTED_KATT_MIN_MILLI_RATTI = 4_000
export const SUGGESTED_KATT_MAX_MILLI_RATTI = 24_000

export class Settings {
  constructor(private readonly repo: SettingsRepository) {}

  overReturnToleranceMg(): number {
    return this.readInteger(
      SETTING_KEYS.overReturnToleranceMg,
      DEFAULT_OVER_RETURN_TOLERANCE_MG,
    )
  }

  kattCheckEnabled(): boolean {
    return this.repo.get(SETTING_KEYS.kattCheckEnabled) === 'true'
  }

  kattRangeMilliRatti(): { min: number; max: number } {
    return {
      min: this.readInteger(SETTING_KEYS.kattMinMilliRatti, SUGGESTED_KATT_MIN_MILLI_RATTI),
      max: this.readInteger(SETTING_KEYS.kattMaxMilliRatti, SUGGESTED_KATT_MAX_MILLI_RATTI),
    }
  }

  wholesaleInvoicePrefix(): string {
    return this.repo.get(SETTING_KEYS.wholesaleInvoicePrefix)?.trim() || 'WS-'
  }

  settlementInvoicePrefix(): string {
    return this.repo.get(SETTING_KEYS.settlementInvoicePrefix)?.trim() || 'RT-'
  }

  retailInvoicePrefix(): string {
    return this.repo.get(SETTING_KEYS.retailInvoicePrefix)?.trim() || 'RS-'
  }

  /**
   * The bill-number prefix. A SEPARATE sequence from invoice numbers.
   *
   * A bill and the slips under it are different documents: the customer is
   * handed one slip per purchase, and the bill is what says those slips were
   * one visit. Sharing a sequence would mean a bill number and an invoice
   * number that look alike and count together, so "RS-00007" could be either a
   * slip the customer is holding or the visit it belonged to.
   */
  retailBillPrefix(): string {
    return this.repo.get(SETTING_KEYS.retailBillPrefix)?.trim() || 'RB-'
  }

  /** Whether wastage is added to the net weight or taken out of it. */
  retailWastageDirection(): WastageDirection {
    const raw = this.repo.get(SETTING_KEYS.retailWastageDirection)?.trim()
    return raw === 'add' || raw === 'subtract' ? raw : DEFAULT_RETAIL_WASTAGE_DIRECTION
  }

  /** Whether the wastage percentage is taken on gross weight or on net. */
  retailWastageBasis(): WastageBasis {
    const raw = this.repo.get(SETTING_KEYS.retailWastageBasis)?.trim()
    return raw === 'gross' || raw === 'net' ? raw : DEFAULT_RETAIL_WASTAGE_BASIS
  }

  /**
   * The rounding step for the invoice total, in whole rupees.
   *
   * Anything that is not one of the three offered values falls back to 1 — no
   * rounding — rather than to the nearest plausible step. A corrupt row must
   * never invent a rounding habit the shop did not choose.
   */
  retailRoundingNearest(): RoundingStep {
    const raw = Number(this.repo.get(SETTING_KEYS.retailRoundingNearest)?.trim())
    return RETAIL_ROUNDING_STEPS.includes(raw as RoundingStep)
      ? (raw as RoundingStep)
      : DEFAULT_RETAIL_ROUNDING
  }

  /**
   * Records the shop's rounding habit.
   *
   * Refuses anything outside the offered set for the same reason
   * `setRetailWastageRule` does: a value that silently falls back on every read
   * means the shop made a decision and the software ignored it.
   */
  setRetailRoundingNearest(step: number): void {
    if (!RETAIL_ROUNDING_STEPS.includes(step as RoundingStep)) {
      throw new TypeError(
        `"${step}" is not a rounding step. Expected one of ` +
          `${RETAIL_ROUNDING_STEPS.join(', ')} whole rupees.`,
      )
    }
    this.repo.set(SETTING_KEYS.retailRoundingNearest, String(step))
  }

  /**
   * Records the shop's choice of wastage rule.
   *
   * Validated here rather than at the caller, because a settings row holding
   * something that is neither 'add' nor 'subtract' would fall back to the
   * default on every read — the shop would have made a decision and the
   * software would quietly ignore it. Refusing the write is the only way that
   * failure is visible.
   *
   * Changing this affects FUTURE sales only. Every posted sale carries the rule
   * it was priced with on its own row (migration 006), so nothing already
   * printed can be re-priced by this call.
   */
  setRetailWastageRule(direction: string, basis: string): void {
    if (direction !== 'add' && direction !== 'subtract') {
      throw new TypeError(
        `"${direction}" is not a wastage direction. Expected "add" or "subtract".`,
      )
    }
    if (basis !== 'gross' && basis !== 'net') {
      throw new TypeError(`"${basis}" is not a wastage basis. Expected "gross" or "net".`)
    }
    this.repo.set(SETTING_KEYS.retailWastageDirection, direction)
    this.repo.set(SETTING_KEYS.retailWastageBasis, basis)
  }

  /**
   * Whether the operator has made a choice about the sidebar.
   *
   * Three states, not two, and the third is the point: `null` means "no manual
   * choice", which is what lets the width rule apply. Once somebody has pressed
   * the toggle their answer is stored and the width rule stops overriding it.
   */
  sidebarCollapsed(): boolean | null {
    const raw = this.repo.get(SETTING_KEYS.uiSidebarCollapsed)?.trim()
    if (raw === 'true') return true
    if (raw === 'false') return false
    return null
  }

  setSidebarCollapsed(collapsed: boolean): void {
    this.repo.set(SETTING_KEYS.uiSidebarCollapsed, collapsed ? 'true' : 'false')
  }

  /** How the window was last left, for the next launch. */
  windowState(): WindowState {
    const mode = this.repo.get(SETTING_KEYS.uiWindowMode)?.trim()
    return {
      mode: mode === 'fullscreen' || mode === 'normal' ? mode : 'maximized',
      bounds: this.readBounds(),
    }
  }

  setWindowState(state: WindowState): void {
    this.repo.set(SETTING_KEYS.uiWindowMode, state.mode)
    if (state.bounds) {
      this.repo.set(SETTING_KEYS.uiWindowBounds, JSON.stringify(state.bounds))
    }
  }

  /**
   * A corrupt or half-written bounds row falls back to null rather than
   * throwing. A shop must be able to start its till with a bad preference; it
   * must not start it off the edge of a screen.
   */
  private readBounds(): WindowBounds | null {
    const raw = this.repo.get(SETTING_KEYS.uiWindowBounds)
    if (!raw) return null
    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null) return null
      const candidate = parsed as Record<string, unknown>
      const numbers = ['x', 'y', 'width', 'height'].map((key) => candidate[key])
      if (!numbers.every((value) => typeof value === 'number' && Number.isFinite(value))) {
        return null
      }
      const [x, y, width, height] = numbers as [number, number, number, number]
      return width > 0 && height > 0 ? { x, y, width, height } : null
    } catch {
      return null
    }
  }

  private readInteger(key: string, fallback: number): number {
    const raw = this.repo.get(key)
    if (raw === null) return fallback
    const value = Number(raw)
    // A corrupt row falls back rather than throwing. The shop must be able to
    // keep trading with a bad setting; it must not keep trading with a bad
    // *number*, which is why this refuses anything non-integer too.
    return Number.isSafeInteger(value) && value >= 0 ? value : fallback
  }
}
