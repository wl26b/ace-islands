import {
  IMPACT_POS,
  IMPACT_TOLERANCE,
  PERFECT_TOLERANCE,
  POWER_START,
} from '../sim/constants'
import { lockedPosition } from '../sim/bar'
import { distanceTicks } from './scale'
import type { Entry } from '../app/leaderboard'
import type { RunScore } from '../sim/run'

/**
 * The HUD and the shot bar, as a plain DOM overlay on top of the canvas.
 *
 * The bar's impact zone is positioned from the simulation's own constants,
 * so what the player is aiming at and what the maths scores are the same
 * numbers by construction.
 */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const pct = (v: number): string => `${(v * 100).toFixed(2)}%`

export type FlashTone = 'good' | 'bad' | 'neutral' | 'ace'

/** How long the hole-in-one flash stays up, matching its CSS animation. */
export const ACE_FLASH_MS = 3000

/**
 * How wide the pin band is on the green, in metres either side of the pin.
 * A good putt dies just past the hole, never short of it.
 */
const PIN_BAND_PUTT = { short: 0.1, long: 0.8 }

export interface BarView {
  visible: boolean
  /** Where the marker currently sits, in bar units. */
  marker: number
  /** Locked power, once the second tap has landed. */
  power: number | null
  /** The shot has been struck: hold the marker where it landed. */
  struck?: boolean
  pure?: boolean
}

export class Hud {
  readonly root: HTMLElement
  /** Called when the on-screen aim buttons are held, for touch play. */
  onAim: ((direction: -1 | 1, down: boolean) => void) | null = null
  onPrimary: (() => void) | null = null

  private holeLabel = el('div', 'hole-label')
  private windValue = el('div', 'wind-value')
  private elevationChip = el('div', 'elevation')
  private windArrow = el('div', 'wind-arrow', '↑')
  private strokesValue = el('div', 'stat-value')
  private distanceValue = el('div', 'stat-value')
  private rangeValue = el('div', 'stat-value')
  private prompt = el('div', 'prompt')
  private bar = el('div', 'gauge')
  private barFill = el('div', 'gauge-fill')
  private barNeedle = el('div', 'gauge-needle')
  private barTicks = el('div', 'gauge-ticks')
  private barScale = el('div', 'gauge-scale')
  private pinMarker = el('div', 'pin-marker')
  /** Putting hides the impact section, so the bar is drawn full width. */
  private putting = false
  /** Top of the marker's travel, so a shortened scale still fills the bar. */
  private powerCap = 1
  private forecast = el('div', 'forecast')
  private flashEl = el('div', 'flash')
  private overlay = el('div', 'overlay')
  private flashTimer = 0

  constructor(root: HTMLElement) {
    this.root = root
    root.replaceChildren()

    const top = el('div', 'hud-top')
    const wind = el('div', 'wind')
    wind.append(this.windArrow, this.windValue)
    top.append(this.holeLabel, this.elevationChip, wind)

    const stats = el('div', 'hud-stats')
    stats.append(
      stat('Strokes', this.strokesValue),
      stat('To pin', this.distanceValue),
      stat('Full power', this.rangeValue),
    )

    // The two halves of the bar, laid out from the simulation's own
    // constants so the player is aiming at exactly what the maths scores.
    // The gauge runs bottom to top: the impact section sits at the foot,
    // where the marker comes back to, and power builds above it.
    const accuracySection = el('div', 'gauge-accuracy')
    accuracySection.style.width = pct(POWER_START)
    const accuracyLabel = el('div', 'gauge-label gauge-label-impact', 'Impact')
    accuracyLabel.style.width = pct(POWER_START)
    const powerLabel = el('div', 'gauge-label gauge-label-power', 'Power')
    powerLabel.style.left = pct(POWER_START)

    const barZone = el('div', 'gauge-zone')
    barZone.style.left = pct(IMPACT_POS - IMPACT_TOLERANCE)
    barZone.style.width = pct(IMPACT_TOLERANCE * 2)
    const barPure = el('div', 'gauge-pure')
    barPure.style.left = pct(IMPACT_POS - PERFECT_TOLERANCE)
    barPure.style.width = pct(PERFECT_TOLERANCE * 2)

    this.bar.append(
      accuracySection,
      this.barFill,
      barZone,
      barPure,
      this.barTicks,
      this.pinMarker,
      accuracyLabel,
      powerLabel,
      this.barNeedle,
    )

    const bottom = el('div', 'hud-bottom')
    bottom.append(
      this.forecast,
      this.prompt,
      this.bar,
      this.barScale,
      this.buildTouchControls(),
    )

    root.append(top, stats, this.flashEl, bottom, this.overlay)
    this.setBar({ visible: false, marker: 0, power: null })
    this.hideOverlay()
  }

