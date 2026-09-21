import { describe, expect, test } from 'vitest'
import { HOLE_ONE, generateHole } from './holes'
import { maxRange, powerForDistance, puttPaceFor, rangeAt } from './range'
import { simulateShot } from './shot'
import { pureTaps, taps } from './testing'
import { aimTowards } from './aim'
import type { Hole } from './types'
import { FLAT } from './types'

const calm: Hole = { ...HOLE_ONE, wind: { speed: 0, direction: 0 } }

describe('the full-power range readout', () => {
  test('a full-power strike really does travel about that far', () => {
    const stated = maxRange(calm, 'drive')
    const actual = simulateShot(
      { ...calm, greenIsland: { centre: { x: 0, z: 0 }, radius: 1e5, surfaceY: 4, slope: FLAT }, pin: { x: 0, z: -1e6 } },
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
      greenIsland: { centre: { x: 0, z: 0 }, radius: 1e5, surfaceY: 4, slope: FLAT },
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

describe('the advice the game gives is safe to follow', () => {
  test('filling the bar to the stated share lands on the green', () => {
    // The HUD shows distance to pin and full-power range, and the player
    // fills that share of the bar. If the ball rolls a long way after
    // pitching, doing exactly that lands it short of the island and in the
    // water -- the game telling you to drown. This is that regression.
    let drowned = 0
    let total = 0
    // Out to hole 35, so the small greens and tight pins at the hard end
    // of the difficulty ramp are covered, not just the gentle opening.
    for (let seed = 0; seed < 12; seed++) {
      for (const n of [1, 3, 6, 10, 15, 20, 25, 30, 35]) {
        const hole = generateHole(seed * 7919 + 13, n)
        const dist = Math.hypot(hole.pin.x - hole.tee.x, hole.pin.z - hole.tee.z)
        const aim = aimTowards(hole.pin.x - hole.tee.x, hole.pin.z - hole.tee.z)
        // Aim is allowed to lean into the wind, as a player reading the
        // wind gauge would. What is on trial here is the power advice.
        const power = dist / maxRange(hole, 'drive')
        let landed = false
        for (const nudge of [0, -0.08, 0.08, -0.16, 0.16, -0.24, 0.24]) {
          const r = simulateShot(hole, {
            kind: 'drive',
            from: hole.tee,
            aim: aim + nudge,
            ...pureTaps(power),
          })
          if (r.surface === 'green') landed = true
        }
        total++
        if (!landed) drowned++
      }
    }
    expect(drowned, `${drowned} of ${total} recommended shots missed the green`).toBe(0)
  })

  test('the ball stops near where it pitches', () => {
    // Short bounce and roll, so the landing spot sets up the putt.
    const hole = generateHole(20260921, 4)
    for (const p of [0.6, 0.8, 1]) {
      const r = simulateShot(hole, { kind: 'drive', from: hole.tee, aim: 0, ...pureTaps(p) })
      const total = Math.hypot(r.end.x - hole.tee.x, r.end.z - hole.tee.z)
      if (r.surface === 'green') expect(total - r.carry).toBeLessThan(7)
    }
  })
})

describe('the run gets harder', () => {
  const sample = (hole: number, pick: (h: ReturnType<typeof generateHole>) => number) =>
    Array.from({ length: 40 }, (_, i) => pick(generateHole(i * 7919 + 13, hole)))

  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length

  test('greens shrink as the run goes on', () => {
    expect(mean(sample(30, (h) => h.greenIsland.radius))).toBeLessThan(
      mean(sample(1, (h) => h.greenIsland.radius)) - 4,
    )
  })

  test('holes stretch as the run goes on', () => {
    const fill = (n: number) =>
      mean(sample(n, (h) => Math.hypot(h.pin.x, h.pin.z) / maxRange(h, 'drive')))
    expect(fill(30)).toBeGreaterThan(fill(1))
  })

  test('pins creep towards the edge, but never onto the front lip', () => {
    for (let seed = 0; seed < 40; seed++) {
      for (const n of [1, 10, 20, 30, 40]) {
        const hole = generateHole(seed * 7919 + 13, n)
        const g = hole.greenIsland
        // How far the pin sits towards the tee from the middle. A ball
        // pitched at it must still have green underneath.
        const towardsTee = Math.max(0, hole.pin.z - g.centre.z)
        // The clamp lands exactly on this bound, so allow for the last
        // bit of floating point rather than asserting an exact equality.
        expect(g.radius - towardsTee).toBeGreaterThan(8 - 1e-6)
        // And it must stay on the green at all.
        const offset = Math.hypot(hole.pin.x - g.centre.x, hole.pin.z - g.centre.z)
        expect(offset).toBeLessThanOrEqual(g.radius - 2.4)
      }
    }
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
    // Capped, so a late hole is a stiff breeze and never unplayable.
    expect(Math.max(...late)).toBeLessThanOrEqual(9.5)
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
      for (const n of [1, 3, 6, 10, 15, 20, 25, 30, 35]) {
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

describe('the pace needed for a putt', () => {
  test('it rolls about as far as asked, on the level', () => {
    const flat: Hole = {
      ...HOLE_ONE,
      wind: { speed: 0, direction: 0 },
      pin: { x: 0, z: -1e6 },
    }
    const from = { x: 0, y: flat.greenIsland.surfaceY, z: flat.greenIsland.centre.z }
    for (const want of [3, 6, 10, 16]) {
      const r = simulateShot(flat, {
        kind: 'putt',
        from,
        aim: 0,
        ...pureTaps(puttPaceFor(want)),
      })
      const rolled = Math.hypot(r.end.x - from.x, r.end.z - from.z)
      expect(Math.abs(rolled - want), `${want}m putt rolled ${rolled.toFixed(2)}m`).toBeLessThan(0.6)
    }
  })

  test('the fill means the same thing putting as it does off the tee', () => {
    // Putting speed used to ramp linearly while distance goes as its
    // square, so half a bar sent the ball a third of the way and the
    // distance readout quietly lied on every putt.
    const huge: Hole = {
      ...HOLE_ONE,
      wind: { speed: 0, direction: 0 },
      greenIsland: { centre: { x: 0, z: -80 }, radius: 1e4, surfaceY: 4, slope: FLAT },
      pin: { x: 0, z: -1e6 },
    }
    const from = { x: 0, y: 4, z: -80 }
    const full = maxRange(huge, 'putt')

    for (const fill of [0.2, 0.4, 0.6, 0.8, 1]) {
      const r = simulateShot(huge, { kind: 'putt', from, aim: 0, ...pureTaps(fill) })
      const rolled = Math.hypot(r.end.x - from.x, r.end.z - from.z)
      expect(Math.abs(rolled - full * fill), `fill ${fill}`).toBeLessThan(0.6)
    }
  })

  test('a longer putt asks for more pace, and it stays in range', () => {
    expect(puttPaceFor(12)).toBeGreaterThan(puttPaceFor(4))
    expect(puttPaceFor(0)).toBeGreaterThanOrEqual(0)
    expect(puttPaceFor(1e6)).toBeLessThanOrEqual(1)
  })
})

describe('the bar tells the truth about distance', () => {
  test('the power it names really does travel that far', () => {
    // The ruler is only worth having if the ball agrees with it.
    const hole = generateHole(20260921, 6)
    for (const want of [30, 45, 60, 75]) {
      const power = powerForDistance(hole, 'drive', want)
      expect(Math.abs(rangeAt(hole, 'drive', power) - want), `${want}m`).toBeLessThan(0.5)
    }
  })

  test('stopping on the pin mark finishes at the pin', () => {
    // Measured on real holes, wind, elevation and all. Assuming distance
    // was simply proportional to the bar left every shot short.
    const errors: number[] = []
    for (let seed = 0; seed < 15; seed++) {
      for (const n of [1, 8, 16, 26]) {
        const hole = generateHole(seed * 7919 + 13, n)
        const toPin = Math.hypot(hole.pin.x - hole.tee.x, hole.pin.z - hole.tee.z)
        const aim = aimTowards(hole.pin.x - hole.tee.x, hole.pin.z - hole.tee.z)
        const r = simulateShot(hole, {
          kind: 'drive',
          from: hole.tee,
          aim,
          ...pureTaps(powerForDistance(hole, 'drive', toPin)),
        })
        if (r.surface !== 'green') continue
        errors.push(Math.hypot(r.end.x - hole.tee.x, r.end.z - hole.tee.z) - toPin)
      }
    }
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length
    expect(Math.abs(mean), `mean error ${mean.toFixed(2)}m`).toBeLessThan(0.75)
    const close = errors.filter((e) => Math.abs(e) <= 2).length / errors.length
    expect(close, 'most shots should finish within 2m').toBeGreaterThan(0.85)
  })

  test('a distance beyond the bar answers exactly full power', () => {
    const hole = generateHole(20260921, 6)
    expect(powerForDistance(hole, 'drive', 10000)).toBe(1)
    expect(powerForDistance(hole, 'drive', -5)).toBe(0)
  })
})
