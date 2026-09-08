/**
 * Generated audio - no asset files anywhere.
 *
 * Every sound is synthesised from oscillators and a noise buffer at runtime, and
 * the ambient bed is scheduled against the AudioContext clock (never setTimeout)
 * so it stays in time when the main thread stutters.
 */
import { Save } from '../util/storage.ts';

type Ctx = AudioContext;

let ctx: Ctx | null = null;
let master: GainNode | null = null;
let musicBus: GainNode | null = null;
let sfxBus: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let schedulerId: number | null = null;
let nextNoteTime = 0;
let step = 0;
let musicWanted = false;

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.25;
const STEP_SECONDS = 60 / 84 / 2; // eighth notes at 84bpm

function ensure(): Ctx | null {
  if (ctx) return ctx;
  const Ctor =
    (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }

  master = ctx.createGain();
  master.gain.value = Save.all().muted ? 0 : 0.9;
  master.connect(ctx.destination);

  sfxBus = ctx.createGain();
  sfxBus.gain.value = 0.85;
  sfxBus.connect(master);

  musicBus = ctx.createGain();
  musicBus.gain.value = 0.0;
  musicBus.connect(master);

  const len = Math.floor(ctx.sampleRate * 0.6);
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  // Deterministic noise - no Math.random, so a recording of the game is reproducible.
  let seed = 0x2f6e2b1;
  for (let i = 0; i < len; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 0xffffffff) * 2 - 1;
  }
  return ctx;
}

function now(): number {
  return ctx ? ctx.currentTime : 0;
}

interface ToneOpts {
  type?: OscillatorType;
  freq: number;
  to?: number;
  dur: number;
  gain?: number;
  delay?: number;
  attack?: number;
  bus?: GainNode | null;
  detune?: number;
  filter?: number;
  /** Absolute AudioContext time. Wins over `delay` - used by the music scheduler. */
  at?: number;
}

function tone(o: ToneOpts): void {
  const c = ensure();
  if (!c || !sfxBus) return;
  const t0 = o.at ?? now() + (o.delay ?? 0);
  const osc = c.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t0 + o.dur);
  if (o.detune) osc.detune.setValueAtTime(o.detune, t0);

  const g = c.createGain();
  const peak = o.gain ?? 0.2;
  const atk = o.attack ?? 0.006;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);

  let tail: AudioNode = g;
  if (o.filter) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(o.filter, t0);
    g.connect(f);
    tail = f;
  }

  osc.connect(g);
  tail.connect(o.bus ?? sfxBus);
  osc.start(t0);
  osc.stop(t0 + o.dur + 0.05);
}

function noise(
  dur: number,
  gain: number,
  freq: number,
  type: BiquadFilterType = 'bandpass',
  delay = 0,
  at?: number,
): void {
  const c = ensure();
  if (!c || !sfxBus || !noiseBuffer) return;
  const t0 = at ?? now() + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t0);
  f.Q.value = 1.1;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f);
  f.connect(g);
  g.connect(sfxBus);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

/* ------------------------------------------------------------------ ambience */

const BASS = [55, 55, 62, 49];
const ARP = [220, 261.63, 329.63, 261.63, 246.94, 329.63, 392, 329.63];

function scheduleStep(t: number): void {
  if (!musicBus) return;
  const bar = Math.floor(step / 8) % 4;
  if (step % 8 === 0) {
    tone({ type: 'triangle', freq: BASS[bar], dur: 1.5, gain: 0.28, attack: 0.05, bus: musicBus, filter: 420, at: t });
  }
  if (step % 4 === 2) {
    noise(0.18, 0.022, 5200, 'highpass', 0, t);
  }
  if (step % 2 === 0) {
    tone({
      type: 'sine',
      freq: ARP[step % ARP.length],
      dur: 0.5,
      gain: 0.05,
      attack: 0.02,
      bus: musicBus,
      filter: 1800,
      at: t,
    });
  }
  step++;
}

function pump(): void {
  const c = ensure();
  if (!c) return;
  while (nextNoteTime < c.currentTime + SCHEDULE_AHEAD) {
    scheduleStep(nextNoteTime);
    nextNoteTime += STEP_SECONDS;
  }
}

