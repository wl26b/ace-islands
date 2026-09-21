import { describe, expect, test } from 'vitest'
import {
  FULL_PUTT_SCALE,
  accuracyFromTaps,
  autoPuttScale,
  puttScaleRange,
  isPure,
  lockedPosition,
  powerFromTap,
  powerCapFor,
  powerPhasePosition,
  pureTaps,
  returnPosition,
  returnWindowMs,
} from './bar'
import { IMPACT_POS, POWER_START, SWEEP_MS } from './constants'

describe('the power section', () => {
  test('the marker stays inside the power half', () => {
    for (let ms = 0; ms < 40000; ms += 7) {
      const p = powerPhasePosition(ms)
      expect(p).toBeGreaterThanOrEqual(POWER_START - 1e-9)
      expect(p).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  test('it bounces back and forth rather than stopping at the end', () => {
    const span = 1 - POWER_START
    const outward = span * SWEEP_MS
    expect(powerPhasePosition(0)).toBeCloseTo(POWER_START, 9)
    expect(powerPhasePosition(outward)).toBeCloseTo(1, 9)
    // Halfway back down again.
    expect(powerPhasePosition(outward * 1.5)).toBeCloseTo(POWER_START + span / 2, 9)
    expect(powerPhasePosition(outward * 2)).toBeCloseTo(POWER_START, 9)
  })

  test('the marker never jumps', () => {
    // Continuous at both turns, or a tap could land on a power the player
    // never saw the marker occupy.
    let previous = powerPhasePosition(0)
    for (let ms = 0.5; ms < 12000; ms += 0.5) {
      const here = powerPhasePosition(ms)
      expect(Math.abs(here - previous)).toBeLessThan(0.01)
      previous = here
    }
  })

  test('it never runs out: waiting does not commit the shot', () => {
    // The old bar swept once and fired itself at full power. Waiting must
    // now simply mean the marker is somewhere else, never a shot played.
    const late = powerPhasePosition(60000)
    expect(Number.isFinite(late)).toBe(true)
    expect(late).toBeLessThanOrEqual(1)
    // Over many cycles it keeps visiting both ends.
    const seen = new Set<string>()
    for (let ms = 0; ms < 20000; ms += 13) {
      const p = powerPhasePosition(ms)
      if (p < POWER_START + 0.05) seen.add('low')
      if (p > 0.95) seen.add('high')
    }
    expect([...seen].sort()).toEqual(['high', 'low'])
  })

  test('power reads 0 to 1 across the section', () => {
    const span = 1 - POWER_START
    expect(powerFromTap(0)).toBeCloseTo(0, 9)
    expect(powerFromTap(span * SWEEP_MS)).toBeCloseTo(1, 9)
    expect(powerFromTap(span * SWEEP_MS * 0.5)).toBeCloseTo(0.5, 9)
    for (const want of [0.1, 0.35, 0.86, 0.99]) {
      expect(powerFromTap(pureTaps(want).powerTapMs)).toBeCloseTo(want, 9)
    }
  })

  test('a nonsense timing is treated as zero, not NaN', () => {
    // Logs arrive from outside and will one day arrive from a browser the
    // server does not control.
    for (const bad of [NaN, -1, -Infinity, Infinity]) {
      expect(Number.isFinite(powerFromTap(bad))).toBe(true)
    }
  })
})

describe('the accuracy section', () => {
  test('the marker only reaches it on the way back', () => {
    for (let ms = 0; ms < 20000; ms += 11) {
      expect(powerPhasePosition(ms)).toBeGreaterThanOrEqual(POWER_START - 1e-9)
    }
    // Having locked power, it runs down past the divider and into the zone.
    const power = 0.8
    expect(returnPosition(power, 0)).toBeCloseTo(lockedPosition(power), 9)
    const atZone = (lockedPosition(power) - IMPACT_POS) * SWEEP_MS
    expect(returnPosition(power, atZone)).toBeCloseTo(IMPACT_POS, 9)
    expect(IMPACT_POS).toBeLessThan(POWER_START)
  })

  test('a bigger power gives a longer run back', () => {
    expect(returnWindowMs(1)).toBeGreaterThan(returnWindowMs(0.4))
  })

  test('tapping on the zone is pure and straight', () => {
    for (const power of [0.2, 0.5, 0.86, 1]) {
      const t = pureTaps(power)
      expect(powerFromTap(t.powerTapMs)).toBeCloseTo(power, 9)
      expect(isPure(power, t.impactTapMs)).toBe(true)
      expect(accuracyFromTaps(power, t.impactTapMs)).toBeCloseTo(0, 9)
    }
  })

  test('early leaks right, late draws left', () => {
    const power = 0.8
    const pure = pureTaps(power).impactTapMs
    expect(accuracyFromTaps(power, pure - 90)).toBeGreaterThan(0)
    expect(accuracyFromTaps(power, pure + 90)).toBeLessThan(0)
  })

  test('letting the marker run out is the worst miss, not a free shot', () => {
    const power = 0.8
    const error = accuracyFromTaps(power, returnWindowMs(power))
    expect(error).toBeLessThan(-0.9)
  })
})

describe('the putter scales', () => {
  const span = 1 - POWER_START

  test('a full swing always uses the whole range', () => {
    expect(powerCapFor('drive', 1)).toBe(1)
    expect(powerCapFor('drive')).toBe(1)
  })

  test('the scale follows the length of the putt', () => {
    // Chosen for the player, not by them: the shortest ruler that reaches
    // is always the right one, because it reads the putt most finely.
    // Scales are 3 / 6 / 12 / full, with headroom for a breaking putt.
    expect(autoPuttScale(1)).toBe(0)
    expect(autoPuttScale(2)).toBe(0)
    expect(autoPuttScale(4)).toBe(1)
    expect(autoPuttScale(8)).toBe(2)
    expect(autoPuttScale(14)).toBe(FULL_PUTT_SCALE)
    expect(autoPuttScale(200)).toBe(FULL_PUTT_SCALE)
  })

  test('a short putt gets a lower cap than a long one', () => {
    expect(powerCapFor('putt', 1)).toBeLessThan(powerCapFor('putt', 4))
    expect(powerCapFor('putt', 4)).toBeLessThan(powerCapFor('putt', 8))
    expect(powerCapFor('putt', 8)).toBeLessThan(powerCapFor('putt', 20))
    expect(powerCapFor('putt', 20)).toBe(1)
  })

  test('a nonsense distance still gives a usable scale', () => {
    for (const bad of [NaN, -5, Infinity]) {
      const cap = powerCapFor('putt', bad)
      expect(Number.isFinite(cap)).toBe(true)
      expect(cap).toBeGreaterThan(0)
      expect(cap).toBeLessThanOrEqual(1)
    }
  })

  test('the ruler never quite ends at the hole', () => {
    // Headroom, so a putt is not pinned to the very end of its scale.
    // Comfortably beyond, not just beyond: a breaking putt is aimed off
    // and curves in, so it travels further than the straight line.
    for (const distance of [1, 2.2, 4, 8.5, 12]) {
      expect(puttScaleRange(distance, 23.3)).toBeGreaterThan(distance * 1.2)
    }
  })

  test('the marker still fills the bar, just more slowly', () => {
    const cap = powerCapFor('putt', 1)
    let top = 0
    for (let ms = 0; ms < 8000; ms += 3) {
      const p = powerPhasePosition(ms, cap)
      expect(p).toBeGreaterThanOrEqual(POWER_START - 1e-9)
      expect(p).toBeLessThanOrEqual(POWER_START + cap * span + 1e-9)
      top = Math.max(top, p)
    }
    expect(top).toBeCloseTo(POWER_START + cap * span, 4)
  })

  test('a short putt is genuinely finer to strike', () => {
    const perMs = (cap: number) =>
      Math.abs(powerFromTap(410, cap) - powerFromTap(400, cap)) / 10
    expect(perMs(powerCapFor('putt', 1)) * 3).toBeLessThan(perMs(1))
  })

  test('taps round-trip on whichever scale the putt calls for', () => {
    for (const distance of [1, 5, 20]) {
      const cap = powerCapFor('putt', distance)
      for (const want of [0, 0.3, 0.7, 1]) {
        const power = want * cap
        const taps = pureTaps(power, cap)
        expect(powerFromTap(taps.powerTapMs, cap), `${distance}m`).toBeCloseTo(power, 9)
      }
    }
  })

  test('the same timing on two scales is two different putts', () => {
    // Which is why the scale must be derived from the shot and not taken
    // on trust from a run log.
    const a = powerFromTap(500, powerCapFor('putt', 1))
    const b = powerFromTap(500, powerCapFor('putt', 20))
    expect(Math.abs(a - b)).toBeGreaterThan(0.1)
  })
})
