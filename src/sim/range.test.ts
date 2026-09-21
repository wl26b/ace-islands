import { describe, expect, test } from 'vitest'
import { HOLE_ONE, generateHole } from './holes'
import { maxRange } from './range'
import { simulateShot } from './shot'
import { pureTaps, taps } from './testing'
import { aimTowards } from './aim'
import type { Hole } from './types'

const calm: Hole = { ...HOLE_ONE, wind: { speed: 0, direction: 0 } }

describe('the full-power range readout', () => {
  test('a full-power strike really does travel about that far', () => {
    const stated = maxRange(calm, 'drive')
    const actual = simulateShot(
      { ...calm, greenIsland: { centre: { x: 0, z: 0 }, radius: 1e5, surfaceY: 4 }, pin: { x: 0, z: -1e6 } },
      { kind: 'drive', from: HOLE_ONE.tee, aim: 0, ...pureTaps(1) },
    )
    expect(stated).toBeCloseTo(Math.hypot(actual.end.x, actual.end.z), 6)
  })

  test('filling the bar to a fraction covers about that fraction of the range', () => {
    // The whole mechanic rests on this: read the distance, read the range,
    // estimate the fill. If it drifted far from proportional the readout
    // would be actively misleading.
    const stated = maxRange(calm, 'drive')
    const flat: Hole = {
      ...calm,
      greenIsland: { centre: { x: 0, z: 0 }, radius: 1e5, surfaceY: 4 },
      pin: { x: 0, z: -1e6 },
    }
    for (const fill of [0.5, 0.6, 0.7, 0.8, 0.9]) {
      const r = simulateShot(flat, { kind: 'drive', from: HOLE_ONE.tee, aim: 0, ...pureTaps(fill) })
      const actual = Math.hypot(r.end.x, r.end.z)
      expect(Math.abs(actual - stated * fill), `fill ${fill}`).toBeLessThan(2)
    }
  })

  test('the hazards and the cup do not shorten the reading', () => {
    // Measured over a reference surface, so a hole whose green is short
    // still reports how far the ball can be hit.
    expect(maxRange(calm, 'drive')).toBeGreaterThan(
      Math.abs(calm.greenIsland.centre.z),
    )
  })

  test('a headwind shortens it and a tailwind lengthens it', () => {
    const tail = maxRange({ ...calm, wind: { speed: 6, direction: 0 } }, 'drive')
    const head = maxRange({ ...calm, wind: { speed: 6, direction: Math.PI } }, 'drive')
    expect(tail).toBeGreaterThan(maxRange(calm, 'drive'))
    expect(head).toBeLessThan(maxRange(calm, 'drive'))
  })

  test('putting has its own, much shorter range', () => {
    const putt = maxRange(calm, 'putt')
    expect(putt).toBeGreaterThan(5)
    expect(putt).toBeLessThan(maxRange(calm, 'drive') / 2)
  })

  test('a full-power putt can cross the green it is played on', () => {
    // Otherwise a drive finishing at the back would be unputtable.
    expect(maxRange(calm, 'putt')).toBeGreaterThan(calm.greenIsland.radius)
  })
})

describe('seeded holes', () => {
  test('hole 1 differs between runs', () => {
    const winds = [111, 222, 333, 444].map((s) => generateHole(s, 1).wind.speed)
    expect(new Set(winds).size).toBeGreaterThan(1)
    const pins = [111, 222, 333, 444].map((s) => generateHole(s, 1).pin.x)
    expect(new Set(pins).size).toBeGreaterThan(1)
  })

  test('late holes are reliably windier, not merely capable of it', () => {
    const sample = (hole: number): number[] =>
      Array.from({ length: 40 }, (_, i) => generateHole(i * 7919, hole).wind.speed)
    const early = sample(1)
    const late = sample(20)
    // The floor rises, not just the ceiling: the calmest late hole must
    // still beat the average early one.
    const avgEarly = early.reduce((a, b) => a + b, 0) / early.length
    expect(Math.min(...late)).toBeGreaterThan(avgEarly)
    expect(Math.max(...late)).toBeLessThanOrEqual(7.5)
  })

  test('the opening hole stays gentle', () => {
    const speeds = Array.from({ length: 50 }, (_, i) => generateHole(i * 104729, 1).wind.speed)
    expect(Math.max(...speeds)).toBeLessThan(2.1)
  })

  test('every generated hole is still reachable, across many seeds', () => {
    // Aimed at the pin with room to lean into the wind, which is what the
    // game gives a player: a fixed straight aim misses offset greens in a
    // crosswind and would condemn perfectly fair holes.
    for (let seed = 0; seed < 12; seed++) {
      for (let n = 1; n <= 15; n++) {
        const hole = generateHole(seed * 7919 + 13, n)
        const base = aimTowards(hole.pin.x - hole.tee.x, hole.pin.z - hole.tee.z)
        let landed = false
        for (const nudge of [-0.2, -0.1, 0, 0.1, 0.2]) {
          for (let p = 0.3; p <= 1.001 && !landed; p += 0.02) {
            if (
              simulateShot(hole, { kind: 'drive', from: hole.tee, aim: base + nudge, ...taps(p, 0) })
                .surface === 'green'
            ) {
              landed = true
            }
          }
        }
        expect(landed, `seed ${seed} hole ${n} unreachable`).toBe(true)
      }
    }
  })
})
