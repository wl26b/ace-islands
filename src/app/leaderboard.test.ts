// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from 'vitest'
import { clearRuns, leaderboard, saveRun } from './leaderboard'
import { scoreRun } from '../sim/run'
import type { RunLog } from '../sim/run'
import { taps } from '../sim/testing'

function logFor(seed: number, powers: number[]): RunLog {
  return {
    version: 1,
    seed,
    shots: powers.map((p) => ({ hole: 1, aim: 0, ...taps(p, 0) })),
  }
}

describe('the local leaderboard', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  test('a saved run scores exactly what replaying its log gives', () => {
    const log = logFor(20260921, [0.86, 0.5, 0.4])
    saveRun('Wailu', log)
    const entry = leaderboard()[0]
    const replayed = scoreRun(log)
    expect(entry?.holesSurvived).toBe(replayed.holesSurvived)
    expect(entry?.birdies).toBe(replayed.birdies)
  })

  test('no score is written to storage, only the log', () => {
    saveRun('Wailu', logFor(1, [0.86, 0.5]))
    const raw = localStorage.getItem('ace-islands.runs.v1') ?? ''
    expect(raw).not.toMatch(/holesSurvived|birdies|score/)
    expect(raw).toMatch(/powerTapMs/)
  })

  test('a tampered store cannot inflate a score', () => {
    saveRun('Wailu', logFor(20260921, [0.86, 0.5, 0.4]))
    const honest = leaderboard()[0]?.holesSurvived ?? -1

    // Someone edits localStorage to claim a huge score. There is nowhere to
    // put it: the number is recomputed from the log every time it is shown.
    const runs = JSON.parse(localStorage.getItem('ace-islands.runs.v1') ?? '[]')
    runs[0].holesSurvived = 999
    runs[0].birdies = 999
    localStorage.setItem('ace-islands.runs.v1', JSON.stringify(runs))

    expect(leaderboard()[0]?.holesSurvived).toBe(honest)
    expect(leaderboard()[0]?.birdies).not.toBe(999)
  })

  test('ranking is by holes survived, then birdies', () => {
    // Distinct seeds so the runs differ; ordering is asserted on the
    // computed figures rather than on which seed happens to do better.
    for (const seed of [11, 22, 33, 44]) {
      saveRun(`P${seed}`, logFor(seed, [0.86, 0.55, 0.5, 0.5]))
    }
    const rows = leaderboard()
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]
      const cur = rows[i]
      if (!prev || !cur) continue
      expect(
        prev.holesSurvived > cur.holesSurvived ||
          (prev.holesSurvived === cur.holesSurvived && prev.birdies >= cur.birdies),
      ).toBe(true)
    }
  })

  test('a corrupt store degrades to an empty board, not a crash', () => {
    localStorage.setItem('ace-islands.runs.v1', '{not json')
    expect(leaderboard()).toEqual([])
    localStorage.setItem('ace-islands.runs.v1', '[{"junk":true}]')
    expect(leaderboard()).toEqual([])
  })

  test('clearing empties the board', () => {
    saveRun('Wailu', logFor(1, [0.86]))
    clearRuns()
    expect(leaderboard()).toEqual([])
  })
})
