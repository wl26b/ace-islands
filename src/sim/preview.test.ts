import { describe, expect, test } from 'vitest'
import { generateHole } from './holes'
import { previewPower, previewShot, previewTaps } from './preview'
import { applyShot, nextShotKind, startRun } from './run'
import { simulateShot } from './shot'
import { aimTowards } from './aim'
import { heightAt } from './surface'
import { FLAT } from './types'
import type { Hole } from './types'

describe('the aiming preview', () => {
  test('it is a shot the player could actually strike', () => {
    for (let n = 1; n <= 30; n++) {
      const hole = generateHole(20260921, n)
      const power = previewPower(hole, hole.tee, 'drive')
      expect(power, `hole ${n}`).toBeGreaterThan(0)
      expect(power, `hole ${n}`).toBeLessThanOrEqual(1)
    }
  })

  test('playing it produces exactly the path it drew', () => {
    // The guard that matters. If the preview ever computed its shot with
    // different wind, a different power, or a flat green, the line on
    // screen would be a promise the game does not keep -- and the player
    // would aim at it and drown.
    for (let n = 1; n <= 20; n++) {
      const state = startRun(20260921 + n)
      const kind = nextShotKind(state)
      const aim = aimTowards(
        state.hole.pin.x - state.ball.x,
        state.hole.pin.z - state.ball.z,
      )

      const shown = previewShot(state.hole, state.ball, aim, kind)
      const taps = previewTaps(state.hole, state.ball, kind)
      const played = applyShot(state, aim, taps.powerTapMs, taps.impactTapMs)

      expect(played.result.path, `hole ${n}`).toEqual(shown.path)
      expect(played.result.end, `hole ${n}`).toEqual(shown.end)
      expect(played.result.outcome, `hole ${n}`).toBe(shown.outcome)
    }
  })

  test('it accounts for the wind rather than drawing a straight line', () => {
    const hole = generateHole(20260921, 12)
    const aim = aimTowards(hole.pin.x - hole.tee.x, hole.pin.z - hole.tee.z)
    const shown = previewShot(hole, hole.tee, aim, 'drive')
    const calm = simulateShot(
      { ...hole, wind: { speed: 0, direction: 0 } },
      { kind: 'drive', from: hole.tee, aim, ...previewTaps(hole, hole.tee, 'drive') },
    )
    expect(hole.wind.speed).toBeGreaterThan(1)
    expect(Math.hypot(shown.end.x - calm.end.x, shown.end.z - calm.end.z)).toBeGreaterThan(0.5)
  })

  test('a putt preview bends with the green', () => {
    const hole = generateHole(4242, 25)
    const g = hole.greenIsland
    const from = { x: g.centre.x, y: heightAt(g, g.centre.x, g.centre.z), z: g.centre.z }
    const aim = aimTowards(hole.pin.x - from.x, hole.pin.z - from.z)
    const taps = previewTaps(hole, from, 'putt')

    // Both rolled with the cup out of the way: if each drops in, both
    // finish at the pin and the comparison measures nothing at all. The
    // pin goes *behind* the ball rather than to infinity, so the putter
    // keeps the same scale and the two shots stay comparable.
    const toPin = Math.hypot(hole.pin.x - from.x, hole.pin.z - from.z)
    const open: Hole = { ...hole, pin: { x: from.x, z: from.z + toPin } }
    const sloped = simulateShot(open, { kind: 'putt', from, aim, ...taps })
    const level = simulateShot(
      { ...open, greenIsland: { ...g, slope: FLAT } },
      { kind: 'putt', from, aim, ...taps },
    )

    // The whole reason to draw it: the break has to show.
    expect(
      Math.hypot(sloped.end.x - level.end.x, sloped.end.z - level.end.z),
    ).toBeGreaterThan(0.15)
  })

  test('the preview never claims more than the bar can give', () => {
    for (let n = 1; n <= 40; n++) {
      expect(previewPower(generateHole(777, n), generateHole(777, n).tee, 'drive'))
        .toBeLessThanOrEqual(1)
    }
    // A pin further away than the ball can be hit shows the longest shot
    // available, not an imaginary one past the end of the bar.
    const hole = generateHole(777, 5)
    const outOfReach: Hole = { ...hole, pin: { x: 0, z: -400 } }
    expect(previewPower(outOfReach, outOfReach.tee, 'drive')).toBe(1)
  })
})
