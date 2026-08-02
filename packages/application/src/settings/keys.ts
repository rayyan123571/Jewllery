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
} as const

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
