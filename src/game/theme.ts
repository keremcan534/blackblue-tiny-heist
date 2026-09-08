/**
 * Miniature-diorama palette.
 *
 * Dark cold floors, warm tungsten pools from above, red for anything that can
 * see you, cyan for the only thing on your side.
 */
export const C = {
  bg: 0x05070c,
  bgDeep: 0x03050a,

  // The floor is the lit surface; walls are dark slabs that only catch light on
  // their top rim. Inverting this reads as "bright maze on dark floor" instead
  // of a miniature room lit from above.
  floor: 0x212a3b,
  floorAlt: 0x1b2331,
  floorGrid: 0x2b3548,
  floorEdge: 0x0b0f18,

  wall: 0x080c14,
  wallTop: 0x141a26,
  wallLip: 0x64769c,
  wallShadow: 0x03050a,

  warm: 0xffb265,
  warmSoft: 0xff9a3c,

  cyan: 0x38f0d8,
  cyanDim: 0x1d8f84,
  cyanGlow: 0x8dfff0,

  red: 0xff4d5e,
  redDeep: 0xb01f2e,
  redSoft: 0xff8a94,

  gold: 0xffc857,
  goldGlow: 0xffe9a8,

  exit: 0x63f0a0,
  exitDim: 0x2b7a55,

  noise: 0xf0a54a,
  noiseDim: 0x6b4a1e,

  ink: 0xe8f4ff,
  inkDim: 0x8ea2bd,
  inkFaint: 0x4d5c74,

  key: [0xff5a6e, 0x63e07a, 0x5aa8ff] as const,
  keyDim: [0x7d2733, 0x2c6b39, 0x27507f] as const,
} as const;

export const css = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

export const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/**
 * Design resolution, letterboxed to fit.
 *
 * 420x900 is 0.467 - within a percent of the 0.462 that modern phones use, so
 * the black bars are a few pixels rather than a band.
 */
export const VIEW_W = 420;
export const VIEW_H = 900;

export interface TextStyleOpts {
  size?: number;
  color?: number;
  weight?: '400' | '600' | '700' | '800';
  spacing?: number;
  align?: 'left' | 'center' | 'right';
}

export function textStyle(o: TextStyleOpts = {}): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontFamily: FONT,
    fontSize: `${o.size ?? 14}px`,
    color: css(o.color ?? C.ink),
    fontStyle: o.weight ?? '600',
    align: o.align ?? 'left',
  };
}

/** Phaser's letterSpacing landed in 3.60 - guard it so a bundle swap cannot crash. */
export function spaced(t: Phaser.GameObjects.Text, px: number): Phaser.GameObjects.Text {
  const anyText = t as unknown as { setLetterSpacing?: (v: number) => unknown };
  if (typeof anyText.setLetterSpacing === 'function') anyText.setLetterSpacing(px);
  return t;
}
