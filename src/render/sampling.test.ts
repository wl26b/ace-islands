import { describe, expect, test } from 'vitest'
import { evenlySpaced } from './sampling'
import { simulateShot } from '../sim/shot'
import { HOLE_ONE } from '../sim/holes'
import { pureTaps } from '../sim/bar'
import type { Vec3 } from '../sim/types'

const gap = (a: Vec3, b: Vec3) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)

describe('evenly spaced path markers', () => {
  test('a straight line is divided into equal steps', () => {
    const line: Vec3[] = Array.from({ length: 9 }, (_, i) => ({ x: i, y: 0, z: 0 }))
    const points = evenlySpaced(line, 3)
    expect(points.map((p) => p.x)).toEqual([2, 4, 6])
  })

  test('a real flight is spaced by distance, not by time', () => {
    // The path arrives evenly spaced in time, which bunches markers at the
    // top of the arc where the ball is slowest. This is the fix.
    const flight = simulateShot(
      { ...HOLE_ONE, wind: { speed: 0, direction: 0 } },
      { kind: 'drive', from: HOLE_ONE.tee, aim: 0, ...pureTaps(0.9) },
    ).path

    const points = evenlySpaced(flight, 24)
    expect(points).toHaveLength(24)

    const gaps = points.slice(1).map((p, i) => gap(points[i] as Vec3, p))
    const smallest = Math.min(...gaps)
    const largest = Math.max(...gaps)
    expect(largest / smallest).toBeLessThan(1.25)

    // Compare against the naive version, which is visibly lumpy.
    const naive = Array.from({ length: 24 }, (_, i) =>
      flight[Math.round(((i + 1) / 25) * (flight.length - 1))] as Vec3,
    )
    const naiveGaps = naive.slice(1).map((p, i) => gap(naive[i] as Vec3, p))
    expect(Math.max(...naiveGaps) / Math.min(...naiveGaps)).toBeGreaterThan(1.25)
  })

  test('degenerate paths give nothing rather than throwing', () => {
    expect(evenlySpaced([], 5)).toEqual([])
    expect(evenlySpaced([{ x: 0, y: 0, z: 0 }], 5)).toEqual([])
    expect(evenlySpaced([{ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3 }], 5)).toEqual([])
    expect(evenlySpaced([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], 0)).toEqual([])
  })
})
