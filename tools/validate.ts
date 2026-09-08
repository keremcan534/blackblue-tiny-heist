/**
 * Level validator.
 *
 * Builds every level, precomputes its threat map and breadth-first searches the
 * exact action space the game exposes. A level only ships if a fully undetected
 * run exists. Also writes `src/game/levels/tuning.ts` so par times are derived
 * from the proven optimal run instead of guessed.
 *
 *   npm run validate            summary table
 *   npm run validate:verbose    plus the proven route for every level
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TICK_HZ } from '../src/game/core/constants.ts';
import { buildDanger } from '../src/game/core/danger.ts';
import { buildLevel } from '../src/game/core/level.ts';
import { solveLevel } from '../src/game/core/solver.ts';
import { Sim } from '../src/game/core/sim.ts';
import { LEVEL_DEFS } from '../src/game/levels/index.ts';
import type { LevelRuntime } from '../src/game/core/types.ts';
import type { RouteStep } from '../src/game/core/solver.ts';

const verbose = process.argv.includes('--verbose');
const write = !process.argv.includes('--no-write');

interface Row {
  id: number;
  name: string;
  size: string;
  sensors: string;
  cycle: number;
  seconds: number;
  taps: number;
  cap: number;
  coverage: number;
  ok: boolean;
  note: string;
}

const rows: Row[] = [];
const failures: string[] = [];
const tuning: Record<number, { par: number; optimal: number; taps: number }> = {};

for (const def of LEVEL_DEFS) {
  let lv: LevelRuntime;
  try {
    lv = buildLevel(def);
  } catch (err) {
    failures.push(`L${def.id} ${def.name}: ${(err as Error).message}`);
    rows.push({
      id: def.id,
      name: def.name,
      size: '-',
      sensors: '-',
      cycle: 0,
      seconds: 0,
      taps: 0,
      cap: 0,
      coverage: 0,
      ok: false,
      note: (err as Error).message,
    });
    continue;
  }

  let note = '';
  let ok = true;
  let seconds = 0;
  let taps = 0;
  let coverage = 0;
  let cycle = 0;

  try {
    const danger = buildDanger(lv);
    cycle = danger.cycle;
    const res = solveLevel(lv, danger);
    seconds = res.seconds;
    taps = res.waypoints;
    coverage = res.coverage;

    if (!res.solvable) {
      ok = false;
      note = res.reason;
      failures.push(`L${def.id} ${def.name}: UNSOLVABLE - ${res.reason}`);
    } else {
      const replay = replayRoute(lv, res.route);
      if (!replay.ok) {
        ok = false;
        note = replay.note;
        failures.push(`L${def.id} ${def.name}: replay mismatch - ${replay.note}`);
      }
      if (lv.maxWaypoints > 0 && taps > lv.maxWaypoints) {
        ok = false;
        note = `needs ${taps} taps but cap is ${lv.maxWaypoints}`;
        failures.push(`L${def.id} ${def.name}: ${note}`);
      }
      if (seconds < 3) {
        note = note || 'very short run';
      }
      if (seconds > 46) {
        note = note || 'long run';
      }
      const par = Math.max(6, Math.ceil(seconds * 1.4));
      tuning[def.id] = { par, optimal: Math.round(seconds * 100) / 100, taps };

      if (verbose) {
        console.log(`\n--- L${def.id} ${def.name} proven route (${res.route.length} steps) ---`);
        console.log(renderRoute(lv, res.route));
      }
    }
  } catch (err) {
    ok = false;
    note = (err as Error).message;
    failures.push(`L${def.id} ${def.name}: ${note}`);
  }

  rows.push({
    id: def.id,
    name: def.name,
    size: `${lv.w}x${lv.h}`,
    sensors: `${lv.guards.length}g ${lv.cameras.length}c ${lv.lasers.length}l ${lv.doors.length}d`,
    cycle,
    seconds,
    taps,
    cap: lv.maxWaypoints,
    coverage,
    ok,
    note,
  });
}

/** Replays the proven route through the live Sim - the ultimate agreement check. */
function replayRoute(lv: LevelRuntime, route: RouteStep[]): { ok: boolean; note: string } {
  const sim = new Sim(lv);
  let i = 1;
  const limit = route[route.length - 1].tick + 4;
  while (sim.tick < limit && sim.status === 'running') {
    if (sim.tick % 15 === 0 && i < route.length) {
      const step = route[i];
      if (!step.wait) {
        sim.path = [[step.x, step.y]];
      }
      i++;
    }
    sim.step();
  }
  if (sim.status === 'caught') {
    return { ok: false, note: `live sim was caught by ${sim.caughtBy?.label ?? '?'} at tick ${sim.tick}` };
  }
  if (sim.status !== 'won') {
    return { ok: false, note: `live sim ended as "${sim.status}" at tick ${sim.tick}` };
  }
  if (sim.everSpotted) {
    return { ok: false, note: 'live sim raised suspicion on the proven route' };
  }
  return { ok: true, note: '' };
}

