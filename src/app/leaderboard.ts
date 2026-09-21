import type { RunLog } from '../sim/run'
import { LOG_VERSION, scoreRun } from '../sim/run'

/**
 * The fake local leaderboard.
 *
 * It stores run logs and nothing else: no score is ever written down. Every
 * figure it displays is recomputed by replaying the log through the shot
 * module, which is precisely the job the Lambda will take over. Swapping
 * this for the real thing should mean changing where the log is sent, not
 * how it is scored.
 */

const KEY = 'ace-islands.runs.v1'

export interface StoredRun {
  id: string
  name: string
  log: RunLog
  at: number
}

export interface Entry {
  id: string
  name: string
  at: number
  holesSurvived: number
  birdies: number
  aces: number
}

function readAll(): StoredRun[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isStoredRun)
  } catch {
    // A corrupt or unavailable store should cost you the leaderboard, not
    // the game.
    return []
  }
}

function isStoredRun(v: unknown): v is StoredRun {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Partial<StoredRun>
  return (
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    typeof r.at === 'number' &&
    typeof r.log === 'object' &&
    r.log !== null &&
    // Logs from an older bar would replay into a different score, so they
    // are dropped rather than shown as something they are not.
    r.log.version === LOG_VERSION &&
    typeof r.log.seed === 'number' &&
    Array.isArray(r.log.shots)
  )
}

function write(runs: StoredRun[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(runs))
  } catch {
    // Private browsing, quota, or no storage at all. Not worth interrupting.
  }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`
}

export function saveRun(name: string, log: RunLog): void {
  const runs = readAll()
  runs.push({
    id: newId(),
    name: name.trim().slice(0, 16) || 'Anon',
    log,
    at: Date.now(),
  })
  // Keep the store from growing without bound.
  write(runs.slice(-200))
}

/**
 * Ranked by holes survived, birdies as the tiebreak, then whoever got there
 * first. Scores come from replaying each log, never from storage.
 */
export function leaderboard(limit = 8): Entry[] {
  return readAll()
    .map((run): Entry => {
      const score = scoreRun(run.log)
      return {
        id: run.id,
        name: run.name,
        at: run.at,
        holesSurvived: score.holesSurvived,
        birdies: score.birdies,
        aces: score.aces,
      }
    })
    .sort(
      (a, b) =>
        b.holesSurvived - a.holesSurvived ||
        b.birdies - a.birdies ||
        a.at - b.at,
    )
    .slice(0, limit)
}

export function clearRuns(): void {
  write([])
}
