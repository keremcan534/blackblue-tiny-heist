import Phaser from 'phaser';
import { Audio } from '../audio/audio.ts';
import { C, spaced, textStyle } from '../theme.ts';
import { haptic } from '../util/haptics.ts';

export type ButtonVariant = 'primary' | 'ghost' | 'danger';

export interface ButtonOpts {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  onClick: () => void;
  variant?: ButtonVariant;
  size?: number;
  enabled?: boolean;
}

const FILL: Record<ButtonVariant, { fill: number; alpha: number; stroke: number; text: number }> = {
  primary: { fill: C.cyan, alpha: 0.14, stroke: C.cyan, text: C.cyan },
  ghost: { fill: C.ink, alpha: 0.05, stroke: C.inkFaint, text: C.inkDim },
  danger: { fill: C.red, alpha: 0.12, stroke: C.red, text: C.redSoft },
};

export function makeButton(scene: Phaser.Scene, o: ButtonOpts): Phaser.GameObjects.Container {
  const variant = o.variant ?? 'primary';
  const skin = FILL[variant];
  const enabled = o.enabled !== false;

  const box = scene.add.graphics();
  const label = spaced(
    scene.add
      .text(0, 0, o.label, textStyle({ size: o.size ?? 15, color: skin.text, weight: '700' }))
      .setOrigin(0.5),
    2.2,
  );

  const draw = (scale: number, glow: number) => {
    box.clear();
    const w = o.w * scale;
    const h = o.h * scale;
    box.fillStyle(skin.fill, (enabled ? skin.alpha : skin.alpha * 0.4) + glow * 0.14);
    box.fillRoundedRect(-w / 2, -h / 2, w, h, Math.min(14, h / 2));
    box.lineStyle(1.5, skin.stroke, (enabled ? 0.55 : 0.2) + glow * 0.4);
    box.strokeRoundedRect(-w / 2, -h / 2, w, h, Math.min(14, h / 2));
  };
  draw(1, 0);

  const container = scene.add.container(o.x, o.y, [box, label]);
  container.setSize(o.w, o.h);
  label.setAlpha(enabled ? 1 : 0.35);

  if (!enabled) return container;

  container.setInteractive(
    new Phaser.Geom.Rectangle(-o.w / 2, -o.h / 2, o.w, o.h),
    Phaser.Geom.Rectangle.Contains,
  );

  container.on('pointerover', () => draw(1, 1));
  container.on('pointerout', () => {
    draw(1, 0);
    container.setScale(1);
  });
  container.on('pointerdown', () => {
    container.setScale(0.96);
    draw(1, 1);
    Audio.ui();
    haptic('light');
  });
  container.on('pointerup', () => {
    container.setScale(1);
    draw(1, 0);
    o.onClick();
  });

  return container;
}

/** Three chevron stars; `count` are lit. */
export function starRow(
  scene: Phaser.Scene,
  x: number,
  y: number,
  count: number,
  radius: number,
  gap = radius * 2.4,
): Phaser.GameObjects.Container {
  const g = scene.add.graphics();
  for (let i = 0; i < 3; i++) {
    const cx = (i - 1) * gap;
    const lit = i < count;
    drawStar(g, cx, 0, radius, lit ? C.gold : C.inkFaint, lit ? 1 : 0.45, lit);
  }
  return scene.add.container(x, y, [g]);
}

export function drawStar(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  r: number,
  color: number,
  alpha: number,
  filled: boolean,
): void {
  const pts: number[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.44;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  if (filled) {
    g.fillStyle(color, alpha);
    g.fillPoints(toPoints(pts), true);
  }
  g.lineStyle(1.2, color, filled ? alpha : alpha * 0.9);
  g.strokePoints(toPoints(pts), true);
}

function toPoints(flat: number[]): Phaser.Geom.Point[] {
  const out: Phaser.Geom.Point[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push(new Phaser.Geom.Point(flat[i], flat[i + 1]));
  return out;
}

/** A soft framed panel used by every overlay card. */
export function panel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  stroke: number = C.inkFaint,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(0x0a0f18, 0.94);
  g.fillRoundedRect(x - w / 2, y - h / 2, w, h, 20);
  g.lineStyle(1.4, stroke, 0.5);
  g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 20);
  return g;
}
