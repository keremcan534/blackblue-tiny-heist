import Phaser from 'phaser';
import { Audio } from '../audio/audio.ts';
import { ALERT_TICKS } from '../core/constants.ts';
import { LEVEL_COUNT } from '../levels/index.ts';
import { TUNING } from '../levels/tuning.ts';
import { C, css, spaced, textStyle, VIEW_H, VIEW_W } from '../theme.ts';
import { drawStar, makeButton, panel } from '../ui/widgets.ts';
import { Save } from '../util/storage.ts';
import type { GameView, RunResult } from './view.ts';

/**
 * Chrome layer above the board.
 *
 * Pulls state from GameScene each frame instead of being pushed to, so a scene
 * restart needs no teardown handshake - the HUD simply notices a new run id.
 */
export class HudScene extends Phaser.Scene {
  private view!: GameView;
  private seenRun = -1;

  private title!: Phaser.GameObjects.Text;
  private clock!: Phaser.GameObjects.Text;
  private lootText!: Phaser.GameObjects.Text;
  private tapsText!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private frozenLabel!: Phaser.GameObjects.Text;
  private gPips!: Phaser.GameObjects.Graphics;
  private gAlert!: Phaser.GameObjects.Graphics;
  private gFrame!: Phaser.GameObjects.Graphics;

  private intro!: Phaser.GameObjects.Container;
  private resultCard: Phaser.GameObjects.Container | null = null;
  private t = 0;

  constructor() {
    super('Hud');
  }

  create(): void {
    this.view = this.scene.get('Game') as unknown as GameView;
    this.seenRun = -1;
    this.resultCard = null;
    this.t = 0;

    const bar = this.add.graphics();
    bar.fillStyle(C.bgDeep, 0.9);
    bar.fillRect(0, 0, VIEW_W, 88);
    bar.fillRect(0, VIEW_H - 92, VIEW_W, 92);
    bar.lineStyle(1, C.floorGrid, 0.8);
    bar.lineBetween(0, 88, VIEW_W, 88);
    bar.lineBetween(0, VIEW_H - 92, VIEW_W, VIEW_H - 92);

    this.iconButton(30, 30, 'back', () => this.view.gotoSelect());
    this.iconButton(VIEW_W - 30, 30, 'restart', () => this.view.restartRun());

    this.title = spaced(
      this.add.text(VIEW_W / 2, 24, '', textStyle({ size: 13, color: C.ink, weight: '700' })).setOrigin(0.5),
      3.4,
    );
    this.add.text(0, 0, '');

    this.gPips = this.add.graphics();
    this.lootText = spaced(
      this.add.text(28, 62, '', textStyle({ size: 10, color: C.inkDim })).setOrigin(0, 0.5),
      1.6,
    );
    this.clock = this.add
      .text(VIEW_W / 2, 62, '0.00s', {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '14px',
        color: css(C.ink),
      })
      .setOrigin(0.5);
    this.tapsText = spaced(
      this.add.text(VIEW_W - 28, 62, '', textStyle({ size: 10, color: C.inkDim, align: 'right' })).setOrigin(1, 0.5),
      1.6,
    );

    this.hint = spaced(
      this.add
        .text(VIEW_W / 2, VIEW_H - 58, '', {
          ...textStyle({ size: 11, color: C.inkDim, align: 'center' }),
          wordWrap: { width: VIEW_W - 48 },
        })
        .setOrigin(0.5),
      1.8,
    );
    this.frozenLabel = spaced(
      this.add
        .text(VIEW_W / 2, VIEW_H - 30, 'TIME FROZEN', textStyle({ size: 10, color: C.cyan, weight: '700' }))
        .setOrigin(0.5),
      6,
    );
    this.frozenLabel.setAlpha(0);

    this.gAlert = this.add.graphics().setDepth(5);
    this.gFrame = this.add.graphics().setDepth(4);

    this.buildIntro();
  }

