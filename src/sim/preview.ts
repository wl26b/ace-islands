import type { Hole, Vec3 } from './types'
import type { ShotKind, ShotResult } from './shot'
import { simulateShot } from './shot'
import { powerCapFor, pureTaps } from './bar'
import { powerForDistance } from './range'

/**
 * The aiming preview: where a dead straight strike would finish.
 *
 * It lives here, beside the simulation, rather than in the renderer, so it
 * cannot drift into showing a shot the game would not actually play. The
 * preview is a real shot, computed by the same function, at the power the
 * hole asks for -- so it answers "how far will the wind and the slope move
 * a good strike?" and nothing else. Hitting it is still up to the player.
 */

/** The power the hole asks for from here. */
export function previewPower(hole: Hole, from: Vec3, kind: ShotKind): number {
  return powerForDistance(
    hole,
    kind,
    Math.hypot(hole.pin.x - from.x, hole.pin.z - from.z),
  )
}

/** The taps that would play the previewed shot. */
export function previewTaps(
  hole: Hole,
  from: Vec3,
  kind: ShotKind,
): { powerTapMs: number; impactTapMs: number } {
  return pureTaps(
    previewPower(hole, from, kind),
    powerCapFor(kind, Math.hypot(hole.pin.x - from.x, hole.pin.z - from.z)),
  )
}

export function previewShot(
  hole: Hole,
  from: Vec3,
  aim: number,
  kind: ShotKind,
): ShotResult {
  return simulateShot(hole, { kind, from, aim, ...previewTaps(hole, from, kind) })
}
