/**
 * Choosing the distance marks along the power bar.
 *
 * The bar is calibrated in metres rather than in percent, so the player
 * reads "the pin is at 48m, and 48 sits about there" instead of dividing
 * one HUD number by another. The steps have to land on round numbers, or
 * the scale is harder to read than no scale at all.
 */

/** A round step close to the asked-for size: 1, 2, 2.5, 5 or 10 per decade. */
export function niceStep(rough: number): number {
  if (!Number.isFinite(rough) || rough <= 0) return 1
  const decade = Math.pow(10, Math.floor(Math.log10(rough)))
  const scaled = rough / decade
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10
  return step * decade
}

/**
 * Distances to mark on a bar that reaches `max`. The far end is left
 * unlabelled: it is the end of the bar, which speaks for itself, and a
 * label there would collide with the edge.
 */
export function distanceTicks(max: number): number[] {
  if (!Number.isFinite(max) || max <= 0) return []
  const step = niceStep(max / 5)
  const ticks: number[] = []
  for (let d = step; d < max - step * 0.35; d += step) ticks.push(d)
  return ticks
}
