import {
  IMPACT_POS,
  IMPACT_TOLERANCE,
  PERFECT_TOLERANCE,
  SWEEP_MS,
} from './constants'

/**
 * The three-click bar, as maths.
 *
 * The run log stores the player's two raw tap timings, not a power and an
 * accuracy. This file is the only thing that turns one into the other, so
 * the UI's bar and the server's replay cannot drift apart: both read these
 * functions and the constants behind them.
 *
 * Timeline:
 *   tap 1  starts the marker at 0, sweeping up.
 *   tap 2  locks power wherever the marker has reached.
 *   tap 3  should land on the impact zone as the marker sweeps back down.
 */

/** Marker position during the outward sweep, in bar units [0, 1]. */
export function sweepPosition(elapsedMs: number): number {
  return clamp(elapsedMs / SWEEP_MS, 0, 1)
}

/** Marker position during the return sweep, starting from locked power. */
export function returnPosition(power: number, elapsedMs: number): number {
  return clamp(power - elapsedMs / SWEEP_MS, 0, 1)
}

/** Power in [0, 1] from the second tap. */
export function powerFromTap(powerTapMs: number): number {
  return sweepPosition(powerTapMs)
}

/**
 * Signed accuracy error, normalised so 1 is a full miss.
 * Positive means struck early (marker still above the zone) and the ball
 * leaks right; negative means late and it draws left.
 */
export function accuracyFromTaps(power: number, impactTapMs: number): number {
  const raw = returnPosition(power, impactTapMs) - IMPACT_POS
  return clamp(raw / IMPACT_TOLERANCE, -1.5, 1.5)
}

/** True when the third tap landed inside the pure-strike window. */
export function isPure(power: number, impactTapMs: number): boolean {
  const raw = returnPosition(power, impactTapMs) - IMPACT_POS
  return Math.abs(raw) <= PERFECT_TOLERANCE
}

/**
 * Tap timings for a given power struck dead centre. Used to ask the
 * simulation how far a perfect shot would travel.
 */
export function pureTaps(power: number): {
  powerTapMs: number
  impactTapMs: number
} {
  return {
    powerTapMs: power * SWEEP_MS,
    impactTapMs: (power - IMPACT_POS) * SWEEP_MS,
  }
}

/** Milliseconds of return sweep available before the marker reaches zero. */
export function returnWindowMs(power: number): number {
  return power * SWEEP_MS
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}
