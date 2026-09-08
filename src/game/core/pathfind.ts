import { isWalkable } from './level.ts';
import type { LevelRuntime } from './types.ts';

/** Fixed neighbour order. The game and the offline validator MUST agree here,
 *  otherwise a route the validator proved would not be the route the thief walks. */
export const DIRS: readonly [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** Breadth-first distance from `(tx,ty)` to every tile, in tiles. 65535 = unreachable. */
export function distanceField(lv: LevelRuntime, tx: number, ty: number, mask: number): Uint16Array {
  const n = lv.w * lv.h;
  const dist = new Uint16Array(n).fill(65535);
  if (!isWalkable(lv, tx, ty, mask)) return dist;
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const start = ty * lv.w + tx;
  dist[start] = 0;
  queue[tail++] = start;
  while (head < tail) {
    const cur = queue[head++];
    const cx = cur % lv.w;
    const cy = (cur - cx) / lv.w;
    const nd = dist[cur] + 1;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isWalkable(lv, nx, ny, mask)) continue;
      const ni = ny * lv.w + nx;
      if (dist[ni] <= nd) continue;
      dist[ni] = nd;
      queue[tail++] = ni;
    }
  }
  return dist;
}

/**
 * The one and only route the thief will ever walk between two tiles.
 *
 * Shortest path, deterministic tie-break (DIRS order), inclusive of both ends.
 * Returns null when the target is unreachable with the given keycards.
 */
export function findPath(
  lv: LevelRuntime,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  mask: number,
  field?: Uint16Array,
): [number, number][] | null {
  if (!isWalkable(lv, sx, sy, mask) || !isWalkable(lv, tx, ty, mask)) return null;
  const dist = field ?? distanceField(lv, tx, ty, mask);
  let cx = sx;
  let cy = sy;
  if (dist[cy * lv.w + cx] === 65535) return null;
  const path: [number, number][] = [[cx, cy]];
  let guard = lv.w * lv.h + 4;
  while ((cx !== tx || cy !== ty) && guard-- > 0) {
    const want = dist[cy * lv.w + cx] - 1;
    let moved = false;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= lv.w || ny >= lv.h) continue;
      if (dist[ny * lv.w + nx] !== want) continue;
      cx = nx;
      cy = ny;
      path.push([cx, cy]);
      moved = true;
      break;
    }
    if (!moved) return null;
  }
  return cx === tx && cy === ty ? path : null;
}
