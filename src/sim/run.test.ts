import { describe, expect, test } from 'vitest'
import { makeRng } from './rng'
import {
  advanceHole,
  applyShot,
  nextShotKind,
  scoreRun,
  startRun,
  summarise,
} from './run'
import type { LoggedShot, RunLog } from './run'
import { STROKE_CAP } from './constants'
import { taps } from './testing'
import { generateHole } from './holes'
import { powerCapFor } from './bar'
import { maxRange, puttPaceFor } from './range'

/**
 * A scripted player good enough to survive several holes, so the replay
 * tests actually exercise hole changes and birdies rather than one dead
 * first hole. It drives the same state machine the real game drives,
 * recording a log as it goes, exactly as the UI will.
 */
function playRun(seed: number, botSeed: number, maxShots = 80) {
  const state = startRun(seed)
  const rng = makeRng(botSeed)
  const shots: LoggedShot[] = []

  for (let i = 0; i < maxShots; i++) {
    if (state.status === 'run-over') break
    if (state.status === 'hole-complete') advanceHole(state)

    const kind = nextShotKind(state)
    const dx = state.hole.pin.x - state.ball.x
    const dz = state.hole.pin.z - state.ball.z
    const aim = Math.atan2(dx, -dz) + (rng() - 0.5) * 0.02

    let power: number
    if (kind === 'drive') {
      // Exactly what the HUD tells a player to do: fill the share of the
      // bar that the distance is of full power. If this stopped working,
      // the readout would be lying to them.
      const dist = Math.hypot(dx, dz)
      power = dist / maxRange(state.hole, 'drive') + (rng() - 0.5) * 0.04
      power = Math.min(Math.max(power, 0.05), 1)
    } else {
      // The same helper the game's own preview uses, rather than a second
      // copy of the pace maths that can fall out of step with it.
      power = puttPaceFor(Math.hypot(dx, dz)) + (rng() - 0.5) * 0.04
      power = Math.min(Math.max(power, 0.05), 1)
    }

    // Timed against the scale the game will pick for a putt of this
    // length: the same milliseconds mean different power on a different
    // ruler, and the bot has to strike on the one it aimed with.
    const error = (rng() - 0.5) * 0.3
    const t = taps(power, error, powerCapFor(kind, Math.hypot(dx, dz)))

    shots.push({ hole: state.holeNumber, aim, ...t })
    applyShot(state, aim, t.powerTapMs, t.impactTapMs)
  }

  const log: RunLog = { version: 7, seed, shots }
  return { state, log }
}

describe('replay agreement', () => {
  test('a replayed log scores exactly what was played', () => {
    for (const botSeed of [1, 2, 3, 7, 11, 99]) {
      const { state, log } = playRun(20260921, botSeed)
      const live = summarise(state)
      const replayed = scoreRun(log)

      expect(replayed.holesSurvived, `bot ${botSeed}`).toBe(live.holesSurvived)
      expect(replayed.birdies, `bot ${botSeed}`).toBe(live.birdies)
      expect(replayed.holes, `bot ${botSeed}`).toEqual(live.holes)
    }
  })

  test('replaying the same log twice gives the same score', () => {
    const { log } = playRun(555, 42)
    expect(scoreRun(log)).toEqual(scoreRun(log))
  })
})

describe('forged logs do not survive replay', () => {
  test('tampered tap timings produce the shots they actually describe', () => {
    const { log } = playRun(20260921, 7)
    // Struck the moment the bar turned: a maximum mishit, every time.
    const forged: RunLog = {
      ...log,
      shots: log.shots.map((s) => ({ ...s, impactTapMs: 0 })),
    }
    expect(scoreRun(forged).holesSurvived).toBe(0)
  })

  test('claiming holes you never reached changes nothing', () => {
    const { log } = playRun(20260921, 7)
    const honest = scoreRun(log)
    // Bolt on shots for holes far beyond where the run actually ended.
    const padded: RunLog = {
      ...log,
      shots: [
        ...log.shots,
        ...Array.from({ length: 30 }, (_, i) => ({
          hole: 50 + i,
          aim: 0,
          powerTapMs: 1290,
          impactTapMs: 1140,
        })),
      ],
    }
    expect(scoreRun(padded).holesSurvived).toBe(honest.holesSurvived)
  })

  test('the log carries no score to trust in the first place', () => {
    const { log } = playRun(1, 1)
    const keys = new Set(log.shots.flatMap((s) => Object.keys(s)))
    expect([...keys].sort()).toEqual(['aim', 'hole', 'impactTapMs', 'powerTapMs'])
  })
})

