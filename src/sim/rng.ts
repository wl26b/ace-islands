/**
 * Seeded randomness. Every gameplay value that varies per hole comes from
 * here, never from Math.random(), so the server can regenerate the exact
 * hole a player faced from the run's seed alone.
 */

/** mulberry32: small, fast, and identical in every JS engine. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Derives an independent stream per hole, so hole 7 of a run is the same
 * whether you reached it by playing or by replaying the log.
 */
export function streamFor(seed: number, holeNumber: number): () => number {
  return makeRng((Math.imul(seed >>> 0, 0x9e3779b1) ^ Math.imul(holeNumber, 0x85ebca6b)) >>> 0)
}

/** Uniform in [min, max). */
export function range(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min)
}
