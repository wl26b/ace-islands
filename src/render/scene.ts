import * as THREE from 'three'
import type { Hole, Island } from '../sim/types'
import { BALL_RADIUS, PALETTE } from './palette'

/**
 * Builds the visible world from a Hole. Read-only with respect to the
 * simulation: the renderer consumes hole data and never feeds back into it.
 */

function flat(colour: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color: colour, flatShading: true })
}

/**
 * An island is a chunky low-poly cylinder: grass cap, rock body, and a low
 * segment count so the facets read as deliberate.
 */
function buildIsland(island: Island, grassColour: number): THREE.Group {
  const group = new THREE.Group()
  const depth = 7
  const segments = 9

  // The body stops 1m short of the surface so its top face ends up hidden
  // inside the grass cap. Ending it flush at surfaceY would make the two top
  // faces coplanar, and they z-fight into a speckled mess.
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(island.radius * 0.72, island.radius, depth, segments, 1),
    flat(PALETTE.rock),
  )
  body.position.y = island.surfaceY - 1 - depth / 2
  group.add(body)

  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(island.radius, island.radius, 1.2, segments, 1),
    flat(grassColour),
  )
  cap.position.y = island.surfaceY - 0.6
  cap.receiveShadow = true
  group.add(cap)

  group.position.set(island.centre.x, 0, island.centre.z)
  return group
}

function buildWater(): THREE.Mesh {
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600, 24, 24),
    new THREE.MeshLambertMaterial({
      color: PALETTE.water,
      flatShading: true,
      transparent: true,
      opacity: 0.92,
    }),
  )
  water.rotation.x = -Math.PI / 2
  water.position.y = 0
  return water
}

function buildFlag(hole: Hole): THREE.Group {
  const group = new THREE.Group()
  const poleHeight = 2.6

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, poleHeight, 6),
    flat(PALETTE.flagPole),
  )
  pole.position.y = poleHeight / 2
  group.add(pole)

  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), new THREE.MeshLambertMaterial({
    color: PALETTE.flagCloth,
    flatShading: true,
    side: THREE.DoubleSide,
  }))
  cloth.position.set(0.55, poleHeight - 0.45, 0)
  group.add(cloth)

  group.position.set(hole.pin.x, hole.greenIsland.surfaceY, hole.pin.z)
  return group
}

function buildCup(hole: Hole): THREE.Mesh {
  const cup = new THREE.Mesh(
    new THREE.CircleGeometry(hole.cupRadius, 12),
    new THREE.MeshBasicMaterial({ color: 0x1d2b1b }),
  )
  cup.rotation.x = -Math.PI / 2
  cup.position.set(hole.pin.x, hole.greenIsland.surfaceY + 0.02, hole.pin.z)
  return cup
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
}

export function buildWorld(hole: Hole): World {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(PALETTE.sky)
  // Fog matches the sky exactly, so the far water dissolves into the horizon
  // instead of ending on a visible band.
  scene.fog = new THREE.Fog(PALETTE.sky, 130, 420)

  scene.add(new THREE.HemisphereLight(0xffffff, PALETTE.waterDeep, 1.05))
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.25)
  sun.position.set(-30, 60, 20)
  scene.add(sun)

  scene.add(buildWater())
  scene.add(buildIsland(hole.teeIsland, PALETTE.grass))
  scene.add(buildIsland(hole.greenIsland, PALETTE.green))

  const flag = buildFlag(hole)
  scene.add(flag)
  scene.add(buildCup(hole))

  const ball = buildBall(hole)
  scene.add(ball)

  const aimLine = buildAimLine()
  aimLine.position.set(hole.tee.x, hole.tee.y + 0.05, hole.tee.z)
  scene.add(aimLine)

  return { scene, ball, aimLine, flag }
}
