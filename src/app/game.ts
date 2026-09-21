import { Stage } from '../render/stage'
import { Hud } from '../ui/hud'
import { leaderboard, saveRun } from './leaderboard'
import { returnPosition, returnWindowMs, sweepPosition } from '../sim/bar'
import { SWEEP_MS } from '../sim/constants'
import { maxRange } from '../sim/range'
import {
  advanceHole,
  applyShot,
  nextShotKind,
  startRun,
  summarise,
} from '../sim/run'
import type { LoggedShot, RunLog, RunState, ShotEvent } from '../sim/run'
import type { Vec3 } from '../sim/types'
import { aimTowards } from '../sim/aim'

/**
 * Glue: input and time on one side, the pure simulation on the other.
 *
 * The only thing this layer decides is *when* a tap happened. It measures
 * the two timings, hands them to the run state machine, and animates
 * whatever path comes back. It keeps the log as it goes, so the run can be
 * rescored from scratch afterwards.
 */

type Phase = 'aim' | 'power' | 'impact' | 'watching' | 'settling' | 'over'

/** How far either way you may swing the aim off the default line. */
const AIM_LIMIT = 0.38
const AIM_RATE = 0.55
/** Path samples are emitted at 60Hz by the simulation. */
const MS_PER_SAMPLE = 1000 / 60

export class Game {
  private state: RunState
  private log: RunLog
  private phase: Phase = 'aim'
  private aim = 0
  /**
   * The default line for this shot, straight at the pin. Aim is limited
   * relative to this, not to zero: a putt back down the hole can point any
   * direction at all, and clamping absolutely would snap it off the cup.
   */
  private baseAim = 0
  private aimHeld = { left: false, right: false }

  private barStart = 0
  private power: number | null = null
  private powerTapMs = 0

  private path: Vec3[] = []
  private animStart = 0
  private pendingEvent: ShotEvent | null = null

  private lastFrame = 0
  private name = 'You'

  constructor(
    private readonly stage: Stage,
    private readonly hud: Hud,
  ) {
    const seed = newSeed()
    this.state = startRun(seed)
    this.log = { version: 1, seed, shots: [] }
    this.bindInput()
    this.beginHole()
  }

