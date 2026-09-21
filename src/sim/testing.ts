import { IMPACT_TOLERANCE, SWEEP_MS } from './constants'
import { pureTaps } from './bar'

export { pureTaps } from './bar'

/**
 * Tap timings with a deliberate accuracy error in [-1, 1], where positive
 * means struck early.
 */
export function taps(
  power: number,
  error: number,
  cap = 1,
): { powerTapMs: number; impactTapMs: number } {
  const pure = pureTaps(power, cap)
  return {
    powerTapMs: pure.powerTapMs,
    impactTapMs: pure.impactTapMs - error * IMPACT_TOLERANCE * SWEEP_MS,
  }
}
