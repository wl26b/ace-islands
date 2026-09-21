/**
 * The aim convention, in one place.
 *
 * An aim of 0 points straight down the hole and positive swings toward +X.
 * Both the simulation and the renderer derive direction from here, so a
 * sign error cannot leave the aim line pointing somewhere the ball will not
 * go. three.js Object3D.lookAt uses the same convention (-Z faces the
 * target), which is why the renderer aims things rather than rotating them.
 */

export interface Heading {
  x: number
  z: number
}

export function aimDirection(aim: number): Heading {
  return { x: Math.sin(aim), z: -Math.cos(aim) }
}

/** The aim angle that points from one place toward another. */
export function aimTowards(dx: number, dz: number): number {
  return Math.atan2(dx, -dz)
}
