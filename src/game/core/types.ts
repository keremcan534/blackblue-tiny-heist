/**
 * Tiny Heist - core data types.
 *
 * Everything in `core/` is pure TypeScript with zero Phaser / DOM dependencies so
 * that the exact same simulation can run inside the game AND inside the offline
 * level validator (`tools/validate.ts`). If the two ever disagreed, levels could
 * ship unsolvable - so they share one code path by construction.
 */

/** A tile coordinate pair. */
export type Tile = [number, number];

export type KeyColor = 0 | 1 | 2;

/** Kinds of tile the parsed grid can hold. */
export const enum TileKind {
  Void = 0,
  Floor = 1,
  Wall = 2,
  Door = 3,
}

/** ---------------------------------------------------------------- authoring */

export interface GuardDef {
  /** Axis-aligned waypoint chain, in tiles. Consecutive points share a row or column. */
  path: Tile[];
  /** `cycle` walks path[0..n-1] then straight back to path[0]; `pingpong` reverses. */
  loop?: 'cycle' | 'pingpong';
  /** Ticks to walk a single tile. Default 24 (2.5 tiles/sec). */
  stepTicks?: number;
  /** Ticks spent standing still at each waypoint. Default 0. */
  pause?: number;
  /** Vision cone reach, in tiles. Default 4.6. */
  range?: number;
  /** Half-width of the vision cone, in degrees. Default 30. */
  halfAngle?: number;
  /** Headings (degrees, 0 = +x, 90 = +y/down) cycled through while paused. */
  scan?: number[];
  /** Shift the whole patrol in time, in ticks. */
  phase?: number;
}

export interface CameraDef {
  x: number;
  y: number;
  /** Sweep start heading, degrees. */
  from: number;
  /** Sweep end heading, degrees. */
  to: number;
  /** Ticks for one one-way sweep. Default 72. */
  sweepTicks?: number;
  /** Ticks held motionless at each end of the sweep. Default 24. */
  holdTicks?: number;
  phase?: number;
  range?: number;
  halfAngle?: number;
}

export interface LaserDef {
  a: Tile;
  b: Tile;
  /** Ticks the beam is live. Default 60. */
  on?: number;
  /** Ticks the beam is dark. Default 60. */
  off?: number;
  phase?: number;
}

export interface LevelDef {
  id: number;
  name: string;
  /** One short line shown on the level intro card. */
  brief: string;
  /**
   * ASCII map, one string per row. Legend:
   *   '#' wall      '.' floor     ' ' void (outside the diorama)
   *   'S' start     'E' exit      '$' loot
   *   '1','2','3' keycards        'A','B','C' matching doors
   *   '~' noise floor - walkable, but guards hear you from much further away
   */
  map: string[];
  guards?: GuardDef[];
  cameras?: CameraDef[];
  lasers?: LaserDef[];
  /** Warm light pools, in tiles. Auto-placed when omitted. */
  lights?: Tile[];
  /** Route changes allowed. `0` means unlimited. */
  maxWaypoints?: number;
  /** Seconds for the 2nd star. Auto-derived by the validator when omitted. */
  parTime?: number;
}

/** ---------------------------------------------------------------- runtime */

export interface GuardFrame {
  /** Tile-space position (may be fractional while walking). */
  x: number;
  y: number;
  /** Facing, in radians. */
  a: number;
  /** True while standing still. */
  idle: boolean;
}

export interface GuardRuntime {
  def: GuardDef;
  frames: GuardFrame[];
  period: number;
  range: number;
  halfAngle: number;
}

export interface CameraRuntime {
  def: CameraDef;
  x: number;
  y: number;
  angles: Float32Array;
  period: number;
  range: number;
  halfAngle: number;
}

export interface LaserRuntime {
  def: LaserDef;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  tiles: number[];
  on: number;
  off: number;
  phase: number;
  period: number;
}

export interface CollectibleRuntime {
  /** Bit index inside the collected mask. */
  bit: number;
  x: number;
  y: number;
  kind: 'loot' | 'key';
  color: KeyColor;
}

export interface DoorRuntime {
  x: number;
  y: number;
  color: KeyColor;
  /** Bit of the keycard that opens it. */
  keyBit: number;
}

export interface LevelRuntime {
  def: LevelDef;
  w: number;
  h: number;
  /** Row-major grid of TileKind, length w*h. */
  grid: Uint8Array;
  /** Door color per tile index, or 255. */
  doorAt: Uint8Array;
  /** 1 where the floor is a noise zone (grating, gravel, broken glass). */
  noise: Uint8Array;
  /** True when the level has any noise floor at all. */
  hasNoise: boolean;
  start: Tile;
  exit: Tile;
  loot: CollectibleRuntime[];
  keys: CollectibleRuntime[];
  collectibles: CollectibleRuntime[];
  doors: DoorRuntime[];
  lights: Tile[];
  guards: GuardRuntime[];
  cameras: CameraRuntime[];
  lasers: LaserRuntime[];
  /** LCM of every sensor cycle - the whole world repeats every `period` ticks. */
  period: number;
  /** Mask with every collectible bit set. */
  allLootMask: number;
  lootMask: number;
  maxWaypoints: number;
}
