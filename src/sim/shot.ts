import type { Hole, Island, Vec3 } from './types'
import * as K from './constants'
import { accuracyFromTaps, clamp, isPure, powerCapFor, powerFromTap } from './bar'
import { aimDirection } from './aim'
import { gradientAt, heightAt } from './surface'

/**
 * The pure shot module.
 *
 * Given a hole, an aim angle and the two tap timings, this returns the
 * ball's path and where it ended up. It imports no three.js, touches no DOM,
 * calls no Math.random() and reads no clock, and it advances on a fixed
 * timestep — so it produces identical results on a phone, a laptop and
 * inside a Lambda replaying a submitted run.
 */

export type ShotKind = 'drive' | 'putt'
export type SurfaceKind = 'green' | 'tee' | 'water'
/** How the ball finished: in the cup, at rest on land, or wet. */
export type ShotOutcome = 'holed' | 'rest' | 'water'

export interface ShotInput {
  kind: ShotKind
  from: Vec3
  /** Radians. 0 points straight down the hole; positive swings toward +X. */
  aim: number
  powerTapMs: number
  impactTapMs: number
}

export interface ShotResult {
  /** Positions at 60Hz, for the renderer to animate along. */
  path: Vec3[]
  end: Vec3
  outcome: ShotOutcome
  /** Surface the ball came to rest on; 'water' when the outcome is water. */
  surface: SurfaceKind
  power: number
  accuracy: number
  pure: boolean
  /** Horizontal distance from the resting place to the cup, in metres. */
  toPin: number
  /** Highest point reached, so the camera can frame the flight. */
  apex: number
  /** Distance flown before the first ground contact, in metres. */
  carry: number
  /** True when the ball was stopped by the rock rather than the water. */
  struckPeak: boolean
}

interface Surface {
  kind: SurfaceKind
  y: number
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function horizontalDist(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz)
}

/** Which island a point sits over, if any. */
function islandAt(hole: Hole, x: number, z: number): Island | null {
  const g = hole.greenIsland
  if (horizontalDist(x, z, g.centre.x, g.centre.z) <= g.radius) return g
  const t = hole.teeIsland
  if (horizontalDist(x, z, t.centre.x, t.centre.z) <= t.radius) return t
  return null
}

/**
 * What lies under a given point: the green, the tee island, or water, and
 * at what height. Ground is no longer level, so the height comes from the
 * same field the renderer builds its mesh from.
 */
export function surfaceAt(hole: Hole, x: number, z: number): Surface {
  const g = hole.greenIsland
  if (horizontalDist(x, z, g.centre.x, g.centre.z) <= g.radius) {
    return { kind: 'green', y: heightAt(g, x, z) }
  }
  const t = hole.teeIsland
  if (horizontalDist(x, z, t.centre.x, t.centre.z) <= t.radius) {
    return { kind: 'tee', y: heightAt(t, x, z) }
  }
  return { kind: 'water', y: 0 }
}

/** Shortest distance from the cup to the segment the ball travelled this step. */
function distanceToCup(
  hole: Hole,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax
  const dz = bz - az
  const lenSq = dx * dx + dz * dz
  if (lenSq === 0) return horizontalDist(ax, az, hole.pin.x, hole.pin.z)
  let t = ((hole.pin.x - ax) * dx + (hole.pin.z - az) * dz) / lenSq
  t = clamp(t, 0, 1)
  return horizontalDist(ax + dx * t, az + dz * t, hole.pin.x, hole.pin.z)
}

/**
 * The cup's capture radius shrinks as the ball speeds up and reaches zero at
 * CAPTURE_SPEED, which is what makes a putt struck too hard lip out.
 */
/** How much further a ball at this speed would run before stopping. */
function runOut(speed: number, friction: number): number {
  return (speed * speed) / (2 * friction)
}

function capturedBy(
  hole: Hole,
  speed: number,
  dist: number,
  friction: number,
): boolean {
  const left = runOut(speed, friction)
  const effective = hole.cupRadius * clamp(1 - left / K.CAPTURE_RUNOUT, 0, 1)
  // Guard the zero case explicitly: a ball rolling dead over the cup centre
  // has dist === 0, and `0 <= 0` would drop it in at any speed at all.
  if (effective <= 0) return false
  return dist <= effective
}

