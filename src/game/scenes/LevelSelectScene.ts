import Phaser from 'phaser';
import { Audio } from '../audio/audio.ts';
import { TEX } from '../fx/textures.ts';
import { CHAPTERS, LEVEL_COUNT, LEVEL_DEFS } from '../levels/index.ts';
import { TUNING } from '../levels/tuning.ts';
import { C, spaced, textStyle, VIEW_H, VIEW_W } from '../theme.ts';
import { drawStar, makeButton } from '../ui/widgets.ts';
import { Save } from '../util/storage.ts';
import { haptic } from '../util/haptics.ts';

const COLS = 5;
const CELL = 68;
const CELL_GAP = 8;

/** Six chapters of five jobs, with stars and best times. */
export class LevelSelectScene extends Phaser.Scene {
  constructor() {
    super('LevelSelect');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(C.bg);

    const g = this.add.graphics();
    g.fillStyle(C.bgDeep, 1);
    g.fillRect(0, 0, VIEW_W, VIEW_H);
    this.add
      .tileSprite(VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, TEX.grain)
      .setAlpha(0.45)
      .setDepth(60);

    const cx = VIEW_W / 2;
    spaced(this.add.text(cx, 52, 'SELECT A JOB', textStyle({ size: 20, color: C.ink, weight: '800' })).setOrigin(0.5), 6);
    spaced(
      this.add
        .text(cx, 78, `${Save.totalStars()} / ${LEVEL_COUNT * 3} STARS`, textStyle({ size: 10, color: C.inkFaint }))
        .setOrigin(0.5),
      2,
    );

    const gridW = COLS * CELL + (COLS - 1) * CELL_GAP;
    const left = (VIEW_W - gridW) / 2;
    let y = 122;

    for (const chapter of CHAPTERS) {
      spaced(
        this.add.text(left, y, chapter.title, textStyle({ size: 10, color: C.cyanDim, weight: '700' })),
        3.4,
      );
      const line = this.add.graphics();
      line.lineStyle(1, C.floorGrid, 0.85);
      line.lineBetween(left + 96, y + 6, left + gridW, y + 6);
      y += 22;

      for (let i = chapter.from; i <= chapter.to; i++) {
        const col = i - chapter.from;
        this.cell(left + col * (CELL + CELL_GAP), y, i);
      }
      y += CELL + 18;
    }

    makeButton(this, {
      x: cx,
      y: VIEW_H - 48,
      w: 180,
      h: 46,
      label: 'BACK',
      variant: 'ghost',
      size: 13,
      onClick: () => {
        Audio.back();
        this.scene.start('Menu');
      },
    });
  }

  private cell(x: number, y: number, id: number): void {
    const unlocked = Save.isUnlocked(id);
    const rec = Save.record(id);
    const def = LEVEL_DEFS.find((l) => l.id === id);
    const g = this.add.graphics();

    const accent = rec.stars === 3 ? C.gold : rec.stars > 0 ? C.cyan : unlocked ? C.inkDim : C.inkFaint;

    g.fillStyle(unlocked ? C.floor : C.floorAlt, unlocked ? 1 : 0.55);
    g.fillRoundedRect(x, y, CELL, CELL, 12);
    g.lineStyle(1.4, accent, unlocked ? (rec.stars > 0 ? 0.65 : 0.3) : 0.14);
    g.strokeRoundedRect(x, y, CELL, CELL, 12);

    if (rec.ghost) {
      g.lineStyle(1, C.cyanGlow, 0.35);
      g.strokeRoundedRect(x + 3.5, y + 3.5, CELL - 7, CELL - 7, 9);
    }

    const num = spaced(
      this.add
        .text(x + CELL / 2, y + 24, String(id).padStart(2, '0'),
          textStyle({ size: 21, color: unlocked ? C.ink : C.inkFaint, weight: '800' }))
        .setOrigin(0.5),
      1.5,
    );
    if (!unlocked) num.setAlpha(0.45);

    if (unlocked) {
      const stars = this.add.graphics();
      for (let s = 0; s < 3; s++) {
        const lit = s < rec.stars;
        drawStar(stars, x + CELL / 2 + (s - 1) * 15, y + 48, 5.5, lit ? C.gold : C.inkFaint, lit ? 1 : 0.4, lit);
      }
      const label = rec.best > 0 ? `${rec.best.toFixed(1)}s` : (def?.maxWaypoints ? `${def.maxWaypoints} TAPS` : '—');
      this.add
        .text(x + CELL / 2, y + 62, label, textStyle({ size: 9, color: rec.best > 0 ? C.inkDim : C.inkFaint }))
        .setOrigin(0.5);

      const zone = this.add
        .zone(x + CELL / 2, y + CELL / 2, CELL, CELL)
        .setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => {
        Audio.ui();
        haptic('light');
      });
      zone.on('pointerup', () => {
        Audio.unlock();
        if (!Audio.muted) Audio.startMusic();
        this.scene.start('Game', { levelId: id });
      });
    } else {
      // Padlock glyph.
      const lock = this.add.graphics();
      lock.lineStyle(1.6, C.inkFaint, 0.55);
      lock.strokeRoundedRect(x + CELL / 2 - 8, y + 42, 16, 13, 3);
      lock.beginPath();
      lock.arc(x + CELL / 2, y + 42, 5.5, Math.PI, 0);
      lock.strokePath();
      const par = TUNING[id];
      if (par) {
        this.add
          .text(x + CELL / 2, y + 63, 'LOCKED', textStyle({ size: 8, color: C.inkFaint }))
          .setOrigin(0.5)
          .setAlpha(0.7);
      }
    }
  }
}
