import { Stage } from '../render/stage'
import { ACE_FLASH_MS, Hud } from '../ui/hud'
import { leaderboard, saveRun } from './leaderboard'
import {
  impactErrorMs,
  lockedPosition,
  powerCapFor,
  powerFromTap,
  powerPhasePosition,
  returnPosition,
  returnWindowMs,
} from '../sim/bar'
import { puttScaleRange } from '../sim/bar'
import { previewShot } from '../sim/preview'
import type { ShotKind } from '../sim/shot'
import { surfaceAt } from '../sim/shot'
import { describeImpact } from '../ui/verdict'

import { maxRange, powerForDistance } from '../sim/range'
import {
  advanceHole,
  applyShot,
  nextShotKind,
  startRun,
  summarise,
} from '../sim/run'
import type { LoggedShot, RunLog, RunState, ShotEvent } from '../sim/run'
import type { Vec3 } from '../sim/types'
import { aimDirection, aimTowards } from '../sim/aim'

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
/**
 * The power marker bounces indefinitely, so nothing forces a shot. This
 * only stops a logged timing growing without bound if someone wanders off.
 */
const MAX_POWER_WAIT_MS = 120000
/** Time from the top of the backswing to the strike. */
const DOWNSWING_MS = 130
/** And on through to the finish. */
const FOLLOW_THROUGH_MS = 280

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
  private swingStart = 0
  private pendingEvent: ShotEvent | null = null

  private lastFrame = 0
  private name = 'You'
  /** Runs started past hole 1 are practice: a look, not a score. */
  private firstHole = 1

  constructor(
    private readonly stage: Stage,
    private readonly hud: Hud,
  ) {
    const seed = newSeed()
    this.firstHole = startingHole()
    this.state = startRun(seed, this.firstHole)
    this.log = { version: 7, seed, shots: [] }
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
    this.hud.setHole(
      this.state.holeNumber,
      this.state.hole.par,
      this.firstHole > 1,
    )
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
    // The flat aim sliver is for the tee. On a contoured green the dotted
    // line does the same job and follows the ground.
    this.stage.showAim(kind === 'drive')
    this.stage.addressBall(this.state.ball, this.aim, kind)
    this.stage.setSwing(-0.05)
    this.stage.frameShot(this.state.ball, this.aim, kind)
    this.stage.showGreenGrid(kind === 'putt')
    this.updatePreview()

    // Before the scale, which is drawn differently for a putt.
    this.hud.setShotKind(kind)
    this.hud.setStrokes(this.state.strokes)
    this.hud.setDistance(this.distanceToPin())
    this.refreshGauge(kind)
    this.hud.setElevation(
      this.state.hole.greenIsland.surfaceY - this.state.hole.tee.y,
    )
    this.hud.setBar({ visible: false, marker: 0, power: null })
    this.hud.setPrompt(
      kind === 'drive'
        ? 'Aim with ← → · Space to start the bar'
        : 'Read the green · aim with ← → · Space for pace',
    )
  }

  /**
   * The top of the marker's travel for the shot in hand. For a putt this
   * follows its length: a short putt gets a short ruler, read finely.
   */
  private shotCap(): number {
    return powerCapFor(nextShotKind(this.state), this.distanceToPin())
  }

  /** How far the gauge reaches, in metres. */
  private gaugeRange(kind: ShotKind): number {
    const full = maxRange(this.state.hole, kind)
    return kind === 'putt' ? puttScaleRange(this.distanceToPin(), full) : full
  }

  /** Redraws the gauge for the shot in hand. */
  private refreshGauge(kind: ShotKind): void {
    const range = this.gaugeRange(kind)
    this.hud.setShotKind(kind, this.shotCap())
    this.hud.setRange(range)
    this.hud.setPowerScale(range, this.distanceToPin(), (distance) =>
      powerForDistance(this.state.hole, kind, distance),
    )
  }

  /**
   * The no-break reference line: straight along the aim, hugging the
   * ground, ending where the hole is. The grid says how far the ball will
   * leave it.
   */
  private straightLine(): Vec3[] {
    const dir = aimDirection(this.aim)
    const length = Math.max(this.distanceToPin(), 0.5)
    const steps = 30
    const points: Vec3[] = []
    for (let i = 0; i <= steps; i++) {
      const along = (length * i) / steps
      const x = this.state.ball.x + dir.x * along
      const z = this.state.ball.z + dir.z * along
      points.push({ x, y: surfaceAt(this.state.hole, x, z).y, z })
    }
    return points
  }

  /** Sensible default aim: straight at the pin, before wind. */
  private aimAtPin(): number {
    return aimTowards(
      this.state.hole.pin.x - this.state.ball.x,
      this.state.hole.pin.z - this.state.ball.z,
    )
  }

  /**
   * Draws where a dead straight strike would finish from here. The power
   * assumed is the one the hole asks for, so the line shows what the wind
   * and the slope will do to a good shot -- which is the thing a player
   * cannot otherwise know without simply trying it and drowning.
   */
  private updatePreview(): void {
    const kind = nextShotKind(this.state)

    // On the green the line is dead straight: where the putt would finish
    // with no slope at all. It gives you something to aim along and to
    // judge the break against, without answering the question the grid is
    // asking -- which drawing the real, curving path would.
    if (kind !== 'drive') {
      this.stage.showTrajectory(this.straightLine())
      this.hud.setForecast(null, null)
      return
    }

    const preview = previewShot(this.state.hole, this.state.ball, this.aim, kind)
    this.stage.showTrajectory(preview.path)

    {
      const total = Math.hypot(
        preview.end.x - this.state.ball.x,
        preview.end.z - this.state.ball.z,
      )
      this.hud.setForecast(preview.carry, total)
    }
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
      this.stage.showTrajectory(null)
      this.hud.setPrompt('Space to set power')
    } else if (this.phase === 'power') {
      this.lockPower(now - this.barStart)
    } else if (this.phase === 'impact') {
      this.strike(now - this.barStart)
    }
  }

  private lockPower(elapsed: number): void {
    this.powerTapMs = Math.min(elapsed, MAX_POWER_WAIT_MS)
    this.power = powerFromTap(this.powerTapMs, this.shotCap())

    if (nextShotKind(this.state) === 'putt') {
      // No impact test on the green: the putt is away the moment the pace
      // is set. Zero is logged because there was no second tap to time.
      this.commit(this.powerTapMs, 0)
      return
    }

    this.phase = 'impact'
    this.barStart = performance.now()
    this.hud.setPrompt('Space on the impact zone')
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
    // The ball waits for the club: the downswing plays first, and the path
    // starts the instant the two meet.
    this.swingStart = performance.now()
    this.animStart = this.swingStart + DOWNSWING_MS
    this.phase = 'watching'

    this.hud.setStrokes(this.state.strokes)
    this.stage.showTrajectory(null)

    // Freeze the bar where the strike landed and say what it did. It stays
    // up until the next shot begins, so there is time to read it.
    const power = this.power ?? 0
    this.hud.setBar({
      visible: true,
      // A putt has no return sweep, so the marker stays at the pace set.
      marker:
        event.kind === 'putt'
          ? lockedPosition(power)
          : returnPosition(power, impactTapMs),
      power,
      struck: true,
      pure: event.result.pure,
    })
    if (event.kind === 'putt') {
      // Nothing to grade: the pace is the whole shot.
      this.hud.setPrompt('')
    } else {
      const verdict = describeImpact(
        impactErrorMs(power, impactTapMs),
        event.result.accuracy,
      )
      this.hud.setPrompt(verdict.headline, verdict.tone)
      if (event.result.pure) this.hud.flash('PURE', 'good')
    }
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
        this.stage.addressBall(this.state.ball, this.aim, nextShotKind(this.state))
        this.stage.frameShot(this.state.ball, this.aim, nextShotKind(this.state))
        this.updatePreview()
      }
      return
    }

    if (this.phase === 'power') {
      // The marker runs back and forth and never commits on its own: the
      // player chooses the moment. Only an absurdly long wait is cut off,
      // to keep the logged timing finite.
      const cap = this.shotCap()
      const elapsed = Math.min(now - this.barStart, MAX_POWER_WAIT_MS)
      const marker = powerPhasePosition(elapsed, cap)
      this.hud.setBar({ visible: true, marker, power: null })
      // The club goes back with the bar, so the swing is the gauge.
      this.stage.setSwing(-(0.08 + 0.92 * (powerFromTap(elapsed, cap) / cap)))
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
      // Held at the top while the strike is timed.
      this.stage.setSwing(-1)
      return
    }

    if (this.phase === 'watching') {
      const since = now - this.swingStart
      this.stage.setSwing(
        since < DOWNSWING_MS
          ? -1 + since / DOWNSWING_MS
          : Math.min(1, (since - DOWNSWING_MS) / FOLLOW_THROUGH_MS),
      )
      this.advanceAnimation(now)
      return
    }

    void dt
  }

  private advanceAnimation(now: number): void {
    const elapsed = now - this.animStart
    // Still on the downswing: the ball has not been struck yet.
    if (elapsed < 0) return
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
      // Worth naming which way you died: short of the green and into the
      // rock are the same penalty but completely different mistakes.
      this.hud.flash(event.result.struckPeak ? 'INTO THE ROCK' : 'SPLASH', 'bad')
    } else if (event.result.outcome === 'holed') {
      const outcome = event.outcome
      if (outcome?.ace) {
        // The one the game is named for. Confetti out of the cup, and the
        // message stays up long enough to enjoy.
        this.stage.celebrate(event.result.end)
        this.hud.flash('HOLE IN ONE', 'ace')
      } else if (outcome?.birdie) {
        this.hud.flash('BIRDIE', 'good')
      } else if (outcome?.holed) {
        this.hud.flash(outcome.strokes === outcome.par ? 'PAR' : 'IN THE CUP', 'good')
      } else {
        this.hud.flash('IN THE CUP', 'good')
      }
    }

    this.phase = 'settling'
    let pause = event.result.outcome === 'rest' ? 600 : 1500
    if (event.outcome?.ace) pause = ACE_FLASH_MS
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
      canSave: this.firstHole === 1,
      onSave: (name) => {
        this.name = name.trim() || 'You'
        saveRun(this.name, this.log)
      },
      onReplay: () => this.restart(),
    })
  }

  private restart(): void {
    const seed = newSeed()
    this.state = startRun(seed, this.firstHole)
    this.log = { version: 7, seed, shots: [] }
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

/**
 * A starting hole from the address bar, so a late, hard hole can be looked
 * at without playing twenty-nine holes to reach it. Practice only.
 */
function startingHole(): number {
  try {
    const asked = new URLSearchParams(window.location.search).get('hole')
    const parsed = Number.parseInt(asked ?? '', 10)
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 999) : 1
  } catch {
    return 1
  }
}
