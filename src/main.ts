import Phaser from 'phaser';
import { BootScene } from './game/scenes/BootScene.ts';
import { GameScene } from './game/scenes/GameScene.ts';
import { HudScene } from './game/scenes/HudScene.ts';
import { LevelSelectScene } from './game/scenes/LevelSelectScene.ts';
import { MenuScene } from './game/scenes/MenuScene.ts';
import { C, VIEW_H, VIEW_W } from './game/theme.ts';
import { Audio } from './game/audio/audio.ts';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-root',
  backgroundColor: C.bg,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: VIEW_W,
    height: VIEW_H,
  },
  render: {
    antialias: true,
    roundPixels: false,
    powerPreference: 'high-performance',
  },
  input: {
    activePointers: 2,
  },
  fps: {
    target: 60,
    // Phaser's own smoothing; the sim runs on its own fixed-tick accumulator.
    smoothStep: true,
  },
  scene: [BootScene, MenuScene, LevelSelectScene, GameScene, HudScene],
};

const game = new Phaser.Game(config);

// Debug handle for automated smoke tests and manual poking in the console.
(globalThis as { tinyHeist?: Phaser.Game }).tinyHeist = game;

// Suspend the ambience when the tab or app is backgrounded.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) Audio.stopMusic();
  else if (!Audio.muted) Audio.startMusic();
});

// Keep the canvas honest across rotation and mobile browser chrome resizes.
window.addEventListener('resize', () => game.scale.refresh());
window.addEventListener('orientationchange', () => {
  window.setTimeout(() => game.scale.refresh(), 120);
});
