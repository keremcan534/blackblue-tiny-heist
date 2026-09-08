/** Fixed simulation rate. The sim never uses wall-clock time directly. */
export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;

/** Ticks the thief takes to cross one tile (15 => 4 tiles/sec). */
export const TILE_TICKS = 15;

/** Continuous ticks inside a cone before the heist is blown (0.55s). */
export const ALERT_TICKS = 33;

/** Ticks of suspicion shed per tick once out of sight. */
export const ALERT_COOLDOWN = 1;

/** Default sensor tuning. */
export const GUARD_RANGE = 4.6;
export const GUARD_HALF_ANGLE = 30;
export const GUARD_STEP_TICKS = 24;
export const CAMERA_RANGE = 5.2;
export const CAMERA_HALF_ANGLE = 24;
export const CAMERA_SWEEP_TICKS = 72;
export const CAMERA_HOLD_TICKS = 24;
export const LASER_ON = 60;
export const LASER_OFF = 60;

/**
 * How much further a guard notices you while you are standing on a noise floor.
 *
 * Noise is a property of the TILE, not of guard behaviour - nobody investigates,
 * nobody leaves their patrol. A grating simply means "you are detectable from
 * further away here", which keeps every patrol as predictable as before.
 */
export const NOISE_RANGE_MULT = 1.75;

/** Solver horizon: no level may need more than this many ticks (60s). */
export const SOLVER_HORIZON_TICKS = 3600;

/**
 * Detection is evaluated on a sub-tile lattice: 4 => quarter-tile steps.
 *
 * The live sim snaps the thief to this same lattice before asking `detect()`, so
 * the offline threat table and the running game agree exactly rather than
 * approximately. At 4 subdivisions the snap is under 5px on a phone - invisible -
 * but it is what makes "this level is beatable" a proof instead of a hope.
 */
export const DANGER_SUBDIV = 4;

export const DEG = Math.PI / 180;
