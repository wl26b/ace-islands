import * as THREE from 'three'
import type { Hole, Island, Peak, Vec2 } from '../sim/types'
import { gradientAt, heightAt } from '../sim/surface'
import { PALETTE } from './palette'

/**
 * The islands and the sea.
 *
 * All of it is geometry and per-face colour: no textures, no imported
 * models, in keeping with the chunky low-poly look. Flat shading plus one
 * colour per triangle is what lets a radial grid read as mown grass,
 * shoreline sand and cliff rock without a single image.
 *
 * Nothing here affects play. The simulation sees a flat disc at surfaceY
 * and water everywhere else, exactly as before.
 */

/** Deterministic speckle, so a hole always looks the same as last time. */
function speckle(i: number, j: number): number {
  const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453
  return n - Math.floor(n)
}

/** Assigns one colour per triangle of a non-indexed geometry. */
function colourFaces(
  geometry: THREE.BufferGeometry,
  pick: (cx: number, cy: number, cz: number) => number,
): THREE.BufferGeometry {
  const pos = geometry.getAttribute('position')
  const colours = new Float32Array(pos.count * 3)
  const c = new THREE.Color()
  for (let f = 0; f < pos.count; f += 3) {
    const cx = (pos.getX(f) + pos.getX(f + 1) + pos.getX(f + 2)) / 3
    const cy = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3
    const cz = (pos.getZ(f) + pos.getZ(f + 1) + pos.getZ(f + 2)) / 3
    c.setHex(pick(cx, cy, cz))
    for (let k = 0; k < 3; k++) {
      colours[(f + k) * 3] = c.r
      colours[(f + k) * 3 + 1] = c.g
      colours[(f + k) * 3 + 2] = c.b
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  return geometry
}

function vertexLit(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })
}

/**
 * The playing surface: a radial grid of quads, each coloured by what it
 * would be on a real hole — putting surface by the pin, striped fairway
 * beyond it, a rough collar, and sand at the shoreline.
 */
