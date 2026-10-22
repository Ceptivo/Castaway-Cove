import Phaser from 'phaser';
import '@fontsource/oswald/700.css';
import '@fontsource/nunito/700.css';
import tuning from './data/tuning.json';
import { hookPlatform } from './core/platform';
import { BagScene } from './scenes/BagScene';
import { BootScene } from './scenes/BootScene';
import { FishingScene } from './scenes/FishingScene';
import { HudScene } from './scenes/HudScene';
import { IslandScene } from './scenes/IslandScene';

const parent = document.getElementById('game')!;
const dpr = Math.min(window.devicePixelRatio || 1, tuning.view.maxDevicePixelRatio);

/** Screen size in CSS pixels; falls back to the window if the page isn't laid out yet. */
function screenSize(): { w: number; h: number } {
  return { w: parent.clientWidth || window.innerWidth || 360, h: parent.clientHeight || window.innerHeight || 780 };
}

function start(): void {
  const { w, h } = screenSize();
  // The canvas is drawn at device resolution and shown at CSS size, so the
  // painted art stays sharp on high-density phone screens.
  const game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent,
    backgroundColor: '#2B524C',
    width: w * dpr,
    height: h * dpr,
    scale: {
      mode: Phaser.Scale.NONE,
      zoom: 1 / dpr,
    },
    render: {
      antialias: true,
      powerPreference: 'high-performance',
    },
    fps: { target: 60 },
    input: { activePointers: 2 },
    disableContextMenu: true,
    scene: [BootScene, IslandScene, FishingScene, HudScene, BagScene],
  });

  window.addEventListener('resize', () => {
    const s = screenSize();
    game.scale.resize(s.w * dpr, s.h * dpr);
    game.scale.setZoom(1 / dpr);
  });

  game.registry.set('dpr', dpr);
  hookPlatform(game);
}

// The HUD draws its text on canvas, so give the fonts a moment to arrive
// first, but never hold the game back if they can't load.
void Promise.race([
  Promise.all(['700 16px Oswald', '700 16px Nunito'].map((f) => document.fonts.load(f))).catch(() => undefined),
  new Promise((resolve) => setTimeout(resolve, 1500)),
]).then(start);
