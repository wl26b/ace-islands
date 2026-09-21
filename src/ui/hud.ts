import { IMPACT_POS, IMPACT_TOLERANCE, PERFECT_TOLERANCE } from '../sim/constants'
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

export interface BarView {
  visible: boolean
  /** Where the marker currently sits, in bar units. */
  marker: number
  /** Locked power, once the second tap has landed. */
  power: number | null
}

export class Hud {
  readonly root: HTMLElement
  /** Called when the on-screen aim buttons are held, for touch play. */
  onAim: ((direction: -1 | 1, down: boolean) => void) | null = null
  onPrimary: (() => void) | null = null

  private holeLabel = el('div', 'hole-label')
  private windValue = el('div', 'wind-value')
  private windArrow = el('div', 'wind-arrow', '↑')
  private strokesValue = el('div', 'stat-value')
  private distanceValue = el('div', 'stat-value')
  private rangeValue = el('div', 'stat-value')
  private prompt = el('div', 'prompt')
  private bar = el('div', 'bar')
  private barFill = el('div', 'bar-fill')
  private barNeedle = el('div', 'bar-needle')
  private flashEl = el('div', 'flash')
  private overlay = el('div', 'overlay')

  constructor(root: HTMLElement) {
    this.root = root
    root.replaceChildren()

    const top = el('div', 'hud-top')
    const wind = el('div', 'wind')
    wind.append(this.windArrow, this.windValue)
    top.append(this.holeLabel, wind)

    const stats = el('div', 'hud-stats')
    stats.append(
      stat('Strokes', this.strokesValue),
      stat('To pin', this.distanceValue),
      stat('Full power', this.rangeValue),
    )

    const barZone = el('div', 'bar-zone')
    barZone.style.left = pct(IMPACT_POS - IMPACT_TOLERANCE)
    barZone.style.width = pct(IMPACT_TOLERANCE * 2)
    const barPure = el('div', 'bar-pure')
    barPure.style.left = pct(IMPACT_POS - PERFECT_TOLERANCE)
    barPure.style.width = pct(PERFECT_TOLERANCE * 2)
    this.bar.append(this.barFill, barZone, barPure, this.barNeedle)

    const bottom = el('div', 'hud-bottom')
    bottom.append(this.prompt, this.bar, this.buildTouchControls())

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

  setHole(hole: number, par: number): void {
    this.holeLabel.textContent = `Hole ${hole} · Par ${par}`
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

  /** How far a perfect full-power shot goes, so the fill can be estimated. */
  setRange(metres: number): void {
    this.rangeValue.textContent = `${metres.toFixed(0)} m`
  }

  setPrompt(text: string): void {
    this.prompt.textContent = text
  }

  setBar(view: BarView): void {
    this.bar.style.opacity = view.visible ? '1' : '0'
    const locked = view.power !== null
    this.barFill.style.width = pct(locked ? (view.power ?? 0) : view.marker)
    this.barFill.classList.toggle('locked', locked)
    this.barNeedle.style.left = pct(view.marker)
  }

  /** A big centred message: PURE, BIRDIE, SPLASH. */
  flash(main: string, tone: 'good' | 'bad' | 'neutral' = 'neutral'): void {
    this.flashEl.textContent = main
    this.flashEl.className = `flash show ${tone}`
    window.setTimeout(() => {
      this.flashEl.className = 'flash'
    }, 1400)
  }

  hideOverlay(): void {
    this.overlay.className = 'overlay'
    this.overlay.replaceChildren()
  }

  showRunOver(
    score: RunScore,
    entries: Entry[],
    defaultName: string,
    handlers: { onSave: (name: string) => void; onReplay: () => void },
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
    card.append(form)

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
