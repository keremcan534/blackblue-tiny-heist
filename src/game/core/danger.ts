import { DANGER_SUBDIV, NOISE_RANGE_MULT, TILE_TICKS } from './constants.ts';
import { hasLineOfSight, inCone, lcm } from './geometry.ts';
import { isNoisyAt } from './level.ts';
import { DIRS } from './pathfind.ts';
import type { LevelRuntime } from './types.ts';

/**
 * Offline threat map used only by the level validator.
 *
 * The world repeats every `cycle` ticks, and the thief only ever starts a step on
 * a tick that is a multiple of TILE_TICKS - so every question the solver asks
 * ("is standing on tile T through phase P safe?", "is stepping T->U through phase
 * P safe?") collapses to a table lookup.
 *
 * Sampling happens on the DANGER_SUBDIV lattice - the very same lattice the live
 * sim snaps the thief to - so a route proven here cannot be flagged in play.
 */
export interface DangerTable {
  cycle: number;
  slots: number;
  /** [tile * slots + slot] -> 1 when standing there for that whole slot is safe. */
  stay: Uint8Array;
  /** [(dir * tiles + tile) * slots + slot] -> 1 when stepping out in `dir` is safe. */
  move: Uint8Array;
}

interface SensorBits {
  period: number;
  bits: Uint8Array;
}

export class DangerBudgetError extends Error {}

const MAX_CYCLE = 5400;

export function buildDanger(lv: LevelRuntime): DangerTable {
  const cycle = lcm(lv.period, TILE_TICKS);
  if (cycle > MAX_CYCLE) {
    throw new DangerBudgetError(
      `Level ${lv.def.id} "${lv.def.name}": world cycle is ${cycle} ticks (max ${MAX_CYCLE}). ` +
        'Pick patrol/sweep timings with a smaller least common multiple.',
    );
  }

  const sw = lv.w * DANGER_SUBDIV;
  const sh = lv.h * DANGER_SUBDIV;
  const n = sw * sh;
  const sensors: SensorBits[] = [];

  for (let gi = 0; gi < lv.guards.length; gi++) {
    const g = lv.guards[gi];
    const bits = new Uint8Array(g.period * n);
    for (let p = 0; p < g.period; p++) {
      const f = g.frames[p];
      paintCone(lv, bits, p * n, sw, sh, f.x + 0.5, f.y + 0.5, f.a, g.range, g.halfAngle, true);
    }
    sensors.push({ period: g.period, bits });
  }

  for (let ci = 0; ci < lv.cameras.length; ci++) {
    const c = lv.cameras[ci];
    const bits = new Uint8Array(c.period * n);
    for (let p = 0; p < c.period; p++) {
      paintCone(lv, bits, p * n, sw, sh, c.x + 0.5, c.y + 0.5, c.angles[p], c.range, c.halfAngle);
    }
    sensors.push({ period: c.period, bits });
  }

  for (let li = 0; li < lv.lasers.length; li++) {
    const l = lv.lasers[li];
    const bits = new Uint8Array(l.period * n);
    const minX = Math.min(l.ax, l.bx) + 0.5;
    const maxX = Math.max(l.ax, l.bx) + 0.5;
    const minY = Math.min(l.ay, l.by) + 0.5;
    const maxY = Math.max(l.ay, l.by) + 0.5;
    for (let p = 0; p < l.period; p++) {
      if (((p + l.phase) % l.period) >= l.on) continue;
      const base = p * n;
      for (let j = 0; j < sh; j++) {
        const cy = j / DANGER_SUBDIV + 0.5;
        for (let i = 0; i < sw; i++) {
          const cx = i / DANGER_SUBDIV + 0.5;
          const nx = Math.min(Math.max(cx, minX), maxX);
          const ny = Math.min(Math.max(cy, minY), maxY);
          if (Math.hypot(cx - nx, cy - ny) <= 0.42) bits[base + j * sw + i] = 1;
        }
      }
    }
    sensors.push({ period: l.period, bits });
  }

  const dangerous = (sample: number, tick: number): boolean => {
    for (let s = 0; s < sensors.length; s++) {
      const sen = sensors[s];
      if (sen.bits[(tick % sen.period) * n + sample]) return true;
    }
    return false;
  };

  const slots = cycle / TILE_TICKS;
  const tiles = lv.w * lv.h;
  const stay = new Uint8Array(tiles * slots);
  const move = new Uint8Array(4 * tiles * slots);

  for (let y = 0; y < lv.h; y++) {
    for (let x = 0; x < lv.w; x++) {
      const tile = y * lv.w + x;
      const centre = DANGER_SUBDIV * y * sw + DANGER_SUBDIV * x;
      for (let slot = 0; slot < slots; slot++) {
        const t0 = slot * TILE_TICKS;
        let safe = true;
        for (let k = 0; k < TILE_TICKS; k++) {
          if (dangerous(centre, (t0 + k) % cycle)) {
            safe = false;
            break;
          }
        }
        stay[tile * slots + slot] = safe ? 1 : 0;
      }

      for (let d = 0; d < 4; d++) {
        const [dx, dy] = DIRS[d];
        const nx = x + dx;
        const ny = y + dy;
        const base = (d * tiles + tile) * slots;
        if (nx < 0 || ny < 0 || nx >= lv.w || ny >= lv.h) continue;
        for (let slot = 0; slot < slots; slot++) {
          const t0 = slot * TILE_TICKS;
          let safe = true;
          for (let k = 0; k < TILE_TICKS; k++) {
            const f = k / TILE_TICKS;
            const si = Math.round((x + dx * f) * DANGER_SUBDIV);
            const sj = Math.round((y + dy * f) * DANGER_SUBDIV);
            if (dangerous(sj * sw + si, (t0 + k) % cycle)) {
              safe = false;
              break;
            }
          }
          move[base + slot] = safe ? 1 : 0;
        }
      }
    }
  }

  return { cycle, slots, stay, move };
}

function paintCone(
  lv: LevelRuntime,
  bits: Uint8Array,
  base: number,
  sw: number,
  sh: number,
  ox: number,
  oy: number,
  facing: number,
  range: number,
  halfAngle: number,
  /** Guards hear; lenses do not. Only a hearing sensor gets the noise-floor bonus. */
  hears = false,
): void {
  const reach = hears && lv.hasNoise ? range * NOISE_RANGE_MULT : range;
  const i0 = Math.max(0, Math.floor((ox - reach - 1) * DANGER_SUBDIV));
  const i1 = Math.min(sw - 1, Math.ceil((ox + reach + 1) * DANGER_SUBDIV));
  const j0 = Math.max(0, Math.floor((oy - reach - 1) * DANGER_SUBDIV));
  const j1 = Math.min(sh - 1, Math.ceil((oy + reach + 1) * DANGER_SUBDIV));
  for (let j = j0; j <= j1; j++) {
    const cy = j / DANGER_SUBDIV + 0.5;
    for (let i = i0; i <= i1; i++) {
      const cx = i / DANGER_SUBDIV + 0.5;
      const idx = base + j * sw + i;
      if (bits[idx]) continue;
      const r = hears && isNoisyAt(lv, i / DANGER_SUBDIV, j / DANGER_SUBDIV) ? reach : range;
      if (!inCone(ox, oy, facing, r, halfAngle, cx, cy)) continue;
      if (!hasLineOfSight(lv.grid, lv.w, lv.h, ox, oy, cx, cy)) continue;
      bits[idx] = 1;
    }
  }
}