function buildSurface(
  island: Island,
  focus: Vec2,
  focusRadius: number,
): THREE.Mesh {
  const rings = 9
  const sectors = 36
  const positions: number[] = []
  const faceColour: number[] = []

  for (let i = 0; i < rings; i++) {
    const r0 = (island.radius * i) / rings
    const r1 = (island.radius * (i + 1)) / rings
    for (let j = 0; j < sectors; j++) {
      const a0 = (j / sectors) * Math.PI * 2
      const a1 = ((j + 1) / sectors) * Math.PI * 2

      const p = [
        [Math.cos(a0) * r0, Math.sin(a0) * r0],
        [Math.cos(a1) * r0, Math.sin(a1) * r0],
        [Math.cos(a1) * r1, Math.sin(a1) * r1],
        [Math.cos(a0) * r0, Math.sin(a0) * r0],
        [Math.cos(a1) * r1, Math.sin(a1) * r1],
        [Math.cos(a0) * r1, Math.sin(a0) * r1],
      ] as const

      // Height comes from the simulation's own field, so the facets you
      // read a putt off are the ones the ball actually rolls on.
      for (const [x, z] of p) {
        positions.push(
          x,
          heightAt(island, island.centre.x + x, island.centre.z + z),
          z,
        )
      }

      const mid = ((r0 + r1) / 2) * 1
      const ax = (a0 + a1) / 2
      const colour = surfaceColour(
        island.centre.x + Math.cos(ax) * mid,
        island.centre.z + Math.sin(ax) * mid,
        island.radius - mid,
        focus,
        focusRadius,
        speckle(i, j),
      )
      faceColour.push(colour, colour)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  let face = 0
  colourFaces(geometry, () => faceColour[face++] ?? PALETTE.fairway)

  // The vertices already carry their own heights.
  return new THREE.Mesh(geometry, vertexLit())
}

function surfaceColour(
  worldX: number,
  worldZ: number,
  toEdge: number,
  focus: Vec2,
  focusRadius: number,
  jitter: number,
): number {
  // Beach, then a rough collar, then the mown stuff.
  if (toEdge < 1.4) return jitter > 0.35 ? PALETTE.sand : PALETTE.sandDark
  if (toEdge < 3.4) return jitter > 0.5 ? PALETTE.rough : PALETTE.roughDark

  const toFocus = Math.hypot(worldX - focus.x, worldZ - focus.z)
  const close = toFocus < focusRadius
  // Mowing stripes: narrow and fine on the green, wide out on the fairway.
  const band = Math.floor(worldZ / (close ? 2.2 : 4.8))
  const light = (((band % 2) + 2) % 2) === 0

  if (close) return light ? PALETTE.puttingGreen : PALETTE.puttingStripe
  return light ? PALETTE.fairway : PALETTE.fairwayStripe
}

/** How far below the waterline the cliffs reach. */
const CLIFF_FOOT_Y = -5

/**
 * The cliff below the surface: sand at the waterline, rock beneath.
 *
 * Built by hand rather than from a cylinder, because the rim has to follow
 * the contoured top. A straight cylinder would leave the surface floating
 * over gaps on the low side of a sloped green.
 */
function buildCliff(island: Island): THREE.Mesh {
  const sectors = 36
  const bands = 4
  const positions: number[] = []
  const faceColour: number[] = []

  const rim = (angle: number): [number, number, number] => {
    const x = Math.cos(angle) * island.radius
    const z = Math.sin(angle) * island.radius
    return [x, heightAt(island, island.centre.x + x, island.centre.z + z), z]
  }
  const foot = (angle: number): [number, number, number] => [
    Math.cos(angle) * island.radius * 0.66,
    CLIFF_FOOT_Y,
    Math.sin(angle) * island.radius * 0.66,
  ]

  const blend = (
    a: [number, number, number],
    b: [number, number, number],
    t: number,
  ): [number, number, number] => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ]

  for (let j = 0; j < sectors; j++) {
    const a0 = (j / sectors) * Math.PI * 2
    const a1 = ((j + 1) / sectors) * Math.PI * 2
    const rim0 = rim(a0)
    const rim1 = rim(a1)
    const foot0 = foot(a0)
    const foot1 = foot(a1)

    for (let b = 0; b < bands; b++) {
      const t0 = b / bands
      const t1 = (b + 1) / bands
      const p00 = blend(rim0, foot0, t0)
      const p10 = blend(rim1, foot1, t0)
      const p01 = blend(rim0, foot0, t1)
      const p11 = blend(rim1, foot1, t1)

      for (const v of [p00, p11, p10, p00, p01, p11]) positions.push(v[0], v[1], v[2])

      const rimHeight = (rim0[1] + rim1[1]) / 2
      const mid = (p00[1] + p11[1]) / 2
      const belowSurface = rimHeight - mid
      const colour =
        belowSurface < 1.1
          ? PALETTE.sand
          : belowSurface < 2.2
            ? PALETTE.sandDark
            : belowSurface < 5
              ? PALETTE.rock
              : PALETTE.rockDark
      faceColour.push(colour, colour)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  let face = 0
  colourFaces(geometry, () => faceColour[face++] ?? PALETTE.rock)
  return new THREE.Mesh(geometry, vertexLit())
}

export function buildIsland(island: Island, focus: Vec2, focusRadius: number): THREE.Group {
  const group = new THREE.Group()
  group.add(buildCliff(island))
  group.add(buildSurface(island, focus, focusRadius))
  // The pieces are built around a local origin; the group puts them on
  // the map. Surface colours are chosen in world space, so they already
  // account for this.
  group.position.set(island.centre.x, 0, island.centre.z)
  return group
}

export interface Seascape {
  group: THREE.Group
  update(time: number): void
}

/**
 * Water shaded by depth, with a gentle swell and foam where it meets the
 * shore. The swell is cosmetic: the simulation's water is a flat plane at
 * y = 0 and stays that way.
 */
export function buildSeascape(hole: Hole): Seascape {
  const group = new THREE.Group()
  const size = 700
  const segments = 90

  const geometry = new THREE.PlaneGeometry(size, size, segments, segments)
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute

  // The plane is built in XY and laid flat, so local +Z becomes world height
  // and local -Y becomes world Z.
  const shoreDistance = (wx: number, wz: number): number => {
    const a =
      Math.hypot(wx - hole.teeIsland.centre.x, wz - hole.teeIsland.centre.z) -
      hole.teeIsland.radius
    const b =
      Math.hypot(wx - hole.greenIsland.centre.x, wz - hole.greenIsland.centre.z) -
      hole.greenIsland.radius
    return Math.min(a, b)
  }

  const colours = new Float32Array(pos.count * 3)
  const shallow = new THREE.Color(PALETTE.waterShallow)
  const mid = new THREE.Color(PALETTE.water)
  const deep = new THREE.Color(PALETTE.waterDeep)
  const c = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const d = shoreDistance(pos.getX(i), -pos.getY(i))
    if (d < 16) c.copy(shallow).lerp(mid, THREE.MathUtils.clamp(d / 16, 0, 1))
    else c.copy(mid).lerp(deep, THREE.MathUtils.clamp((d - 16) / 46, 0, 1))
    colours[i * 3] = c.r
    colours[i * 3 + 1] = c.g
    colours[i * 3 + 2] = c.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))

  const water = new THREE.Mesh(
    geometry,
    // Phong rather than Lambert purely for the specular: with flat shading
    // every facet of the swell catches the sun separately, which is what
    // stops a large flat plane reading as a sheet of paper.
    new THREE.MeshPhongMaterial({
      vertexColors: true,
      flatShading: true,
      transparent: true,
      opacity: 0.94,
      shininess: 70,
      specular: 0x8fd8e8,
    }),
  )
  water.rotation.x = -Math.PI / 2
  group.add(water)

  const base: number[] = []
  for (let i = 0; i < pos.count; i++) base.push(pos.getX(i), pos.getY(i))

  const foams = [hole.teeIsland, hole.greenIsland].map((island) => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(island.radius - 0.2, island.radius + 1.9, 40),
      new THREE.MeshBasicMaterial({
        color: PALETTE.foam,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
      }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.set(island.centre.x, 0.09, island.centre.z)
    group.add(ring)
    return ring
  })

  return {
    group,
    update(time: number): void {
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 2] ?? 0
        const y = base[i * 2 + 1] ?? 0
        const h =
          Math.sin(x * 0.17 + time * 0.85) * 0.34 +
          Math.sin(y * 0.115 - time * 0.6) * 0.26 +
          Math.sin((x + y) * 0.062 + time * 0.31) * 0.18
        pos.setZ(i, h)
      }
      pos.needsUpdate = true
      // Flat shading takes its normals from screen-space derivatives, so
      // there is nothing to recompute.

      const pulse = 0.33 + Math.sin(time * 1.1) * 0.08
      for (const ring of foams) {
        const m = ring.material as THREE.MeshBasicMaterial
        m.opacity = pulse
        const s = 1 + Math.sin(time * 0.8) * 0.012
        ring.scale.set(s, s, 1)
      }
    },
  }
}