describe('starting partway through', () => {
  test('a run can begin at a later, harder hole', () => {
    const state = startRun(4242, 30)
    expect(state.holeNumber).toBe(30)
    expect(state.hole).toEqual(generateHole(4242, 30))
    expect(state.ball).toEqual(state.hole.tee)
  })

  test('it carries on from there', () => {
    const state = startRun(4242, 30)
    const t = taps(0.9, 0)
    applyShot(state, 0, t.powerTapMs, t.impactTapMs)
    expect(state.holeNumber).toBe(30)
  })

  test('a nonsense start is clamped to the first hole', () => {
    expect(startRun(1, 0).holeNumber).toBe(1)
    expect(startRun(1, -5).holeNumber).toBe(1)
    expect(startRun(1, 2.7).holeNumber).toBe(2)
  })
})

describe('par 3', () => {
  test('a one-shot hole is a par 3, as it is in golf', () => {
    for (let n = 1; n <= 5; n++) {
      expect(startRun(n).hole.par).toBe(3)
    }
  })

  test('survival matches the scorecard: par or better lives, worse ends it', () => {
    // Checked against real played holes rather than a contrived one, so it
    // covers aces, birdies and pars in the same sweep.
    for (const botSeed of [1, 2, 3, 7, 11, 99]) {
      for (const outcome of playRun(20260921, botSeed).state.holes) {
        expect(outcome.survived).toBe(outcome.holed && outcome.strokes <= outcome.par)
        expect(outcome.birdie).toBe(outcome.holed && outcome.strokes < outcome.par)
        expect(outcome.ace).toBe(outcome.holed && outcome.strokes === 1)
      }
    }
  })

  test('an ace counts as a birdie too, never the other way round', () => {
    for (const botSeed of [1, 5, 9, 13, 21]) {
      for (const outcome of playRun(20260921, botSeed).state.holes) {
        if (outcome.ace) expect(outcome.birdie).toBe(true)
      }
    }
  })
})

describe('run rules', () => {
  test('going over par ends the run', () => {
    const state = startRun(4)
    // Three feeble shots: each finds the water, each costs two strokes.
    for (let i = 0; i < 3 && state.status === 'awaiting-shot'; i++) {
      const t = taps(0.3, 0)
      applyShot(state, 0, t.powerTapMs, t.impactTapMs)
    }
    expect(state.status).toBe('run-over')
    expect(summarise(state).holesSurvived).toBe(0)
  })

  test('a hole is abandoned at the stroke cap', () => {
    const state = startRun(4)
    while (state.status === 'awaiting-shot') {
      const t = taps(0.3, 0)
      applyShot(state, 0, t.powerTapMs, t.impactTapMs)
    }
    const last = state.holes[state.holes.length - 1]
    expect(last?.strokes).toBeLessThanOrEqual(STROKE_CAP + 1)
    expect(last?.holed).toBe(false)
  })

  test('a drowned drive is replayed from the tee with a penalty', () => {
    const state = startRun(4)
    const t = taps(0.3, 0)
    applyShot(state, 0, t.powerTapMs, t.impactTapMs)
    expect(state.ball).toEqual(state.hole.tee)
    expect(state.strokes).toBe(2)
  })

  test('the scripted runs go deep enough to be worth replaying', () => {
    // Guards the replay tests above: if every bot died on hole 1 they would
    // never exercise a hole change, a birdie, or advanceHole at all.
    const depths = [1, 2, 3, 7, 11, 99].map(
      (b) => summarise(playRun(20260921, b).state).holesSurvived,
    )
    expect(Math.max(...depths), `bot depths were ${depths}`).toBeGreaterThan(1)
  })

  test('a shot cannot be played after the run is over', () => {
    const state = startRun(4)
    while (state.status === 'awaiting-shot') {
      const t = taps(0.3, 0)
      applyShot(state, 0, t.powerTapMs, t.impactTapMs)
    }
    expect(() => applyShot(state, 0, 1000, 900)).toThrow()
  })
})
