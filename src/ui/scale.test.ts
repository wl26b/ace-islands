import { describe, expect, test } from 'vitest'
import { distanceTicks, niceStep } from './scale'

describe('the distance scale', () => {
  test('steps land on round numbers', () => {
    expect(niceStep(17.6)).toBe(20)
    expect(niceStep(4.6)).toBe(5)
    expect(niceStep(2.2)).toBe(2.5)
    expect(niceStep(0.9)).toBe(1)
    expect(niceStep(73)).toBe(100)
  })

  test('a drive gets a handful of readable marks', () => {
    expect(distanceTicks(88)).toEqual([20, 40, 60, 80])
    // 25s are just as round as 20s, and fit this range better.
    expect(distanceTicks(102)).toEqual([25, 50, 75])
  })

  test('a putt gets its own, much finer scale', () => {
    // The same bar serves a 90m drive and a 20m putt, so the scale has to
    // come from the shot rather than being fixed.
    expect(distanceTicks(23.3)).toEqual([5, 10, 15, 20])
    expect(distanceTicks(8)).toEqual([2, 4, 6])
  })

  test('marks stay inside the bar and never crowd the end', () => {
    for (const max of [6, 12, 23.3, 47, 88, 104]) {
      const ticks = distanceTicks(max)
      // A short putt bar wants fewer marks, not more.
      expect(ticks.length).toBeGreaterThanOrEqual(2)
      expect(ticks.length).toBeLessThanOrEqual(6)
      expect(Math.max(...ticks)).toBeLessThan(max)
      expect(Math.min(...ticks)).toBeGreaterThan(0)
    }
  })

  test('nonsense gives no scale rather than an infinite loop', () => {
    expect(distanceTicks(0)).toEqual([])
    expect(distanceTicks(-5)).toEqual([])
    expect(distanceTicks(NaN)).toEqual([])
  })
})
