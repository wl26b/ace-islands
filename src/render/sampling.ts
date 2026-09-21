import type { Vec3 } from '../sim/types'

/**
 * Picks evenly spaced points along a path.
 *
 * The simulation emits its path at a fixed 60Hz, so its samples are evenly
 * spaced in *time*, not in space: they bunch up where the ball is slow, at
 * the top of a flight, and stretch out where it is quick. Drawing markers
 * straight from those samples looks lumpy, so they are re-spaced by
 * distance travelled instead.
 */
export function evenlySpaced(path: Vec3[], count: number): Vec3[] {
  if (count <= 0 || path.length < 2) return []

  const cumulative: number[] = [0]
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    if (!a || !b) return []
    cumulative.push(
      (cumulative[i - 1] ?? 0) + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z),
    )
  }

  const total = cumulative[cumulative.length - 1] ?? 0
  if (total <= 0) return []

  const out: Vec3[] = []
  let cursor = 1
  for (let k = 1; k <= count; k++) {
    const target = (k / (count + 1)) * total
    while (cursor < cumulative.length - 1 && (cumulative[cursor] ?? 0) < target) {
      cursor++
    }
    const a = path[cursor - 1]
    const b = path[cursor]
    const before = cumulative[cursor - 1] ?? 0
    const after = cumulative[cursor] ?? 0
    if (!a || !b) continue
    const span = after - before
    const t = span > 0 ? (target - before) / span : 0
    out.push({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    })
  }
  return out
}
