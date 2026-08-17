import { khalisOf } from '../wholesale/lineMath.js'
import type { Katt } from '../wholesale/Katt.js'
import type { Weight } from '../common/Weight.js'

/**
 * The piece computations: net and khalis from what the scale says.
 *
 *   net    = gross − stone        (a stone is weight, but it is not metal)
 *   khalis = net × (96000 − katt_milliRatti) / 96000
 *
 * The khalis comes from the NET, not the gross — this is the one place piece
 * arithmetic differs from a purchase line, and it differs because purchases of
 * old gold have no stones. A stone-set piece valued off its gross would count
 * the stones as gold, and every valuation built on it would be quietly high.
 * With stone at zero the two formulas are identical, which a test proves.
 *
 * Same integer discipline as everything else: milligrams in, milligrams out,
 * rounded half away from zero exactly once inside `khalisOf`.
 */

export interface PieceFigures {
  readonly net: Weight
  readonly khalis: Weight
}

export function computePieceFigures(input: {
  readonly gross: Weight
  readonly stone: Weight
  readonly katt: Katt
}): PieceFigures {
  if (input.stone.isNegative) {
    throw new RangeError('Stone weight cannot be negative.')
  }
  if (input.stone.milligrams > input.gross.milligrams) {
    throw new RangeError(
      `Stone weight (${input.stone.format()} g) cannot exceed the gross ` +
        `(${input.gross.format()} g) — the stones are part of what was weighed.`,
    )
  }
  const net = input.gross.minus(input.stone)
  return { net, khalis: khalisOf(net, input.katt) }
}
