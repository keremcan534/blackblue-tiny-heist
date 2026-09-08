import { NOISE_RANGE_MULT } from './constants.ts';
import { hasLineOfSight, inCone } from './geometry.ts';
import { isNoisyAt } from './level.ts';
import type { GuardFrame, LevelRuntime } from './types.ts';

/** Identifies which sensor spotted the thief, so the loss screen can name it. */
export interface SensorRef {
  kind: 'guard' | 'camera' | 'laser';
  index: number;
  x: number;
  y: number;
  label: string;
  /** True when a noise floor is what gave the thief away. */
  heard: boolean;
}

export function guardAt(lv: LevelRuntime, index: number, tick: number): GuardFrame {
  const g = lv.guards[index];
  return g.frames[((tick % g.period) + g.period) % g.period];
}

export function cameraAngleAt(lv: LevelRuntime, index: number, tick: number): number {
  const c = lv.cameras[index];
  return c.angles[((tick % c.period) + c.period) % c.period];
}

/** True when a laser beam is live on this tick. */
export function laserOnAt(lv: LevelRuntime, index: number, tick: number): boolean {
  const l = lv.lasers[index];
  return ((tick + l.phase) % l.period) < l.on;
}

/**
 * The single source of truth for "is the thief visible right now".
 *
 * `x`/`y` are tile-space and may be fractional (mid-step). Returns the sensor
 * that has eyes on the thief, or null. Guards win ties over cameras over lasers
 * so the loss card always blames the most legible threat.
 */
export function detect(lv: LevelRuntime, x: number, y: number, tick: number): SensorRef | null {
  const cx = x + 0.5;
  const cy = y + 0.5;
  const noisy = isNoisyAt(lv, x, y);

  for (let i = 0; i < lv.guards.length; i++) {
    const g = lv.guards[i];
    const f = guardAt(lv, i, tick);
    const reach = noisy ? g.range * NOISE_RANGE_MULT : g.range;
    if (!inCone(f.x + 0.5, f.y + 0.5, f.a, reach, g.halfAngle, cx, cy)) continue;
    if (!hasLineOfSight(lv.grid, lv.w, lv.h, f.x + 0.5, f.y + 0.5, cx, cy)) continue;
    const heard = noisy && Math.hypot(f.x - x, f.y - y) > g.range;
    return { kind: 'guard', index: i, x: f.x, y: f.y, label: `GUARD ${i + 1}`, heard };
  }

  for (let i = 0; i < lv.cameras.length; i++) {
    const c = lv.cameras[i];
    const a = cameraAngleAt(lv, i, tick);
    if (!inCone(c.x + 0.5, c.y + 0.5, a, c.range, c.halfAngle, cx, cy)) continue;
    if (!hasLineOfSight(lv.grid, lv.w, lv.h, c.x + 0.5, c.y + 0.5, cx, cy)) continue;
    return { kind: 'camera', index: i, x: c.x, y: c.y, label: `CAMERA ${i + 1}`, heard: false };
  }

  for (let i = 0; i < lv.lasers.length; i++) {
    if (!laserOnAt(lv, i, tick)) continue;
    const l = lv.lasers[i];
    // Beams are axis-aligned, so a point-to-segment test collapses to a band check.
    const minX = Math.min(l.ax, l.bx);
    const maxX = Math.max(l.ax, l.bx);
    const minY = Math.min(l.ay, l.by);
    const maxY = Math.max(l.ay, l.by);
    const nearX = Math.min(Math.max(cx, minX + 0.5), maxX + 0.5);
    const nearY = Math.min(Math.max(cy, minY + 0.5), maxY + 0.5);
    if (Math.hypot(cx - nearX, cy - nearY) <= 0.42) {
      return { kind: 'laser', index: i, x: l.ax, y: l.ay, label: `LASER ${i + 1}`, heard: false };
    }
  }

  return null;
}