  private buildTouchControls(): HTMLElement {
    const wrap = el('div', 'touch-controls')
    const left = el('button', 'touch-btn', '◀')
    const right = el('button', 'touch-btn', '▶')
    const hit = el('button', 'touch-btn touch-hit', 'SWING')

    const bind = (node: HTMLElement, dir: -1 | 1): void => {
      const start = (e: Event): void => {
        e.preventDefault()
        this.onAim?.(dir, true)
      }
      const end = (e: Event): void => {
        e.preventDefault()
        this.onAim?.(dir, false)
      }
      node.addEventListener('pointerdown', start)
      node.addEventListener('pointerup', end)
      node.addEventListener('pointercancel', end)
      node.addEventListener('pointerleave', end)
    }
    bind(left, -1)
    bind(right, 1)
    hit.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      this.onPrimary?.()
    })

    wrap.append(left, hit, right)
    return wrap
  }

  setHole(hole: number, par: number, practice = false): void {
    this.holeLabel.textContent =
      `Hole ${hole} · Par ${par}` + (practice ? ' · Practice' : '')
    this.holeLabel.classList.toggle('practice', practice)
  }

  setStrokes(n: number): void {
    this.strokesValue.textContent = String(n)
  }

  setDistance(metres: number): void {
    this.distanceValue.textContent = `${metres.toFixed(1)} m`
  }

  /**
   * Wind is drawn relative to the hole, so the arrow points the way the
   * ball will be pushed: straight up means it is blowing down the hole.
   */
  setWind(speed: number, direction: number): void {
    this.windValue.textContent = `${speed.toFixed(1)} m/s`
    this.windArrow.style.transform = `rotate(${(direction * 180) / Math.PI}deg)`
    this.windArrow.style.opacity = speed < 0.3 ? '0.25' : '1'
  }

  /**
   * The shot this aim would produce, split the way a golf game splits it:
   * what it carries through the air and what it runs out on the ground.
   */
  setForecast(carry: number | null, total: number | null): void {
    if (carry === null || total === null) {
      this.forecast.replaceChildren()
      return
    }
    const roll = Math.max(0, total - carry)
    this.forecast.replaceChildren(
      el('span', 'forecast-parts', `${carry.toFixed(0)} m + ${roll.toFixed(0)} m`),
      el('span', 'forecast-total', `Distance ${total.toFixed(0)} m`),
    )
  }

  /**
   * Calibrates the power bar in metres, the way a golf game's meter is
   * marked in yards: the player reads where the pin distance falls on the
   * bar instead of dividing one HUD number by another.
   *
   * The pin marker is the point of it. Everything else is a ruler.
   */
  setPowerScale(
    fullPower: number,
    toPin: number,
    powerFor: (distance: number) => number,
  ): void {
    const span = 1 - POWER_START
    // Where a distance sits is asked of the simulation, not worked out as
    // a fraction of the maximum: the two are close but not the same, and
    // the ruler has to agree with the ball.
    const at = (distance: number): number => POWER_START + powerFor(distance) * span

    this.barTicks.replaceChildren()
    this.barScale.replaceChildren()

    const ticks = distanceTicks(fullPower)
    const decimals = ticks.some((d) => !Number.isInteger(d)) ? 1 : 0
    for (const distance of ticks) {
      const tick = el('div', 'gauge-tick')
      tick.style.left = pct(this.screen(at(distance)))
      this.barTicks.append(tick)

      const label = el('div', 'scale-label', distance.toFixed(decimals))
      label.style.left = pct(this.screen(at(distance)))
      this.barScale.append(label)
    }

    const reachable = toPin <= fullPower ? '' : ' unreachable'

    if (this.putting) {
      // On the green the pin is a band: good pace is a range, dying just
      // past the hole rather than stopping on it. A band says that, and
      // needs no label of its own to collide with the scale underneath.
      const from = this.screen(at(Math.max(0, toPin - PIN_BAND_PUTT.short)))
      const to = this.screen(at(toPin + PIN_BAND_PUTT.long))
      this.pinMarker.className = `pin-band${reachable}`
      this.pinMarker.style.left = pct(from)
      this.pinMarker.style.width = pct(Math.max(to - from, 0.012))
      return
    }

    // Off the tee it stays a single mark with its distance beside it.
    this.pinMarker.className = `pin-marker${reachable}`
    this.pinMarker.style.left = pct(at(toPin))
    this.pinMarker.style.width = ''

    const pinLabel = el('div', 'scale-label scale-pin', `${toPin.toFixed(0)} pin`)
    pinLabel.style.left = pct(at(toPin))
    this.barScale.append(pinLabel)
  }

  /**
   * How the green sits relative to the tee. Uphill costs distance and
   * downhill gains it, so the player needs to see it to judge the bar.
   */
  setElevation(metres: number): void {
    const rounded = Math.round(metres)
    if (rounded === 0) {
      this.elevationChip.textContent = 'Level'
      this.elevationChip.className = 'elevation'
      return
    }
    const up = rounded > 0
    this.elevationChip.textContent = `${up ? '\u25B2' : '\u25BC'} ${Math.abs(rounded)} m`
    this.elevationChip.className = `elevation ${up ? 'up' : 'down'}`
  }

  /** How far a perfect full-power shot goes, so the fill can be estimated. */
  setRange(metres: number): void {
    this.rangeValue.textContent = `${metres.toFixed(0)} m`
  }

  /**
   * Putting has no impact test, so the bar drops its impact markings and
   * becomes a pace gauge and nothing else.
   */
  setShotKind(kind: 'drive' | 'putt', powerCap = 1): void {
    this.putting = kind === 'putt'
    this.powerCap = powerCap
    this.bar.classList.toggle('putting', this.putting)
  }

  /**
   * Bar position to screen position.
   *
   * The simulation always measures power from POWER_START, because that is
   * where the impact section ends. Putting has no impact section, so the
   * power stretch is drawn across the whole bar instead of leaving a dead
   * strip on the left. A drawing decision only: the maths is untouched.
   */
  private screen(barPosition: number): number {
    if (!this.putting) return barPosition
    return (barPosition - POWER_START) / (this.powerCap * (1 - POWER_START))
  }

  setPrompt(text: string, tone?: 'pure' | 'near' | 'miss'): void {
    this.prompt.textContent = text
    this.prompt.className = tone ? `prompt ${tone}` : 'prompt'
  }

  setBar(view: BarView): void {
    this.bar.style.opacity = view.visible ? '1' : '0'
    const locked = view.power !== null
    // The fill only ever describes the power section, so it keeps meaning
    // the same thing once the marker has run back into the accuracy half.
    const head = locked ? lockedPosition(view.power ?? 0) : view.marker
    const foot = this.screen(POWER_START)
    this.barFill.style.left = pct(foot)
    this.barFill.style.width = pct(Math.max(0, this.screen(head) - foot))
    this.barFill.classList.toggle('locked', locked)
    this.barNeedle.style.left = pct(this.screen(view.marker))
    // Held where it landed once struck, so the player can see how they
    // fared against the zone instead of it vanishing on the same frame.
    this.barNeedle.classList.toggle('struck', view.struck === true)
    this.barNeedle.classList.toggle('pure', view.pure === true)
    this.bar.classList.toggle('struck', view.struck === true)
  }

  /** A big centred message: PURE, BIRDIE, SPLASH, HOLE IN ONE. */
  flash(main: string, tone: FlashTone = 'neutral'): void {
    this.flashEl.textContent = main
    this.flashEl.className = `flash show ${tone}`
    window.clearTimeout(this.flashTimer)
    // The ace gets to hang about; everything else is a quick note.
    this.flashTimer = window.setTimeout(
      () => {
        this.flashEl.className = 'flash'
      },
      tone === 'ace' ? ACE_FLASH_MS : 1400,
    )
  }

  hideOverlay(): void {
    this.overlay.className = 'overlay'
    this.overlay.replaceChildren()
  }

  showRunOver(
    score: RunScore,
    entries: Entry[],
    defaultName: string,
    handlers: {
      onSave: (name: string) => void
      onReplay: () => void
      canSave?: boolean
    },
  ): void {
    this.overlay.className = 'overlay show'
    this.overlay.replaceChildren()

    const card = el('div', 'card')
    card.append(el('h1', undefined, 'Run over'))
    card.append(
      el(
        'p',
        'lede',
        `${score.holesSurvived} ${score.holesSurvived === 1 ? 'hole' : 'holes'} survived` +
          (score.birdies > 0
            ? ` · ${score.birdies} ${score.birdies === 1 ? 'birdie' : 'birdies'}`
            : ''),
      ),
    )

    if (handlers.canSave === false) {
      // A practice run started partway through is not a score.
      card.append(el('p', 'lede', 'Practice run \u2014 not saved to the board.'))
    }

    const form = el('div', 'save-row')
    const input = el('input', 'name-input')
    input.type = 'text'
    input.maxLength = 16
    input.value = defaultName
    input.placeholder = 'Name'
    const save = el('button', 'btn', 'Save run')
    save.addEventListener('click', () => {
      handlers.onSave(input.value)
      save.disabled = true
      save.textContent = 'Saved'
    })
    form.append(input, save)
    if (handlers.canSave !== false) card.append(form)

    card.append(this.buildTable(entries))

    const again = el('button', 'btn primary', 'Play again')
    again.addEventListener('click', () => handlers.onReplay())
    card.append(again)

    this.overlay.append(card)
  }

  private buildTable(entries: Entry[]): HTMLElement {
    const table = el('div', 'board')
    table.append(
      el('div', 'board-head', 'Local leaderboard · scored by replay'),
    )
    if (entries.length === 0) {
      table.append(el('div', 'board-empty', 'No runs saved yet.'))
      return table
    }
    entries.forEach((entry, i) => {
      const row = el('div', 'board-row')
      row.append(
        el('span', 'rank', String(i + 1)),
        el('span', 'who', entry.name),
        el('span', 'holes', `${entry.holesSurvived}`),
        el('span', 'birdies', entry.birdies > 0 ? `${entry.birdies}` : '–'),
      )
      table.append(row)
    })
    return table
  }
}

function stat(label: string, value: HTMLElement): HTMLElement {
  const wrap = el('div', 'stat')
  wrap.append(el('div', 'stat-label', label), value)
  return wrap
}