export interface Sky {
  group: THREE.Group
  update(time: number): void
}

/**
 * Chunky low-poly clouds drifting across the sky.
 *
 * Fog is disabled on them: they sit far enough out that the haze would
 * dissolve them into the background entirely, and a cloud you cannot see
 * is not worth drawing. Positions come from a fixed hash rather than
 * Math.random so they do not jump about every time a hole is rebuilt.
 */
export function buildSky(): Sky {
  const group = new THREE.Group()
  const material = new THREE.MeshLambertMaterial({
    color: 0xfdfeff,
    flatShading: true,
    fog: false,
  })

  const clouds: Array<{ object: THREE.Group; startX: number; drift: number }> = []
  const count = 14
  for (let i = 0; i < count; i++) {
    const cloud = new THREE.Group()
    const puffs = 3 + Math.floor(speckle(i, 1) * 3)
    const scale = 7 + speckle(i, 2) * 12

    for (let j = 0; j < puffs; j++) {
      const puff = new THREE.Mesh(
        new THREE.IcosahedronGeometry(scale * (0.55 + speckle(i, j + 5) * 0.5), 0),
        material,
      )
      puff.position.set(
        (speckle(i, j + 11) - 0.5) * scale * 2.6,
        (speckle(i, j + 17) - 0.5) * scale * 0.4,
        (speckle(i, j + 23) - 0.5) * scale * 1.2,
      )
      // Squashed, because clouds are wider than they are tall.
      puff.scale.set(1, 0.62, 1)
      cloud.add(puff)
    }

    cloud.position.set(
      (speckle(i, 31) - 0.5) * SPREAD,
      52 + speckle(i, 37) * 46,
      -40 - speckle(i, 41) * 330,
    )
    group.add(cloud)
    clouds.push({
      object: cloud,
      startX: cloud.position.x,
      drift: 1.1 + speckle(i, 43) * 1.6,
    })
  }

  return {
    group,
    update(time: number): void {
      for (const cloud of clouds) {
        // Positioned from elapsed time rather than nudged each frame, so
        // the sky drifts at the same speed on a 120Hz display as a 60Hz
        // one. Wrapped, so it never empties out.
        const x = cloud.startX + cloud.drift * time
        cloud.object.position.x = ((x + SPREAD / 2) % SPREAD + SPREAD) % SPREAD - SPREAD / 2
      }
    },
  }
}

