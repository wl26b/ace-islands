import type { Hole, Vec3 } from './types'
import { FLAT } from './types'
import { clamp, pureTaps, puttPaceFor } from './bar'
import { simulateShot } from './shot'

import type { ShotKind } from './shot'

/**
 * How far a perfect full-power shot would travel from here, in metres.
 *
 * This is what the power bar is calibrated against: the player reads the
 * distance to the pin, reads this, and estimates what fraction of the bar
 * to fill. Distance turns out to be very nearly proportional to bar fill
 * (within ~1m across the whole range), so that estimate is honest.
 *
 * It is measured by asking the simulation itself rather than by a formula,
 * so it stays correct when the tuning changes, and it accounts for the
 * hole's wind. The measurement runs over a hazard-free reference surface
 * with the cup moved out of reach, so the answer is how far the ball can be
 * hit rather than where this particular hole happens to stop it.
 */
/**
 * The reference this hole's distances are measured against: open ground
 * at the green's height, no hazards, no cup. It carries the hole's wind
 * and elevation, because those change how far the ball goes, but not the
 * green's contours -- what the slope does is for the grid to tell you.
 */
/**
 * The same hole with no rock in the way. Reach is a measure of how far the
 * ball travels, not of whether this hole happens to have an obstacle on
 * the line -- and the gauge is calibrated against it.
 */
function withoutPeak(hole: Hole): Hole {
  const { peak: _peak, ...rest } = hole
  return rest
}

function reference(hole: Hole, kind: ShotKind): { hole: Hole; from: Vec3 } {
  if (kind === 'putt') {
    return {
      hole: {
        ...withoutPeak(hole),
        greenIsland: {
          centre: { x: 0, z: 0 },
          radius: 1e4,
          surfaceY: hole.greenIsland.surfaceY,
          slope: FLAT,
        },
        pin: { x: 0, z: -1e6 },
      },
      from: { x: 0, y: hole.greenIsland.surfaceY, z: 0 },
    }
  }

  // A drive starts on the tee and finishes on ground at the green's
  // height, so the reference needs both, at their real heights, with open
  // water between. Laying one enormous green over the origin instead would
  // put the ball underground whenever the green sits above the tee, and
  // the "flight" would come out as a very long roll.
  return {
    hole: {
      ...withoutPeak(hole),
      teeIsland: { centre: { x: 0, z: 0 }, radius: 12, surfaceY: hole.tee.y, slope: FLAT },
      greenIsland: {
        // Near edge set back far enough that a full shot is always well
        // above the lip when it crosses, whatever the elevation.
        centre: { x: 0, z: -(1e4 + LANDING_GAP) },
        radius: 1e4,
        surfaceY: hole.greenIsland.surfaceY,
        slope: FLAT,
      },
      pin: { x: 0, z: -1e6 },
    },
    from: { ...hole.tee },
  }
}

/** How far a strike at this power would travel. */
export function rangeAt(hole: Hole, kind: ShotKind, power: number): number {
  const { hole: ref, from } = reference(hole, kind)
  const result = simulateShot(ref, { kind, from, aim: 0, ...pureTaps(power) })
  return Math.hypot(result.end.x - from.x, result.end.z - from.z)
}

/**
 * How far a perfect full-power shot would travel from here, in metres.
 *
 * Measured by asking the simulation rather than by a formula, so it stays
 * correct when the tuning changes, and it accounts for the hole's wind and
 * elevation.
 */
export function maxRange(hole: Hole, kind: ShotKind): number {
  return rangeAt(hole, kind, 1)
}

/**
 * The power that sends the ball a given distance.
 *
 * Found by inverting the simulation with a bisection rather than by
 * assuming distance is proportional to the bar. It very nearly is over
 * most of the range, but not near the bottom, where the ball still travels
 * ten metres at no power at all -- and a ruler that is wrong at one end is
 * a ruler you stop trusting.
 */
export function powerForDistance(
  hole: Hole,
  kind: ShotKind,
  distance: number,
): number {
  if (kind === 'putt') return puttPaceFor(distance)

  // Out of reach either way: answer exactly, rather than letting the
  // bisection creep towards an end it can never quite touch.
  if (distance >= rangeAt(hole, kind, 1)) return 1
  if (distance <= rangeAt(hole, kind, 0)) return 0

  let low = 0
  let high = 1
  // Distance rises with power on the open reference, so bisection is safe.
  for (let i = 0; i < 18; i++) {
    const mid = (low + high) / 2
    if (rangeAt(hole, kind, mid) < distance) low = mid
    else high = mid
  }
  return clamp((low + high) / 2, 0, 1)
}

/** Distance from the tee at which the reference ground begins. */
const LANDING_GAP = 30

export { puttPaceFor } from './bar'
