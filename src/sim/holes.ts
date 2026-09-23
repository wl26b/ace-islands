import type { Hole, Peak, Slope } from './types'
import { FLAT } from './types'
import { MAX_GREEN_GRADIENT } from './constants'
import { range, streamFor } from './rng'
import { simulateShot } from './shot'
import { aimDirection, aimTowards } from './aim'
import { pureTaps } from './bar'
import { maxRange, powerForDistance } from './range'

/**
 * The reference hole, and the generator that makes the ones you play.
 *
 * Par 3: one shot to the green and two putts, which is what a one-shot
 * hole is in real golf. There is no such thing as a par 2.
 *
 * A hole is plain data, so nothing here touches the renderer: the scene is
 * built from whatever these return.
 */
/**
 * The hand-made hole the shot maths was tuned against. Generated holes stay
 * inside this envelope. Kept as the fixed reference for tests; a real run
 * generates every hole, hole 1 included, so no two runs open the same way.
 */
/** You tee off from a level box, as you do in real golf. */
const TEE_ISLAND = {
  centre: { x: 0, z: 0 },
  radius: 9,
  surfaceY: 4,
  slope: FLAT,
}

export const HOLE_ONE: Hole = {
  id: 'ace-1',
  par: 3,
  tee: { x: 0, y: 4, z: 0 },
  teeIsland: TEE_ISLAND,
  greenIsland: {
    centre: { x: 0, z: -80 },
    radius: 18,
    surfaceY: 4,
    // The reference green is level on purpose: it is the fixed testbed the
    // shot maths was tuned against. Holes you actually play are contoured.
    slope: FLAT,
  },
  pin: { x: 3, z: -82 },
  cupRadius: 0.32,
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

  // The run has to get harder or it never ends: par 3 gives you a shot at
  // the green and two putts, which a steady player will make all day. So
  // the greens shrink, the pins tighten, the holes stretch and the wind
  // gets up as you go.
  const difficulty = Math.min(holeNumber / 25, 1)

  const wind = windFor(rng, holeNumber)
  const radius = range(
    rng,
    lerp(16, 9.5, difficulty),
    lerp(20, 13, difficulty),
  )
  // Greens sit above or below the tee. An uphill green shortens the shot
  // and puts a taller wall in front of it; a sunken one runs on.
  const surfaceY = range(rng, 1.5, lerp(9, 11, difficulty))
  /** What share of a full-power shot this hole asks for. */
  const demand = range(
    rng,
    lerp(0.55, 0.74, difficulty),
    lerp(0.95, 0.99, difficulty),
  )
  const lateral = range(rng, -9, 9)
  const slope = slopeFor(rng, difficulty)
  const pinAngle = range(rng, 0, Math.PI * 2)
  // Tighter to the edge as the run goes on.
  const pinDist = range(
    rng,
    0,
    Math.max(0, Math.min(radius * lerp(0.45, 0.85, difficulty), radius - 2.5)),
  )

  // Ask the simulation how far the ball can actually be hit into this
  // hole's wind, and place the green as a share of that. A fixed distance
  // range cannot know that 88m is a comfortable hole downwind and an
  // impossible one into a 7m/s breeze.
  const reach = maxRange(
    {
      ...HOLE_ONE,
      wind,
      greenIsland: { ...HOLE_ONE.greenIsland, radius, surfaceY },
    },
    'drive',
  )

  // Always leave a real carry over water between the two islands, and set
  // a tall green further back still: the ball has to be over the lip by
  // the time it arrives, and a high wall close to the tee is unclearable.
  const minCentre =
    radius + TEE_ISLAND.radius + 22 + Math.max(0, surfaceY - TEE_ISLAND.surfaceY) * 3.5
  const centreZ = -Math.max(reach * demand, minCentre)

  const bare: Hole = {
    id: `ace-${holeNumber}`,
    par: 3,
    tee: { x: 0, y: 4, z: 0 },
    teeIsland: TEE_ISLAND,
    greenIsland: {
      centre: { x: lateral, z: centreZ },
      radius,
      surfaceY,
      slope,
    },
    pin: {
      x: lateral + Math.cos(pinAngle) * pinDist,
      // Tucked pins are fine at the back and down the sides, but not on
      // the front lip: a ball pitched at the pin stops a few metres past
      // where it lands, so a pin too near the front edge puts the pitch
      // point out over the water, and following the game's own advice
      // drowns you. A tailwind adds run-out, hence the generous margin.
      z: centreZ + Math.min(Math.sin(pinAngle) * pinDist, Math.max(0, radius - 8)),
    },
    cupRadius: 0.32,
    wind,
  }

  const peak = peakFor(rng, bare, difficulty)
  return peak === null ? bare : { ...bare, peak }
}

