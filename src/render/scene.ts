import * as THREE from 'three'
import type { Hole } from '../sim/types'
import { BALL_RADIUS, PALETTE } from './palette'
import { buildIsland, buildPeak, buildSeascape, buildSky } from './terrain'
import { heightAt } from '../sim/surface'
import type { Seascape, Sky } from './terrain'

/**
 * Builds the visible world from a Hole. Read-only with respect to the
 * simulation: the renderer consumes hole data and never feeds back into it.
 */

function flat(colour: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color: colour, flatShading: true })
}

function buildFlag(hole: Hole): THREE.Group {
  const group = new THREE.Group()
  const poleHeight = 2.6

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.06, poleHeight, 6),
    flat(PALETTE.flagPole),
  )
  pole.position.y = poleHeight / 2
  group.add(pole)

  const cloth = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.7),
    new THREE.MeshLambertMaterial({
      color: PALETTE.flagCloth,
      flatShading: true,
      side: THREE.DoubleSide,
    }),
  )
  cloth.position.set(0.55, poleHeight - 0.45, 0)
  group.add(cloth)

  // On contoured ground the pin sits at its own local height.
  group.position.set(
    hole.pin.x,
    heightAt(hole.greenIsland, hole.pin.x, hole.pin.z),
    hole.pin.z,
  )
  return group
}

/** The hole itself, with a pale collar so it reads from the tee. */
function buildCup(hole: Hole): THREE.Group {
  const group = new THREE.Group()

  const collar = new THREE.Mesh(
    new THREE.RingGeometry(hole.cupRadius, hole.cupRadius + 0.22, 16),
    new THREE.MeshBasicMaterial({ color: PALETTE.puttingGreen, depthWrite: false }),
  )
  collar.rotation.x = -Math.PI / 2
  collar.position.y = 0.02
  group.add(collar)

  const hollow = new THREE.Mesh(
    new THREE.CylinderGeometry(hole.cupRadius, hole.cupRadius * 0.9, 0.45, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: PALETTE.cup, side: THREE.BackSide }),
  )
  hollow.position.y = -0.22
  group.add(hollow)

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(hole.cupRadius * 0.9, 16),
    new THREE.MeshBasicMaterial({ color: PALETTE.cup }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -0.44
  group.add(floor)

  group.position.set(
    hole.pin.x,
    heightAt(hole.greenIsland, hole.pin.x, hole.pin.z) + 0.01,
    hole.pin.z,
  )
  return group
}

function buildBall(hole: Hole): THREE.Mesh {
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS, 10, 8),
    flat(PALETTE.ball),
  )
  ball.position.set(hole.tee.x, hole.tee.y + BALL_RADIUS, hole.tee.z)
  return ball
}

/** The aim line: a flat sliver on the ground showing where you are pointed. */
function buildAimLine(): THREE.Group {
  const group = new THREE.Group()
  const length = 30
  const shaft = new THREE.Mesh(
    new THREE.PlaneGeometry(0.35, length),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
  )
  shaft.rotation.x = -Math.PI / 2
  // The group pivots at the ball, so push the shaft out in front of it.
  shaft.position.z = -length / 2 - 1
  group.add(shaft)

  const head = new THREE.Mesh(
    new THREE.ConeGeometry(0.9, 2.2, 4),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }),
  )
  head.rotation.x = -Math.PI / 2
  head.position.z = -length - 1
  group.add(head)

  return group
}

export interface World {
  scene: THREE.Scene
  ball: THREE.Mesh
  aimLine: THREE.Group
  flag: THREE.Group
  seascape: Seascape
  sky: Sky
}

export function buildWorld(hole: Hole): World {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(PALETTE.sky)
  // Fog matches the sky exactly, and closes well before the water plane
  // runs out (it reaches 350m), so the sea dissolves into the horizon
  // rather than stopping on a visible edge.
  scene.fog = new THREE.Fog(PALETTE.sky, 95, 320)

  scene.add(new THREE.HemisphereLight(0xffffff, PALETTE.waterDeep, 0.95))
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.15)
  sun.position.set(-30, 60, 20)
  scene.add(sun)
  // A second, dimmer light from the other side keeps the cliff faces from
  // going flat black where the sun does not reach.
  const fill = new THREE.DirectionalLight(0xdbeef7, 0.3)
  fill.position.set(40, 25, -40)
  scene.add(fill)

  const seascape = buildSeascape(hole)
  scene.add(seascape.group)
  const sky = buildSky()
  scene.add(sky.group)

  // The tee island is mown around the teeing ground; the green around the pin.
  scene.add(buildIsland(hole.teeIsland, { x: hole.tee.x, z: hole.tee.z }, 3.4))
  scene.add(
    buildIsland(
      hole.greenIsland,
      hole.pin,
      Math.min(hole.greenIsland.radius * 0.45, 11),
    ),
  )

  if (hole.peak) scene.add(buildPeak(hole.peak))

  const flag = buildFlag(hole)
  scene.add(flag)
  scene.add(buildCup(hole))

  const ball = buildBall(hole)
  scene.add(ball)

  const aimLine = buildAimLine()
  aimLine.position.set(hole.tee.x, hole.tee.y + 0.05, hole.tee.z)
  scene.add(aimLine)

  return { scene, ball, aimLine, flag, seascape, sky }
}
