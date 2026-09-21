import * as THREE from 'three'
import type { Hole } from '../sim/types'

/**
 * Tee camera: sits behind and above the ball, looking down the hole at the
 * pin. Flight-following and the cut to the landing come later (step 8).
 */
export function makeCamera(hole: Hole): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000)
  aimAtPin(camera, hole)
  return camera
}

export function aimAtPin(camera: THREE.PerspectiveCamera, hole: Hole): void {
  const toPin = new THREE.Vector3(
    hole.pin.x - hole.tee.x,
    0,
    hole.pin.z - hole.tee.z,
  ).normalize()

  camera.position.set(
    hole.tee.x - toPin.x * 15,
    hole.tee.y + 9,
    hole.tee.z - toPin.z * 15,
  )
  // Aim just above the green, not high over it: a raised target tilts the
  // camera up and shoves the tee island into the bottom of the frame.
  camera.lookAt(hole.pin.x, hole.greenIsland.surfaceY + 1.5, hole.pin.z)
}

/** Portrait phones get a wider field of view so the green stays in frame. */
export function fitToViewport(camera: THREE.PerspectiveCamera, w: number, h: number): void {
  camera.aspect = w / h
  camera.fov = h > w ? 72 : 55
  camera.updateProjectionMatrix()
}
