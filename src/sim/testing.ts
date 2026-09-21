import { IMPACT_POS, SWEEP_MS } from './constants'

export { pureTaps } from './bar'

/**
 * Tap timings with a deliberate accuracy error in [-1, 1], where positive
 * means struck early.
 */
export function taps(
  power: number,
  error: number,
): { powerTapMs: number; impactTapMs: number } {
  return {
    powerTapMs: power * SWEEP_MS,
    impactTapMs: (power - IMPACT_POS) * SWEEP_MS - error * 0.12 * SWEEP_MS,
  }
}
