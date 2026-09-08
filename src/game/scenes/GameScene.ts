import Phaser from 'phaser';
import { Audio } from '../audio/audio.ts';
import { ALERT_TICKS, NOISE_RANGE_MULT, TICK_MS, TILE_TICKS } from '../core/constants.ts';
import { buildLevel, isNoisyAt, isOpenTile, isWalkable } from '../core/level.ts';
import { cameraAngleAt, guardAt, laserOnAt } from '../core/sensors.ts';
import { Sim } from '../core/sim.ts';
import { TileKind, type LevelRuntime } from '../core/types.ts';
import { TEX } from '../fx/textures.ts';
import { levelById, LEVEL_COUNT } from '../levels/index.ts';
import { TUNING } from '../levels/tuning.ts';
import { C, VIEW_H, VIEW_W } from '../theme.ts';
import { haptic } from '../util/haptics.ts';
import { Save } from '../util/storage.ts';
import type { GameView, RunResult } from './view.ts';

const BOARD_TOP = 96;
const BOARD_BOTTOM = VIEW_H - 104;
const INTRO_MS = 1750;

interface SensorPose {
  x: number;
  y: number;
  a: number;
  range: number;
  half: number;
  idle: boolean;
  hears: boolean;
}

/** The playfield: renders the diorama and owns the freeze/route interaction. */
export class GameScene extends Phaser.Scene implements GameView {
  levelId = 1;
  runId = 0;
  lv!: LevelRuntime;
  sim!: Sim;

  frozen = false;
  freezeAmount = 0;
  introLeft = INTRO_MS;
  result: RunResult | null = null;
  hasFrozenOnce = false;

  /**
   * Beat between the run ending and the card appearing.
   *
   * On a bust the player has to be able to SEE the cone, the beam and the guard
   * that caught them - a card slapped up instantly would hide the one piece of
   * information that makes the loss fair.
   */
  private resultDelay = 0;

  get resultReady(): boolean {
    return this.result !== null && this.resultDelay <= 0;
  }

  private tile = 0;
  private ox = 0;
  private oy = 0;
  private acc = 0;
  private timeScale = 1;
  private clock = 0;

  private gCones!: Phaser.GameObjects.Graphics;
  private gWorld!: Phaser.GameObjects.Graphics;
  private gPreview!: Phaser.GameObjects.Graphics;
  private timeText!: Phaser.GameObjects.Text;
  private freezeTint!: Phaser.GameObjects.Rectangle;
  private scanlines!: Phaser.GameObjects.TileSprite;
  private thiefGlow!: Phaser.GameObjects.Image;

  private guardPoses: SensorPose[] = [];
  private cameraPoses: SensorPose[] = [];

  private previewPath: [number, number][] | null = null;
  private previewTarget: { x: number; y: number } | null = null;
  private previewValid = false;
  private reach: Uint16Array | null = null;
  private trail: { x: number; y: number }[] = [];
  private lastFootTick = -99;
  private denyFlash = 0;

  constructor() {
    super('Game');
  }

  init(data: { levelId?: number }): void {
    this.levelId = Math.min(LEVEL_COUNT, Math.max(1, data?.levelId ?? 1));
  }

  create(): void {
    const def = levelById(this.levelId);
    if (!def) {
      this.scene.start('Menu');
      return;
    }

    this.runId++;
    this.lv = buildLevel(def);
    this.sim = new Sim(this.lv);
    this.frozen = false;
    this.freezeAmount = 0;
    this.timeScale = 1;
    this.acc = 0;
    this.clock = 0;
    this.introLeft = INTRO_MS;
    this.result = null;
    this.resultDelay = 0;
    this.hasFrozenOnce = false;
    this.previewPath = null;
    this.previewTarget = null;
    this.reach = null;
    this.trail = [];
    this.lastFootTick = -99;
    this.denyFlash = 0;

    this.cameras.main.setBackgroundColor(C.bg);
    this.layout();
    this.drawStatic();

    this.gCones = this.add.graphics().setDepth(20);
    this.thiefGlow = this.add
      .image(0, 0, TEX.glow)
      .setDepth(28)
      .setTint(C.cyan)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(this.tile * 3.4, this.tile * 3.4);
    this.gWorld = this.add.graphics().setDepth(30);

    this.freezeTint = this.add
      .rectangle(VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, 0x0a1a2e, 0)
      .setDepth(34);
    this.scanlines = this.add
      .tileSprite(VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, TEX.scan)
      .setDepth(35)
      .setAlpha(0);
    this.gPreview = this.add.graphics().setDepth(40);
    // Built here, never lazily: `scene.restart()` reuses this instance, so a
    // cached game object from the previous run would be a destroyed husk.
    this.timeText = this.add
      .text(0, 0, '', {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '10px',
        color: '#8dfff0',
      })
      .setOrigin(0.5)
      .setDepth(41)
      .setAlpha(0);

    this.add
      .tileSprite(VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, TEX.grain)
      .setDepth(45)
      .setAlpha(0.4);

    this.scene.launch('Hud');
    this.scene.bringToTop('Hud');

    this.bindInput();
  }

  /* ------------------------------------------------------------------ layout */

  private layout(): void {
    const availW = VIEW_W - 28;
    const availH = BOARD_BOTTOM - BOARD_TOP;
    this.tile = Math.floor(Math.min(availW / this.lv.w, availH / this.lv.h));
    const boardW = this.tile * this.lv.w;
    const boardH = this.tile * this.lv.h;
    this.ox = Math.round((VIEW_W - boardW) / 2);
    this.oy = Math.round(BOARD_TOP + (availH - boardH) / 2);
  }

  private sx(tx: number): number {
    return this.ox + tx * this.tile;
  }

  private sy(ty: number): number {
    return this.oy + ty * this.tile;
  }

  private cx(tx: number): number {
    return this.ox + (tx + 0.5) * this.tile;
  }

