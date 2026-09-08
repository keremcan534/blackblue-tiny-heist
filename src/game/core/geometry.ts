import { TileKind } from './types.ts';

/** Wraps an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r <= -Math.PI) r += Math.PI * 2;
  return r;
}

/** Shortest absolute angular distance between two headings, in radians. */
export function angleDelta(a: number, b: number): number {
  return Math.abs(wrapAngle(a - b));
}

/**
 * True when nothing solid stands between two tile-space points.
 *
 * Walls and void block sight. Doors are lit security gates - they never block
 * sight, which keeps the solver and the live game in exact agreement regardless
 * of which keycards the thief happens to be carrying.
 */
export function hasLineOfSight(
  grid: Uint8Array,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return true;
  // ~4 samples per tile: fine enough to never tunnel through a 1-tile wall.
  const steps = Math.ceil(dist * 4);
  const sx = dx / steps;
  const sy = dy / steps;
  for (let i = 1; i < steps; i++) {
    const px = x0 + sx * i;
    const py = y0 + sy * i;
    const tx = Math.floor(px);
    const ty = Math.floor(py);
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) return false;
    const k = grid[ty * w + tx];
    if (k === TileKind.Wall || k === TileKind.Void) return false;
  }
  return true;
}

/** True when `(px,py)` falls inside the cone rooted at `(cx,cy)`. */
export function inCone(
  cx: number,
  cy: number,
  facing: number,
  range: number,
  halfAngle: number,
  px: number,
  py: number,
): boolean {
  const dx = px - cx;
  const dy = py - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 > range * range) return false;
  if (d2 < 0.04) return true;
  return angleDelta(Math.atan2(dy, dx), facing) <= halfAngle;
}

export function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x || 1;
}

export function lcm(a: number, b: number): number {
  if (a <= 0) return b;
  if (b <= 0) return a;
  return Math.abs((a / gcd(a, b)) * b);
}
