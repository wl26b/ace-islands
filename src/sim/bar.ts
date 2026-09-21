import {
  IMPACT_POS,
  IMPACT_TOLERANCE,
  PERFECT_TOLERANCE,
  POWER_START,
  PUTT_FRICTION,
  PUTT_MAX_SPEED,
  PUTT_MIN_SPEED,
  PUTT_SCALES,
  SWEEP_MS,
} from './constants'

/**
 * The shot bar, as maths.
 *
 * The run log stores the player's two raw tap timings, not a power and an
 * accuracy. This file is the only thing that turns one into the other, so
 * the UI's bar and the server's replay cannot drift apart: both read these
 * functions and the constants behind them.
 *
 * The bar is in two parts. The right-hand stretch, from POWER_START to the
 * end, is the power section: the marker ping-pongs across it until you tap,
 * and where you catch it sets the power. It then turns and runs back down
 * into the accuracy section on the left, and the second tap has to land on
 * the impact zone there. Power and accuracy are set on their own stretches
 * of bar, and the marker never stops on its own.
 */

/** Width of the power section, in bar units. */
const POWER_SPAN = 1 - POWER_START

/**
 * How long the marker takes to cross the power section, whatever scale is
 * selected. A shorter scale therefore moves the marker more slowly rather
 * than merely turning it round sooner -- which is the entire point of a
 * shorter scale: the same putt, read at finer resolution.
 */
const POWER_SWEEP_MS = POWER_SPAN * SWEEP_MS

/** The putter's widest scale: its whole range. */
export const FULL_PUTT_SCALE = PUTT_SCALES.length - 1

export type BarKind = 'drive' | 'putt'

/**
 * The power that would roll a putt a given distance on level ground.
 *
 * Inverts the rolling maths rather than guessing: a ball leaving at v
 * covers v^2 / 2a before friction stops it.
 */
export function puttPaceFor(distance: number): number {
  const wanted = 2 * PUTT_FRICTION * Math.max(distance, 0)
  const floor = PUTT_MIN_SPEED * PUTT_MIN_SPEED
  const ceiling = PUTT_MAX_SPEED * PUTT_MAX_SPEED
  return clamp((wanted - floor) / (ceiling - floor), 0, 1)
}

/**
 * Headroom on the chosen scale.
 *
 * Generous, because a breaking putt travels further than the straight line
 * to the hole: it is aimed off and curves in. A ruler that only just
 * reaches the pin cannot be struck hard enough to hole a putt with any
 * real break in it.
 */
const SCALE_MARGIN = 1.35

/**
 * The shortest of the putter's scales that still reaches the hole.
 *
 * Chosen for the player rather than by them. A scale is not a decision
 * worth making -- the shortest one that reaches is always the right
 * answer, because it reads the same putt at the finest resolution.
 */
export function autoPuttScale(distanceToPin: number): number {
  const needed = Math.max(distanceToPin, 0) * SCALE_MARGIN
  for (let i = 0; i < PUTT_SCALES.length; i++) {
    if ((PUTT_SCALES[i] ?? 0) >= needed) return i
  }
  return FULL_PUTT_SCALE
}

/** How far the chosen scale reaches, given the putter's own full range. */
export function puttScaleRange(distanceToPin: number, fullRange: number): number {
  const reach = PUTT_SCALES[autoPuttScale(distanceToPin)]
  return reach === undefined || !Number.isFinite(reach)
    ? fullRange
    : Math.min(reach, fullRange)
}

/**
 * The top of the marker's travel, in power units. A full swing always uses
 * the whole range; a putt uses whichever scale its length calls for.
 */
export function powerCapFor(kind: BarKind, distanceToPin = Infinity): number {
  if (kind !== 'putt') return 1
  const distance = PUTT_SCALES[autoPuttScale(distanceToPin)]
  if (distance === undefined || !Number.isFinite(distance)) return 1
  // Never so small that the scale becomes a hair trigger.
  return clamp(puttPaceFor(distance), 0.04, 1)
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

/** Timings arrive from a log that may be anything at all. */
function sane(ms: number): number {
  return Number.isFinite(ms) && ms > 0 ? ms : 0
}

/**
 * Marker position while power is being set: back and forth across the
 * power section at a steady pace, forever, until the player taps. It never
 * runs out and fires itself at full power.
 */
export function powerPhasePosition(elapsedMs: number, cap = 1): number {
  const cycle = 2 * POWER_SWEEP_MS
  const t = sane(elapsedMs) % cycle
  const fraction = t <= POWER_SWEEP_MS
    ? t / POWER_SWEEP_MS
    : 2 - t / POWER_SWEEP_MS
  return POWER_START + fraction * cap * POWER_SPAN
}

/** Power in [0, 1], from where the first tap caught the marker. */
export function powerFromTap(powerTapMs: number, cap = 1): number {
  return (powerPhasePosition(powerTapMs, cap) - POWER_START) / POWER_SPAN
}

/** Where the marker sits on the bar once power is locked in. */
export function lockedPosition(power: number): number {
  return POWER_START + clamp(power, 0, 1) * POWER_SPAN
}

/** Marker position on the way back down towards the accuracy section. */
export function returnPosition(power: number, elapsedMs: number): number {
  return clamp(lockedPosition(power) - sane(elapsedMs) / SWEEP_MS, 0, 1)
}

/** Milliseconds of return run available before the marker reaches zero. */
export function returnWindowMs(power: number): number {
  return lockedPosition(power) * SWEEP_MS
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

/** True when the second tap landed inside the pure-strike window. */
export function isPure(power: number, impactTapMs: number): boolean {
  const raw = returnPosition(power, impactTapMs) - IMPACT_POS
  return Math.abs(raw) <= PERFECT_TOLERANCE
}

/**
 * How far the second tap missed the impact zone, in milliseconds.
 * Positive means early, negative late. This is what the player needs to
 * see to correct the next one: a signed number of milliseconds is
 * actionable in a way that "you sliced it" is not.
 */
export function impactErrorMs(power: number, impactTapMs: number): number {
  return (returnPosition(power, impactTapMs) - IMPACT_POS) * SWEEP_MS
}

/**
 * Tap timings for a given power struck dead centre. Used to ask the
 * simulation how far a perfect shot would travel, and by the tests.
 */
export function pureTaps(power: number, cap = 1): {
  powerTapMs: number
  impactTapMs: number
} {
  const p = clamp(power, 0, cap)
  return {
    // Caught on the marker's first run out across the power section.
    powerTapMs: (p / cap) * POWER_SWEEP_MS,
    impactTapMs: (lockedPosition(p) - IMPACT_POS) * SWEEP_MS,
  }
}
