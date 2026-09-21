import type { Hole } from './types'
import { pureTaps } from './bar'
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
export function maxRange(hole: Hole, kind: ShotKind): number {
  const reference: Hole = {
    ...hole,
    greenIsland: {
      centre: { x: 0, z: 0 },
      radius: 1e5,
      surfaceY: hole.greenIsland.surfaceY,
    },
    pin: { x: 0, z: -1e6 },
  }
  const from = {
    x: 0,
    y: hole.greenIsland.surfaceY,
    z: 0,
  }
  const result = simulateShot(reference, {
    kind,
    from,
    aim: 0,
    ...pureTaps(1),
  })
  return Math.hypot(result.end.x - from.x, result.end.z - from.z)
}
