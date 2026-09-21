/** Chunky pastel palette. Kept in one place so the look stays coherent. */
export const PALETTE = {
  sky: 0xbfe6f2,
  fog: 0xcfeaf3,

  // Water, shallow to deep. The shallows ring the islands.
  waterShallow: 0x74cfdb,
  water: 0x45b0c6,
  waterDeep: 0x2a7f9c,
  foam: 0xf2fbfd,

  // The mown surfaces, lightest at the hole and coarser further out.
  puttingGreen: 0xa8dd82,
  puttingStripe: 0x9ad273,
  fairway: 0x8ccb66,
  fairwayStripe: 0x7ec05a,
  rough: 0x6dab52,
  roughDark: 0x5f9a48,

  // Shoreline and the cliffs beneath.
  sand: 0xeadfb0,
  sandDark: 0xd8c994,
  rock: 0xa9855f,
  rockDark: 0x86653f,

  flagPole: 0xf5f5f0,
  flagCloth: 0xf2604f,
  ball: 0xfffdf7,
  cup: 0x1d2b1b,
} as const

/**
 * Still exaggerated for visibility -- a real ball would be a speck at this
 * camera distance -- but kept in proportion to the cup, which a ball
 * filling two thirds of the hole was not.
 */
export const BALL_RADIUS = 0.16