/**
 * A rock on the line to the green, or nothing.
 *
 * Its height is taken from the trajectory of the shot the hole actually
 * asks for: high enough that a weak one is into the rock, low enough that
 * the right one clears. Picking a height out of the air would either make
 * the hole impossible or leave the rock as scenery, and which of the two
 * would depend on how far the hole happened to be.
 *
 * The point of it is to narrow the band of power that gets you home. Under
 * it and you are in the sea; over it and you may be through the back of
 * the green. Without that squeeze the direct line is simply better than
 * laying up, and there is no decision to make.
 */
function peakFor(rng: () => number, hole: Hole, difficulty: number): Peak | null {
  // Rare early on, common late.
  if (rng() > lerp(0.1, 0.8, difficulty)) return null

  const toPin = Math.hypot(hole.pin.x - hole.tee.x, hole.pin.z - hole.tee.z)
  const radius = range(rng, 5, 8)

  // Somewhere down the carry. Measured to the green's centre, not to the
  // pin: a pin tucked at the back sits beyond the middle of the green, so
  // working back from it would put the rock inside the island.
  const toGreen = Math.hypot(
    hole.greenIsland.centre.x - hole.tee.x,
    hole.greenIsland.centre.z - hole.tee.z,
  )
  const nearest = hole.teeIsland.radius + radius + CLEARANCE
  const furthest = toGreen - hole.greenIsland.radius - radius - CLEARANCE
  if (furthest <= nearest) return null
  // Biased towards the green rather than the middle of the carry. Near
  // the apex every shot is high and the rock is scenery; near the green
  // the ball is coming down and a few points of power is the difference
  // between clearing it and not.
  const along = nearest + (furthest - nearest) * range(rng, 0.45, 0.95)

  const aim = aimTowards(hole.pin.x - hole.tee.x, hole.pin.z - hole.tee.z)
  const heading = aimDirection(aim)
  const centre = {
    x: hole.tee.x + heading.x * along,
    z: hole.tee.z + heading.z * along,
  }

  // The line runs to the pin, which is not the green's centre, so the
  // distance along it does not settle where the rock actually lands.
  // Measure the finished position against both islands and give up rather
  // than have a rock growing out of a green.
  const clearOfTee = Math.hypot(centre.x - hole.teeIsland.centre.x, centre.z - hole.teeIsland.centre.z)
  const clearOfGreen = Math.hypot(
    centre.x - hole.greenIsland.centre.x,
    centre.z - hole.greenIsland.centre.z,
  )
  if (clearOfTee < hole.teeIsland.radius + radius + CLEARANCE) return null
  if (clearOfGreen < hole.greenIsland.radius + radius + CLEARANCE) return null

  // How high the ball is over that spot when played as the hole intends.
  const intended = simulateShot(hole, {
    kind: 'drive',
    from: hole.tee,
    aim,
    ...pureTaps(powerForDistance(hole, 'drive', toPin)),
  })
  const overhead = heightAlong(intended.path, hole.tee, along) - hole.tee.y
  if (overhead < 5) return null

  // Leaves the right shot room to spare early on, and less later.
  const height = hole.tee.y + overhead * lerp(0.55, 0.78, difficulty)
  const peak: Peak = { centre, radius, height }

  // Then check rather than trust. The height was worked out from a shot
  // aimed straight at the pin, but a crosswind has to be aimed off, and
  // that shot flies a different line over the rock. A hole whose own
  // recommended shot cannot clear its own obstacle is a hole that lies to
  // the player, so it loses the rock instead.
  const withPeak: Hole = { ...hole, peak }
  for (const nudge of [0, -0.2, -0.1, 0.1, 0.2]) {
    const played = simulateShot(withPeak, {
      kind: 'drive',
      from: hole.tee,
      aim: aim + nudge,
      ...pureTaps(powerForDistance(hole, 'drive', toPin)),
    })
    if (played.struckPeak) return null
  }

  return peak
}