/** How wide the band of sky is before a cloud wraps back round. */
const SPREAD = 640

export interface GreenGrid {
  group: THREE.Group
  update(dt: number): void
}

/** Steepest slope we colour for, in rise per metre. */
const STEEP = 0.13
/** How many lights drift across the green showing which way it falls. */
const FLOW_COUNT = 120
/** Metres per second a light travels per unit of gradient. */
const FLOW_SPEED = 18

/**
 * The reading grid over a green.
 *
 * Follows how golf games show a green: a mesh laid over the surface,
 * coloured by how steep it is -- pale where it is nearly flat, hot where
 * it falls away -- with lights sliding down the slope whose direction and
 * speed say which way a putt will break and how hard.
 *
 * Purely a way of seeing the height field that the simulation already
 * rolls the ball across; it adds nothing to the physics.
 */
export function buildGreenGrid(island: Island): GreenGrid {
  const group = new THREE.Group()
  const spacing = Math.max(1.3, island.radius / 11)
  const lift = 0.05

  const positions: number[] = []
  const colours: number[] = []
  const gentle = new THREE.Color(0x7fd6ef)
  const steep = new THREE.Color(0xe2603f)
  const shade = new THREE.Color()

  const inside = (x: number, z: number): boolean =>
    Math.hypot(x, z) <= island.radius - 0.6

  const push = (x0: number, z0: number, x1: number, z1: number): void => {
    if (!inside(x0, z0) || !inside(x1, z1)) return
    const wx = island.centre.x
    const wz = island.centre.z
    positions.push(
      x0, heightAt(island, wx + x0, wz + z0) + lift, z0,
      x1, heightAt(island, wx + x1, wz + z1) + lift, z1,
    )
    const mx = (x0 + x1) / 2
    const mz = (z0 + z1) / 2
    const tilt = gradientAt(island, wx + mx, wz + mz)
    const t = Math.min(Math.hypot(tilt.x, tilt.z) / STEEP, 1)
    shade.copy(gentle).lerp(steep, t)
    for (let k = 0; k < 2; k++) colours.push(shade.r, shade.g, shade.b)
  }

  for (let a = -island.radius; a <= island.radius; a += spacing) {
    for (let b = -island.radius; b <= island.radius; b += spacing) {
      push(a, b, a + spacing, b)
      push(a, b, a, b + spacing)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3))
  group.add(
    new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    ),
  )

  // The sliding lights: small dashes lying flat on the grass, pointing the
  // way the ground falls. Drawn as real geometry rather than points, which
  // render as camera-facing squares and read as litter floating over the
  // green rather than flow across it.
  const centres: Array<{ x: number; z: number }> = []
  const ages: number[] = []
  const lives: number[] = []

  const reseed = (i: number, initial: boolean): void => {
    const salt = initial ? 3 : Math.floor((ages[i] ?? 0) * 1000) % 97
    const angle = speckle(i, salt) * Math.PI * 2
    const radius = Math.sqrt(speckle(i, salt + 5)) * (island.radius - 1)
    centres[i] = { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius }
    ages[i] = 0
    lives[i] = 1.3 + speckle(i, 21) * 1.5
  }
  for (let i = 0; i < FLOW_COUNT; i++) reseed(i, true)

  const dashes = new Float32Array(FLOW_COUNT * 18)
  const dashGeometry = new THREE.BufferGeometry()
  dashGeometry.setAttribute('position', new THREE.BufferAttribute(dashes, 3))
  group.add(
    new THREE.Mesh(
      dashGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ),
  )

  const writeDash = (i: number): void => {
    const centre = centres[i]
    const base = i * 18
    if (!centre) {
      for (let k = 0; k < 18; k++) dashes[base + k] = 0
      return
    }

    const wx = island.centre.x + centre.x
    const wz = island.centre.z + centre.z
    const tilt = gradientAt(island, wx, wz)
    const steepness = Math.hypot(tilt.x, tilt.z)

    // Flat ground gets no lights at all, which is itself the reading.
    if (steepness < 0.006) {
      for (let k = 0; k < 18; k++) dashes[base + k] = 0
      return
    }

    // Fading in and out over its life, by length, so dashes do not pop.
    const age = ages[i] ?? 0
    const life = lives[i] ?? 1
    const fade = Math.min(1, Math.min(age, life - age) * 4)
    const half = (0.32 + Math.min(steepness / STEEP, 1) * 0.36) * fade
    const wide = 0.075

    const fx = -tilt.x / steepness
    const fz = -tilt.z / steepness
    const rx = -fz
    const rz = fx

    const corner = (alongward: number, sideward: number): [number, number, number] => {
      const x = centre.x + fx * half * alongward + rx * wide * sideward
      const z = centre.z + fz * half * alongward + rz * wide * sideward
      return [x, heightAt(island, island.centre.x + x, island.centre.z + z) + lift * 2, z]
    }

    const a = corner(-1, -1)
    const b = corner(1, -1)
    const c = corner(1, 1)
    const d = corner(-1, 1)
    const verts = [a, b, c, a, c, d]
    for (let v = 0; v < 6; v++) {
      const point = verts[v]
      if (!point) continue
      dashes[base + v * 3] = point[0]
      dashes[base + v * 3 + 1] = point[1]
      dashes[base + v * 3 + 2] = point[2]
    }
  }

  for (let i = 0; i < FLOW_COUNT; i++) writeDash(i)

  group.position.set(island.centre.x, 0, island.centre.z)

  return {
    group,
    update(dt: number): void {
      for (let i = 0; i < FLOW_COUNT; i++) {
        const centre = centres[i]
        if (!centre) continue
        const tilt = gradientAt(
          island,
          island.centre.x + centre.x,
          island.centre.z + centre.z,
        )
        // Downhill, at a speed set by how steeply it falls.
        const nx = centre.x - tilt.x * FLOW_SPEED * dt
        const nz = centre.z - tilt.z * FLOW_SPEED * dt

        ages[i] = (ages[i] ?? 0) + dt
        if ((ages[i] ?? 0) > (lives[i] ?? 2) || Math.hypot(nx, nz) > island.radius - 1) {
          reseed(i, false)
        } else {
          centres[i] = { x: nx, z: nz }
        }
        writeDash(i)
      }
      dashGeometry.getAttribute('position').needsUpdate = true
    },
  }
}

