import { TICK_HZ, TILE_TICKS } from './constants.ts';
import { buildDanger, type DangerTable } from './danger.ts';
import { isWalkable } from './level.ts';
import { DIRS, findPath } from './pathfind.ts';
import type { LevelRuntime } from './types.ts';

export interface RouteStep {
  x: number;
  y: number;
  /** True when the thief held position for this 250ms slice instead of stepping. */
  wait: boolean;
  tick: number;
  mask: number;
}

export interface SolveResult {
  solvable: boolean;
  /** Ticks the optimal run takes. */
  ticks: number;
  seconds: number;
  /** Tile-by-tile optimal route, including the start. */
  route: RouteStep[];
  /** Taps the optimal route needs once compressed into path commands. */
  waypoints: number;
  /** Distinct tiles visited - a rough "how much of the map does this use" gauge. */
  coverage: number;
  reason: string;
}

const NO_PARENT = -1;

/**
 * Exhaustive breadth-first search over (tile, keycards, world phase).
 *
 * The thief's action space here is exactly the one the game exposes: on every
 * TILE_TICKS boundary, either hold position or step to an orthogonally adjacent
 * tile. Because the search is breadth-first over a uniform 250ms step cost, the
 * first solution found is the fastest possible run of the level.
 */
export function solveLevel(lv: LevelRuntime, danger?: DangerTable): SolveResult {
  const dg = danger ?? buildDanger(lv);
  const tiles = lv.w * lv.h;
  const masks = 1 << lv.collectibles.length;
  const slots = dg.slots;
  const size = tiles * masks * slots;

  const collectibleAt = new Int8Array(tiles).fill(-1);
  for (const c of lv.collectibles) collectibleAt[c.y * lv.w + c.x] = c.bit;

  const startTile = lv.start[1] * lv.w + lv.start[0];
  const exitTile = lv.exit[1] * lv.w + lv.exit[0];

  const prev = new Int32Array(size).fill(NO_PARENT);
  const seen = new Uint8Array(size);
  const stepTick = new Int32Array(size);

  const encode = (tile: number, mask: number, slot: number) => (tile * masks + mask) * slots + slot;

  let startMask = 0;
  const startBit = collectibleAt[startTile];
  if (startBit >= 0) startMask |= 1 << startBit;

  if (!dg.stay[startTile * slots]) {
    return fail(lv, 'the thief is inside a cone on tick 0');
  }

  let frontier: number[] = [encode(startTile, startMask, 0)];
  seen[frontier[0]] = 1;
  stepTick[frontier[0]] = 0;

  let goal = -1;
  let depth = 0;
  const maxDepth = Math.ceil((TICK_HZ * 75) / TILE_TICKS);

  if (startTile === exitTile && (startMask & lv.lootMask) === lv.lootMask) goal = frontier[0];

  while (frontier.length && goal < 0 && depth < maxDepth) {
    const next: number[] = [];
    depth++;
    const tick = depth * TILE_TICKS;
    for (let f = 0; f < frontier.length; f++) {
      const cur = frontier[f];
      const slot = cur % slots;
      const rest = (cur - slot) / slots;
      const mask = rest % masks;
      const tile = (rest - mask) / masks;
      const x = tile % lv.w;
      const y = (tile - x) / lv.w;
      const nextSlot = (slot + 1) % slots;

      // Hold position.
      if (dg.stay[tile * slots + slot]) {
        const id = encode(tile, mask, nextSlot);
        if (!seen[id]) {
          seen[id] = 1;
          prev[id] = cur;
          stepTick[id] = tick;
          next.push(id);
        }
      }

      // Step to a neighbour.
      for (let d = 0; d < 4; d++) {
        if (!dg.move[(d * tiles + tile) * slots + slot]) continue;
        const nx = x + DIRS[d][0];
        const ny = y + DIRS[d][1];
        if (!isWalkable(lv, nx, ny, mask)) continue;
        const ntile = ny * lv.w + nx;
        let nmask = mask;
        const bit = collectibleAt[ntile];
        if (bit >= 0) nmask |= 1 << bit;
        const id = encode(ntile, nmask, nextSlot);
        if (seen[id]) continue;
        seen[id] = 1;
        prev[id] = cur;
        stepTick[id] = tick;
        next.push(id);
        if (ntile === exitTile && (nmask & lv.lootMask) === lv.lootMask) {
          goal = id;
          break;
        }
      }
      if (goal >= 0) break;
    }
    frontier = next;
  }

  if (goal < 0) {
    return fail(
      lv,
      depth >= maxDepth
        ? 'no safe route found within 75 seconds'
        : 'no safe route exists - every branch ends in a cone or a wall',
    );
  }

  // Walk the parent chain back to the start.
  const chain: number[] = [];
  for (let id = goal; id !== NO_PARENT; id = prev[id]) chain.push(id);
  chain.reverse();

  const route: RouteStep[] = chain.map((id, i) => {
    const slot = id % slots;
    const rest = (id - slot) / slots;
    const mask = rest % masks;
    const tile = (rest - mask) / masks;
    const x = tile % lv.w;
    const y = (tile - x) / lv.w;
    const prevStep = i > 0 ? chain[i - 1] : -1;
    let wait = false;
    if (prevStep >= 0) {
      const pSlot = prevStep % slots;
      const pRest = (prevStep - pSlot) / slots;
      const pMask = pRest % masks;
      const pTile = (pRest - pMask) / masks;
      wait = pTile === tile;
    }
    return { x, y, wait, tick: stepTick[id], mask };
  });

  const ticks = route[route.length - 1].tick;
  const distinct = new Set(route.map((r) => r.y * lv.w + r.x)).size;

  return {
    solvable: true,
    ticks,
    seconds: ticks / TICK_HZ,
    route,
    waypoints: countWaypoints(lv, route),
    coverage: distinct,
    reason: 'ok',
  };
}

/**
 * How many taps the route needs.
 *
 * Standing still is free - the thief always halts at the end of a committed path,
 * so a pause between two runs costs nothing. Each *movement* run costs one tap,
 * and a run may only be as long as the game's own pathfinder would reproduce it.
 */
export function countWaypoints(lv: LevelRuntime, route: RouteStep[]): number {
  let taps = 0;
  let i = 0;
  while (i < route.length - 1) {
    if (route[i + 1].wait) {
      i++;
      continue;
    }
    const mask = route[i].mask;
    let end = i + 1;
    let best = i + 1;
    while (end < route.length && !route[end].wait) {
      const path = findPath(lv, route[i].x, route[i].y, route[end].x, route[end].y, mask);
      if (!path || path.length !== end - i + 1) break;
      let match = true;
      for (let k = 0; k <= end - i; k++) {
        if (path[k][0] !== route[i + k].x || path[k][1] !== route[i + k].y) {
          match = false;
          break;
        }
      }
      if (!match) break;
      best = end;
      end++;
    }
    taps++;
    i = best;
  }
  return taps;
}

function fail(lv: LevelRuntime, reason: string): SolveResult {
  return {
    solvable: false,
    ticks: 0,
    seconds: 0,
    route: [{ x: lv.start[0], y: lv.start[1], wait: false, tick: 0, mask: 0 }],
    waypoints: 0,
    coverage: 0,
    reason,
  };
}
