import * as THREE from 'three'
import type { Hole, Vec3 } from '../sim/types'
import { buildWorld } from './scene'
import type { World } from './scene'
import { fitToViewport } from './camera'
import { aimDirection } from '../sim/aim'
import { surfaceAt } from '../sim/shot'
import { BALL_RADIUS } from './palette'

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

export class Stage {
  readonly renderer: THREE.WebGLRenderer
  readonly camera: THREE.PerspectiveCamera
  private world: World | null = null
  private hole: Hole | null = null
  private splashes: Splash[] = []
  /** Previous ball position, so movement can be turned into rotation. */
  private lastBall: THREE.Vector3 | null = null
  /** When set, the camera pans to keep this point in view. */
  private watching: THREE.Vector3 | null = null

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
    this.lastBall = null
    this.hole = hole
    this.world = buildWorld(hole)
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

  setAim(from: Vec3, aim: number): void {
    const line = this.world?.aimLine
    if (!line) return
    const dir = aimDirection(aim)
    line.position.set(from.x, from.y + 0.05, from.z)
    // lookAt points the group's -Z at the target, which is the same
    // convention the simulation launches along. No sign to get backwards.
    line.lookAt(from.x + dir.x * 30, from.y + 0.05, from.z + dir.z * 30)
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

    // A gentle flag flutter, purely cosmetic: it never touches the sim.
    const flagCloth = this.world.flag.children[1]
    if (flagCloth) flagCloth.rotation.y = Math.sin(performance.now() / 420) * 0.35

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