/** Height of a flight as it passes a given distance from the tee. */
function heightAlong(
  path: readonly { x: number; y: number; z: number }[],
  from: { x: number; z: number },
  distance: number,
): number {
  let best = -Infinity
  let closest = Infinity
  for (const point of path) {
    const gap = Math.abs(Math.hypot(point.x - from.x, point.z - from.z) - distance)
    if (gap < closest) {
      closest = gap
      best = point.y
    }
  }
  return best
}

/**
 * Wind for a given hole. Both ends of the range climb with the hole number,
 * so late holes are reliably windy rather than merely capable of being so:
 * raising only the ceiling would still deal plenty of dead calm at hole 20.
 */
function windFor(rng: () => number, holeNumber: number): Hole['wind'] {
  const ceiling = Math.min(1.5 + holeNumber * 0.6, 9.5)
  const floor = Math.max(0, ceiling - 2.2)
  return {
    speed: range(rng, floor, ceiling),
    direction: range(rng, 0, Math.PI * 2),
  }
}

/** Water left between the rock and either island. */
const CLEARANCE = 6

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * The contour of a green: a steady tilt with a rolling swell over it,
 * both firming up as the run goes on. Kept well inside what friction can
 * hold, so a ball that comes to rest stays put instead of trickling away
 * on its own.
 */
function slopeFor(rng: () => number, difficulty: number): Slope {
  // Nearly flat to begin with, and severe by the end of the ramp.
  const tilt = lerp(0.015, 0.075, difficulty)
  const swellFreq = range(rng, 0.17, 0.32)

  const slope: Slope = {
    // Side slope is where the break comes from, so it runs either way.
    gradientX: range(rng, -tilt, tilt),
    // Front-to-back is mostly tilted away from the tee. Tilting towards it
    // raises the front lip, and the ball has to clear that lip on a shot
    // whose power was worked out against level ground -- so a steep one
    // turns the game's own advice into a splash.
    gradientZ: range(rng, -tilt, tilt * 0.3),
    swellAmp: range(rng, 0.04, lerp(0.12, 0.34, difficulty)),
    swellFreq,
    swellPhase: range(rng, 0, Math.PI * 2),
  }

  // The tilt and the swell can both be steep at once, so the pair is
  // scaled to fit under the limit rather than each being bounded alone --
  // which would either leave the cap unreachable or let the two of them
  // together exceed it.
  const steepest = steepestOf(slope)
  if (steepest <= MAX_GREEN_GRADIENT) return slope

  const scale = MAX_GREEN_GRADIENT / steepest
  return {
    ...slope,
    gradientX: slope.gradientX * scale,
    gradientZ: slope.gradientZ * scale,
    swellAmp: slope.swellAmp * scale,
  }
}

/** The worst gradient this contour can produce anywhere on the green. */
function steepestOf(slope: Slope): number {
  return (
    Math.hypot(slope.gradientX, slope.gradientZ) +
    slope.swellAmp * slope.swellFreq
  )
}
