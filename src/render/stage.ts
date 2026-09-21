import * as THREE from 'three'
import type { Hole, Vec3 } from '../sim/types'
import { buildWorld } from './scene'
import { buildGolfer } from './golfer'
import type { Golfer } from './golfer'
import { buildGreenGrid } from './terrain'
import type { GreenGrid } from './terrain'
import type { World } from './scene'
import { fitToViewport } from './camera'
import { aimDirection } from '../sim/aim'
import { surfaceAt } from '../sim/shot'
import { BALL_RADIUS, PALETTE } from './palette'
import { evenlySpaced } from './sampling'

/**
 * Owns the canvas, the camera and whichever hole is currently built.
 *
 * Everything here is playback. The stage is handed a path the simulation
 * already computed and animates the ball along it; it never decides where
 * the ball goes, so nothing it does can affect a run's score.
 */

interface Splash {
  mesh: THREE.Mesh
  age: number
}

interface Shard {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  spin: THREE.Vector3
  age: number
}

/** Confetti colours, drawn from the same pastel set as the world. */
const CONFETTI = [
  PALETTE.flagCloth,
  PALETTE.puttingGreen,
  PALETTE.sand,
  PALETTE.foam,
  0xf4c15a,
  0xef8fb4,
]

/** How many dots make up the aiming preview. */
const TRAIL_DOTS = 34
/** Small, so the line reads as a thread rather than a string of beads. */
const TRAIL_DOT_RADIUS = 0.085

