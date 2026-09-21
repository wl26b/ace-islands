// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { Hud } from './hud'
import { IMPACT_POS } from '../sim/constants'

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
    const zone = hud.root.querySelector<HTMLElement>('.bar-zone')
    const pure = hud.root.querySelector<HTMLElement>('.bar-pure')
    // Both bands must straddle IMPACT_POS, or the player is aiming at a
    // different target from the one the maths rewards.
    const centreOf = (e: HTMLElement | null): number =>
      e ? parseFloat(e.style.left) + parseFloat(e.style.width) / 2 : NaN
    expect(centreOf(zone)).toBeCloseTo(IMPACT_POS * 100, 6)
    expect(centreOf(pure)).toBeCloseTo(IMPACT_POS * 100, 6)
  })

  test('the run-over card lists saved runs and wires its buttons', () => {
    const hud = mount()
    let saved: string | null = null
    let replayed = false
    hud.showRunOver(
      { holesSurvived: 3, birdies: 1, holes: [], finished: true },
      [{ id: 'a', name: 'Wailu', at: 0, holesSurvived: 3, birdies: 1 }],
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
