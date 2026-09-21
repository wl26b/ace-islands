import type { Island } from './types'

/**
 * The shape of the ground.
 *
 * One height field, read by the simulation and by the renderer alike. That
 * is the whole point of it living here: a green that looks sloped but
 * putts dead straight is worse than an honest flat one, so the mesh is
 * built from exactly the function the ball rolls on.
 */

/** Height of the surface at a point, in world coordinates. */
export function heightAt(island: Island, x: number, z: number): number {
  const s = island.slope
  const dx = x - island.centre.x
  const dz = z - island.centre.z
  return (
    island.surfaceY +
    s.gradientX * dx +
    s.gradientZ * dz +
    s.swellAmp *
      Math.sin(dx * s.swellFreq + s.swellPhase) *
      Math.cos(dz * s.swellFreq + s.swellPhase)
  )
}

/**
 * Slope at a point, as rise per metre along each axis. Differentiated by
 * hand rather than sampled, so it is exact and costs nothing: a rolling
 * ball asks for this on every one of its 120 steps a second.
 */
export function gradientAt(
  island: Island,
  x: number,
  z: number,
): { x: number; z: number } {
  const s = island.slope
  const dx = x - island.centre.x
  const dz = z - island.centre.z
  const fx = dx * s.swellFreq + s.swellPhase
  const fz = dz * s.swellFreq + s.swellPhase
  return {
    x: s.gradientX + s.swellAmp * s.swellFreq * Math.cos(fx) * Math.cos(fz),
    z: s.gradientZ - s.swellAmp * s.swellFreq * Math.sin(fx) * Math.sin(fz),
  }
}
