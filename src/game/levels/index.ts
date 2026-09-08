import type { LevelDef } from '../core/types.ts';
import { PACK_1 } from './pack1.ts';
import { PACK_2 } from './pack2.ts';
import { PACK_3 } from './pack3.ts';
import { PACK_4 } from './pack4.ts';
import { PACK_5 } from './pack5.ts';
import { PACK_6 } from './pack6.ts';

/** All 30 hand-designed levels, in play order. */
export const LEVEL_DEFS: LevelDef[] = [
  ...PACK_1,
  ...PACK_2,
  ...PACK_3,
  ...PACK_4,
  ...PACK_5,
  ...PACK_6,
];

export const LEVEL_COUNT = LEVEL_DEFS.length;

export function levelById(id: number): LevelDef | undefined {
  return LEVEL_DEFS.find((l) => l.id === id);
}

/** Six bands of five, used by the level-select screen. */
export const CHAPTERS: { title: string; from: number; to: number }[] = [
  { title: 'BASICS', from: 1, to: 5 },
  { title: 'PATROLS', from: 6, to: 10 },
  { title: 'KEYCARDS', from: 11, to: 15 },
  { title: 'THE SHIFT', from: 16, to: 20 },
  { title: 'ALARMS', from: 21, to: 25 },
  { title: 'THE JOB', from: 26, to: 30 },
];
