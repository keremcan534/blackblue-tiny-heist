import Phaser from 'phaser';
import { Audio } from '../audio/audio.ts';
import { TEX } from '../fx/textures.ts';
import { LEVEL_COUNT } from '../levels/index.ts';
import { C, spaced, textStyle, VIEW_H, VIEW_W } from '../theme.ts';
import { makeButton } from '../ui/widgets.ts';
import { Save } from '../util/storage.ts';

/** Title screen, with a slow diorama sweep behind the logo. */
export class MenuScene extends Phaser.Scene {
  private sweep!: Phaser.GameObjects.Graphics;
  private t = 0;
  private toggles: Phaser.GameObjects.Text[] = [];

  constructor() {
    super('Menu');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(C.bg);
    this.t = 0;
    this.toggles = [];

    this.drawBackdrop();

    this.sweep = this.add.graphics().setAlpha(0.9);

    const cx = VIEW_W / 2;

    const halo = this.add
      .image(cx, 312, TEX.glow)
      .setDisplaySize(340, 150)
      .setTint(C.cyan)
      .setAlpha(0.22)
      .setBlendMode(Phaser.BlendModes.ADD);

    const mark = spaced(
      this.add.text(cx, 250, 'TINY', textStyle({ size: 54, color: C.ink, weight: '800' })).setOrigin(0.5),
      13,
    );
    const mark2 = spaced(
      this.add.text(cx, 312, 'HEIST', textStyle({ size: 54, color: C.cyan, weight: '800' })).setOrigin(0.5),
      13,
    );
    this.tweens.add({
      targets: halo,
      alpha: 0.34,
      duration: 2200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.tweens.add({
      targets: [mark, mark2],
      y: '-=6',
      duration: 2600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    spaced(
      this.add
        .text(cx, 366, 'FREEZE TIME  ·  CHANGE THE ROUTE', textStyle({ size: 11, color: C.inkDim }))
        .setOrigin(0.5),
      3,
    );
    spaced(
      this.add
        .text(cx, 386, 'STEAL IT  ·  ESCAPE', textStyle({ size: 11, color: C.inkDim }))
        .setOrigin(0.5),
      3,
    );

    const save = Save.all();
    const next = Math.min(LEVEL_COUNT, save.unlocked);
    const fresh = Save.completed() === 0;

    makeButton(this, {
      x: cx,
      y: 520,
      w: 250,
      h: 62,
      label: fresh ? 'START THE JOB' : `CONTINUE  ·  ${String(next).padStart(2, '0')}`,
      size: 17,
      onClick: () => this.launch(next),
    });

    makeButton(this, {
      x: cx,
      y: 600,
      w: 250,
      h: 54,
      label: 'LEVEL SELECT',
      variant: 'ghost',
      size: 14,
      onClick: () => {
        Audio.unlock();
        this.scene.start('LevelSelect');
      },
    });

    const stars = Save.totalStars();
    spaced(
      this.add
        .text(cx, 660, `${stars} / ${LEVEL_COUNT * 3} STARS  ·  ${Save.completed()} / ${LEVEL_COUNT} CLEARED`,
          textStyle({ size: 11, color: C.inkFaint }))
        .setOrigin(0.5),
      2,
    );

    this.optionToggle(cx - 70, 745, () => (Audio.muted ? 'SOUND OFF' : 'SOUND ON'), () => {
      Audio.unlock();
      Audio.setMuted(!Audio.muted);
      if (!Audio.muted) Audio.startMusic();
      else Audio.stopMusic();
    });
    this.optionToggle(cx + 70, 745, () => (Save.all().haptics ? 'BUZZ ON' : 'BUZZ OFF'), () => {
      Save.setHaptics(!Save.all().haptics);
    });

    spaced(
      this.add
        .text(cx, VIEW_H - 34, 'HOLD TO FREEZE  ·  TAP TO ROUTE  ·  RELEASE TO GO',
          textStyle({ size: 9, color: C.inkFaint }))
        .setOrigin(0.5),
      1.6,
    );

    this.input.once('pointerdown', () => {
      Audio.unlock();
      if (!Audio.muted) Audio.startMusic();
    });
  }

  private launch(id: number): void {
    Audio.unlock();
    if (!Audio.muted) Audio.startMusic();
    this.scene.start('Game', { levelId: id });
  }

  private optionToggle(x: number, y: number, label: () => string, toggle: () => void): void {
    const t = spaced(
      this.add.text(x, y, label(), textStyle({ size: 11, color: C.inkDim })).setOrigin(0.5),
      2,
    );
    t.setInteractive({ useHandCursor: true });
    t.on('pointerdown', () => {
      toggle();
      this.toggles.forEach((o) => o.setColor('#8ea2bd'));
      t.setText(label());
      Audio.ui();
    });
    this.toggles.push(t);
  }

  /** Static parts of the backdrop: floor grid, warm pools, a dim vault outline. */
  private drawBackdrop(): void {
    const g = this.add.graphics();
    g.fillStyle(C.bgDeep, 1);
    g.fillRect(0, 0, VIEW_W, VIEW_H);

    g.fillStyle(C.floor, 1);
    g.fillRoundedRect(24, 120, VIEW_W - 48, VIEW_H - 200, 18);

    g.lineStyle(1, C.floorGrid, 0.5);
    for (let x = 24; x <= VIEW_W - 24; x += 36) {
      g.lineBetween(x, 120, x, VIEW_H - 80);
    }
    for (let y = 120; y <= VIEW_H - 80; y += 36) {
      g.lineBetween(24, y, VIEW_W - 24, y);
    }

    g.lineStyle(1.5, C.wallLip, 0.28);
    g.strokeRoundedRect(24, 120, VIEW_W - 48, VIEW_H - 200, 18);

    for (const [x, y, s] of [
      [96, 210, 300],
      [356, 430, 340],
      [130, 640, 320],
    ] as const) {
      this.add
        .image(x, y, TEX.pool)
        .setDisplaySize(s, s)
        .setTint(C.warm)
        .setAlpha(0.1)
        .setBlendMode(Phaser.BlendModes.ADD);
    }

    this.add
      .tileSprite(VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, TEX.grain)
      .setAlpha(0.5)
      .setDepth(50);
  }

  update(_time: number, delta: number): void {
    this.t += (Number.isFinite(delta) ? delta : 16) / 1000;
    const g = this.sweep;
    g.clear();

    // A lone camera cone sweeping the empty gallery.
    const ox = 352;
    const oy = 168;
    const a = Math.PI * 0.62 + Math.sin(this.t * 0.42) * 0.55;
    const half = 0.42;
    const len = 300;
    g.fillStyle(C.red, 0.06);
    g.beginPath();
    g.moveTo(ox, oy);
    for (let i = 0; i <= 16; i++) {
      const th = a - half + (half * 2 * i) / 16;
      g.lineTo(ox + Math.cos(th) * len, oy + Math.sin(th) * len);
    }
    g.closePath();
    g.fillPath();

    g.lineStyle(1, C.red, 0.16);
    g.lineBetween(ox, oy, ox + Math.cos(a - half) * len, oy + Math.sin(a - half) * len);
    g.lineBetween(ox, oy, ox + Math.cos(a + half) * len, oy + Math.sin(a + half) * len);

    g.fillStyle(C.red, 0.85);
    g.fillCircle(ox, oy, 4);
    g.fillStyle(C.redSoft, 0.35);
    g.fillCircle(ox, oy, 8 + Math.sin(this.t * 3) * 1.4);
  }
}
