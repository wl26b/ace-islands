import { PERFECT_TOLERANCE, SWEEP_MS } from '../sim/constants'

/**
 * Turns a struck shot into something the player can act on.
 *
 * Pure and separate from the DOM so the wording can be tested: the whole
 * point is that it tells the truth about which way the ball will bend.
 * The marker is held on the bar where it landed, which already shows how
 * far out the tap was; this only has to name what it did.
 */

export interface Verdict {
  headline: string
  tone: 'pure' | 'near' | 'miss'
}

/** Below this many milliseconds out, the miss is a good one. */
const NEAR_MS = 55

export function describeImpact(errorMs: number, accuracy: number): Verdict {
  if (Math.abs(errorMs) <= PERFECT_TOLERANCE * SWEEP_MS) {
    return { headline: 'Pure strike · dead straight', tone: 'pure' }
  }

  const early = errorMs > 0
  // Positive accuracy bends the ball right, negative left. Named by how
  // far off it is, so a small miss does not read as a disaster.
  const severe = Math.abs(accuracy) > 0.45
  const shape = early
    ? severe
      ? 'slices right'
      : 'fades right'
    : severe
      ? 'hooks left'
      : 'draws left'

  return {
    headline: `${early ? 'Early' : 'Late'} · ${shape}`,
    tone: Math.abs(errorMs) <= NEAR_MS ? 'near' : 'miss',
  }
}