export class Stage {
  readonly renderer: THREE.WebGLRenderer
  readonly camera: THREE.PerspectiveCamera
  private world: World | null = null
  private hole: Hole | null = null
  private splashes: Splash[] = []
  private shards: Shard[] = []
  /** Previous ball position, so movement can be turned into rotation. */
  private lastBall: THREE.Vector3 | null = null
  /** Reused dots showing where a pure strike would send the ball. */
  private trail: THREE.Mesh[] = []
  private landingMark: THREE.Mesh | null = null
  private greenGrid: GreenGrid | null = null
  private golfer: Golfer | null = null
  /** When set, the camera pans to keep this point in view. */
  private watching: THREE.Vector3 | null = null
  /** Wall-clock seconds since the stage started, for cosmetic motion only. */
  private elapsed = 0

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(this.renderer.domElement)
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000)
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h)
    fitToViewport(this.camera, w, h)
  }

  loadHole(hole: Hole): void {
    if (this.world) disposeScene(this.world.scene)
    this.splashes = []
    this.shards = []
    this.lastBall = null
    this.hole = hole
    this.world = buildWorld(hole)
    this.buildTrail()

    // The reading grid for this green, hidden until the ball is on it.
    const grid = buildGreenGrid(hole.greenIsland)
    grid.group.visible = false
    this.world.scene.add(grid.group)
    this.greenGrid = grid

    const golfer = buildGolfer()
    this.world.scene.add(golfer.group)
    this.golfer = golfer
    // Stood to the tee straight away, so the figure is in place on the
    // very first frame rather than only once something moves the aim.
    golfer.place(hole.tee, 0, 'drive')
    golfer.setSwing(-0.05)
  }

  /**
   * Places the ball and rolls it by however far it moved.
   *
   * Cosmetic only. The rotation is derived from the path the simulation
   * already produced, so a ball that looks like it is rolling is rolling
   * exactly as far as the maths says.
   */
  setBall(p: Vec3): void {
    const ball = this.world?.ball
    if (!ball) return

    const hole = this.hole
    const grounded =
      hole !== null && p.y <= surfaceAt(hole, p.x, p.z).y + 0.06

    const next = new THREE.Vector3(p.x, p.y + BALL_RADIUS, p.z)

    // Sink into the cup as it crosses. Purely cosmetic: whether the ball is
    // captured was already decided by the simulation, but a ball that lips
    // out should visibly drop into the edge and climb back out.
    if (hole && grounded) {
      const toCup = Math.hypot(p.x - hole.pin.x, p.z - hole.pin.z)
      if (toCup < hole.cupRadius) {
        next.y -= (1 - toCup / hole.cupRadius) * BALL_RADIUS * 1.6
      }
    }

    const prev = this.lastBall
    if (prev) {
      const dx = next.x - prev.x
      const dz = next.z - prev.z
      const travelled = Math.hypot(dx, dz)
      if (travelled > 1e-5) {
        // Roll about the horizontal axis square to the direction of travel,
        // so the contact patch stays still: one turn per circumference.
        // In the air a true roll rate strobes, so spin it gently instead.
        const axis = new THREE.Vector3(dz / travelled, 0, -dx / travelled)
        ball.rotateOnWorldAxis(
          axis,
          (travelled / BALL_RADIUS) * (grounded ? 1 : 0.15),
        )
      }
    }

    ball.position.copy(next)
    this.lastBall = next
  }

  /**
   * A pool of dots, reused rather than rebuilt: the preview is recomputed
   * every time the aim moves, and allocating a fresh set each frame would
   * churn for no reason.
   */
  private buildTrail(): void {
    const scene = this.world?.scene
    if (!scene) return
    this.trail = []
    for (let i = 0; i < TRAIL_DOTS; i++) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(TRAIL_DOT_RADIUS, 6, 5),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
        }),
      )
      dot.visible = false
      scene.add(dot)
      this.trail.push(dot)
    }

    const mark = new THREE.Mesh(
      new THREE.RingGeometry(0.52, 0.64, 22),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    mark.rotation.x = -Math.PI / 2
    mark.visible = false
    scene.add(mark)
    this.landingMark = mark
  }

  /**
   * Shows where a dead straight strike would finish, given the aim. It is
   * a pure strike at a sensible power, so it answers "how much is the wind
   * and the slope going to move this?" -- and no more than that. The
   * player's own accuracy is still theirs to find.
   */
  showTrajectory(path: Vec3[] | null): void {
    const usable = path && path.length >= 2 ? path : null
    // Spaced by distance travelled, not by the simulation's fixed time
    // step, which would crowd the dots at the top of the arc where the
    // ball is slowest and leave gaps where it is quick.
    const points = usable ? evenlySpaced(usable, this.trail.length) : []

    for (let i = 0; i < this.trail.length; i++) {
      const dot = this.trail[i]
      if (!dot) continue
      const sample = points[i]
      if (!sample) {
        dot.visible = false
        continue
      }
      dot.position.set(sample.x, sample.y + 0.14, sample.z)
      // A gentle taper, so the line still reads as a direction of travel.
      dot.scale.setScalar(1 - (i / this.trail.length) * 0.3)
      dot.visible = true
    }

    const mark = this.landingMark
    if (!mark) return
    const last = usable?.[usable.length - 1]
    if (!usable || !last) {
      mark.visible = false
      return
    }
    mark.position.set(last.x, last.y + 0.07, last.z)
    mark.visible = true
  }

  /** Stands the golfer to the ball for this shot. */
  addressBall(ball: Vec3, aim: number, kind: 'drive' | 'putt'): void {
    this.golfer?.place(ball, aim, kind)
    this.golfer?.setVisible(true)
  }

  /** -1 at the top of the backswing, 0 at the strike, +1 at the finish. */
  setSwing(phase: number): void {
    this.golfer?.setSwing(phase)
  }

  hideGolfer(): void {
    this.golfer?.setVisible(false)
  }

  /** Shows the slope grid, as a golf game does once you are putting. */
  showGreenGrid(visible: boolean): void {
    if (this.greenGrid) this.greenGrid.group.visible = visible
  }

  setAim(from: Vec3, aim: number): void {
    const line = this.world?.aimLine
    if (!line) return
    const dir = aimDirection(aim)
    // Held a little clear of the ground: on a contoured green a flat line
    // laid at surface height sinks into the rise in front of it.
    line.position.set(from.x, from.y + 0.16, from.z)
    // lookAt points the group's -Z at the target, which is the same
    // convention the simulation launches along. No sign to get backwards.
    line.lookAt(from.x + dir.x * 30, from.y + 0.16, from.z + dir.z * 30)
  }

  showAim(visible: boolean): void {
    if (this.world) this.world.aimLine.visible = visible
  }

  /** Camera behind the ball, looking along the aim line. */
  frameShot(from: Vec3, aim: number, kind: 'drive' | 'putt'): void {
    this.watching = null
    const back = kind === 'drive' ? 15 : 7
    const up = kind === 'drive' ? 8 : 3
    const ahead = kind === 'drive' ? 45 : 9

    const dir = aimDirection(aim)
    this.camera.position.set(
      from.x - dir.x * back,
      from.y + up,
      from.z - dir.z * back,
    )
    this.camera.lookAt(
      from.x + dir.x * ahead,
      from.y,
      from.z + dir.z * ahead,
    )
  }

  /** Pans from where it stands to follow the ball through the air. */
  watch(p: Vec3): void {
    this.watching = new THREE.Vector3(p.x, p.y, p.z)
  }

  /**
   * Confetti out of the cup, for a hole in one. Purely cosmetic, like the
   * splash: it is fired after the simulation has already decided the ball
   * went in.
   */
  celebrate(at: Vec3): void {
    if (!this.world) return
    const count = 34
    for (let i = 0; i < count; i++) {
      const colour = CONFETTI[i % CONFETTI.length] ?? PALETTE.flagCloth
      const mesh = new THREE.Mesh(
        new THREE.TetrahedronGeometry(0.16 + (i % 3) * 0.05),
        new THREE.MeshLambertMaterial({
          color: colour,
          flatShading: true,
          transparent: true,
        }),
      )
      mesh.position.set(at.x, at.y + 0.1, at.z)

      // Fired up and out in a rough cone, so it erupts rather than puffs.
      const angle = (i / count) * Math.PI * 2 + (i % 5) * 0.21
      const spread = 2.4 + (i % 7) * 0.5
      this.shards.push({
        mesh,
        velocity: new THREE.Vector3(
          Math.cos(angle) * spread,
          7.5 + (i % 5) * 1.1,
          Math.sin(angle) * spread,
        ),
        spin: new THREE.Vector3((i % 3) - 1, (i % 4) - 1.5, (i % 5) - 2).multiplyScalar(3.4),
        age: 0,
      })
      this.world.scene.add(mesh)
    }
  }

  splash(at: Vec3): void {
    if (!this.world) return
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.9, 16),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(at.x, 0.06, at.z)
    this.world.scene.add(mesh)
    this.splashes.push({ mesh, age: 0 })
  }

  render(dt: number): void {
    if (!this.world) return

    this.elapsed += dt
    this.world.seascape.update(this.elapsed)
    if (this.greenGrid?.group.visible) this.greenGrid.update(dt)
    this.world.sky.update(this.elapsed)

    if (this.watching) this.camera.lookAt(this.watching)

    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const s = this.splashes[i]
      if (!s) continue
      s.age += dt
      const t = s.age / 1.4
      s.mesh.scale.setScalar(1 + t * 7)
      const material = s.mesh.material as THREE.MeshBasicMaterial
      material.opacity = Math.max(0, 0.85 * (1 - t))
      if (t >= 1) {
        this.world.scene.remove(s.mesh)
        s.mesh.geometry.dispose()
        material.dispose()
        this.splashes.splice(i, 1)
      }
    }

    for (let i = this.shards.length - 1; i >= 0; i--) {
      const shard = this.shards[i]
      if (!shard) continue
      shard.age += dt
      shard.velocity.y -= 16 * dt
      shard.mesh.position.addScaledVector(shard.velocity, dt)
      shard.mesh.rotation.x += shard.spin.x * dt
      shard.mesh.rotation.y += shard.spin.y * dt
      shard.mesh.rotation.z += shard.spin.z * dt

      const material = shard.mesh.material as THREE.MeshLambertMaterial
      material.opacity = Math.max(0, 1 - shard.age / 2.6)
      if (shard.age > 2.6) {
        this.world.scene.remove(shard.mesh)
        shard.mesh.geometry.dispose()
        material.dispose()
        this.shards.splice(i, 1)
      }
    }

    // A gentle flag flutter, purely cosmetic: it never touches the sim.
    const flagCloth = this.world.flag.children[1]
    if (flagCloth) flagCloth.rotation.y = Math.sin(this.elapsed * 2.4) * 0.35

    this.renderer.render(this.world.scene, this.camera)
  }
}

/** Holes are rebuilt every time the run advances, so release the old one. */
function disposeScene(scene: THREE.Scene): void {
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const material = mesh.material
    if (Array.isArray(material)) material.forEach((m) => m.dispose())
    else if (material) material.dispose()
  })
}
