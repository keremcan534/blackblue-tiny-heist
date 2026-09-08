import Phaser from 'phaser';
import { buildTextures } from '../fx/textures.ts';
import { C } from '../theme.ts';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(C.bg);
    buildTextures(this);

    const splash = document.getElementById('boot-splash');
    if (splash) {
      splash.classList.add('hidden');
      window.setTimeout(() => splash.remove(), 600);
    }

    this.scene.start('Menu');
  }
}
