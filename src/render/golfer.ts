import * as THREE from 'three'
import type { Vec3 } from '../sim/types'
import { aimDirection } from '../sim/aim'

/**
 * The golfer: a chunky low-poly figure who addresses the ball and swings.
 *
 * Built from primitives like everything else here, rather than a sprite or
 * an imported model, so it sits in the same flat-shaded world. Purely
 * decorative -- the swing is played back from the shot the simulation has
 * already decided, exactly as the ball's flight is.
 */

const SKIN = 0xf0c9a4
const SHIRT = 0xf2604f
const TROUSERS = 0xf3f1e7
const SHOES = 0x3a4a52
const SHAFT = 0xd8dde0
const HEAD_METAL = 0x9aa7ad

function part(
  geometry: THREE.BufferGeometry,
  colour: number,
  position: [number, number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshLambertMaterial({ color: colour, flatShading: true }),
  )
  mesh.position.set(...position)
  return mesh
}

export interface Golfer {
  group: THREE.Group
  /** Stands the golfer beside the ball, facing down the aim line. */
  place(ball: Vec3, aim: number, kind: 'drive' | 'putt'): void
  /**
   * Poses the swing. -1 is the top of the backswing, 0 is the strike and
   * +1 is the finish.
   */
  setSwing(phase: number): void
  setVisible(visible: boolean): void
}

export function buildGolfer(): Golfer {
  const group = new THREE.Group()

  /**
   * The figure hangs off an inner group so that the outer one is turned
   * only by lookAt. Aiming writes a quaternion and the shoulder tilt
   * writes an Euler angle; doing both to the same object is asking for one
   * to quietly undo the other.
   */
  const body = new THREE.Group()
  group.add(body)

  // Feet up: the figure is built facing -Z, the way it will be aimed.
  body.add(part(new THREE.BoxGeometry(0.22, 0.12, 0.34), SHOES, [-0.17, 0.06, 0]))
  body.add(part(new THREE.BoxGeometry(0.22, 0.12, 0.34), SHOES, [0.17, 0.06, 0]))
  body.add(part(new THREE.BoxGeometry(0.2, 0.7, 0.24), TROUSERS, [-0.14, 0.45, 0]))
  body.add(part(new THREE.BoxGeometry(0.2, 0.7, 0.24), TROUSERS, [0.14, 0.45, 0]))
  body.add(part(new THREE.BoxGeometry(0.46, 0.6, 0.3), SHIRT, [0, 1.1, 0]))
  body.add(part(new THREE.IcosahedronGeometry(0.17, 0), SKIN, [0, 1.55, 0]))
  // A cap, so the head reads as a head from behind.
  const cap = part(new THREE.CylinderGeometry(0.18, 0.18, 0.09, 7), SHIRT, [0, 1.66, 0])
  body.add(cap)

  /**
   * Everything that swings hangs off one pivot at the hands, so the arms
   * and club stay together through the stroke instead of being animated
   * separately and drifting apart.
   */
  const swing = new THREE.Group()
  swing.position.set(0, 1.18, -0.16)
  body.add(swing)

  const arms = part(new THREE.BoxGeometry(0.16, 0.5, 0.16), SKIN, [0, -0.2, 0])
  swing.add(arms)

  const club = new THREE.Group()
  club.position.set(0, -0.4, 0)
  swing.add(club)

  const shaftLength = 1.05
  const shaft = part(
    new THREE.CylinderGeometry(0.022, 0.03, shaftLength, 6),
    SHAFT,
    [0, -shaftLength / 2, 0],
  )
  club.add(shaft)
  const head = part(
    new THREE.BoxGeometry(0.2, 0.11, 0.1),
    HEAD_METAL,
    [0, -shaftLength + 0.03, -0.03],
  )
  club.add(head)

  let putting = false

  return {
    group,

    place(ball: Vec3, aim: number, kind): void {
      putting = kind === 'putt'
      const dir = aimDirection(aim)
      // A step to the ball's right, square to the line.
      const side = { x: -dir.z, z: dir.x }
      const reach = putting ? 0.52 : 0.62
      group.position.set(ball.x + side.x * reach, ball.y, ball.z + side.z * reach)
      group.lookAt(ball.x + dir.x * 10, ball.y, ball.z + dir.z * 10)
      // A putter is shorter and stood to more upright than a driver.
      club.scale.setScalar(putting ? 0.78 : 1)
    },

    setSwing(phase: number): void {
      const clamped = Math.max(-1, Math.min(1, phase))
      // A putting stroke is a fraction of a full swing.
      const reach = putting ? 0.55 : 2.35
      swing.rotation.x = clamped * reach
      // The shoulders turn with it, which is most of what sells a swing.
      body.rotation.z = clamped * (putting ? 0.02 : 0.12)
    },

    setVisible(visible: boolean): void {
      group.visible = visible
    },
  }
}
