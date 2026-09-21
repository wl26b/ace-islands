import { describe, expect, test } from 'vitest'
import { HOLE_ONE, generateHole } from './holes'
import { gradientAt, heightAt } from './surface'
import { simulateShot, surfaceAt } from './shot'
import { aimTowards } from './aim'
import { taps } from './testing'
import { powerCapFor } from './bar'
import { MAX_STEPS } from './constants'
import type { Hole, Slope } from './types'
import { FLAT } from './types'

/** The reference hole, contoured to order, with the cup out of the way. */
function contoured(slope: Partial<Slope>, keepCup = false): Hole {
  return {
    ...HOLE_ONE,
    wind: { speed: 0, direction: 0 },
    greenIsland: { ...HOLE_ONE.greenIsland, slope: { ...FLAT, ...slope } },
    ...(keepCup ? {} : { pin: { x: 0, z: -1e6 } }),
  }
}

function puttAcross(hole: Hole, aim = 0, power = 0.5) {
  const from = {
    x: HOLE_ONE.pin.x,
    y: heightAt(hole.greenIsland, HOLE_ONE.pin.x, HOLE_ONE.pin.z + 8),
    z: HOLE_ONE.pin.z + 8,
  }
  // Timed against the scale this putt's length calls for, or `power` here
  // would mean a fraction of the full ruler and land far short.
  const cap = powerCapFor('putt', 8)
  return {
    from,
    result: simulateShot(hole, { kind: 'putt', from, aim, ...taps(power, 0, cap) }),
  }
}

describe('the height field', () => {
  test('a level surface is level everywhere', () => {
    const island = HOLE_ONE.greenIsland
    for (const [x, z] of [[0, -80], [8, -74], [-12, -88]] as const) {
      expect(heightAt(island, x, z)).toBeCloseTo(island.surfaceY, 12)
      expect(gradientAt(island, x, z).x).toBeCloseTo(0, 12)
    }
  })

  test('the gradient really is the slope of the height', () => {
    // Differentiated by hand, so it is worth checking against the real
    // thing: a wrong gradient would bend putts the wrong way.
    const hole = contoured({ gradientX: 0.05, gradientZ: -0.03, swellAmp: 0.4, swellFreq: 0.25, swellPhase: 1.1 })
    const island = hole.greenIsland
    const h = 1e-4
    for (const [x, z] of [[0, -80], [7, -75], [-9, -85], [3, -90]] as const) {
      const numericX = (heightAt(island, x + h, z) - heightAt(island, x - h, z)) / (2 * h)
      const numericZ = (heightAt(island, x, z + h) - heightAt(island, x, z - h)) / (2 * h)
      const exact = gradientAt(island, x, z)
      expect(exact.x).toBeCloseTo(numericX, 6)
      expect(exact.z).toBeCloseTo(numericZ, 6)
    }
  })

  test('the simulation reads its ground from that field', () => {
    // The renderer builds its mesh from heightAt too, so this is what ties
    // what you see to what the ball rolls on.
    const hole = contoured({ gradientX: 0.05, swellAmp: 0.3, swellFreq: 0.22 })
    for (const [x, z] of [[0, -80], [6, -76], [-8, -86]] as const) {
      expect(surfaceAt(hole, x, z).y).toBeCloseTo(heightAt(hole.greenIsland, x, z), 12)
    }
  })
})

