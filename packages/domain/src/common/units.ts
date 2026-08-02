/**
 * The subcontinental weight units, and the one place their constants live.
 *
 * Taken from the working reference implementation (GoldLab `src/logic/units.js`),
 * not from a general definition of a tola:
 *
 *     export const GRAMS_PER_TOLA = 11.664
 *
 * It is 11.664, not 11.6638038. The reference uses the round trade figure
 * throughout — the purity engine, the receipts and the deal maths all divide by
 * it — so using the physical definition here would put every amount slightly out
 * against the system this replaces.
 *
 * `nayaSoda.js` in that codebase carries a warning worth repeating, because it
 * is the bug this file exists to prevent:
 *
 *   "ریٹ is per TOLA but وزن is stored in GRAMS, so grams must be converted to
 *    tolas BEFORE multiplying. Multiplying a per-tola rate by a gram weight
 *    gives a figure 11.664× too large — it is not money at all. Keeping the
 *    formula in one file is what stops that bug coming back."
 *
 * Same policy here: nothing else in the codebase may retype these numbers.
 */

/** 11.664 g. The trade figure, matching the reference implementation. */
export const GRAMS_PER_TOLA = 11.664

/**
 * 11,664 mg — and note that it is an exact integer.
 *
 * That is the whole reason weight is stored in milligrams rather than in some
 * other minor unit: a tola is a whole number of milligrams, so converting
 * between the unit the trade quotes in and the unit we store in never needs a
 * fraction. Every rate calculation divides by this exact integer.
 */
export const MG_PER_TOLA = 11_664

export const MASHA_PER_TOLA = 12
export const RATTI_PER_MASHA = 8

/**
 * 96 ratti to the tola. This is the katt scale.
 *
 * Katt on a wholesale slip is quoted in ratti per tola, and the pure-gold
 * fraction is `(96 − katt) / 96` — confirmed against the reference engine's
 * `factor = 1 - totalRatti / 96` in `purity.js`.
 */
export const RATTI_PER_TOLA = MASHA_PER_TOLA * RATTI_PER_MASHA // 96

/**
 * Katt is stored as an integer count of milli-ratti, for the same reason weight
 * is stored in milligrams: the slip quotes it to three decimal places (13.000,
 * 11.500) and an integer keeps it exact.
 */
export const MILLI_RATTI_PER_TOLA = RATTI_PER_TOLA * 1000 // 96_000

/** Katt outside this is arithmetically meaningless, not merely suspicious. */
export const MIN_KATT_MILLI_RATTI = 0
export const MAX_KATT_MILLI_RATTI = MILLI_RATTI_PER_TOLA