export const Audio = {
  /** Must be called from a user gesture on iOS. Safe to call repeatedly. */
  unlock(): void {
    const c = ensure();
    if (!c) return;
    if (c.state === 'suspended') void c.resume();
    if (musicWanted) Audio.startMusic();
  },

  setMuted(muted: boolean): void {
    Save.setMuted(muted);
    if (master && ctx) {
      master.gain.cancelScheduledValues(now());
      master.gain.linearRampToValueAtTime(muted ? 0 : 0.9, now() + 0.12);
    }
  },

  get muted(): boolean {
    return Save.all().muted;
  },

  startMusic(): void {
    musicWanted = true;
    const c = ensure();
    if (!c || !musicBus) return;
    if (c.state === 'suspended') void c.resume();
    musicBus.gain.cancelScheduledValues(now());
    musicBus.gain.linearRampToValueAtTime(0.5, now() + 1.4);
    if (schedulerId !== null) return;
    nextNoteTime = c.currentTime + 0.1;
    schedulerId = window.setInterval(pump, LOOKAHEAD_MS);
  },

  stopMusic(): void {
    musicWanted = false;
    if (musicBus && ctx) {
      musicBus.gain.cancelScheduledValues(now());
      musicBus.gain.linearRampToValueAtTime(0.0001, now() + 0.5);
    }
    if (schedulerId !== null) {
      window.clearInterval(schedulerId);
      schedulerId = null;
    }
  },

  /** Ducks the bed while the world is frozen so the silence reads as "time stopped". */
  duckMusic(amount: number): void {
    if (!musicBus || !ctx) return;
    musicBus.gain.cancelScheduledValues(now());
    musicBus.gain.linearRampToValueAtTime(0.5 * amount + 0.0001, now() + 0.15);
  },

  freeze(): void {
    tone({ type: 'sawtooth', freq: 520, to: 90, dur: 0.42, gain: 0.12, filter: 900 });
    tone({ type: 'sine', freq: 1320, to: 220, dur: 0.32, gain: 0.06 });
    noise(0.3, 0.035, 1400, 'lowpass');
  },

  unfreeze(): void {
    tone({ type: 'sawtooth', freq: 110, to: 480, dur: 0.24, gain: 0.1, filter: 1400 });
    tone({ type: 'sine', freq: 300, to: 1180, dur: 0.2, gain: 0.05 });
  },

  tap(): void {
    tone({ type: 'square', freq: 880, dur: 0.06, gain: 0.06, filter: 2600 });
  },

  place(): void {
    tone({ type: 'triangle', freq: 660, to: 990, dur: 0.12, gain: 0.11 });
    tone({ type: 'sine', freq: 1320, dur: 0.09, gain: 0.05, delay: 0.03 });
  },

  deny(): void {
    tone({ type: 'square', freq: 150, to: 90, dur: 0.16, gain: 0.09, filter: 700 });
  },

  footstep(): void {
    noise(0.055, 0.022, 900, 'bandpass');
  },

  pickup(): void {
    [0, 1, 2].forEach((i) =>
      tone({ type: 'triangle', freq: 523.25 * Math.pow(2, i / 12) * (1 + i * 0.24), dur: 0.2, gain: 0.13, delay: i * 0.055 }),
    );
    noise(0.16, 0.03, 4200, 'highpass', 0.02);
  },

  keycard(): void {
    tone({ type: 'square', freq: 740, dur: 0.09, gain: 0.09, filter: 2400 });
    tone({ type: 'square', freq: 1108, dur: 0.14, gain: 0.07, delay: 0.07, filter: 2800 });
  },

  door(): void {
    tone({ type: 'sawtooth', freq: 180, to: 60, dur: 0.34, gain: 0.13, filter: 620 });
    noise(0.3, 0.05, 500, 'lowpass', 0.03);
  },

  alarm(): void {
    for (let i = 0; i < 3; i++) {
      tone({ type: 'sawtooth', freq: 620, to: 980, dur: 0.16, gain: 0.14, delay: i * 0.19, filter: 2200 });
    }
  },

  spotted(): void {
    tone({ type: 'square', freq: 1400, dur: 0.07, gain: 0.09, filter: 3200 });
  },

  caught(): void {
    tone({ type: 'sawtooth', freq: 300, to: 70, dur: 0.9, gain: 0.2, filter: 900 });
    tone({ type: 'square', freq: 148, to: 52, dur: 1.0, gain: 0.13, filter: 500 });
    noise(0.7, 0.07, 300, 'lowpass', 0.04);
  },

  win(): void {
    const chord = [523.25, 659.25, 783.99, 1046.5];
    chord.forEach((f, i) =>
      tone({ type: 'triangle', freq: f, dur: 0.85, gain: 0.13, delay: i * 0.075, attack: 0.02, filter: 3200 }),
    );
    noise(0.5, 0.03, 6000, 'highpass', 0.05);
  },

  star(index: number): void {
    tone({ type: 'triangle', freq: 784 * Math.pow(1.26, index), dur: 0.34, gain: 0.14, attack: 0.01 });
  },

  ui(): void {
    tone({ type: 'square', freq: 520, dur: 0.05, gain: 0.05, filter: 2200 });
  },

  back(): void {
    tone({ type: 'square', freq: 300, to: 220, dur: 0.09, gain: 0.05, filter: 1600 });
  },
};