  private iconButton(x: number, y: number, kind: 'back' | 'restart', onClick: () => void): void {
    const g = this.add.graphics();
    g.lineStyle(1.3, C.inkFaint, 0.5);
    g.strokeRoundedRect(x - 19, y - 17, 38, 34, 10);
    g.lineStyle(2, C.inkDim, 0.95);
    if (kind === 'back') {
      g.beginPath();
      g.moveTo(x + 4, y - 6);
      g.lineTo(x - 4, y);
      g.lineTo(x + 4, y + 6);
      g.strokePath();
    } else {
      g.beginPath();
      g.arc(x, y, 7.5, Math.PI * 0.35, Math.PI * 1.85);
      g.strokePath();
      g.fillStyle(C.inkDim, 0.95);
      g.fillTriangle(x + 4.5, y - 10.5, x + 11, y - 6.5, x + 3.5, y - 3.5);
    }
    const zone = this.add.zone(x, y, 46, 44).setInteractive({ useHandCursor: true });
    zone.on('pointerup', onClick);
  }

  private buildIntro(): void {
    const y = VIEW_H / 2 - 40;
    const bg = this.add.graphics();
    bg.fillStyle(C.bgDeep, 0.82);
    bg.fillRect(0, 0, VIEW_W, VIEW_H);

    const num = spaced(
      this.add
        .text(VIEW_W / 2, y - 52, '', textStyle({ size: 11, color: C.cyanDim, weight: '700' }))
        .setOrigin(0.5),
      6,
    );
    const name = spaced(
      this.add.text(VIEW_W / 2, y - 12, '', textStyle({ size: 30, color: C.ink, weight: '800' })).setOrigin(0.5),
      6,
    );
    const brief = this.add
      .text(VIEW_W / 2, y + 30, '', {
        ...textStyle({ size: 12, color: C.inkDim, align: 'center' }),
        wordWrap: { width: VIEW_W - 90 },
      })
      .setOrigin(0.5);
    const rule = this.add.graphics();
    rule.lineStyle(1, C.cyan, 0.4);
    rule.lineBetween(VIEW_W / 2 - 40, y + 8, VIEW_W / 2 + 40, y + 8);

    this.intro = this.add.container(0, 0, [bg, num, name, brief, rule]).setDepth(30);
    this.intro.setData('num', num);
    this.intro.setData('name', name);
    this.intro.setData('brief', brief);
  }

  private refreshIntro(): void {
    const def = this.view.lv.def;
    (this.intro.getData('num') as Phaser.GameObjects.Text).setText(
      `JOB ${String(def.id).padStart(2, '0')} / ${LEVEL_COUNT}`,
    );
    (this.intro.getData('name') as Phaser.GameObjects.Text).setText(def.name);
    (this.intro.getData('brief') as Phaser.GameObjects.Text).setText(def.brief);
    this.intro.setAlpha(1);
  }

