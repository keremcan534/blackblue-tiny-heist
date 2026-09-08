import {
  CAMERA_HALF_ANGLE,
  CAMERA_HOLD_TICKS,
  CAMERA_RANGE,
  CAMERA_SWEEP_TICKS,
  DEG,
  GUARD_HALF_ANGLE,
  GUARD_RANGE,
  GUARD_STEP_TICKS,
  LASER_OFF,
  LASER_ON,
} from './constants.ts';
import { lcm, wrapAngle } from './geometry.ts';
import {
  TileKind,
  type CameraDef,
  type CameraRuntime,
  type CollectibleRuntime,
  type DoorRuntime,
  type GuardDef,
  type GuardFrame,
  type GuardRuntime,
  type KeyColor,
  type LaserDef,
  type LaserRuntime,
  type LevelDef,
  type LevelRuntime,
  type Tile,
} from './types.ts';

/** Hard ceiling so the solver's dedupe table stays small. */
export const MAX_COLLECTIBLES = 8;

class LevelError extends Error {}

function fail(def: LevelDef, msg: string): never {
  throw new LevelError(`Level ${def.id} "${def.name}": ${msg}`);
}

function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

/** Expands a guard definition into one position+facing frame per tick. */
function buildGuard(def: LevelDef, g: GuardDef): GuardRuntime {
  const stepTicks = g.stepTicks ?? GUARD_STEP_TICKS;
  const pause = Math.max(0, Math.round(g.pause ?? 0));
  const loop = g.loop ?? 'cycle';

  let way: Tile[] = g.path.slice();
  if (way.length < 2) fail(def, 'guard patrol needs at least 2 waypoints');
  if (loop === 'pingpong' && way.length > 2) {
    way = [...way, ...way.slice(1, -1).reverse()];
  }

  const n = way.length;
  const segs: { fx: number; fy: number; tx: number; ty: number; len: number; dir: number }[] = [];
  for (let i = 0; i < n; i++) {
    const [fx, fy] = way[i];
    const [tx, ty] = way[(i + 1) % n];
    if (fx !== tx && fy !== ty) {
      fail(def, `guard segment (${fx},${fy})->(${tx},${ty}) is not axis-aligned`);
    }
    const len = Math.abs(tx - fx) + Math.abs(ty - fy);
    if (len === 0) fail(def, `guard has a zero-length segment at (${fx},${fy})`);
    segs.push({ fx, fy, tx, ty, len, dir: Math.atan2(ty - fy, tx - fx) });
  }

  const period = segs.reduce((acc, s) => acc + pause + s.len * stepTicks, 0);
  if (period <= 0) fail(def, 'guard patrol has zero period');

  const frames: GuardFrame[] = new Array(period);
  let t = 0;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const prev = segs[(i - 1 + segs.length) % segs.length];
    for (let k = 0; k < pause; k++) {
      let a: number;
      if (g.scan && g.scan.length) {
        a = g.scan[Math.min(g.scan.length - 1, Math.floor((k * g.scan.length) / pause))] * DEG;
      } else {
        a = lerpAngle(prev.dir, seg.dir, pause <= 1 ? 1 : k / (pause - 1));
      }
      frames[t++] = { x: seg.fx, y: seg.fy, a, idle: true };
    }
    const walk = seg.len * stepTicks;
    for (let k = 0; k < walk; k++) {
      const f = k / walk;
      frames[t++] = {
        x: seg.fx + (seg.tx - seg.fx) * f,
        y: seg.fy + (seg.ty - seg.fy) * f,
        a: seg.dir,
        idle: false,
      };
    }
  }

  const phase = ((Math.round(g.phase ?? 0) % period) + period) % period;
  const rotated = phase === 0 ? frames : [...frames.slice(phase), ...frames.slice(0, phase)];

  return {
    def: g,
    frames: rotated,
    period,
    range: g.range ?? GUARD_RANGE,
    halfAngle: (g.halfAngle ?? GUARD_HALF_ANGLE) * DEG,
  };
}

