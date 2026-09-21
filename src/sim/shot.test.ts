import { describe, expect, test } from 'vitest'
import { HOLE_ONE, generateHole } from './holes'
import { simulateShot, surfaceAt } from './shot'
import { aimDirection, aimTowards } from './aim'
import { maxRange } from './range'
import { pureTaps, taps } from './testing'
import type { Hole } from './types'

const calm: Hole = { ...HOLE_ONE, wind: { speed: 0, direction: 0 } }
const tee = HOLE_ONE.tee

function drive(hole: Hole, power: number, error = 0, aim = 0) {
  return simulateShot(hole, { kind: 'drive', from: tee, aim, ...taps(power, error) })
}

describe('determinism', () => {
  test('identical inputs give byte-identical results', () => {
    const a = drive(HOLE_ONE, 0.86, 0.3)
    const b = drive(HOLE_ONE, 0.86, 0.3)
    expect(b.end).toEqual(a.end)
    expect(b.path.length).toBe(a.path.length)
    expect(b.path).toEqual(a.path)
  })

  test('a hole regenerates identically from its seed', () => {
    expect(generateHole(4242, 7)).toEqual(generateHole(4242, 7))
    expect(generateHole(4242, 7)).not.toEqual(generateHole(4242, 8))
    expect(generateHole(4242, 7)).not.toEqual(generateHole(9999, 7))
  })
})

describe('the carry', () => {
  test('a weak shot falls in the water short of the green', () => {
    const r = drive(calm, 0.4)
    expect(r.outcome).toBe('water')
    // Short of the green's near edge, so it never had a chance to land.
    const nearEdge = Math.abs(calm.greenIsland.centre.z) - calm.greenIsland.radius
    expect(r.carry).toBeLessThan(nearEdge)
  })

  test('a well struck shot finds the green', () => {
    const r = drive(calm, 0.86)
    expect(r.outcome).toBe('rest')
    expect(r.surface).toBe('green')
    expect(r.toPin).toBeLessThan(6)
  })

  test('islands have sides: arriving under the lip is a splash', () => {
    // Just short of clearing the edge, the ball must hit the cliff rather
    // than being snapped up onto the surface.
    const r = drive(calm, 0.76)
    expect(r.outcome).toBe('water')
  })

  test('too much power runs the ball to the back of the green', () => {
    const long = drive(calm, 1)
    const good = drive(calm, 0.86)
    expect(long.toPin).toBeGreaterThan(good.toPin)
  })
})

describe('accuracy', () => {
  test('a late strike draws left, an early one leaks right', () => {
    expect(drive(calm, 0.86, -0.5).end.x).toBeLessThan(0)
    expect(drive(calm, 0.86, 0.5).end.x).toBeGreaterThan(0)
  })

  test('the error scales: a bigger miss goes further offline', () => {
    const small = Math.abs(drive(calm, 0.86, 0.25).end.x)
    const big = Math.abs(drive(calm, 0.86, 0.75).end.x)
    expect(big).toBeGreaterThan(small)
  })

  test('a pure strike is flagged and flies straight', () => {
    const r = drive(calm, 0.86, 0)
    expect(r.pure).toBe(true)
    expect(Math.abs(r.end.x)).toBeLessThan(0.5)
  })

  test('a miss is not flagged pure', () => {
    expect(drive(calm, 0.86, 0.4).pure).toBe(false)
  })
})

describe('wind', () => {
  test('a tailwind carries further than calm, a headwind less', () => {
    const tail: Hole = { ...calm, wind: { speed: 6, direction: 0 } }
    const head: Hole = { ...calm, wind: { speed: 6, direction: Math.PI } }
    expect(drive(tail, 0.86).carry).toBeGreaterThan(drive(calm, 0.86).carry)
    expect(drive(head, 0.86).carry).toBeLessThan(drive(calm, 0.86).carry)
  })

  test('a crosswind pushes the ball sideways', () => {
    const cross: Hole = { ...calm, wind: { speed: 6, direction: Math.PI / 2 } }
    expect(drive(cross, 0.86).end.x).toBeGreaterThan(1)
  })
})

