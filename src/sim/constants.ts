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
/** Milliseconds for the marker to sweep the full bar, either direction. */
export const SWEEP_MS = 1500
/** Where the impact zone sits, as a fraction of the bar. */
export const IMPACT_POS = 0.1
/** Bar distance from the impact zone that counts as a full miss. */
export const IMPACT_TOLERANCE = 0.12
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
export const RESTITUTION = 0.36
/** Horizontal speed kept through a bounce. */
export const BOUNCE_FRICTION = 0.5
/** Below this upward speed the ball stops bouncing and starts rolling. */
export const ROLL_THRESHOLD = 0.9
/** Rolling deceleration on the green, m/s^2. */
export const ROLL_FRICTION = 4.2
/** Below this the ball is at rest. */
export const REST_SPEED = 0.06

// --- Putting ------------------------------------------------------------
export const PUTT_MIN_SPEED = 2
export const PUTT_MAX_SPEED = 14
/** Accuracy error swings the putt line by this many radians at full error. */
export const PUTT_SKEW = 0.1

// --- The cup ------------------------------------------------------------
/**
 * Above this speed the ball cannot be captured at all: the capture radius
 * shrinks to nothing, so a putt hit too hard lips out.
 */
export const CAPTURE_SPEED = 2.4
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