/** Expands a camera into a per-tick heading table: hold, sweep, hold, sweep back. */
function buildCamera(def: LevelDef, c: CameraDef): CameraRuntime {
  const sweep = Math.max(1, Math.round(c.sweepTicks ?? CAMERA_SWEEP_TICKS));
  const hold = Math.max(0, Math.round(c.holdTicks ?? CAMERA_HOLD_TICKS));
  const period = 2 * (sweep + hold);
  if (period <= 0) fail(def, 'camera has zero period');

  const from = c.from * DEG;
  const to = c.to * DEG;
  const angles = new Float32Array(period);
  let t = 0;
  for (let k = 0; k < hold; k++) angles[t++] = from;
  for (let k = 0; k < sweep; k++) angles[t++] = lerpAngle(from, to, k / sweep);
  for (let k = 0; k < hold; k++) angles[t++] = to;
  for (let k = 0; k < sweep; k++) angles[t++] = lerpAngle(to, from, k / sweep);

  const phase = ((Math.round(c.phase ?? 0) % period) + period) % period;
  const shifted = new Float32Array(period);
  for (let i = 0; i < period; i++) shifted[i] = angles[(i + phase) % period];

  return {
    def: c,
    x: c.x,
    y: c.y,
    angles: shifted,
    period,
    range: c.range ?? CAMERA_RANGE,
    halfAngle: (c.halfAngle ?? CAMERA_HALF_ANGLE) * DEG,
  };
}

function buildLaser(def: LevelDef, w: number, l: LaserDef): LaserRuntime {
  const [ax, ay] = l.a;
  const [bx, by] = l.b;
  if (ax !== bx && ay !== by) fail(def, `laser (${ax},${ay})->(${bx},${by}) is not axis-aligned`);
  const on = Math.max(1, Math.round(l.on ?? LASER_ON));
  const off = Math.max(0, Math.round(l.off ?? LASER_OFF));
  const period = on + off;
  const tiles: number[] = [];
  const steps = Math.abs(bx - ax) + Math.abs(by - ay);
  const sx = Math.sign(bx - ax);
  const sy = Math.sign(by - ay);
  for (let i = 0; i <= steps; i++) tiles.push((ay + sy * i) * w + (ax + sx * i));
  return {
    def: l,
    ax,
    ay,
    bx,
    by,
    tiles,
    on,
    off,
    period,
    phase: ((Math.round(l.phase ?? 0) % period) + period) % period,
  };
}

const KEY_CHARS = '123';
const DOOR_CHARS = 'ABC';