describe('the cup', () => {
  const from = {
    x: HOLE_ONE.pin.x,
    y: HOLE_ONE.greenIsland.surfaceY,
    z: HOLE_ONE.pin.z + 10,
  }
  const putt = (power: number, error = 0) =>
    simulateShot(calm, { kind: 'putt', from, aim: 0, ...taps(power, error) })

  test('some pace on a 10m putt drops it', () => {
    // Scanned rather than hardcoded: the exact power depends on rolling
    // friction, which is a tuning number, but *some* pace must work.
    const holing = []
    for (let p = 0.3; p <= 0.9; p += 0.01) {
      if (putt(p).outcome === 'holed') holing.push(p)
    }
    expect(holing.length, 'no power holed a straight 10m putt').toBeGreaterThan(0)
  })

  test('a putt straight over the cup but far too hard lips out', () => {
    // Dead on line, so the distance to the cup centre is zero: only the
    // speed-dependent capture radius can keep this out.
    const r = putt(1)
    expect(r.outcome).not.toBe('holed')
  })

  test('a putt pushed offline misses', () => {
    expect(putt(0.55, 1).outcome).not.toBe('holed')
  })

  test('a putt left short stays short', () => {
    const r = putt(0.2)
    expect(r.outcome).toBe('rest')
    expect(r.toPin).toBeGreaterThan(1)
  })
})

describe('the lip', () => {
  const dist = 6
  const from = {
    x: HOLE_ONE.pin.x,
    y: HOLE_ONE.greenIsland.surfaceY,
    z: HOLE_ONE.pin.z + dist,
  }
  /** The same hole with the cup moved out of reach, as a control. */
  const noCup: Hole = { ...calm, pin: { x: 0, z: -1e6 } }

  const roll = (hole: Hole, power: number, offset: number) =>
    simulateShot(hole, {
      kind: 'putt',
      from,
      aim: Math.atan2(offset, dist),
      ...taps(power, 0),
    })

  test('a ball crossing the cup too fast is thrown off its line', () => {
    const lipped = roll(calm, 0.7, 0.3)
    const control = roll(noCup, 0.7, 0.3)
    expect(lipped.outcome).not.toBe('holed')
    // It must not sail over as though the cup were painted on.
    expect(Math.abs(lipped.end.x - control.end.x)).toBeGreaterThan(0.4)
  })

  test('the lip pulls the ball towards the hole', () => {
    // It drops into the near edge and curls, rather than being batted away:
    // a ball passing to the right of the cup is turned back leftwards.
    const passedRight = roll(calm, 0.7, 0.3).end.x - roll(noCup, 0.7, 0.3).end.x
    const passedLeft = roll(calm, 0.7, -0.3).end.x - roll(noCup, 0.7, -0.3).end.x
    expect(passedRight).toBeLessThan(0)
    expect(passedLeft).toBeGreaterThan(0)
  })

  test('a dead centre pass is slowed but not turned', () => {
    const lipped = roll(calm, 0.7, 0)
    const control = roll(noCup, 0.7, 0)
    expect(Math.abs(lipped.end.x - control.end.x)).toBeLessThan(0.01)
    const travelled = Math.hypot(lipped.end.x - from.x, lipped.end.z - from.z)
    const clean = Math.hypot(control.end.x - from.x, control.end.z - from.z)
    expect(travelled).toBeLessThan(clean)
  })

  test('the quicker it crosses, the less the lip turns it', () => {
    // A ball spends less time over the hole the faster it goes, so the
    // deflection has to shrink with speed rather than stay constant.
    //
    // Measured as an angle. Comparing sideways displacement at rest would
    // be meaningless: a faster ball rolls much further after the cup, so a
    // smaller turn still ends up further off line.
    const turnAngle = (power: number): number => {
      const lipped = roll(calm, power, 0.2)
      const control = roll(noCup, power, 0.2)
      const sideways = Math.abs(lipped.end.x - control.end.x)
      const afterCup = Math.hypot(
        lipped.end.x - calm.pin.x,
        lipped.end.z - calm.pin.z,
      )
      return sideways / Math.max(afterCup, 0.01)
    }
    expect(turnAngle(1)).toBeLessThan(turnAngle(0.55))
  })

  test('a putt that misses the cup entirely is untouched', () => {
    const wide = roll(calm, 0.7, 1.5)
    const control = roll(noCup, 0.7, 1.5)
    expect(wide.end.x).toBeCloseTo(control.end.x, 9)
    expect(wide.end.z).toBeCloseTo(control.end.z, 9)
  })

  test('catching the lip can still drop a marginally fast putt', () => {
    // Slowing on the lip and falling in is real, and it is what makes a
    // long putt a skill rather than a coin flip.
    let holed = 0
    for (let p = 0.3; p <= 0.7; p += 0.002) {
      if (roll(calm, p, 0).outcome === 'holed') holed++
    }
    expect(holed).toBeGreaterThan(0)
  })

  test('a lipped putt is still perfectly deterministic', () => {
    const a = roll(calm, 0.7, 0.3)
    const b = roll(calm, 0.7, 0.3)
    expect(b.end).toEqual(a.end)
    expect(b.path).toEqual(a.path)
  })
})