function renderRoute(lv: LevelRuntime, route: RouteStep[]): string {
  const grid: string[][] = [];
  for (let y = 0; y < lv.h; y++) {
    grid.push(lv.def.map[y].padEnd(lv.w, ' ').split(''));
  }
  route.forEach((r, i) => {
    if (i === 0) return;
    const c = grid[r.y][r.x];
    if (c === '.' || c === '*') grid[r.y][r.x] = r.wait ? 'o' : '*';
  });
  return grid.map((r) => r.join('')).join('\n');
}

const pad = (s: string | number, n: number, right = false) => {
  const v = String(s);
  return right ? v.padStart(n) : v.padEnd(n);
};

console.log('');
console.log(
  `${pad('ID', 4)}${pad('NAME', 20)}${pad('SIZE', 8)}${pad('SENSORS', 16)}${pad('CYCLE', 7, true)}${pad('SECS', 8, true)}${pad('TAPS', 6, true)}${pad('CAP', 5, true)}${pad('TILES', 7, true)}  RESULT`,
);
console.log('-'.repeat(104));
for (const r of rows) {
  console.log(
    `${pad(r.id, 4)}${pad(r.name.slice(0, 19), 20)}${pad(r.size, 8)}${pad(r.sensors, 16)}${pad(r.cycle, 7, true)}${pad(
      r.seconds.toFixed(2),
      8,
      true,
    )}${pad(r.taps, 6, true)}${pad(r.cap || '-', 5, true)}${pad(r.coverage, 7, true)}  ${r.ok ? 'OK' : 'FAIL'}${
      r.note ? ` (${r.note})` : ''
    }`,
  );
}
console.log('-'.repeat(104));

const solved = rows.filter((r) => r.ok).length;
console.log(`${solved}/${rows.length} levels proven solvable with a fully undetected route.`);
if (rows.length) {
  const times = rows.filter((r) => r.ok).map((r) => r.seconds);
  if (times.length) {
    console.log(
      `Optimal run length: min ${Math.min(...times).toFixed(1)}s, ` +
        `median ${times.slice().sort((a, b) => a - b)[Math.floor(times.length / 2)].toFixed(1)}s, ` +
        `max ${Math.max(...times).toFixed(1)}s`,
    );
  }
}

if (write && failures.length === 0 && rows.length > 0) {
  const out = [
    '// AUTO-GENERATED by `npm run validate`. Do not edit by hand.',
    '//',
    '// `optimal` is the fastest fully-undetected run the solver could find, `taps`',
    '// is how many path commands that run needs, and `par` is the 2-star target.',
    'export interface LevelTuning {',
    '  par: number;',
    '  optimal: number;',
    '  taps: number;',
    '}',
    '',
    'export const TUNING: Record<number, LevelTuning> = {',
    ...Object.entries(tuning).map(
      ([id, t]) => `  ${id}: { par: ${t.par}, optimal: ${t.optimal}, taps: ${t.taps} },`,
    ),
    '};',
    '',
  ].join('\n');
  writeFileSync(resolve(process.cwd(), 'src/game/levels/tuning.ts'), out, 'utf8');
  console.log('Wrote src/game/levels/tuning.ts');
}

if (failures.length) {
  console.log('\nFAILURES');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}

console.log(`\nAll good. Tick rate ${TICK_HZ}Hz.`);
