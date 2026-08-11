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
} as const

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
