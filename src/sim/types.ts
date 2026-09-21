/**
 * Pure data types shared by the simulation, the renderer and (later) the
 * Lambda that replays run logs.
 *
 * RULE: nothing in src/sim may import three.js, touch the DOM, call
 * Math.random() or read the wall clock. Positions are plain objects, never
 * THREE.Vector3, so this module can run unchanged inside Node.
 *
 * Axes: +X right, +Y up, -Z down the hole (away from the tee camera).
 * Units are metres and seconds. Water sits at y = 0.
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** A point on the horizontal plane; y is implied by whatever it sits on. */
export interface Vec2 {
  x: number
  z: number
}

/** A floating disc of land. */
export interface Island {
  centre: Vec2
  radius: number
  /** Height of the walkable surface above the water. */
  surfaceY: number
}

export interface Wind {
  /** Metres per second. */
  speed: number
  /** Radians. 0 blows down the hole (-Z); positive rotates toward +X. */
  direction: number
}

/**
 * A hole is plain data. The scene is built from this and nothing about a
 * specific hole is hard-coded anywhere else.
 */
export interface Hole {
  id: string
  par: number
  tee: Vec3
  teeIsland: Island
  greenIsland: Island
  /** The cup, on the green island's surface. */
  pin: Vec2
  cupRadius: number
  wind: Wind
}