/** How far below the waterline the rock is rooted. */
const PEAK_FOOT = -7

/**
 * The rock standing between the tee and the green.
 *
 * Nothing lands on it, so it needs no surface -- it is read as a wall, and
 * it should look like one: a hard, dark spike rather than another island,
 * or a player will try to land on it.
 */
export function buildPeak(peak: Peak): THREE.Group {
  const group = new THREE.Group()
  const tall = peak.height - PEAK_FOOT

  const spire = new THREE.ConeGeometry(peak.radius, tall, 7, 3).toNonIndexed()
  colourFaces(spire, (_cx, cy) => {
    // cy is local to the cone, whose middle sits at zero.
    const world = peak.height - tall / 2 + cy
    if (world < 0.9) return PALETTE.sandDark
    if (world < peak.height * 0.55) return PALETTE.rock
    return PALETTE.rockDark
  })
  const mesh = new THREE.Mesh(spire, vertexLit())
  mesh.position.y = peak.height - tall / 2
  group.add(mesh)

  // A few boulders at the foot, so it sits in the sea rather than on it.
  for (let i = 0; i < 4; i++) {
    const size = peak.radius * (0.16 + speckle(i, 61) * 0.16)
    const boulder = new THREE.Mesh(
      new THREE.IcosahedronGeometry(size, 0),
      new THREE.MeshLambertMaterial({ color: PALETTE.rock, flatShading: true }),
    )
    const angle = speckle(i, 67) * Math.PI * 2
    const out = peak.radius * (0.75 + speckle(i, 71) * 0.4)
    boulder.position.set(Math.cos(angle) * out, 0.2 + speckle(i, 73) * 0.5, Math.sin(angle) * out)
    boulder.scale.y = 0.7
    group.add(boulder)
  }

  group.position.set(peak.centre.x, 0, peak.centre.z)
  return group
}