describe('surfaces', () => {
  test('the tee and green read as land, the gap as water', () => {
    expect(surfaceAt(HOLE_ONE, 0, 0).kind).toBe('tee')
    expect(surfaceAt(HOLE_ONE, HOLE_ONE.pin.x, HOLE_ONE.pin.z).kind).toBe('green')
    expect(surfaceAt(HOLE_ONE, 0, -40).kind).toBe('water')
  })
})

describe('generated holes stay playable', () => {
/**
 * Can a competent player reach this green? Aims at the pin, as the game
 * does by default, and allows some adjustment into the wind, because a
 * shot fired straight down the hole is not what anyone actually plays.
 */
function reachable(hole: Hole): boolean {
  const base = aimTowards(hole.pin.x - hole.tee.x, hole.pin.z - hole.tee.z)
  for (const nudge of [-0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2]) {
    for (let p = 0.3; p <= 1.001; p += 0.02) {
      const r = simulateShot(hole, {
        kind: 'drive',
        from: hole.tee,
        aim: base + nudge,
        ...pureTaps(p),
      })
      if (r.surface === 'green') return true
    }
  }
  return false
}

  test('every hole in a long run can be reached', () => {
    for (let n = 1; n <= 40; n++) {
      expect(reachable(generateHole(1234, n)), `hole ${n} unreachable`).toBe(true)
    }
  })

  test('holes ask for a wide spread of the bar', () => {
    // The point of varying the distance: if every hole needed the same
    // fill, the power bar would be a formality.
    const fills = Array.from({ length: 40 }, (_, i) => {
      const hole = generateHole(1234, i + 1)
      const dist = Math.hypot(hole.pin.x - hole.tee.x, hole.pin.z - hole.tee.z)
      return dist / maxRange(hole, 'drive')
    })
    expect(Math.min(...fills)).toBeLessThan(0.65)
    expect(Math.max(...fills)).toBeGreaterThan(0.9)
  })
})

describe('the aim convention', () => {
  test('aiming toward a point sends the ball toward it', () => {
    for (const [dx, dz] of [
      [0, -50],
      [20, -50],
      [-30, -40],
      [5, -90],
    ] as const) {
      const angle = aimTowards(dx, dz)
      const dir = aimDirection(angle)
      const len = Math.hypot(dx, dz)
      expect(dir.x).toBeCloseTo(dx / len, 10)
      expect(dir.z).toBeCloseTo(dz / len, 10)
    }
  })

  test('positive aim goes right, negative goes left', () => {
    expect(aimDirection(0.3).x).toBeGreaterThan(0)
    expect(aimDirection(-0.3).x).toBeLessThan(0)
    expect(drive(calm, 0.86, 0, 0.12).end.x).toBeGreaterThan(
      drive(calm, 0.86, 0, -0.12).end.x,
    )
  })
})