  update(_time: number, delta: number): void {
    this.t += (Number.isFinite(delta) ? delta : 16) / 1000;
    const v = this.view;
    if (!v || !v.lv || !v.sim) return;

    if (v.runId !== this.seenRun) {
      this.seenRun = v.runId;
      this.onNewRun();
    }

    const sim = v.sim;
    const def = v.lv.def;

    this.title.setText(`${String(def.id).padStart(2, '0')} · ${def.name}`);
    this.clock.setText(`${sim.seconds.toFixed(2)}s`);

    const par = TUNING[def.id]?.par ?? 0;
    this.clock.setColor(par && sim.seconds > par ? css(C.warm) : css(C.ink));

    const totalLoot = v.lv.loot.length;
    this.lootText.setText(`LOOT ${sim.lootTaken}/${totalLoot}`);
    this.drawPips();

    if (v.lv.maxWaypoints > 0) {
      const left = Math.max(0, v.lv.maxWaypoints - sim.waypointsUsed);
      this.tapsText.setText(`ROUTES ${left}/${v.lv.maxWaypoints}`);
      this.tapsText.setColor(left === 0 ? css(C.red) : left <= 2 ? css(C.warm) : css(C.inkDim));
    } else {
      this.tapsText.setText(`ROUTES ${sim.waypointsUsed}`);
      this.tapsText.setColor(css(C.inkDim));
    }

    this.intro.setAlpha(v.introLeft > 0 ? Math.min(1, v.introLeft / 320) : 0);
    if (v.introLeft <= 0) this.intro.setVisible(false);

    this.frozenLabel.setAlpha(v.freezeAmount * (0.65 + 0.35 * Math.sin(this.t * 6)));

    if (!v.hasFrozenOnce && v.introLeft <= 0 && sim.status === 'running') {
      this.hint.setText('HOLD ANYWHERE TO FREEZE TIME');
      this.hint.setAlpha(0.55 + 0.45 * Math.sin(this.t * 3.4));
      this.hint.setColor(css(C.cyan));
    } else if (sim.status === 'running') {
      this.hint.setAlpha(1);
      this.hint.setColor(css(C.inkDim));
      this.hint.setText(
        sim.hasAllLoot ? 'ALL LOOT SECURED — GET TO THE EXIT' : def.brief,
      );
    }

    this.drawAlert(sim.alert / ALERT_TICKS, v.freezeAmount);

    if (v.result && v.resultReady && !this.resultCard) this.showResult(v.result);
  }

  private onNewRun(): void {
    if (this.resultCard) {
      this.resultCard.destroy();
      this.resultCard = null;
    }
    this.intro.setVisible(true);
    this.refreshIntro();
  }

  private drawPips(): void {
    const sim = this.view.sim;
    const g = this.gPips;
    g.clear();
    const startX = 116;
    const y = 62;
    this.view.lv.loot.forEach((l, i) => {
      const x = startX + i * 13;
      const got = sim.isCollected(l);
      g.fillStyle(got ? C.gold : C.inkFaint, got ? 1 : 0.4);
      g.fillCircle(x, y, got ? 4 : 3);
    });
    this.view.lv.keys.forEach((k, i) => {
      const x = VIEW_W - 132 - i * 15;
      const got = sim.isCollected(k);
      g.fillStyle(C.key[k.color], got ? 1 : 0.22);
      g.fillRoundedRect(x - 5, y - 3.5, 10, 7, 2);
    });
  }

  private drawAlert(ratio: number, freeze: number): void {
    const g = this.gAlert;
    g.clear();
    if (ratio > 0.001) {
      for (let i = 0; i < 7; i++) {
        const inset = i * 5;
        g.lineStyle(5, C.red, ratio * 0.2 * (1 - i / 7));
        g.strokeRect(inset, inset, VIEW_W - inset * 2, VIEW_H - inset * 2);
      }
    }

    const f = this.gFrame;
    f.clear();
    if (freeze > 0.02) {
      for (let i = 0; i < 5; i++) {
        const inset = i * 4;
        f.lineStyle(4, C.cyan, freeze * 0.11 * (1 - i / 5));
        f.strokeRect(inset, inset, VIEW_W - inset * 2, VIEW_H - inset * 2);
      }
    }
  }

