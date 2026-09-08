/**
 * Progression persistence.
 *
 * Everything lives in one localStorage key so a corrupt or absent value degrades
 * to "new save" instead of throwing. Private-mode Safari throws on write, so every
 * access is wrapped.
 */
import { LEVEL_COUNT } from '../levels/index.ts';

const KEY = 'tinyheist.save.v1';

export interface LevelRecord {
  /** 0 = locked/unplayed, 1-3 stars. */
  stars: number;
  /** Best completed run in seconds, or 0. */
  best: number;
  /** True once the level has been finished without ever being spotted. */
  ghost: boolean;
}

export interface SaveData {
  records: Record<number, LevelRecord>;
  /** Highest level index unlocked (1-based). */
  unlocked: number;
  muted: boolean;
  haptics: boolean;
  /** Set once the player has seen the freeze tutorial overlay. */
  taught: boolean;
}

const DEFAULTS: SaveData = {
  records: {},
  unlocked: 1,
  muted: false,
  haptics: true,
  taught: false,
};

let cache: SaveData | null = null;

function read(): SaveData {
  if (cache) return cache;
  let data: SaveData = { ...DEFAULTS, records: {} };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      data = {
        records: typeof parsed.records === 'object' && parsed.records ? parsed.records : {},
        unlocked: clampUnlocked(parsed.unlocked),
        muted: !!parsed.muted,
        haptics: parsed.haptics !== false,
        taught: !!parsed.taught,
      };
    }
  } catch {
    data = { ...DEFAULTS, records: {} };
  }
  cache = data;
  return data;
}

function clampUnlocked(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 1;
  return Math.min(LEVEL_COUNT, Math.max(1, n));
}

function write(data: SaveData): void {
  cache = data;
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* private mode / quota - progression is best-effort, never fatal */
  }
}

export const Save = {
  all(): SaveData {
    return read();
  },

  record(id: number): LevelRecord {
    return read().records[id] ?? { stars: 0, best: 0, ghost: false };
  },

  isUnlocked(id: number): boolean {
    return id <= read().unlocked;
  },

  totalStars(): number {
    const r = read().records;
    return Object.values(r).reduce((a, b) => a + b.stars, 0);
  },

  completed(): number {
    const r = read().records;
    return Object.values(r).filter((x) => x.stars > 0).length;
  },

  /** Records a win, keeping the player's best result on every axis. */
  complete(id: number, stars: number, seconds: number, ghost: boolean): LevelRecord {
    const data = read();
    const prev = data.records[id] ?? { stars: 0, best: 0, ghost: false };
    const next: LevelRecord = {
      stars: Math.max(prev.stars, stars),
      best: prev.best > 0 ? Math.min(prev.best, seconds) : seconds,
      ghost: prev.ghost || ghost,
    };
    data.records[id] = next;
    data.unlocked = clampUnlocked(Math.max(data.unlocked, id + 1));
    write(data);
    return next;
  },

  setMuted(muted: boolean): void {
    const data = read();
    data.muted = muted;
    write(data);
  },

  setHaptics(on: boolean): void {
    const data = read();
    data.haptics = on;
    write(data);
  },

  markTaught(): void {
    const data = read();
    if (data.taught) return;
    data.taught = true;
    write(data);
  },

  reset(): void {
    cache = null;
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },
};
