/**
 * Every tuning number in one place. Changing these changes how shots play
 * out, so they are part of the simulation contract: the client and the
 * Lambda must share this file verbatim or replays will disagree.
 */

/** Fixed simulation timestep. Never use frame deltas. */
export const DT = 1 / 120
/** Give up after 30 simulated seconds rather than loop forever. */
export const MAX_STEPS = 30 * 120
/** Path samples are emitted every other step, i.e. at 60Hz. */
export const PATH_STRIDE = 2

export const GRAVITY = 9.81

// --- The shot bar -------------------------------------------------------
/** Milliseconds for the marker to cross the whole bar at its steady speed. */
export const SWEEP_MS = 1500
/**
 * Where the power section begins. Left of this is the accuracy section,
 * which the marker only enters on the way back: the two halves of the shot
 * are set on their own stretches of bar rather than sharing one.
 */
export const POWER_START = 0.28
/**
 * The putter's scales, in metres, as a golf game gives a putter several
 * rulers to choose from. A 1m putt on a 23m scale lives in the first few
 * percent of the bar, which is unreadable; picking a shorter scale spreads
 * that same putt across the whole of it.
 *
 * The last entry is the putter's full range, whatever that happens to be.
 */
export const PUTT_SCALES: readonly number[] = [3, 6, 12, Infinity]

/** Where the impact zone sits, as a fraction of the bar. */
export const IMPACT_POS = 0.12
/** Bar distance from the impact zone that counts as a full miss. */
export const IMPACT_TOLERANCE = 0.1
/** Inside this, the strike is pure. */
export const PERFECT_TOLERANCE = 0.012

// --- The carry ----------------------------------------------------------
export const DRIVE_MIN_SPEED = 10
export const DRIVE_MAX_SPEED = 34
/** Launch angle in radians (~33 degrees). */
export const DRIVE_LOFT = 0.576
/** Air-relative drag. Wind acts through this, so the two are tuned together. */
export const DRAG = 0.0042
/** Sideways acceleration per unit of accuracy error, i.e. hook and slice. */
export const CURVE = 0.12
/** Accuracy error also nudges the launch line a little. */
export const LAUNCH_SKEW = 0.022
/** And the launch angle, which is the "up or down" half of a mishit. */
export const LOFT_SKEW = 0.05
/** A mishit loses this fraction of its speed at full error. */
export const MISHIT_SPEED_LOSS = 0.07

// --- Ground -------------------------------------------------------------
export const RESTITUTION = 0.2
/** Horizontal speed kept through a bounce. */
export const BOUNCE_FRICTION = 0.3
/** Below this upward speed the ball stops bouncing and starts rolling. */
export const ROLL_THRESHOLD = 0.9
/**
 * Rolling deceleration for a ball running out after a drive, m/s^2. High,
 * so the ball stops near where it pitched: your handover asks for a short
 * bounce and roll, and a long run-out makes the landing spot meaningless
 * and the distance readout misleading.
 */
export const ROLL_FRICTION = 6.5
/**
 * Deceleration of a putt, m/s^2. Far lower than the ground an approach
 * bounces across, because a putting surface is mown smooth -- a real green
 * takes about 0.55 from a ball, and anything near the old 4.2 rolls like
 * carpet rather than grass.
 *
 * It is tied to how steep the greens are: a ball only comes to rest where
 * friction beats gravity down the slope, which is why real greens are
 * rarely steeper than about 6%. Lowering this means gentler contours, and
 * since break works out as gravity x gradient x distance / friction, the
 * two changes cancel: the same putt breaks the same amount, and takes far
 * longer doing it.
 */
export const PUTT_FRICTION = 1.6

/**
 * The steepest a green may get, as rise per metre.
 *
 * Hard limit rather than a tuning number: a ball only comes to rest where
 * friction beats gravity down the slope, which here is 16%. Anything near
 * that and a ball never settles, so contours are scaled to fit under this
 * however severe the hole is meant to be.
 */
export const MAX_GREEN_GRADIENT = 0.125
/** Below this the ball is at rest. */
export const REST_SPEED = 0.06

// --- Putting ------------------------------------------------------------
export const PUTT_MIN_SPEED = 1.25
export const PUTT_MAX_SPEED = 8.6

// --- The cup ------------------------------------------------------------
/**
 * How far a ball may still have left to run and be held by the cup. A
 * ball that would finish more than this past the hole cannot be captured,
 * however it crosses, so a putt struck too hard lips out.
 *
 * Expressed as a distance rather than a speed so it means the same thing
 * on a smooth green and on the coarser ground a drive runs out across.
 */
export const CAPTURE_RUNOUT = 0.55
/**
 * A ball that crosses the cup too fast to be held still catches the lip:
 * it drops into the edge, curls, and is thrown back out. Peak turn, in
 * radians, for a pass half way between the centre and the rim.
 */
export const LIP_TURN = 0.45
/** Fraction of speed the lip takes from a dead-centre pass. */
export const LIP_DRAG = 0.4

// --- Scoring ------------------------------------------------------------
/** A hole is abandoned at this many strokes so a disaster cannot drag on. */
export const STROKE_CAP = 5
/** Strokes added for finding the water. */
export const WATER_PENALTY = 1
