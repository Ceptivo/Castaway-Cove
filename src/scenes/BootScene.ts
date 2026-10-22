import Phaser from 'phaser';

/** Loads the atlases and ground textures, then hands over to the island. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload(): void {
    const { width, height } = this.scale;
    const label = this.add
      .text(width / 2, height / 2, 'LOADING', {
        fontFamily: 'Oswald, sans-serif',
        fontSize: `${Math.round(Math.min(width, height) * 0.06)}px`,
        fontStyle: '700',
        color: '#DCC08A',
      })
      .setOrigin(0.5);
    this.load.on('progress', (p: number) => label.setText(`LOADING ${Math.round(p * 100)}%`));

    // A self-contained build (the shareable web page) carries every asset
    // inline in window.__CASTAWAY_ASSETS; otherwise they load from assets/.
    const inline = (window as { __CASTAWAY_ASSETS?: Record<string, never> }).__CASTAWAY_ASSETS;
    const asset = (path: string): string => inline?.[path] ?? path;
    this.load.setPath(inline ? '' : 'assets/');
    this.load.multiatlas('character', asset('character.json'));
    this.load.multiatlas('world', asset('world.json'));
    this.load.multiatlas('hud', asset('hud.json'));
    for (const t of ['sand', 'grass', 'water']) this.load.image(`tex_${t}`, asset(`textures/${t}.png`));
  }

  create(): void {
    makeSoftTextures(this);
    this.scene.start('island');
  }
}

/** Soft radial textures: ground shadows under standing things, firelight glow. */
function makeSoftTextures(scene: Phaser.Scene): void {
  const radial = (key: string, size: number, stops: [number, string][]): void => {
    const tex = scene.textures.createCanvas(key, size, size)!;
    const ctx = tex.getContext();
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const [at, colour] of stops) g.addColorStop(at, colour);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    tex.refresh();
  };
  radial('soft_shadow', 128, [
    [0, 'rgba(33,25,18,1)'],
    [0.55, 'rgba(33,25,18,0.6)'],
    [1, 'rgba(33,25,18,0)'],
  ]);
  radial('fire_glow', 256, [
    [0, 'rgba(255,190,90,0.55)'],
    [0.4, 'rgba(240,140,50,0.22)'],
    [1, 'rgba(240,120,40,0)'],
  ]);
}