describe('putting on a contour', () => {
  test('a putt across a side slope breaks downhill', () => {
    // Measured against where the ball started, not against zero: the tee
    // reference pin sits at x = 3.
    const right = puttAcross(contoured({ gradientX: -0.06 }))
    const left = puttAcross(contoured({ gradientX: 0.06 }))
    const straight = puttAcross(contoured({}))
    expect(straight.result.end.x - straight.from.x).toBeCloseTo(0, 6)
    // Height falling towards +X pulls the ball that way; the other tilt
    // pulls it back. Either way it must not run straight.
    expect(right.result.end.x - right.from.x).toBeGreaterThan(0.3)
    expect(left.result.end.x - left.from.x).toBeLessThan(-0.3)
  })

  test('uphill is shorter than level, downhill is longer', () => {
    const roll = (gradientZ: number) => {
      const { from, result } = puttAcross(contoured({ gradientZ }))
      return Math.hypot(result.end.x - from.x, result.end.z - from.z)
    }
    // The ball runs towards -Z, so a negative gradient there is uphill.
    expect(roll(-0.06)).toBeLessThan(roll(0))
    expect(roll(0.06)).toBeGreaterThan(roll(0))
  })

  test('a ball that comes to rest stays put', () => {
    // Gravity pulls all the way down the slope, so friction has to be able
    // to hold it. Otherwise a ball would creep off the green on its own and
    // the simulation would run until it hit the step cap.
    for (let n = 1; n <= 40; n++) {
      // Cup moved out of reach: this is about whether the ball settles,
      // not about whether it happens to find the hole.
      const generated = generateHole(20260921, n)
      const hole: Hole = { ...generated, pin: { x: 0, z: -1e6 } }
      const g = hole.greenIsland
      const from = { x: g.centre.x, y: heightAt(g, g.centre.x, g.centre.z), z: g.centre.z }
      const r = simulateShot(hole, { kind: 'putt', from, aim: 0.7, ...taps(0.12, 0) })
      expect(r.outcome, `hole ${n}`).toBe('rest')
      expect(r.path.length, `hole ${n} never settled`).toBeLessThan(MAX_STEPS / 2)
    }
  })

  test('a contoured green can still be holed', () => {
    // Searched coarsely then refined, because the holing line is narrower
    // than the cup once the ball is breaking across it: a grid step wider
    // than the hole can stride straight over the answer and report a
    // perfectly puttable green as impossible.
    for (let n = 1; n <= 30; n++) {
      const hole = generateHole(4242, n)
      const g = hole.greenIsland
      // Stepped off towards the middle of the green, not blindly towards
      // the tee: a pin tucked at the back would put the ball in the water
      // before it had rolled anywhere.
      const toCentre = Math.hypot(g.centre.x - hole.pin.x, g.centre.z - hole.pin.z)
      const step = Math.min(7, g.radius - 2)
      const ux = toCentre > 0.01 ? (g.centre.x - hole.pin.x) / toCentre : 0
      const uz = toCentre > 0.01 ? (g.centre.z - hole.pin.z) / toCentre : 1
      const from = { x: hole.pin.x + ux * step, y: 0, z: hole.pin.z + uz * step }
      from.y = heightAt(g, from.x, from.z)

      // Aim is an absolute heading, so the search has to start from the
      // line to the pin. Sweeping a fixed range around zero would point
      // the ball down the hole no matter where the pin actually is.
      const toPin = aimTowards(hole.pin.x - from.x, hole.pin.z - from.z)

      const cap = powerCapFor('putt', step)
      const attempt = (aim: number, power: number) =>
        simulateShot(hole, {
          kind: 'putt',
          from,
          aim: toPin + aim,
          ...taps(power, 0, cap),
        })

      let best = { toPin: Infinity, aim: 0, power: 0.4, holed: false }
      const consider = (aim: number, power: number) => {
        const r = attempt(aim, power)
        if (r.outcome === 'holed') best = { toPin: 0, aim, power, holed: true }
        else if (r.toPin < best.toPin && !best.holed) best = { toPin: r.toPin, aim, power, holed: false }
      }

      for (let aim = -0.4; aim <= 0.4 && !best.holed; aim += 0.05) {
        for (let power = 0.15; power <= 0.85 && !best.holed; power += 0.02) {
          consider(aim, power)
        }
      }
      for (let aim = best.aim - 0.05; aim <= best.aim + 0.05 && !best.holed; aim += 0.004) {
        for (let power = best.power - 0.03; power <= best.power + 0.03 && !best.holed; power += 0.002) {
          consider(aim, power)
        }
      }

      expect(best.holed, `hole ${n}: no ${step.toFixed(0)}m putt could be holed`).toBe(true)
    }
  }, 60000)

  test('a sloped putt is still perfectly deterministic', () => {
    const hole = contoured({ gradientX: 0.05, gradientZ: -0.04, swellAmp: 0.35, swellFreq: 0.28, swellPhase: 2 })
    const a = puttAcross(hole, 0.03, 0.55).result
    const b = puttAcross(hole, 0.03, 0.55).result
    expect(b.end).toEqual(a.end)
    expect(b.path).toEqual(a.path)
  })
})

describe('generated contours', () => {
  test('greens roll, but are not mountains', () => {
    for (const n of [1, 10, 20, 30, 40]) {
      for (let seed = 0; seed < 10; seed++) {
        const g = generateHole(seed * 7919 + 13, n).greenIsland
        let lo = Infinity
        let hi = -Infinity
        for (let a = 0; a < 20; a++) {
          for (let r = 0; r <= 1; r += 0.25) {
            const x = g.centre.x + Math.cos((a / 20) * Math.PI * 2) * g.radius * r
            const z = g.centre.z + Math.sin((a / 20) * Math.PI * 2) * g.radius * r
            const rel = heightAt(g, x, z) - g.surfaceY
            lo = Math.min(lo, rel)
            hi = Math.max(hi, rel)
          }
        }
        expect(hi - lo, `hole ${n} relief`).toBeGreaterThan(0.1)
        // Generous, but it is a bound against absurdity, not a target: the
        // slopes have to be strong enough that a putt must be read.
        expect(hi - lo, `hole ${n} relief`).toBeLessThan(4.6)
      }
    }
  })

  test('later greens are more contoured than early ones', () => {
    const relief = (hole: number) => {
      let total = 0
      for (let seed = 0; seed < 25; seed++) {
        const g = generateHole(seed * 7919 + 13, hole).greenIsland
        total += Math.abs(g.slope.gradientX) + Math.abs(g.slope.gradientZ) + g.slope.swellAmp
      }
      return total / 25
    }
    expect(relief(30)).toBeGreaterThan(relief(1))
  })

  test('the tee box is level, as it is in golf', () => {
    for (let n = 1; n <= 20; n++) {
      expect(generateHole(7, n).teeIsland.slope).toEqual(FLAT)
    }
  })
})
