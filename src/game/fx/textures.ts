import Phaser from 'phaser';

/**
 * Procedural textures. Nothing is loaded from disk - the whole diorama is drawn
 * from gradients and noise generated once at boot.
 */
export const TEX = {
  glow: 'tex-glow',
  pool: 'tex-pool',
  shadow: 'tex-shadow',
  grain: 'tex-grain',
  scan: 'tex-scan',
  spark: 'tex-spark',
} as const;

function canvas(scene: Phaser.Scene, key: string, w: number, h: number): CanvasRenderingContext2D | null {
  if (scene.textures.exists(key)) return null;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return null;
  const ctx = tex.getContext();
  if (!ctx) return null;
  return ctx;
}

function commit(scene: Phaser.Scene, key: string): void {
  const tex = scene.textures.get(key);
  if (tex && 'refresh' in tex) (tex as Phaser.Textures.CanvasTexture).refresh();
}

export function buildTextures(scene: Phaser.Scene): void {
  // Tight radial glow - thief aura, loot sparkle, alert pings.
  {
    const size = 128;
    const ctx = canvas(scene, TEX.glow, size, size);
    if (ctx) {
      const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.32, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.65, 'rgba(255,255,255,0.14)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      commit(scene, TEX.glow);
    }
  }

  // Broad, very soft pool - the warm tungsten lighting on the floor.
  {
    const size = 256;
    const ctx = canvas(scene, TEX.pool, size, size);
    if (ctx) {
      const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, 'rgba(255,255,255,0.85)');
      g.addColorStop(0.25, 'rgba(255,255,255,0.42)');
      g.addColorStop(0.55, 'rgba(255,255,255,0.14)');
      g.addColorStop(0.8, 'rgba(255,255,255,0.03)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      commit(scene, TEX.pool);
    }
  }

  // Contact shadow under raised pieces.
  {
    const size = 128;
    const ctx = canvas(scene, TEX.shadow, size, size);
    if (ctx) {
      const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, 'rgba(0,0,0,0.72)');
      g.addColorStop(0.5, 'rgba(0,0,0,0.28)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      commit(scene, TEX.shadow);
    }
  }

  // Deterministic film grain, tiled over the board.
  {
    const size = 96;
    const ctx = canvas(scene, TEX.grain, size, size);
    if (ctx) {
      const img = ctx.createImageData(size, size);
      let seed = 0x9e3779b9;
      for (let i = 0; i < size * size; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const v = (seed >>> 24) & 0xff;
        img.data[i * 4 + 0] = 255;
        img.data[i * 4 + 1] = 255;
        img.data[i * 4 + 2] = 255;
        img.data[i * 4 + 3] = v > 236 ? 22 : 0;
      }
      ctx.putImageData(img, 0, 0);
      commit(scene, TEX.grain);
    }
  }

  // Scanlines for the freeze overlay.
  {
    const ctx = canvas(scene, TEX.scan, 4, 4);
    if (ctx) {
      ctx.fillStyle = 'rgba(255,255,255,0.055)';
      ctx.fillRect(0, 0, 4, 1);
      commit(scene, TEX.scan);
    }
  }

  // Four-point star flare for pickups.
  {
    const size = 64;
    const ctx = canvas(scene, TEX.spark, size, size);
    if (ctx) {
      const c = size / 2;
      const g = ctx.createRadialGradient(c, c, 0, c, c, c);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.4, 'rgba(255,255,255,0.25)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(c, 0);
      ctx.quadraticCurveTo(c + 4, c - 4, size, c);
      ctx.quadraticCurveTo(c + 4, c + 4, c, size);
      ctx.quadraticCurveTo(c - 4, c + 4, 0, c);
      ctx.quadraticCurveTo(c - 4, c - 4, c, 0);
      ctx.fill();
      commit(scene, TEX.spark);
    }
  }
}
