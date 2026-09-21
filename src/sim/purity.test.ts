import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Rule 1, enforced rather than merely documented.
 *
 * Everything in src/sim has to run unchanged inside a Lambda replaying a
 * submitted run. A stray three.js import or Math.random() call would not
 * fail the build — it would quietly make replays disagree with what the
 * player saw, which is the one bug this whole design exists to prevent.
 */

const BANNED: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\bfrom\s+['"]three['"]/, why: 'three.js does not exist in Node' },
  { pattern: /\bMath\.random\b/, why: 'randomness must come from the seed' },
  { pattern: /\bDate\.now\b/, why: 'the simulation may not read the clock' },
  { pattern: /\bperformance\.now\b/, why: 'the simulation may not read the clock' },
  { pattern: /\bnew Date\b/, why: 'the simulation may not read the clock' },
  { pattern: /\bdocument\./, why: 'there is no DOM in Node' },
  { pattern: /\bwindow\./, why: 'there is no window in Node' },
  { pattern: /\brequestAnimationFrame\b/, why: 'frame timing must not reach the sim' },
]

const files = readdirSync('src/sim')
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))

describe('src/sim stays pure', () => {
  test('there are files to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    test(`${file} has no browser or nondeterministic dependencies`, () => {
      const source = readFileSync(join('src/sim', file), 'utf8')
      for (const { pattern, why } of BANNED) {
        // Comments explaining the rule are allowed to name the thing.
        const code = source
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '')
        expect(pattern.test(code), `${file} uses ${pattern.source}: ${why}`).toBe(false)
      }
    })
  }
})
