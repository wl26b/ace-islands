import { describe, expect, test } from 'vitest'
import { describeImpact } from './verdict'
import { accuracyFromTaps, impactErrorMs, pureTaps } from '../sim/bar'

describe('the impact verdict', () => {
  const read = (power: number, impactTapMs: number) =>
    describeImpact(
      impactErrorMs(power, impactTapMs),
      accuracyFromTaps(power, impactTapMs),
    )

  test('a dead centre strike reads as pure', () => {
    for (const power of [0.3, 0.6, 0.9]) {
      const v = read(power, pureTaps(power).impactTapMs)
      expect(v.tone).toBe('pure')
      expect(v.headline).toContain('Pure')
    }
  })

  test('it names the side the ball will actually bend', () => {
    // The wording has to match the simulation, or it teaches the wrong fix.
    const power = 0.8
    const pure = pureTaps(power).impactTapMs
    const early = read(power, pure - 120)
    const late = read(power, pure + 120)
    expect(early.headline).toContain('Early')
    expect(early.headline).toContain('right')
    expect(accuracyFromTaps(power, pure - 120)).toBeGreaterThan(0)
    expect(late.headline).toContain('Late')
    expect(late.headline).toContain('left')
    expect(accuracyFromTaps(power, pure + 120)).toBeLessThan(0)
  })

  test('it says early or late without a stopwatch reading', () => {
    // The held marker already shows how far out the tap was; a millisecond
    // count on top of it is noise.
    const power = 0.8
    const pure = pureTaps(power).impactTapMs
    // 40ms out is a gentle miss; 150ms is a proper one.
    expect(read(power, pure - 40).headline).toBe('Early · fades right')
    expect(read(power, pure + 40).headline).toBe('Late · draws left')
    expect(read(power, pure - 150).headline).toBe('Early · slices right')
    expect(read(power, pure + 150).headline).toBe('Late · hooks left')
    expect(read(power, pure - 40).headline).not.toMatch(/\d/)
  })

  test('a near miss is not dressed up as a disaster', () => {
    const power = 0.8
    const pure = pureTaps(power).impactTapMs
    expect(read(power, pure - 30).tone).toBe('near')
    expect(read(power, pure - 30).headline).toContain('fades')
    expect(read(power, pure - 260).tone).toBe('miss')
    expect(read(power, pure - 260).headline).toContain('slices')
  })
})
