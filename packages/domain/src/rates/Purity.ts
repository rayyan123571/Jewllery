/**
 * Gold purity, as the trade quotes it.
 *
 * Carried over from the earlier prototype's schema, which had this right. The
 * karat figures are the shop's language; the millesimal fineness is what the
 * arithmetic needs when converting a weight of one purity into its pure-gold
 * equivalent.
 */
export const PURITIES = ['K24', 'K22', 'K21', 'K18'] as const

export type Purity = (typeof PURITIES)[number]

/**
 * Parts of pure gold per thousand parts of alloy.
 *
 * Expressed as integers so purity conversions can go through `Weight.scaled`
 * and stay exact — 22 karat is `scaled(916, 1000)`, never `* 0.916`.
 */
export const FINENESS: Readonly<Record<Purity, number>> = Object.freeze({
  K24: 999,
  K22: 916,
  K21: 875,
  K18: 750,
})

export function isPurity(value: string): value is Purity {
  return (PURITIES as readonly string[]).includes(value)
}

export function parsePurity(value: string): Purity {
  if (!isPurity(value)) {
    throw new TypeError(
      `"${value}" is not a recognised purity. Expected one of: ${PURITIES.join(', ')}.`,
    )
  }
  return value
}

/** How the purity is written on screen and on printed slips. */
export function formatPurity(purity: Purity): string {
  return `${purity.slice(1)}K`
}
