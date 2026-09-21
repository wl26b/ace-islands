import type { Hole } from './types'
import { range, streamFor } from './rng'
import { maxRange } from './range'

/**
 * The reference hole, and the generator that makes the ones you play.
 *
 * A hole is plain data, so nothing here touches the renderer: the scene is
 * built from whatever these return.
 */
/**
 * The hand-made hole the shot maths was tuned against. Generated holes stay
 * inside this envelope. Kept as the fixed reference for tests; a real run
 * generates every hole, hole 1 included, so no two runs open the same way.
 */
const TEE_ISLAND = {
  centre: { x: 0, z: 0 },
  radius: 9,
  surfaceY: 4,
} as const

export const HOLE_ONE: Hole = {
  id: 'ace-1',
  par: 2,
  tee: { x: 0, y: 4, z: 0 },
  teeIsland: TEE_ISLAND,
  greenIsland: {
    centre: { x: 0, z: -80 },
    radius: 18,
    surfaceY: 4,
  },
  pin: { x: 3, z: -82 },
  cupRadius: 0.55,
  wind: {
    speed: 3.2,
    direction: 0.6,
  },
}

/**
 * Hole N of a run. Every varying value comes from the seeded stream, so the
 * server can rebuild the exact hole a player faced from the seed alone.
 *
 * The ranges are deliberately narrow: they stay inside the envelope the
 * shot maths was tuned against, so a generated hole is always reachable.
 */
export function generateHole(seed: number, holeNumber: number): Hole {
  const rng = streamFor(seed, holeNumber)

  const wind = windFor(rng, holeNumber)
  const radius = range(rng, 13, 20)
  /** What share of a full-power shot this hole asks for. */
  const demand = range(rng, 0.55, 0.95)
  const lateral = range(rng, -9, 9)
  const pinAngle = range(rng, 0, Math.PI * 2)
  const pinDist = range(rng, 0, radius * 0.5)

  // Ask the simulation how far the ball can actually be hit into this
  // hole's wind, and place the green as a share of that. A fixed distance
  // range cannot know that 88m is a comfortable hole downwind and an
  // impossible one into a 7m/s breeze.
  const reach = maxRange(
    {
      ...HOLE_ONE,
      wind,
      greenIsland: { ...HOLE_ONE.greenIsland, radius },
    },
    'drive',
  )

  // Always leave a real carry over water between the two islands.
  const centreZ = -Math.max(reach * demand, radius + TEE_ISLAND.radius + 22)

  return {
    id: `ace-${holeNumber}`,
    par: 2,
    tee: { x: 0, y: 4, z: 0 },
    teeIsland: TEE_ISLAND,
    greenIsland: {
      centre: { x: lateral, z: centreZ },
      radius,
      surfaceY: 4,
    },
    pin: {
      x: lateral + Math.cos(pinAngle) * pinDist,
      z: centreZ + Math.sin(pinAngle) * pinDist,
    },
    cupRadius: 0.55,
    wind,
  }
}

/**
 * Wind for a given hole. Both ends of the range climb with the hole number,
 * so late holes are reliably windy rather than merely capable of being so:
 * raising only the ceiling would still deal plenty of dead calm at hole 20.
 */
function windFor(rng: () => number, holeNumber: number): Hole['wind'] {
  const ceiling = Math.min(1.5 + holeNumber * 0.55, 7.5)
  const floor = Math.max(0, ceiling - 2.5)
  return {
    speed: range(rng, floor, ceiling),
    direction: range(rng, 0, Math.PI * 2),
  }
}