  start(): void {
    this.lastFrame = performance.now()
    const loop = (now: number): void => {
      const dt = Math.min((now - this.lastFrame) / 1000, 0.1)
      this.lastFrame = now
      this.update(now, dt)
      this.stage.render(dt)
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }

  // --- setup ------------------------------------------------------------

  private beginHole(): void {
    this.stage.loadHole(this.state.hole)
    this.hud.setHole(this.state.holeNumber, this.state.hole.par)
    this.hud.setWind(this.state.hole.wind.speed, this.state.hole.wind.direction)
    this.beginShot()
  }

  private beginShot(): void {
    this.phase = 'aim'
    this.power = null
    this.baseAim = this.aimAtPin()
    this.aim = this.baseAim
    const kind = nextShotKind(this.state)

    this.stage.setBall(this.state.ball)
    this.stage.setAim(this.state.ball, this.aim)
    this.stage.showAim(true)
    this.stage.frameShot(this.state.ball, this.aim, kind)

    this.hud.setStrokes(this.state.strokes)
    this.hud.setDistance(this.distanceToPin())
    this.hud.setRange(maxRange(this.state.hole, kind))
    this.hud.setBar({ visible: false, marker: 0, power: null })
    this.hud.setPrompt(
      kind === 'drive'
        ? 'Aim with ← → · Space to start the bar'
        : 'Putt for it · aim with ← → · Space to start',
    )
  }

  /** Sensible default aim: straight at the pin, before wind. */
  private aimAtPin(): number {
    return aimTowards(
      this.state.hole.pin.x - this.state.ball.x,
      this.state.hole.pin.z - this.state.ball.z,
    )
  }

  private distanceToPin(): number {
    return Math.hypot(
      this.state.hole.pin.x - this.state.ball.x,
      this.state.hole.pin.z - this.state.ball.z,
    )
  }

  // --- input ------------------------------------------------------------

  private bindInput(): void {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return
      // Let the name field on the run-over card have its spaces.
      if (e.target instanceof HTMLInputElement) return
      if (e.code === 'ArrowLeft') this.aimHeld.left = true
      else if (e.code === 'ArrowRight') this.aimHeld.right = true
      else if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault()
        this.primary()
      }
    })
    window.addEventListener('keyup', (e) => {
      if (e.code === 'ArrowLeft') this.aimHeld.left = false
      else if (e.code === 'ArrowRight') this.aimHeld.right = false
    })

    this.hud.onAim = (dir, down) => {
      if (dir === -1) this.aimHeld.left = down
      else this.aimHeld.right = down
    }
    this.hud.onPrimary = () => this.primary()

    // Tapping the canvas is the same as pressing space, for phones.
    this.stage.renderer.domElement.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      this.primary()
    })
  }

  /** Space, Enter, a canvas tap, or the on-screen button. */
  private primary(): void {
    const now = performance.now()
    if (this.phase === 'aim') {
      this.phase = 'power'
      this.barStart = now
      this.stage.showAim(false)
      this.hud.setPrompt('Space to set power')
    } else if (this.phase === 'power') {
      this.lockPower(now - this.barStart)
    } else if (this.phase === 'impact') {
      this.strike(now - this.barStart)
    }
  }

  private lockPower(elapsed: number): void {
    this.powerTapMs = Math.min(elapsed, SWEEP_MS)
    this.power = sweepPosition(this.powerTapMs)
    this.phase = 'impact'
    this.barStart = performance.now()
    this.hud.setPrompt('Space on the marker')
  }

  private strike(elapsed: number): void {
    const power = this.power ?? 0
    const impactTapMs = Math.min(elapsed, returnWindowMs(power))
    this.commit(this.powerTapMs, impactTapMs)
  }

  // --- playing a shot ---------------------------------------------------

  private commit(powerTapMs: number, impactTapMs: number): void {
    const entry: LoggedShot = {
      hole: this.state.holeNumber,
      aim: this.aim,
      powerTapMs,
      impactTapMs,
    }
    this.log.shots.push(entry)

    const event = applyShot(this.state, this.aim, powerTapMs, impactTapMs)
    this.pendingEvent = event
    this.path = event.result.path
    this.animStart = performance.now()
    this.phase = 'watching'

    this.hud.setStrokes(this.state.strokes)
    this.hud.setBar({ visible: false, marker: 0, power: null })
    this.hud.setPrompt('')
    if (event.result.pure) this.hud.flash('PURE', 'good')
  }

  private update(now: number, dt: number): void {
    if (this.phase === 'aim') {
      const dir = (this.aimHeld.right ? 1 : 0) - (this.aimHeld.left ? 1 : 0)
      if (dir !== 0) {
        this.aim = clamp(
          this.aim + dir * AIM_RATE * dt,
          this.baseAim - AIM_LIMIT,
          this.baseAim + AIM_LIMIT,
        )
        this.stage.setAim(this.state.ball, this.aim)
        this.stage.frameShot(this.state.ball, this.aim, nextShotKind(this.state))
      }
      return
    }

    if (this.phase === 'power') {
      const elapsed = now - this.barStart
      if (elapsed >= SWEEP_MS) {
        // Ran out of bar: the shot commits at full power rather than stalling.
        this.lockPower(SWEEP_MS)
        return
      }
      this.hud.setBar({ visible: true, marker: sweepPosition(elapsed), power: null })
      return
    }

    if (this.phase === 'impact') {
      const power = this.power ?? 0
      const elapsed = now - this.barStart
      const window = returnWindowMs(power)
      if (elapsed >= window) {
        this.strike(window)
        return
      }
      this.hud.setBar({
        visible: true,
        marker: returnPosition(power, elapsed),
        power,
      })
      return
    }

    if (this.phase === 'watching') {
      this.advanceAnimation(now)
      return
    }

    void dt
  }

  private advanceAnimation(now: number): void {
    const elapsed = now - this.animStart
    const exact = elapsed / MS_PER_SAMPLE
    const i = Math.floor(exact)

    if (i >= this.path.length - 1) {
      const last = this.path[this.path.length - 1]
      if (last) this.stage.setBall(last)
      this.finishShot()
      return
    }

    const a = this.path[i]
    const b = this.path[i + 1]
    if (!a || !b) return
    const t = exact - i
    const pos: Vec3 = {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    }
    this.stage.setBall(pos)
    this.stage.watch(pos)
  }

  private finishShot(): void {
    const event = this.pendingEvent
    this.pendingEvent = null
    if (!event) return

    if (event.result.outcome === 'water') {
      this.stage.splash(event.result.end)
      this.hud.flash('SPLASH', 'bad')
    } else if (event.result.outcome === 'holed') {
      this.hud.flash(event.outcome?.birdie ? 'BIRDIE' : 'IN THE CUP', 'good')
    }

    this.phase = 'settling'
    const pause = event.result.outcome === 'rest' ? 600 : 1500
    window.setTimeout(() => this.afterSettle(), pause)
  }

  private afterSettle(): void {
    if (this.state.status === 'run-over') {
      this.endRun()
      return
    }
    if (this.state.status === 'hole-complete') {
      advanceHole(this.state)
      this.beginHole()
      return
    }
    this.beginShot()
  }

  private endRun(): void {
    this.phase = 'over'
    this.stage.showAim(false)
    this.hud.setPrompt('')
    this.hud.setBar({ visible: false, marker: 0, power: null })
    this.hud.showRunOver(summarise(this.state), leaderboard(), this.name, {
      onSave: (name) => {
        this.name = name.trim() || 'You'
        saveRun(this.name, this.log)
      },
      onReplay: () => this.restart(),
    })
  }

  private restart(): void {
    const seed = newSeed()
    this.state = startRun(seed)
    this.log = { version: 1, seed, shots: [] }
    this.hud.hideOverlay()
    this.beginHole()
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

/** App-layer randomness: picking which run to play is not a gameplay value. */
function newSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0
}