export function simulateShot(hole: Hole, input: ShotInput): ShotResult {
  // The putter's scale follows the length of the putt, so it is derived
  // here rather than carried in: one fewer number for a run log to get
  // wrong, or to lie about.
  const power = powerFromTap(
    input.powerTapMs,
    powerCapFor(
      input.kind,
      horizontalDist(input.from.x, input.from.z, hole.pin.x, hole.pin.z),
    ),
  )
  // A putt is struck true. There is no impact test on the green: the
  // difficulty of a putt is reading the slope and judging the pace, not
  // catching a marker. The rule lives here rather than in the UI so a log
  // cannot describe a mishit putt the game would never let you play.
  const putting = input.kind === 'putt'
  const accuracy = putting ? 0 : accuracyFromTaps(power, input.impactTapMs)
  const pure = putting ? false : isPure(power, input.impactTapMs)
  const missAmount = Math.min(Math.abs(accuracy), 1)

  const pos: Vec3 = { x: input.from.x, y: input.from.y, z: input.from.z }
  const vel: Vec3 = { x: 0, y: 0, z: 0 }
  let rolling: boolean

  if (input.kind === 'drive') {
    const aim = input.aim + K.LAUNCH_SKEW * accuracy
    const loft = K.DRIVE_LOFT + K.LOFT_SKEW * accuracy
    const speed =
      lerp(K.DRIVE_MIN_SPEED, K.DRIVE_MAX_SPEED, power) *
      (1 - K.MISHIT_SPEED_LOSS * missAmount)
    const flat = Math.cos(loft) * speed
    const dir = aimDirection(aim)
    vel.x = dir.x * flat
    vel.y = Math.sin(loft) * speed
    vel.z = dir.z * flat
    rolling = false
  } else {
    const aim = input.aim
    // Interpolated on the square of the speed, not the speed itself. A
    // rolling ball covers v^2 / 2a, so a linear speed ramp would make
    // distance grow as the square of the bar: half a bar would send it a
    // third of the way, and the distance readout would be a lie on every
    // putt. This way the fill means the same thing as it does off the tee.
    const speed =
      Math.sqrt(
        lerp(
          K.PUTT_MIN_SPEED * K.PUTT_MIN_SPEED,
          K.PUTT_MAX_SPEED * K.PUTT_MAX_SPEED,
          power,
        ),
      ) *
      (1 - K.MISHIT_SPEED_LOSS * missAmount * 0.5)
    const dir = aimDirection(aim)
    vel.x = dir.x * speed
    vel.z = dir.z * speed
    pos.y = surfaceAt(hole, pos.x, pos.z).y
    rolling = true
  }

  // Wind as a vector. Direction 0 blows straight down the hole.
  const windX = Math.sin(hole.wind.direction) * hole.wind.speed
  const windZ = -Math.cos(hole.wind.direction) * hole.wind.speed

  const path: Vec3[] = [{ ...pos }]
  let apex = pos.y
  let carry = 0
  let landed = false
  let lipped = false
  let struckPeak = false
  let outcome: ShotOutcome = 'rest'
  let surface: SurfaceKind = input.kind === 'putt' ? 'green' : 'tee'

  for (let step = 1; step <= K.MAX_STEPS; step++) {
    const prevX = pos.x
    const prevY = pos.y
    const prevZ = pos.z

    if (!rolling) {
      // Drag is computed against the air, not the ground, so wind pushes the
      // ball simply by changing the relative velocity. One mechanism, not two.
      const rx = vel.x - windX
      const ry = vel.y
      const rz = vel.z - windZ
      const relSpeed = Math.hypot(rx, ry, rz)

      let ax = -K.DRAG * relSpeed * rx
      let ay = -K.GRAVITY - K.DRAG * relSpeed * ry
      let az = -K.DRAG * relSpeed * rz

      // Sidespin: acceleration perpendicular to travel, so a mishit bends
      // through the air rather than just launching off-line.
      const flatSpeed = Math.hypot(vel.x, vel.z)
      if (flatSpeed > 1e-4) {
        const rightX = -vel.z / flatSpeed
        const rightZ = vel.x / flatSpeed
        const bend = K.CURVE * accuracy * flatSpeed
        ax += rightX * bend
        az += rightZ * bend
      }

      vel.x += ax * K.DT
      vel.y += ay * K.DT
      vel.z += az * K.DT
      pos.x += vel.x * K.DT
      pos.y += vel.y * K.DT
      pos.z += vel.z * K.DT
      if (pos.y > apex) apex = pos.y

      // The rock. Anything that arrives inside its footprint below the
      // summit has hit it and falls into the sea; nothing ever lands on
      // top, so there is no surface to resolve -- just a wall.
      const peak = hole.peak
      if (peak) {
        const toPeak = horizontalDist(pos.x, pos.z, peak.centre.x, peak.centre.z)
        if (toPeak <= peak.radius && pos.y <= peak.height) {
          if (!landed) {
            landed = true
            carry = horizontalDist(pos.x, pos.z, input.from.x, input.from.z)
          }
          pos.y = 0
          outcome = 'water'
          surface = 'water'
          struckPeak = true
          path.push({ ...pos })
          break
        }
      }

      const under = surfaceAt(hole, pos.x, pos.z)

      // Islands have sides. Arriving inside the footprint from outside it
      // while below the surface means the ball hit the cliff face, not the
      // top: without this it would be snapped up onto the green and roll on,
      // which quietly turned shots that should splash into safe landings.
      const wasOverWater = surfaceAt(hole, prevX, prevZ).kind === 'water'
      if (under.kind !== 'water' && wasOverWater && prevY < under.y) {
        pos.y = 0
        outcome = 'water'
        surface = 'water'
        if (!landed) {
          landed = true
          carry = horizontalDist(pos.x, pos.z, input.from.x, input.from.z)
        }
        path.push({ ...pos })
        break
      }

      if (pos.y <= under.y) {
        if (!landed) {
          landed = true
          carry = horizontalDist(pos.x, pos.z, input.from.x, input.from.z)
        }
        if (under.kind === 'water') {
          pos.y = 0
          outcome = 'water'
          surface = 'water'
          path.push({ ...pos })
          break
        }
        pos.y = under.y
        if (-vel.y < K.ROLL_THRESHOLD) {
          vel.y = 0
          rolling = true
        } else {
          vel.y = -vel.y * K.RESTITUTION
          vel.x *= K.BOUNCE_FRICTION
          vel.z *= K.BOUNCE_FRICTION
        }
      }
    } else {
      // Gravity down the slope, before friction gets a say. This is what
      // makes a putt break: the ball is pulled across its line all the way
      // to the hole, not merely aimed off at the start.
      const ground = islandAt(hole, pos.x, pos.z)
      if (ground) {
        const tilt = gradientAt(ground, pos.x, pos.z)
        vel.x -= K.GRAVITY * tilt.x * K.DT
        vel.z -= K.GRAVITY * tilt.z * K.DT
      }

      const speed = Math.hypot(vel.x, vel.z)
      if (speed < K.REST_SPEED) {
        surface = surfaceAt(hole, pos.x, pos.z).kind
        outcome = 'rest'
        break
      }
      const friction =
        input.kind === 'putt' ? K.PUTT_FRICTION : K.ROLL_FRICTION
      const slowed = Math.max(0, speed - friction * K.DT)
      vel.x = (vel.x / speed) * slowed
      vel.z = (vel.z / speed) * slowed
      pos.x += vel.x * K.DT
      pos.z += vel.z * K.DT

      const under = surfaceAt(hole, pos.x, pos.z)
      if (under.kind === 'water') {
        pos.y = 0
        outcome = 'water'
        surface = 'water'
        path.push({ ...pos })
        break
      }
      pos.y = under.y

      if (under.kind === 'green') {
        const dist = distanceToCup(hole, prevX, prevZ, pos.x, pos.z)
        if (capturedBy(hole, slowed, dist, friction)) {
          pos.x = hole.pin.x
          pos.z = hole.pin.z
          outcome = 'holed'
          surface = 'green'
          path.push({ ...pos })
          break
        }

        // Too fast to be held, but it still crossed the hole. The ball
        // drops into the lip, curls round it and is thrown out slower and
        // off its line. Without this it sails over as though the cup were
        // painted on. Firing once per pass, not once per step.
        if (!lipped && dist <= hole.cupRadius && slowed > 1e-6) {
          const hx = vel.x / slowed
          const hz = vel.z / slowed
          const cx = hole.pin.x - pos.x
          const cz = hole.pin.z - pos.z

          // Only on the way in. Leaving the cup is not another lip.
          if (cx * hx + cz * hz > 0) {
            lipped = true
            // Signed distance from the cup to the line the ball is running
            // on: how centrally it is about to cross, and which way it will
            // be thrown. Measuring how far away it is *now* would always
            // read the rim, since that is where it enters.
            const side = cx * -hz + cz * hx
            const r = Math.min(Math.abs(side) / hole.cupRadius, 1)
            // Strongest half way out: straight over the middle punches
            // through, a rim graze barely touches.
            // The quicker it crosses, the less time it spends in the hole
            // to be turned or slowed. A rocket barely feels the lip.
            const influence = Math.min(
              K.CAPTURE_RUNOUT / Math.max(runOut(slowed, friction), 1e-6),
              1,
            )
            const bend =
              K.LIP_TURN * (side >= 0 ? 1 : -1) * 4 * r * (1 - r) * influence
            const keep = 1 - K.LIP_DRAG * (1 - r) * influence
            const cos = Math.cos(bend)
            const sin = Math.sin(bend)
            vel.x = (hx * cos - hz * sin) * slowed * keep
            vel.z = (hx * sin + hz * cos) * slowed * keep
          }
        } else if (dist > hole.cupRadius * 1.6) {
          lipped = false
        }
      }
    }

    if (step % K.PATH_STRIDE === 0) path.push({ ...pos })
  }

  const last = path[path.length - 1]
  if (!last || last.x !== pos.x || last.y !== pos.y || last.z !== pos.z) {
    path.push({ ...pos })
  }

  return {
    path,
    end: { ...pos },
    outcome,
    surface,
    power,
    accuracy,
    pure,
    toPin: horizontalDist(pos.x, pos.z, hole.pin.x, hole.pin.z),
    apex,
    carry: input.kind === 'putt'
      ? horizontalDist(pos.x, pos.z, input.from.x, input.from.z)
      : carry,
    struckPeak,
  }
}
