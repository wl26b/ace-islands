import type { Hole, Vec3 } from './types'
import { STROKE_CAP, WATER_PENALTY } from './constants'
import { generateHole } from './holes'
import { simulateShot, surfaceAt } from './shot'
import type { ShotKind, ShotResult } from './shot'

/**
 * The run: an endless round of the same par-2, with new wind and a new pin
 * each time, that ends the moment you go over par.
 *
 * The live game and the leaderboard's replay both drive this same state
 * machine. That is the whole point — if the UI advanced the run by its own
 * logic, a replay could legitimately disagree with what the player saw, and
 * the swap to a server-side verifier would become a rewrite.
 */

export interface LoggedShot {
  hole: number
  /** Radians, as aimed. */
  aim: number
  powerTapMs: number
  impactTapMs: number
}

/**
 * Everything needed to recompute a run's score from scratch.
 *
 * The version is the shape *and the meaning* of the timings. Version 2
 * moved to a two-section bar, version 3 changed how putting power maps to
 * distance, and version 4 dropped the impact test from putting -- in each
 * case the same milliseconds describe a different shot. Version 5 gave
 * the putter scales, and version 6 made the game choose them, so the same
 * milliseconds again mean something else. An older log cannot simply be replayed under the current rules --
 * it has to be rejected rather than silently rescored into something that
 * never happened.
 */
export interface RunLog {
  version: 7
  seed: number
  shots: LoggedShot[]
}

/** The log format this build writes and can replay. */
export const LOG_VERSION = 7

export interface HoleOutcome {
  hole: number
  par: number
  strokes: number
  holed: boolean
  birdie: boolean
  /** Straight in from the tee. The moment the game is named for. */
  ace: boolean
  /** False when this hole ended the run. */
  survived: boolean
}

export type RunStatus = 'awaiting-shot' | 'hole-complete' | 'run-over'

export interface RunState {
  seed: number
  holeNumber: number
  hole: Hole
  ball: Vec3
  /** Where the current shot is played from, for replacing after a splash. */
  strokes: number
  status: RunStatus
  holes: HoleOutcome[]
}

export interface RunScore {
  holesSurvived: number
  birdies: number
  aces: number
  holes: HoleOutcome[]
  /** True once the run has actually ended rather than merely run out of log. */
  finished: boolean
}

/**
 * Begins a run. `firstHole` exists so a later, harder hole can be looked
 * at directly; a run started past hole 1 is practice and is not offered to
 * the leaderboard, so the log never has to carry it.
 */
export function startRun(seed: number, firstHole = 1): RunState {
  const holeNumber = Math.max(1, Math.floor(firstHole))
  const hole = generateHole(seed, holeNumber)
  return {
    seed,
    holeNumber,
    hole,
    ball: { ...hole.tee },
    strokes: 0,
    status: 'awaiting-shot',
    holes: [],
  }
}

/** A ball sitting on the green is putted; anything else is a full swing. */
export function nextShotKind(state: RunState): ShotKind {
  return surfaceAt(state.hole, state.ball.x, state.ball.z).kind === 'green'
    ? 'putt'
    : 'drive'
}

export interface ShotEvent {
  result: ShotResult
  kind: ShotKind
  /** Penalty strokes added on top of the shot itself. */
  penalty: number
  /** The hole's outcome, present only on the shot that finished it. */
  outcome?: HoleOutcome
}

/**
 * Plays one shot. Mutates and returns the state, alongside what happened —
 * the renderer needs the path, the HUD needs the penalty and the outcome.
 */
export function applyShot(
  state: RunState,
  aim: number,
  powerTapMs: number,
  impactTapMs: number,
): ShotEvent {
  if (state.status !== 'awaiting-shot') {
    throw new Error(`cannot play a shot while status is ${state.status}`)
  }

  const kind = nextShotKind(state)
  const from: Vec3 = { ...state.ball }
  const result = simulateShot(state.hole, {
    kind,
    from,
    aim,
    powerTapMs,
    impactTapMs,
  })

  state.strokes += 1
  let penalty = 0

  if (result.outcome === 'water') {
    penalty = WATER_PENALTY
    state.strokes += penalty
    // A drowned drive goes back to the tee; a putt that trickles off the
    // green is replaced where it was struck from.
    state.ball = kind === 'drive' ? { ...state.hole.tee } : from
  } else {
    state.ball = { ...result.end }
  }

  const holed = result.outcome === 'holed'
  const finished = holed || state.strokes >= STROKE_CAP
  if (!finished) return { result, kind, penalty }

  const par = state.hole.par
  const survived = holed && state.strokes <= par
  const outcome: HoleOutcome = {
    hole: state.holeNumber,
    par,
    strokes: state.strokes,
    holed,
    birdie: holed && state.strokes < par,
    ace: holed && state.strokes === 1,
    survived,
  }
  state.holes.push(outcome)
  state.status = survived ? 'hole-complete' : 'run-over'

  return { result, kind, penalty, outcome }
}

/** Moves on to the next hole after one is survived. */
export function advanceHole(state: RunState): RunState {
  if (state.status !== 'hole-complete') {
    throw new Error(`cannot advance while status is ${state.status}`)
  }
  state.holeNumber += 1
  state.hole = generateHole(state.seed, state.holeNumber)
  state.ball = { ...state.hole.tee }
  state.strokes = 0
  state.status = 'awaiting-shot'
  return state
}

export function summarise(state: RunState): RunScore {
  return {
    holesSurvived: state.holes.filter((h) => h.survived).length,
    birdies: state.holes.filter((h) => h.birdie).length,
    aces: state.holes.filter((h) => h.ace).length,
    holes: state.holes,
    finished: state.status === 'run-over',
  }
}

/**
 * Recomputes a run's score from its log, by replaying every shot through
 * the same simulation the player saw. This is what the leaderboard trusts,
 * and it is the exact job the Lambda will take over: same function, same
 * input, run somewhere the player cannot reach.
 */
export function scoreRun(log: RunLog): RunScore {
  const state = startRun(log.seed)

  for (const shot of log.shots) {
    if (state.status === 'run-over') break
    if (state.status === 'hole-complete') advanceHole(state)
    // A log that claims a shot on the wrong hole is malformed, not clever.
    if (shot.hole !== state.holeNumber) break
    applyShot(state, shot.aim, shot.powerTapMs, shot.impactTapMs)
  }

  return summarise(state)
}
