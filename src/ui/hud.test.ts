// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { Hud } from './hud'
import { IMPACT_POS, POWER_START } from '../sim/constants'

function mount(): Hud {
  const root = document.createElement('div')
  document.body.append(root)
  return new Hud(root)
}

describe('the HUD', () => {
  test('builds and updates without throwing', () => {
    const hud = mount()
    hud.setHole(3, 2)
    hud.setStrokes(1)
    hud.setDistance(12.34)
    hud.setWind(4.2, 1.1)
    hud.setPrompt('Space to set power')
    hud.setBar({ visible: true, marker: 0.4, power: null })
    hud.setBar({ visible: true, marker: 0.2, power: 0.9 })
    hud.flash('PURE', 'good')
    expect(hud.root.querySelector('.hole-label')?.textContent).toBe('Hole 3 · Par 2')
    expect(hud.root.querySelector('.stat-value')?.textContent).toBe('1')
  })

  test('the impact zone is drawn where the simulation scores it', () => {
    const hud = mount()
    const zone = hud.root.querySelector<HTMLElement>('.gauge-zone')
    const pure = hud.root.querySelector<HTMLElement>('.gauge-pure')
    // Both bands must straddle IMPACT_POS, or the player is aiming at a
    // different target from the one the maths rewards.
    const centreOf = (e: HTMLElement | null): number =>
      e ? parseFloat(e.style.left) + parseFloat(e.style.width) / 2 : NaN
    expect(centreOf(zone)).toBeCloseTo(IMPACT_POS * 100, 6)
    expect(centreOf(pure)).toBeCloseTo(IMPACT_POS * 100, 6)
  })

  test('the struck marker is held, and cleared for the next shot', () => {
    const hud = mount()
    const needle = hud.root.querySelector<HTMLElement>('.gauge-needle')

    hud.setBar({ visible: true, marker: 0.42, power: 0.8, struck: true, pure: false })
    expect(needle?.classList.contains('struck')).toBe(true)
    expect(needle?.classList.contains('pure')).toBe(false)
    // Compared as a number: the browser is free to reserialise the
    // percentage however it likes.
    expect(parseFloat(needle?.style.left ?? '')).toBeCloseTo(42, 2)

    hud.setBar({ visible: true, marker: 0.12, power: 0.8, struck: true, pure: true })
    expect(needle?.classList.contains('pure')).toBe(true)

    // The next shot must start clean, or the old miss lingers on the bar.
    hud.setBar({ visible: false, marker: 0, power: null })
    expect(needle?.classList.contains('struck')).toBe(false)
    expect(needle?.classList.contains('pure')).toBe(false)
  })

  test('the prompt carries the verdict tone, and drops it again', () => {
    const hud = mount()
    const prompt = hud.root.querySelector<HTMLElement>('.prompt')
    hud.setPrompt('84ms early \u00B7 slices right', 'miss')
    expect(prompt?.className).toBe('prompt miss')
    hud.setPrompt('Space to set power')
    expect(prompt?.className).toBe('prompt')
  })

  test('the bar is marked in metres, not in percent', () => {
    const hud = mount()
    hud.setPowerScale(88, 48, (d) => Math.min(d / 88, 1))

    const span = 1 - POWER_START
    const at = (d: number) => (POWER_START + (d / 88) * span) * 100

    const ticks = [...hud.root.querySelectorAll<HTMLElement>('.gauge-tick')]
    expect(ticks).toHaveLength(4)
    ;[20, 40, 60, 80].forEach((distance, i) => {
      // The style is written to two decimals, so compare at that precision.
      expect(parseFloat(ticks[i]?.style.left ?? '')).toBeCloseTo(at(distance), 2)
    })

    const labels = [...hud.root.querySelectorAll('.scale-label')].map((l) => l.textContent)
    expect(labels).toContain('20')
    expect(labels).toContain('80')
  })

  test('off the tee the pin is a single mark, with its distance', () => {
    const hud = mount()
    hud.setShotKind('drive')
    hud.setPowerScale(88, 48, (d) => Math.min(d / 88, 1))

    const marker = hud.root.querySelector<HTMLElement>('.pin-marker')
    const expected = (POWER_START + (48 / 88) * (1 - POWER_START)) * 100
    expect(parseFloat(marker?.style.left ?? '')).toBeCloseTo(expected, 2)
    expect(hud.root.querySelector('.pin-band')).toBeNull()

    const labels = [...hud.root.querySelectorAll('.scale-label')].map((l) => l.textContent)
    expect(labels).toContain('48 pin')
  })

  test('on the green the pin is a band straddling the distance', () => {
    // Good pace is a range, dying just past the hole.
    const hud = mount()
    hud.setShotKind('putt')
    hud.setPowerScale(20, 10, (d) => Math.min(d / 20, 1))

    const band = hud.root.querySelector<HTMLElement>('.pin-band')
    // Drawn full width when putting, so a distance maps straight to it.
    const at = (d: number) => (d / 20) * 100
    expect(parseFloat(band?.style.left ?? '')).toBeCloseTo(at(9.9), 2)
    expect(
      parseFloat(band?.style.left ?? '') + parseFloat(band?.style.width ?? ''),
    ).toBeCloseTo(at(10.8), 2)
    expect(hud.root.querySelector('.pin-marker')).toBeNull()
  })

  test('putting draws the bar full width, with no dead strip', () => {
    // The impact section only exists for a full swing. Leaving its space
    // empty on the green made the gauge look broken.
    const hud = mount()
    hud.setShotKind('putt')
    hud.setPowerScale(20, 10, (d) => Math.min(d / 20, 1))
    hud.setBar({ visible: true, marker: POWER_START, power: null })

    const fill = hud.root.querySelector<HTMLElement>('.gauge-fill')
    expect(parseFloat(fill?.style.left ?? '')).toBeCloseTo(0, 2)

    const needle = hud.root.querySelector<HTMLElement>('.gauge-needle')
    expect(parseFloat(needle?.style.left ?? '')).toBeCloseTo(0, 2)

    // And a full-power marker reaches the far end.
    hud.setBar({ visible: true, marker: 1, power: null })
    expect(parseFloat(needle?.style.left ?? '')).toBeCloseTo(100, 2)
  })

  test('a pin out of reach parks at the end rather than off the bar', () => {
    const hud = mount()
    hud.setShotKind('drive')
    hud.setPowerScale(80, 95, (d) => Math.min(d / 80, 1))
    const marker = hud.root.querySelector<HTMLElement>('.pin-marker')
    expect(parseFloat(marker?.style.left ?? '')).toBeCloseTo(100, 2)
    expect(marker?.classList.contains('unreachable')).toBe(true)
  })

  test('putting gets its own finer scale', () => {
    // The same bar serves a 90m drive and a 20m putt.
    const hud = mount()
    hud.setPowerScale(23.3, 8, (d) => Math.min(d / 23.3, 1))
    const labels = [...hud.root.querySelectorAll('.scale-label')].map((l) => l.textContent)
    expect(labels).toContain('5')
    expect(labels).toContain('20')
  })

  test('rebuilding the scale replaces it rather than stacking it up', () => {
    const hud = mount()
    hud.setPowerScale(88, 48, (d) => Math.min(d / 88, 1))
    hud.setPowerScale(23.3, 8, (d) => Math.min(d / 23.3, 1))
    expect(hud.root.querySelectorAll('.gauge-tick')).toHaveLength(4)
    expect(hud.root.querySelectorAll('.pin-marker, .pin-band')).toHaveLength(1)
  })

  test('the forecast splits carry from roll', () => {
    const hud = mount()
    hud.setForecast(69, 74)
    expect(hud.root.querySelector('.forecast-parts')?.textContent).toBe('69 m + 5 m')
    expect(hud.root.querySelector('.forecast-total')?.textContent).toBe('Distance 74 m')

    // A putt is all roll, and must not show a negative carry.
    hud.setForecast(8, 8)
    expect(hud.root.querySelector('.forecast-parts')?.textContent).toBe('8 m + 0 m')

    hud.setForecast(null, null)
    expect(hud.root.querySelector('.forecast-parts')).toBeNull()
  })

  test('the run-over card lists saved runs and wires its buttons', () => {
    const hud = mount()
    let saved: string | null = null
    let replayed = false
    hud.showRunOver(
      { holesSurvived: 3, birdies: 1, aces: 1, holes: [], finished: true },
      [{ id: 'a', name: 'Wailu', at: 0, holesSurvived: 3, birdies: 1, aces: 1 }],
      'You',
      { onSave: (n) => (saved = n), onReplay: () => (replayed = true) },
    )
    expect(hud.root.querySelector('.lede')?.textContent).toContain('3 holes survived')
    expect(hud.root.querySelectorAll('.board-row')).toHaveLength(1)

    hud.root.querySelector<HTMLButtonElement>('.save-row .btn')?.click()
    hud.root.querySelector<HTMLButtonElement>('.btn.primary')?.click()
    expect(saved).toBe('You')
    expect(replayed).toBe(true)

    hud.hideOverlay()
    expect(hud.root.querySelector('.card')).toBeNull()
  })
})