/** Parses a LevelDef into the immutable runtime shared by the sim and renderer. */
export function buildLevel(def: LevelDef): LevelRuntime {
  const h = def.map.length;
  if (h === 0) fail(def, 'map is empty');
  const w = Math.max(...def.map.map((r) => r.length));

  const grid = new Uint8Array(w * h);
  const doorAt = new Uint8Array(w * h).fill(255);
  const noise = new Uint8Array(w * h);
  let start: Tile | null = null;
  let exit: Tile | null = null;
  const loot: CollectibleRuntime[] = [];
  const rawKeys: { x: number; y: number; color: KeyColor }[] = [];
  const rawDoors: { x: number; y: number; color: KeyColor }[] = [];

  for (let y = 0; y < h; y++) {
    const row = def.map[y].padEnd(w, ' ');
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      const idx = y * w + x;
      if (ch === ' ') {
        grid[idx] = TileKind.Void;
        continue;
      }
      if (ch === '#') {
        grid[idx] = TileKind.Wall;
        continue;
      }
      const doorIdx = DOOR_CHARS.indexOf(ch);
      if (doorIdx >= 0) {
        grid[idx] = TileKind.Door;
        doorAt[idx] = doorIdx;
        rawDoors.push({ x, y, color: doorIdx as KeyColor });
        continue;
      }
      grid[idx] = TileKind.Floor;
      if (ch === '~') {
        noise[idx] = 1;
        continue;
      }
      if (ch === 'S') start = [x, y];
      else if (ch === 'E') exit = [x, y];
      else if (ch === '$') loot.push({ bit: -1, x, y, kind: 'loot', color: 0 });
      else {
        const keyIdx = KEY_CHARS.indexOf(ch);
        if (keyIdx >= 0) rawKeys.push({ x, y, color: keyIdx as KeyColor });
        else if (ch !== '.') fail(def, `unknown map character "${ch}" at (${x},${y})`);
      }
    }
  }

  if (!start) fail(def, 'map has no start tile S');
  if (!exit) fail(def, 'map has no exit tile E');
  if (loot.length === 0) fail(def, 'map has no loot $');

  loot.forEach((l, i) => (l.bit = i));
  const keys: CollectibleRuntime[] = rawKeys.map((k, i) => ({
    bit: loot.length + i,
    x: k.x,
    y: k.y,
    kind: 'key' as const,
    color: k.color,
  }));

  const collectibles = [...loot, ...keys];
  if (collectibles.length > MAX_COLLECTIBLES) {
    fail(def, `${collectibles.length} collectibles exceeds the cap of ${MAX_COLLECTIBLES}`);
  }

  const doors: DoorRuntime[] = rawDoors.map((d) => {
    const key = keys.find((k) => k.color === d.color);
    if (!key) fail(def, `door ${DOOR_CHARS[d.color]} at (${d.x},${d.y}) has no matching keycard`);
    return { x: d.x, y: d.y, color: d.color, keyBit: key.bit };
  });

  const guards = (def.guards ?? []).map((g) => buildGuard(def, g));
  const cameras = (def.cameras ?? []).map((c) => buildCamera(def, c));
  const lasers = (def.lasers ?? []).map((l) => buildLaser(def, w, l));

  let period = 1;
  for (const g of guards) period = lcm(period, g.period);
  for (const c of cameras) period = lcm(period, c.period);
  for (const l of lasers) period = lcm(period, l.period);

  const lights: Tile[] = def.lights
    ? def.lights.slice()
    : autoLights(exit, collectibles, guards, cameras);

  const allLootMask = (1 << collectibles.length) - 1;
  const lootMask = (1 << loot.length) - 1;

  return {
    def,
    w,
    h,
    grid,
    doorAt,
    noise,
    hasNoise: noise.some((n) => n === 1),
    start,
    exit,
    loot,
    keys,
    collectibles,
    doors,
    lights,
    guards,
    cameras,
    lasers,
    period,
    allLootMask,
    lootMask,
    maxWaypoints: def.maxWaypoints ?? 0,
  };
}

/** Scatters warm light pools over the points of interest when a level omits them. */
function autoLights(
  exit: Tile,
  collectibles: CollectibleRuntime[],
  guards: GuardRuntime[],
  cameras: CameraRuntime[],
): Tile[] {
  const out: Tile[] = [exit];
  for (const c of collectibles) out.push([c.x, c.y]);
  for (const g of guards) {
    for (const p of g.def.path) out.push([p[0], p[1]]);
  }
  for (const c of cameras) out.push([c.x, c.y]);
  const seen = new Set<string>();
  return out.filter((p) => {
    const k = `${p[0]},${p[1]}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** True when the thief may stand on this tile given the keycards in `mask`. */
export function isWalkable(lv: LevelRuntime, x: number, y: number, mask: number): boolean {
  if (x < 0 || y < 0 || x >= lv.w || y >= lv.h) return false;
  const idx = y * lv.w + x;
  const k = lv.grid[idx];
  if (k === TileKind.Floor) return true;
  if (k !== TileKind.Door) return false;
  const door = lv.doors.find((d) => d.x === x && d.y === y);
  return !!door && (mask & (1 << door.keyBit)) !== 0;
}

/** True when standing at this tile-space point makes the thief audible. */
export function isNoisyAt(lv: LevelRuntime, x: number, y: number): boolean {
  if (!lv.hasNoise) return false;
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= lv.w || ty >= lv.h) return false;
  return lv.noise[ty * lv.w + tx] === 1;
}

/** Ignores locks - used for "is this tile part of the map at all" checks. */
export function isOpenTile(lv: LevelRuntime, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= lv.w || y >= lv.h) return false;
  const k = lv.grid[y * lv.w + x];
  return k === TileKind.Floor || k === TileKind.Door;
}