  private cy(ty: number): number {
    return this.oy + (ty + 0.5) * this.tile;
  }

  private tileAt(px: number, py: number): { x: number; y: number } {
    return {
      x: Math.floor((px - this.ox) / this.tile),
      y: Math.floor((py - this.oy) / this.tile),
    };
  }

  /* ------------------------------------------------------------ static layer */

  private drawStatic(): void {
    const t = this.tile;
    const g = this.add.graphics().setDepth(4);

    // Diorama plinth.
    const pad = 9;
    g.fillStyle(C.bgDeep, 1);
    g.fillRoundedRect(
      this.ox - pad,
      this.oy - pad,
      this.lv.w * t + pad * 2,
      this.lv.h * t + pad * 2,
      14,
    );
    g.lineStyle(1.5, C.wallLip, 0.22);
    g.strokeRoundedRect(
      this.ox - pad,
      this.oy - pad,
      this.lv.w * t + pad * 2,
      this.lv.h * t + pad * 2,
      14,
    );

    // Floors.
    for (let y = 0; y < this.lv.h; y++) {
      for (let x = 0; x < this.lv.w; x++) {
        if (!isOpenTile(this.lv, x, y)) continue;
        g.fillStyle((x + y) % 2 === 0 ? C.floor : C.floorAlt, 1);
        g.fillRect(this.sx(x), this.sy(y), t, t);
      }
    }

    // Grid seams, only between two open tiles.
    g.lineStyle(1, C.floorGrid, 0.55);
    for (let y = 0; y < this.lv.h; y++) {
      for (let x = 0; x < this.lv.w; x++) {
        if (!isOpenTile(this.lv, x, y)) continue;
        if (isOpenTile(this.lv, x + 1, y)) {
          g.lineBetween(this.sx(x + 1), this.sy(y), this.sx(x + 1), this.sy(y) + t);
        }
        if (isOpenTile(this.lv, x, y + 1)) {
          g.lineBetween(this.sx(x), this.sy(y + 1), this.sx(x) + t, this.sy(y + 1));
        }
      }
    }

    // Noise floors: metal grating, drawn as a hatch so it never reads as a wall.
    if (this.lv.hasNoise) {
      const nz = this.add.graphics().setDepth(6);
      for (let y = 0; y < this.lv.h; y++) {
        for (let x = 0; x < this.lv.w; x++) {
          if (!this.lv.noise[y * this.lv.w + x]) continue;
          const px = this.sx(x);
          const py = this.sy(y);
          nz.fillStyle(C.noiseDim, 0.4);
          nz.fillRect(px, py, t, t);
          nz.lineStyle(1, C.noise, 0.28);
          for (let k = -t; k < t; k += 6) {
            const x0 = Math.max(px, px + k);
            const y0 = py + Math.max(0, -k);
            const x1 = Math.min(px + t, px + k + t);
            const y1 = py + Math.min(t, t - k);
            nz.lineBetween(x0, y0, x1, y1);
          }
          nz.lineStyle(1.2, C.noise, 0.5);
          nz.strokeRect(px + 0.6, py + 0.6, t - 1.2, t - 1.2);
        }
      }
    }

    // Warm tungsten pools.
    for (const [lx, ly] of this.lv.lights) {
      this.add
        .image(this.cx(lx), this.cy(ly), TEX.pool)
        .setDepth(5)
        .setDisplaySize(t * 8, t * 8)
        .setTint(C.warm)
        .setAlpha(0.26)
        .setBlendMode(Phaser.BlendModes.ADD);
    }

    const walls = this.add.graphics().setDepth(8);
    const isWall = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= this.lv.w || y >= this.lv.h) return false;
      return this.lv.grid[y * this.lv.w + x] === TileKind.Wall;
    };
    const anyOpenNeighbour = (x: number, y: number) =>
      isOpenTile(this.lv, x - 1, y) ||
      isOpenTile(this.lv, x + 1, y) ||
      isOpenTile(this.lv, x, y - 1) ||
      isOpenTile(this.lv, x, y + 1) ||
      isOpenTile(this.lv, x - 1, y - 1) ||
      isOpenTile(this.lv, x + 1, y - 1) ||
      isOpenTile(this.lv, x - 1, y + 1) ||
      isOpenTile(this.lv, x + 1, y + 1);

    const lip = Math.max(3, Math.round(t * 0.17));

    // Pass 1: contact shadow cast onto the floor below each wall run.
    walls.fillStyle(C.wallShadow, 0.5);
    for (let y = 0; y < this.lv.h; y++) {
      for (let x = 0; x < this.lv.w; x++) {
        if (!isWall(x, y) || !anyOpenNeighbour(x, y)) continue;
        if (isOpenTile(this.lv, x, y + 1)) {
          walls.fillRect(this.sx(x), this.sy(y) + t, t, lip * 1.5);
        }
      }
    }
    // Pass 2: the extruded side face.
    walls.fillStyle(C.wall, 1);
    for (let y = 0; y < this.lv.h; y++) {
      for (let x = 0; x < this.lv.w; x++) {
        if (!isWall(x, y) || !anyOpenNeighbour(x, y)) continue;
        walls.fillRect(this.sx(x), this.sy(y), t, t);
      }
    }
    // Pass 3: the lit top surface, inset from the bottom so the block reads as raised.
    walls.fillStyle(C.wallTop, 1);
    for (let y = 0; y < this.lv.h; y++) {
      for (let x = 0; x < this.lv.w; x++) {
        if (!isWall(x, y) || !anyOpenNeighbour(x, y)) continue;
        const shrink = isWall(x, y + 1) ? 0 : lip;
        walls.fillRect(this.sx(x), this.sy(y), t, t - shrink);
      }
    }
    // Pass 4: the highlight lip along every exposed top edge.
    walls.lineStyle(1.4, C.wallLip, 0.7);
    for (let y = 0; y < this.lv.h; y++) {
      for (let x = 0; x < this.lv.w; x++) {
        if (!isWall(x, y) || !anyOpenNeighbour(x, y)) continue;
        if (!isWall(x, y - 1)) {
          walls.lineBetween(this.sx(x), this.sy(y) + 0.7, this.sx(x) + t, this.sy(y) + 0.7);
        }
        if (!isWall(x - 1, y)) {
          walls.lineBetween(this.sx(x) + 0.7, this.sy(y), this.sx(x) + 0.7, this.sy(y) + t - lip);
        }
      }
    }
  }

  /* ------------------------------------------------------------------- input */

  private bindInput(): void {
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onDown(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onMove(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.onUp(p));
    this.input.on('pointerupoutside', (p: Phaser.Input.Pointer) => this.onUp(p));

    this.input.keyboard?.on('keydown-R', () => this.restartRun());
    this.input.keyboard?.on('keydown-ESC', () => this.gotoSelect());
  }

  private inBoard(p: Phaser.Input.Pointer): boolean {
    return p.y > BOARD_TOP - 40 && p.y < BOARD_BOTTOM + 34;
  }

  private onDown(p: Phaser.Input.Pointer): void {
    if (this.introLeft > 0) {
      this.introLeft = 0;
      return;
    }
    if (this.sim.status !== 'running' || !this.inBoard(p)) return;

    Audio.unlock();
    this.frozen = true;
    this.hasFrozenOnce = true;
    Save.markTaught();
    Audio.freeze();
    Audio.duckMusic(0.25);
    haptic('medium');
    this.reach = this.sim.reachField();
    this.updatePreview(p);
  }

  private onMove(p: Phaser.Input.Pointer): void {
    if (!this.frozen) return;
    this.updatePreview(p);
  }

  private onUp(p: Phaser.Input.Pointer): void {
    if (!this.frozen) return;
    this.updatePreview(p);
    this.frozen = false;
    Audio.duckMusic(1);

    if (this.previewValid && this.previewTarget) {
      if (this.sim.commit(this.previewTarget.x, this.previewTarget.y)) {
        Audio.place();
        haptic('light');
      } else {
        this.deny();
      }
    } else if (this.previewTarget) {
      this.deny();
    }

    Audio.unfreeze();
    this.previewPath = null;
    this.previewTarget = null;
    this.previewValid = false;
    this.reach = null;
  }

  private deny(): void {
    Audio.deny();
    haptic('warning');
    this.denyFlash = 1;
  }

  private updatePreview(p: Phaser.Input.Pointer): void {
    const t = this.tileAt(p.x, p.y);
    this.previewTarget = t;
    this.previewValid = false;
    this.previewPath = null;

    if (t.x < 0 || t.y < 0 || t.x >= this.lv.w || t.y >= this.lv.h) return;
    if (!isWalkable(this.lv, t.x, t.y, this.sim.mask)) return;
    if (this.sim.waypointsLeft <= 0) return;

    const path = this.sim.previewPath(t.x, t.y);
    if (!path) return;
    this.previewPath = path;
    this.previewValid = path.length > 0 || this.sim.moving || this.sim.path.length > 0;
  }

  /* -------------------------------------------------------------------- loop */

  update(_time: number, delta: number): void {
    // A restored tab can hand Phaser a garbage first delta; never let it poison
    // the accumulator, which would freeze the sim for the rest of the run.
    const dt = Number.isFinite(delta) ? Math.min(Math.max(delta, 0), 48) : 16;
    this.clock += dt;

    if (this.introLeft > 0) {
      this.introLeft = Math.max(0, this.introLeft - dt);
    }

    const target = this.frozen ? 0 : 1;
    const tau = this.frozen ? 60 : 110;
    this.timeScale += (target - this.timeScale) * (1 - Math.exp(-dt / tau));
    if (this.frozen && this.timeScale < 0.02) this.timeScale = 0;
    if (!this.frozen && this.timeScale > 0.99) this.timeScale = 1;
    this.freezeAmount = 1 - this.timeScale;

    if (this.introLeft <= 0 && this.sim.status === 'running') {
      this.acc += dt * this.timeScale;
      let guardSteps = 0;
      while (this.acc >= TICK_MS && guardSteps < 16) {
        const before = this.sim.status;
        this.sim.step();
        guardSteps++;
        this.acc -= TICK_MS;
        this.afterStep(before);
        if (this.sim.status !== 'running') break;
      }
    }

    if (this.resultDelay > 0) this.resultDelay = Math.max(0, this.resultDelay - dt);
    this.denyFlash = Math.max(0, this.denyFlash - dt / 260);
    this.pushTrail();
    this.renderFrame();
  }

  private afterStep(before: string): void {
    if (this.sim.arrivedThisTick && this.sim.tick - this.lastFootTick >= TILE_TICKS) {
      this.lastFootTick = this.sim.tick;
      Audio.footstep();
    }

    while (this.sim.pickups.length) {
      const ev = this.sim.pickups.shift()!;
      const px = this.cx(ev.collectible.x);
      const py = this.cy(ev.collectible.y);
      if (ev.collectible.kind === 'loot') {
        Audio.pickup();
        haptic('medium');
        this.burst(px, py, C.gold, 10);
      } else {
        Audio.keycard();
        haptic('light');
        this.burst(px, py, C.key[ev.collectible.color], 8);
        this.doorPulse(ev.collectible.color);
      }
    }

    if (before === 'running' && this.sim.status === 'won') this.onWin();
    if (before === 'running' && this.sim.status === 'caught') this.onCaught();
  }

  private doorPulse(color: number): void {
    for (const d of this.lv.doors) {
      if (d.color !== color) continue;
      Audio.door();
      const ring = this.add
        .image(this.cx(d.x), this.cy(d.y), TEX.glow)
        .setDepth(31)
        .setTint(C.key[color])
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDisplaySize(this.tile, this.tile);
      this.tweens.add({
        targets: ring,
        displayWidth: this.tile * 4,
        displayHeight: this.tile * 4,
        alpha: 0,
        duration: 520,
        ease: 'Cubic.easeOut',
        onComplete: () => ring.destroy(),
      });
    }
  }

  private burst(x: number, y: number, tint: number, count: number): void {
    const flare = this.add
      .image(x, y, TEX.spark)
      .setDepth(33)
      .setTint(tint)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(this.tile * 1.2, this.tile * 1.2);
    this.tweens.add({
      targets: flare,
      displayWidth: this.tile * 4.2,
      displayHeight: this.tile * 4.2,
      angle: 90,
      alpha: 0,
      duration: 520,
      ease: 'Cubic.easeOut',
      onComplete: () => flare.destroy(),
    });

    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const dot = this.add
        .image(x, y, TEX.glow)
        .setDepth(33)
        .setTint(tint)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDisplaySize(this.tile * 0.5, this.tile * 0.5);
      this.tweens.add({
        targets: dot,
        x: x + Math.cos(a) * this.tile * (1.1 + (i % 3) * 0.35),
        y: y + Math.sin(a) * this.tile * (1.1 + (i % 3) * 0.35),
        alpha: 0,
        displayWidth: 2,
        displayHeight: 2,
        duration: 420 + (i % 4) * 90,
        ease: 'Cubic.easeOut',
        onComplete: () => dot.destroy(),
      });
    }
  }

  private pushTrail(): void {
    const x = this.cx(this.sim.posX);
    const y = this.cy(this.sim.posY);
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(last.x - x, last.y - y) > 2) this.trail.push({ x, y });
    while (this.trail.length > 16) this.trail.shift();
  }

  /* ------------------------------------------------------------------ result */

  private onWin(): void {
    const tune = TUNING[this.levelId];
    const par = tune?.par ?? 20;
    const seconds = this.sim.seconds;
    const underPar = seconds <= par;
    const ghost = !this.sim.everSpotted;
    const stars = 1 + (underPar ? 1 : 0) + (ghost ? 1 : 0);
    const prev = Save.record(this.levelId);
    const firstClear = prev.stars === 0;
    const newBest = prev.best === 0 || seconds < prev.best;

    Save.complete(this.levelId, stars, seconds, ghost);

    this.result = {
      won: true,
      seconds,
      stars,
      underPar,
      ghost,
      par,
      reason: 'CLEAN GETAWAY',
      detail: ghost ? 'Never seen. Not once.' : 'Out with the goods.',
      newBest,
      firstClear,
      focusY: this.cy(this.lv.exit[1]),
    };
    this.resultDelay = 700;

    Audio.win();
    haptic('success');
    this.cameras.main.flash(220, 56, 240, 216, false);

    const gx = this.cx(this.lv.exit[0]);
    const gy = this.cy(this.lv.exit[1]);
    this.burst(gx, gy, C.exit, 14);
  }

  private onCaught(): void {
    const by = this.sim.caughtBy;
    const kind = by?.kind ?? 'guard';
    this.result = {
      won: false,
      seconds: this.sim.seconds,
      stars: 0,
      underPar: false,
      ghost: false,
      par: TUNING[this.levelId]?.par ?? 20,
      reason: by ? `SPOTTED BY ${by.label}` : 'SPOTTED',
      detail: by?.heard
        ? 'The grating gave you away - guards hear much further there.'
        : kind === 'guard'
          ? 'You were inside his cone for too long.'
          : kind === 'camera'
            ? 'The lens swept across you.'
            : 'You walked into a live beam.',
      newBest: false,
      firstClear: false,
      focusY: by ? this.cy(by.y) : this.cy(this.sim.posY),
    };
    this.resultDelay = 1300;

    Audio.alarm();
    Audio.caught();
    haptic('error');
    this.cameras.main.shake(360, 0.011);
    this.cameras.main.flash(260, 255, 77, 94, false);
  }

  /* ---------------------------------------------------------------- commands */

  restartRun(): void {
    Audio.back();
    haptic('light');
    this.scene.stop('Hud');
    this.scene.restart({ levelId: this.levelId });
  }

  gotoNext(): void {
    const next = this.levelId + 1;
    this.scene.stop('Hud');
    if (next > LEVEL_COUNT) {
      this.scene.start('LevelSelect');
      return;
    }
    this.scene.restart({ levelId: next });
  }

  gotoSelect(): void {
    Audio.back();
    this.scene.stop('Hud');
    this.scene.start('LevelSelect');
  }

  /* ------------------------------------------------------------------ render */

  private renderFrame(): void {
    this.readSensors();
    this.renderCones();
    this.renderWorld();
    this.renderPreview();

    this.freezeTint.setAlpha(this.freezeAmount * 0.3);
    this.scanlines.setAlpha(this.freezeAmount * 0.5);
    this.scanlines.tilePositionY = -this.clock * 0.02;
  }

  private readSensors(): void {
    const tick = this.sim.tick;
    this.guardPoses = this.lv.guards.map((g, i) => {
      const f = guardAt(this.lv, i, tick);
      return { x: f.x, y: f.y, a: f.a, range: g.range, half: g.halfAngle, idle: f.idle, hears: true };
    });
    this.cameraPoses = this.lv.cameras.map((c, i) => ({
      x: c.x,
      y: c.y,
      a: cameraAngleAt(this.lv, i, tick),
      range: c.range,
      half: c.halfAngle,
      idle: true,
      hears: false,
    }));
  }

  /** Marches a ray until it leaves the level or hits something solid. */
  private rayDistance(ox: number, oy: number, angle: number, range: number): number {
    const stepLen = 0.12;
    const dx = Math.cos(angle) * stepLen;
    const dy = Math.sin(angle) * stepLen;
    let x = ox;
    let y = oy;
    let d = 0;
    while (d < range) {
      x += dx;
      y += dy;
      d += stepLen;
      const tx = Math.floor(x);
      const ty = Math.floor(y);
      if (tx < 0 || ty < 0 || tx >= this.lv.w || ty >= this.lv.h) return d;
      const k = this.lv.grid[ty * this.lv.w + tx];
      if (k === TileKind.Wall || k === TileKind.Void) return d;
    }
    return range;
  }

  private renderCones(): void {
    const g = this.gCones;
    g.clear();
    const t = this.tile;
    const spotted = this.sim.spottedBy;

    const drawCone = (p: SensorPose, hot: boolean) => {
      const ox = p.x + 0.5;
      const oy = p.y + 0.5;
      const rays = 22;
      const pts: number[] = [];
      for (let i = 0; i <= rays; i++) {
        const th = p.a - p.half + (p.half * 2 * i) / rays;
        const d = this.rayDistance(ox, oy, th, p.range);
        pts.push(this.cx(ox - 0.5 + Math.cos(th) * d), this.cy(oy - 0.5 + Math.sin(th) * d));
      }

      const base = hot ? 0.24 : 0.115;
      g.fillStyle(C.red, base);
      g.beginPath();
      g.moveTo(this.cx(p.x), this.cy(p.y));
      for (let i = 0; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
      g.closePath();
      g.fillPath();

      // Bright inner core so the cone reads even on dark floor.
      g.fillStyle(C.red, base * 0.75);
      g.beginPath();
      g.moveTo(this.cx(p.x), this.cy(p.y));
      for (let i = 0; i <= rays; i++) {
        const th = p.a - p.half * 0.45 + (p.half * 0.9 * i) / rays;
        const d = this.rayDistance(ox, oy, th, p.range) * 0.92;
        g.lineTo(this.cx(ox - 0.5 + Math.cos(th) * d), this.cy(oy - 0.5 + Math.sin(th) * d));
      }
      g.closePath();
      g.fillPath();

      g.lineStyle(1.2, C.red, hot ? 0.6 : 0.3);
      g.beginPath();
      g.moveTo(this.cx(p.x), this.cy(p.y));
      g.lineTo(pts[0], pts[1]);
      g.strokePath();
      g.beginPath();
      g.moveTo(this.cx(p.x), this.cy(p.y));
      g.lineTo(pts[pts.length - 2], pts[pts.length - 1]);
      g.strokePath();

      // Hearing reach on noise floors: a dashed arc past the visual cone.
      if (this.lv.hasNoise && p.hears && this.freezeAmount > 0.15) {
        g.lineStyle(1.2, C.noise, 0.3 * this.freezeAmount);
        g.beginPath();
        for (let i = 0; i <= rays; i++) {
          const th = p.a - p.half + (p.half * 2 * i) / rays;
          const d = this.rayDistance(ox, oy, th, p.range * NOISE_RANGE_MULT);
          const px = this.cx(ox - 0.5 + Math.cos(th) * d);
          const py = this.cy(oy - 0.5 + Math.sin(th) * d);
          if (i === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.strokePath();
      }

      // Sweep tick marks - makes the timing legible while frozen.
      if (this.freezeAmount > 0.15) {
        g.lineStyle(1, C.redSoft, 0.18 * this.freezeAmount);
        for (let r = 1; r <= Math.floor(p.range); r++) {
          g.beginPath();
          for (let i = 0; i <= rays; i++) {
            const th = p.a - p.half + (p.half * 2 * i) / rays;
            const d = Math.min(r, this.rayDistance(ox, oy, th, p.range));
            const px = this.cx(ox - 0.5 + Math.cos(th) * d);
            const py = this.cy(oy - 0.5 + Math.sin(th) * d);
            if (i === 0) g.moveTo(px, py);
            else g.lineTo(px, py);
          }
          g.strokePath();
        }
      }
      void t;
    };

    this.guardPoses.forEach((p, i) =>
      drawCone(p, spotted?.kind === 'guard' && spotted.index === i),
    );
    this.cameraPoses.forEach((p, i) =>
      drawCone(p, spotted?.kind === 'camera' && spotted.index === i),
    );
  }

  private renderWorld(): void {
    const g = this.gWorld;
    g.clear();
    const t = this.tile;
    const beat = this.clock / 1000;

    this.renderExit(g, beat);
    this.renderDoors(g, beat);
    this.renderLasers(g, beat);
    this.renderCollectibles(g, beat);
    this.renderCameras(g, beat);
    this.renderGuards(g, beat);
    this.renderThief(g, beat);

    // Detection beam: the single most important piece of feedback in the game.
    const spot = this.sim.spottedBy ?? this.sim.caughtBy;
    if (spot) {
      const px = this.cx(this.sim.posX);
      const py = this.cy(this.sim.posY);
      const sxp = this.cx(spot.x);
      const syp = this.cy(spot.y);
      const pulse = 0.5 + 0.5 * Math.sin(beat * 18);
      g.lineStyle(3.2, C.red, 0.22 + pulse * 0.3);
      g.lineBetween(sxp, syp, px, py);
      g.lineStyle(1.2, C.redSoft, 0.55 + pulse * 0.4);
      g.lineBetween(sxp, syp, px, py);

      g.lineStyle(2, C.red, 0.5 + pulse * 0.5);
      g.strokeCircle(sxp, syp, t * (0.5 + pulse * 0.14));
    }
    void t;
  }

  private renderExit(g: Phaser.GameObjects.Graphics, beat: number): void {
    const t = this.tile;
    const [ex, ey] = this.lv.exit;
    const open = this.sim.hasAllLoot;
    const x = this.cx(ex);
    const y = this.cy(ey);
    const col = open ? C.exit : C.exitDim;

    g.fillStyle(col, open ? 0.18 : 0.1);
    g.fillRoundedRect(x - t * 0.42, y - t * 0.42, t * 0.84, t * 0.84, 5);
    g.lineStyle(1.6, col, open ? 0.95 : 0.55);
    g.strokeRoundedRect(x - t * 0.42, y - t * 0.42, t * 0.84, t * 0.84, 5);

    const rise = open ? ((beat * 1.6) % 1) : 0.5;
    for (let i = 0; i < 3; i++) {
      const p = (rise + i / 3) % 1;
      const yy = y + t * 0.3 - p * t * 0.62;
      const a = open ? Math.sin(p * Math.PI) * 0.9 : 0.3;
      g.lineStyle(2, col, a);
      g.beginPath();
      g.moveTo(x - t * 0.2, yy + t * 0.1);
      g.lineTo(x, yy - t * 0.05);
      g.lineTo(x + t * 0.2, yy + t * 0.1);
      g.strokePath();
    }
  }

  private renderDoors(g: Phaser.GameObjects.Graphics, beat: number): void {
    const t = this.tile;
    for (const d of this.lv.doors) {
      const open = (this.sim.mask & (1 << d.keyBit)) !== 0;
      const x = this.sx(d.x);
      const y = this.sy(d.y);
      const col = C.key[d.color];
      const dim = C.keyDim[d.color];

      g.fillStyle(C.wall, 1);
      g.fillRect(x, y, t, t);
      g.fillStyle(C.wallTop, 1);
      g.fillRect(x, y, t, t * 0.2);
      g.fillRect(x, y + t * 0.8, t, t * 0.2);

      const inner = t * 0.6;
      const iy = y + t * 0.2;
      if (open) {
        g.fillStyle(dim, 0.3);
        g.fillRect(x, iy, t, inner);
        g.lineStyle(1.4, col, 0.55);
        g.lineBetween(x, iy + 1, x + t, iy + 1);
        g.lineBetween(x, iy + inner - 1, x + t, iy + inner - 1);
      } else {
        g.fillStyle(dim, 0.55);
        g.fillRect(x, iy, t, inner);
        const bars = 4;
        const flick = 0.6 + 0.4 * Math.sin(beat * 6 + d.x);
        for (let i = 0; i < bars; i++) {
          const by = iy + ((i + 0.5) / bars) * inner;
          g.lineStyle(2, col, 0.55 * flick);
          g.lineBetween(x + 2, by, x + t - 2, by);
        }
        g.lineStyle(1.6, col, 0.85);
        g.strokeRect(x + 0.8, iy + 0.8, t - 1.6, inner - 1.6);
      }
    }
  }

  private renderLasers(g: Phaser.GameObjects.Graphics, beat: number): void {
    const t = this.tile;
    for (let i = 0; i < this.lv.lasers.length; i++) {
      const l = this.lv.lasers[i];
      const on = laserOnAt(this.lv, i, this.sim.tick);
      const phase = (this.sim.tick + l.phase) % l.period;
      const untilOn = on ? -1 : l.period - phase;
      const ax = this.cx(l.ax);
      const ay = this.cy(l.ay);
      const bx = this.cx(l.bx);
      const by = this.cy(l.by);

      // Emitter housings.
      for (const [ex, ey] of [
        [ax, ay],
        [bx, by],
      ]) {
        g.fillStyle(C.wall, 1);
        g.fillCircle(ex, ey, t * 0.2);
        g.fillStyle(on ? C.red : C.redDeep, on ? 1 : 0.5);
        g.fillCircle(ex, ey, t * 0.1);
      }

      if (on) {
        const jitter = 0.85 + 0.15 * Math.sin(beat * 40 + i);
        g.lineStyle(t * 0.34, C.red, 0.14 * jitter);
        g.lineBetween(ax, ay, bx, by);
        g.lineStyle(t * 0.14, C.red, 0.4 * jitter);
        g.lineBetween(ax, ay, bx, by);
        g.lineStyle(2, C.redSoft, 0.95);
        g.lineBetween(ax, ay, bx, by);
      } else {
        // A warning stutter in the last third of a second before it re-arms.
        const warn = untilOn > 0 && untilOn < 22;
        const a = warn ? 0.28 + 0.4 * Math.abs(Math.sin(beat * 26)) : 0.15;
        const len = Math.hypot(bx - ax, by - ay);
        const steps = Math.max(1, Math.floor(len / 7));
        g.lineStyle(1.3, C.red, a);
        for (let s = 0; s < steps; s += 2) {
          const t0 = s / steps;
          const t1 = Math.min(1, (s + 1) / steps);
          g.lineBetween(
            ax + (bx - ax) * t0,
            ay + (by - ay) * t0,
            ax + (bx - ax) * t1,
            ay + (by - ay) * t1,
          );
        }
      }
    }
  }

  private renderCollectibles(g: Phaser.GameObjects.Graphics, beat: number): void {
    const t = this.tile;
    for (const c of this.lv.collectibles) {
      if (this.sim.isCollected(c)) continue;
      const x = this.cx(c.x);
      const y = this.cy(c.y);
      const bob = Math.sin(beat * 2.2 + c.x + c.y) * t * 0.05;

      g.fillStyle(C.wallShadow, 0.5);
      g.fillEllipse(x, y + t * 0.28, t * 0.44, t * 0.16);

      if (c.kind === 'loot') {
        const r = t * 0.26;
        g.fillStyle(C.gold, 0.09);
        g.fillCircle(x, y + bob, r * 1.9);
        g.lineStyle(1, C.gold, 0.22);
        g.strokeCircle(x, y + bob, r * 1.9);
        g.fillStyle(C.gold, 1);
        g.beginPath();
        g.moveTo(x, y + bob - r);
        g.lineTo(x + r * 0.8, y + bob);
        g.lineTo(x, y + bob + r);
        g.lineTo(x - r * 0.8, y + bob);
        g.closePath();
        g.fillPath();
        g.lineStyle(1.2, C.goldGlow, 0.9);
        g.beginPath();
        g.moveTo(x, y + bob - r);
        g.lineTo(x + r * 0.8, y + bob);
        g.lineTo(x, y + bob + r);
        g.lineTo(x - r * 0.8, y + bob);
        g.closePath();
        g.strokePath();
      } else {
        const col = C.key[c.color];
        const w = t * 0.44;
        const h = t * 0.3;
        g.fillStyle(col, 0.1);
        g.fillCircle(x, y + bob, t * 0.38);
        g.lineStyle(1, col, 0.24);
        g.strokeCircle(x, y + bob, t * 0.38);
        g.fillStyle(col, 1);
        g.fillRoundedRect(x - w / 2, y + bob - h / 2, w, h, 3);
        g.fillStyle(0x0a0f18, 0.75);
        g.fillRect(x - w / 2 + 2, y + bob - h / 2 + h * 0.3, w - 4, h * 0.22);
      }
    }
  }

  private renderCameras(g: Phaser.GameObjects.Graphics, beat: number): void {
    const t = this.tile;
    this.cameraPoses.forEach((p, i) => {
      const x = this.cx(p.x);
      const y = this.cy(p.y);
      const hot = this.sim.spottedBy?.kind === 'camera' && this.sim.spottedBy.index === i;

      g.fillStyle(C.wallShadow, 0.5);
      g.fillEllipse(x, y + t * 0.24, t * 0.5, t * 0.18);

      // Bracket arm pointing where the lens looks.
      g.lineStyle(3, C.wallTop, 1);
      g.lineBetween(x, y, x + Math.cos(p.a) * t * 0.3, y + Math.sin(p.a) * t * 0.3);

      g.fillStyle(C.wall, 1);
      g.fillCircle(x, y, t * 0.26);
      g.lineStyle(1.2, C.wallLip, 0.7);
      g.strokeCircle(x, y, t * 0.26);

      const lx = x + Math.cos(p.a) * t * 0.14;
      const ly = y + Math.sin(p.a) * t * 0.14;
      const blink = hot ? 1 : 0.55 + 0.45 * Math.sin(beat * 4 + i);
      g.fillStyle(C.red, blink);
      g.fillCircle(lx, ly, t * 0.1);
      g.fillStyle(C.redSoft, 0.35 * blink);
      g.fillCircle(lx, ly, t * 0.17);
    });
  }

  private renderGuards(g: Phaser.GameObjects.Graphics, beat: number): void {
    const t = this.tile;
    this.guardPoses.forEach((p, i) => {
      const x = this.cx(p.x);
      const y = this.cy(p.y);
      const hot = this.sim.spottedBy?.kind === 'guard' && this.sim.spottedBy.index === i;

      g.fillStyle(C.wallShadow, 0.55);
      g.fillEllipse(x, y + t * 0.26, t * 0.55, t * 0.2);

      const bodyR = t * 0.28;
      g.fillStyle(hot ? C.red : 0xd8524f, 1);
      g.fillCircle(x, y, bodyR);
      g.lineStyle(1.4, hot ? C.redSoft : 0x8f2f2f, 0.9);
      g.strokeCircle(x, y, bodyR);

      // Shoulders + facing wedge, so the direction is unmistakable.
      g.fillStyle(0x2a1417, 0.85);
      g.fillCircle(x, y, bodyR * 0.52);
      g.fillStyle(hot ? C.redSoft : 0xffb0a4, 0.95);
      g.beginPath();
      g.moveTo(x + Math.cos(p.a) * bodyR * 1.5, y + Math.sin(p.a) * bodyR * 1.5);
      g.lineTo(x + Math.cos(p.a + 2.5) * bodyR * 0.75, y + Math.sin(p.a + 2.5) * bodyR * 0.75);
      g.lineTo(x + Math.cos(p.a - 2.5) * bodyR * 0.75, y + Math.sin(p.a - 2.5) * bodyR * 0.75);
      g.closePath();
      g.fillPath();

      if (p.idle) {
        g.lineStyle(1.2, C.warm, 0.35 + 0.25 * Math.sin(beat * 3 + i));
        g.strokeCircle(x, y, bodyR * 1.45);
      }

      if (hot) {
        // Alert glyph: a hard, readable exclamation over the guard's head.
        const ay = y - t * 0.72 - Math.abs(Math.sin(beat * 12)) * 3;
        g.fillStyle(C.red, 0.9);
        g.fillRoundedRect(x - 2.4, ay - 9, 4.8, 11, 2.2);
        g.fillCircle(x, ay + 5.5, 2.6);
      }
    });
  }

  private renderThief(g: Phaser.GameObjects.Graphics, beat: number): void {
    const t = this.tile;
    const x = this.cx(this.sim.posX);
    const y = this.cy(this.sim.posY);

    // Motion trail.
    for (let i = 0; i < this.trail.length - 1; i++) {
      const a = (i / this.trail.length) * 0.3;
      g.lineStyle(t * 0.16 * (i / this.trail.length + 0.25), C.cyanDim, a);
      g.lineBetween(this.trail[i].x, this.trail[i].y, this.trail[i + 1].x, this.trail[i + 1].y);
    }

    // Noise floor: visible sound rings, so an extended-range bust is never a surprise.
    if (isNoisyAt(this.lv, this.sim.posX, this.sim.posY)) {
      for (let i = 0; i < 3; i++) {
        const p = ((beat * 1.1 + i / 3) % 1);
        g.lineStyle(2 - p, C.noise, (1 - p) * 0.5);
        g.strokeCircle(x, y, t * (0.3 + p * 1.5));
      }
    }

    g.fillStyle(C.wallShadow, 0.55);
    g.fillEllipse(x, y + t * 0.26, t * 0.5, t * 0.18);

    const alertRatio = this.sim.alert / ALERT_TICKS;
    const r = t * 0.26;

    const pulse = 0.85 + 0.15 * Math.sin(beat * 5);
    this.thiefGlow.setPosition(x, y);
    this.thiefGlow.setDisplaySize(t * 3.2 * pulse, t * 3.2 * pulse);
    this.thiefGlow.setTint(alertRatio > 0 ? C.red : C.cyan);
    this.thiefGlow.setAlpha(0.2 + alertRatio * 0.35);

    g.fillStyle(C.cyan, 1);
    g.fillCircle(x, y, r);
    g.fillStyle(0x06231f, 0.8);
    g.fillCircle(x, y, r * 0.45);
    g.lineStyle(1.4, C.cyanGlow, 0.85);
    g.strokeCircle(x, y, r);

    // Facing pip.
    let fa = 0;
    if (this.sim.moving) fa = Math.atan2(this.sim.toY - this.sim.tileY, this.sim.toX - this.sim.tileX);
    else if (this.sim.path.length) {
      fa = Math.atan2(this.sim.path[0][1] - this.sim.tileY, this.sim.path[0][0] - this.sim.tileX);
    }
    g.fillStyle(C.cyanGlow, 0.95);
    g.fillCircle(x + Math.cos(fa) * r * 0.62, y + Math.sin(fa) * r * 0.62, r * 0.24);

    // Detection meter: a red arc that fills while a sensor holds you.
    if (alertRatio > 0) {
      g.lineStyle(3, C.redDeep, 0.35);
      g.strokeCircle(x, y, r * 1.75);
      g.lineStyle(3, C.red, 0.95);
      g.beginPath();
      g.arc(x, y, r * 1.75, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * alertRatio, false);
      g.strokePath();
    }
  }

  private renderPreview(): void {
    const g = this.gPreview;
    g.clear();
    const t = this.tile;
    const f = this.freezeAmount;

    if (this.denyFlash > 0 && this.previewTarget) {
      const x = this.cx(this.previewTarget.x);
      const y = this.cy(this.previewTarget.y);
      const a = this.denyFlash;
      g.lineStyle(2.5, C.red, a);
      g.lineBetween(x - t * 0.26, y - t * 0.26, x + t * 0.26, y + t * 0.26);
      g.lineBetween(x + t * 0.26, y - t * 0.26, x - t * 0.26, y + t * 0.26);
    }

    if (f < 0.03) return;

    // Reachable tiles: a faint cyan wash that grows out from the thief.
    if (this.reach) {
      for (let y = 0; y < this.lv.h; y++) {
        for (let x = 0; x < this.lv.w; x++) {
          const d = this.reach[y * this.lv.w + x];
          if (d === 65535) continue;
          g.fillStyle(C.cyan, 0.05 * f);
          g.fillRect(this.sx(x) + 1, this.sy(y) + 1, t - 2, t - 2);
        }
      }
    }

    const path = this.previewPath;
    if (path && path.length) {
      const beat = this.clock / 1000;
      const ax = this.cx(this.sim.anchorX);
      const ay = this.cy(this.sim.anchorY);
      const pts: { x: number; y: number }[] = [{ x: ax, y: ay }];
      for (const [px, py] of path) pts.push({ x: this.cx(px), y: this.cy(py) });

      g.lineStyle(t * 0.2, C.cyan, 0.14 * f);
      for (let i = 0; i < pts.length - 1; i++) {
        g.lineBetween(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
      }

      // Marching dots along the route.
      const spacing = 9;
      let travelled = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const seg = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
        let s = ((-beat * 34) % spacing + spacing) % spacing;
        s = s - (travelled % spacing);
        for (let d = s; d < seg; d += spacing) {
          if (d < 0) continue;
          const k = d / seg;
          const dx = pts[i].x + (pts[i + 1].x - pts[i].x) * k;
          const dy = pts[i].y + (pts[i + 1].y - pts[i].y) * k;
          const loud = isNoisyAt(this.lv, (dx - this.ox) / t - 0.5, (dy - this.oy) / t - 0.5);
          g.fillStyle(loud ? C.noise : C.cyanGlow, 0.85 * f);
          g.fillCircle(dx, dy, loud ? 2.4 : 1.9);
        }
        travelled += seg;
      }

      const end = pts[pts.length - 1];
      const ring = t * 0.34 + Math.sin(beat * 6) * 1.6;
      g.lineStyle(2, C.cyan, 0.95 * f);
      g.strokeCircle(end.x, end.y, ring);
      g.lineStyle(1, C.cyanGlow, 0.5 * f);
      g.strokeCircle(end.x, end.y, ring + 5);
      g.fillStyle(C.cyanGlow, 0.5 * f);
      g.fillCircle(end.x, end.y, 2.4);

      // Travel time readout, so route length is a real decision.
      const stepsCount = path.length;
      const secs = (stepsCount * TILE_TICKS) / 60;
      const label = `${secs.toFixed(2)}s`;
      g.fillStyle(0x03060c, 0.7 * f);
      g.fillRoundedRect(end.x - 21, end.y - ring - 22, 42, 15, 4);
      const txt = this.timeText;
      txt.setText(label);
      txt.setPosition(end.x, end.y - ring - 15);
      txt.setAlpha(f);
    } else {
      this.timeText.setAlpha(0);
    }

    if (this.previewTarget && !this.previewValid && f > 0.3) {
      if (
        this.previewTarget.x >= 0 &&
        this.previewTarget.y >= 0 &&
        this.previewTarget.x < this.lv.w &&
        this.previewTarget.y < this.lv.h
      ) {
        g.lineStyle(1.6, C.red, 0.5 * f);
        g.strokeRect(this.sx(this.previewTarget.x) + 2, this.sy(this.previewTarget.y) + 2, t - 4, t - 4);
      }
    }
  }
}
