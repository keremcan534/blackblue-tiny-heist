/**
 * Level diagnosis helper: `npx tsx tools/diagnose.ts <id>`
 *
 * Prints which tiles the solver can actually reach, which collectibles it can
 * pick up, and which single sensor - if removed - would unblock the level. That
 * turns "unsolvable" into a specific thing to move by one tile.
 */
import { TILE_TICKS } from '../src/game/core/constants.ts';
import { buildDanger } from '../src/game/core/danger.ts';
import { buildLevel } from '../src/game/core/level.ts';
import { solveLevel } from '../src/game/core/solver.ts';
import { isWalkable } from '../src/game/core/level.ts';
import { DIRS } from '../src/game/core/pathfind.ts';
import { levelById } from '../src/game/levels/index.ts';
import type { LevelDef, LevelRuntime } from '../src/game/core/types.ts';

const id = Number(process.argv[2] ?? '1');
const def = levelById(id);
if (!def) {
  console.error(`No level ${id}`);
  process.exit(1);
}

report(def);

function report(d: LevelDef): void {
  const lv = buildLevel(d);
  const dg = buildDanger(lv);
  console.log(`L${d.id} ${d.name}  ${lv.w}x${lv.h}  cycle ${dg.cycle}  collectibles ${lv.collectibles.length}`);

  const res = solveLevel(lv, dg);
  console.log(`solver: ${res.solvable ? `OK ${res.seconds.toFixed(2)}s / ${res.waypoints} taps` : res.reason}`);

  const { tiles, bestMask } = explore(lv, dg);
  console.log('\nreachable tiles (r = reached, ? = walkable but never safe):');
  const rows: string[] = [];
  for (let y = 0; y < lv.h; y++) {
    let line = '';
    for (let x = 0; x < lv.w; x++) {
      const ch = (d.map[y] ?? '').padEnd(lv.w, ' ')[x];
      if (ch === '#' || ch === ' ') line += ch === '#' ? '#' : ' ';
      else if (tiles.has(y * lv.w + x)) line += ch === '.' ? 'r' : ch;
      else line += '?';
    }
    rows.push(line);
  }
  console.log(rows.join('\n'));

  console.log(`\nbest collectible mask reached: ${bestMask.toString(2).padStart(lv.collectibles.length, '0')}`);
  for (const c of lv.collectibles) {
    const got = (bestMask & (1 << c.bit)) !== 0;
    console.log(`  ${c.kind} bit${c.bit} at (${c.x},${c.y}) ${got ? 'reachable' : 'BLOCKED'}`);
  }
  const exitTile = lv.exit[1] * lv.w + lv.exit[0];
  console.log(`  exit at (${lv.exit[0]},${lv.exit[1]}) ${tiles.has(exitTile) ? 'reachable' : 'BLOCKED'}`);

  if (res.solvable) return;

  console.log('\nremoving one sensor at a time:');
  const sensors: { label: string; mutate: (x: LevelDef) => LevelDef }[] = [];
  (d.guards ?? []).forEach((_, i) =>
    sensors.push({
      label: `guard ${i + 1}`,
      mutate: (x) => ({ ...x, guards: (x.guards ?? []).filter((__, j) => j !== i) }),
    }),
  );
  (d.cameras ?? []).forEach((_, i) =>
    sensors.push({
      label: `camera ${i + 1}`,
      mutate: (x) => ({ ...x, cameras: (x.cameras ?? []).filter((__, j) => j !== i) }),
    }),
  );
  (d.lasers ?? []).forEach((_, i) =>
    sensors.push({
      label: `laser ${i + 1}`,
      mutate: (x) => ({ ...x, lasers: (x.lasers ?? []).filter((__, j) => j !== i) }),
    }),
  );
  for (const s of sensors) {
    const alt = buildLevel(s.mutate(d));
    const r = solveLevel(alt);
    console.log(`  without ${s.label}: ${r.solvable ? `SOLVABLE ${r.seconds.toFixed(2)}s` : r.reason}`);
  }
  const bare = buildLevel({ ...d, guards: [], cameras: [], lasers: [] });
  const rb = solveLevel(bare);
  console.log(`  with no sensors at all: ${rb.solvable ? `SOLVABLE ${rb.seconds.toFixed(2)}s` : rb.reason}`);
}

/** Same frontier expansion as the solver, but records every tile/mask it touches. */
function explore(lv: LevelRuntime, dg: ReturnType<typeof buildDanger>) {
  const tilesN = lv.w * lv.h;
  const masks = 1 << lv.collectibles.length;
  const slots = dg.slots;
  const seen = new Uint8Array(tilesN * masks * slots);
  const collectibleAt = new Int8Array(tilesN).fill(-1);
  for (const c of lv.collectibles) collectibleAt[c.y * lv.w + c.x] = c.bit;

  const encode = (t: number, m: number, s: number) => (t * masks + m) * slots + s;
  const startTile = lv.start[1] * lv.w + lv.start[0];
  let startMask = 0;
  if (collectibleAt[startTile] >= 0) startMask |= 1 << collectibleAt[startTile];

  const tiles = new Set<number>();
  let bestMask = startMask;
  if (!dg.stay[startTile * slots]) return { tiles, bestMask };

  let frontier = [encode(startTile, startMask, 0)];
  seen[frontier[0]] = 1;
  tiles.add(startTile);

  const maxDepth = Math.ceil((60 * 75) / TILE_TICKS);
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const next: number[] = [];
    for (const cur of frontier) {
      const slot = cur % slots;
      const rest = (cur - slot) / slots;
      const mask = rest % masks;
      const tile = (rest - mask) / masks;
      const x = tile % lv.w;
      const y = (tile - x) / lv.w;
      const ns = (slot + 1) % slots;
      if (dg.stay[tile * slots + slot]) {
        const idn = encode(tile, mask, ns);
        if (!seen[idn]) {
          seen[idn] = 1;
          next.push(idn);
        }
      }
      for (let dir = 0; dir < 4; dir++) {
        if (!dg.move[(dir * tilesN + tile) * slots + slot]) continue;
        const nx = x + DIRS[dir][0];
        const ny = y + DIRS[dir][1];
        if (!isWalkable(lv, nx, ny, mask)) continue;
        const nt = ny * lv.w + nx;
        let nm = mask;
        if (collectibleAt[nt] >= 0) nm |= 1 << collectibleAt[nt];
        const idn = encode(nt, nm, ns);
        if (seen[idn]) continue;
        seen[idn] = 1;
        tiles.add(nt);
        if (popcount(nm) > popcount(bestMask)) bestMask = nm;
        next.push(idn);
      }
    }
    frontier = next;
  }
  return { tiles, bestMask };
}

function popcount(n: number): number {
  let c = 0;
  let v = n;
  while (v) {
    c += v & 1;
    v >>= 1;
  }
  return c;
}