  private showResult(r: RunResult): void {
    const cx = VIEW_W / 2;
    const w = 340;
    const h = r.won ? 410 : 330;
    // Sit in the half of the screen the player is NOT being asked to look at.
    const wanted = r.focusY < VIEW_H / 2 ? VIEW_H / 2 + 118 : VIEW_H / 2 - 118;
    const cy = Math.min(Math.max(wanted, 96 + h / 2), VIEW_H - 100 - h / 2);

    const shade = this.add.graphics();
    shade.fillStyle(0x03060c, r.won ? 0.78 : 0.6);
    shade.fillRect(0, 0, VIEW_W, VIEW_H);

    const card = panel(this, cx, cy, w, h, r.won ? C.cyan : C.red);
    const items: Phaser.GameObjects.GameObject[] = [shade, card];

    const heading = spaced(
      this.add
        .text(cx, cy - h / 2 + 42, r.won ? 'CLEAN GETAWAY' : 'BUSTED',
          textStyle({ size: 24, color: r.won ? C.exit : C.red, weight: '800' }))
        .setOrigin(0.5),
      5,
    );
    items.push(heading);

    const reason = spaced(
      this.add
        .text(cx, cy - h / 2 + 74, r.won ? `${r.seconds.toFixed(2)}s  ·  PAR ${r.par}s` : r.reason,
          textStyle({ size: 12, color: C.inkDim }))
        .setOrigin(0.5),
      2.4,
    );
    items.push(reason);

    const detail = this.add
      .text(cx, cy - h / 2 + 100, r.detail, {
        ...textStyle({ size: 11, color: C.inkFaint, align: 'center' }),
        wordWrap: { width: w - 60 },
      })
      .setOrigin(0.5);
    items.push(detail);

    if (r.won) {
      const g = this.add.graphics();
      items.push(g);
      const starY = cy - 40;
      for (let i = 0; i < 3; i++) {
        const lit = i < r.stars;
        drawStar(g, cx + (i - 1) * 56, starY, lit ? 22 : 18, lit ? C.gold : C.inkFaint, lit ? 1 : 0.35, lit);
        if (lit) {
          this.time.delayedCall(160 + i * 170, () => Audio.star(i));
        }
      }

      const labels = ['ESCAPED', `UNDER ${r.par}s`, 'NEVER SEEN'];
      const won = [true, r.underPar, r.ghost];
      labels.forEach((label, i) => {
        items.push(
          spaced(
            this.add
              .text(cx + (i - 1) * 56, starY + 34, label,
                textStyle({ size: 8, color: won[i] ? C.gold : C.inkFaint, align: 'center' }))
              .setOrigin(0.5),
            0.8,
          ),
        );
      });

      if (r.newBest && !r.firstClear) {
        items.push(
          spaced(
            this.add
              .text(cx, starY + 62, 'NEW BEST TIME', textStyle({ size: 10, color: C.cyan, weight: '700' }))
              .setOrigin(0.5),
            3,
          ),
        );
      }
    }

    const rowY = r.won ? cy + 70 : cy + 26;
    if (r.won) {
      const last = this.view.levelId >= LEVEL_COUNT;
      items.push(
        makeButton(this, {
          x: cx,
          y: rowY,
          w: 250,
          h: 54,
          label: last ? 'BACK TO JOBS' : 'NEXT JOB',
          size: 15,
          onClick: () => this.view.gotoNext(),
        }),
      );
    } else {
      items.push(
        makeButton(this, {
          x: cx,
          y: rowY,
          w: 250,
          h: 54,
          label: 'TRY AGAIN',
          size: 15,
          onClick: () => this.view.restartRun(),
        }),
      );
    }

    items.push(
      makeButton(this, {
        x: cx - 66,
        y: rowY + 64,
        w: 118,
        h: 44,
        label: r.won ? 'REPLAY' : 'JOBS',
        variant: 'ghost',
        size: 12,
        onClick: () => (r.won ? this.view.restartRun() : this.view.gotoSelect()),
      }),
    );
    items.push(
      makeButton(this, {
        x: cx + 66,
        y: rowY + 64,
        w: 118,
        h: 44,
        label: r.won ? 'JOBS' : 'MENU',
        variant: 'ghost',
        size: 12,
        onClick: () => {
          if (r.won) this.view.gotoSelect();
          else {
            this.scene.stop();
            this.scene.get('Game').scene.start('Menu');
          }
        },
      }),
    );

    const total = spaced(
      this.add
        .text(cx, cy + h / 2 - 26, `${Save.totalStars()} / ${LEVEL_COUNT * 3} STARS COLLECTED`,
          textStyle({ size: 9, color: C.inkFaint }))
        .setOrigin(0.5),
      2,
    );
    items.push(total);

    this.resultCard = this.add.container(0, 0, items).setDepth(40);
    this.resultCard.setAlpha(0);
    this.tweens.add({ targets: this.resultCard, alpha: 1, duration: 260, ease: 'Cubic.easeOut' });
  }
}
