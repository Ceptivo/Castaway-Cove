import Phaser from 'phaser';
import '@fontsource/oswald/700.css';
import '@fontsource/nunito/700.css';
import tuning from './data/tuning.json';
import { hookPlatform } from './core/platform';
import { BootScene } from './scenes/BootScene';
import { IslandScene } from './scenes/IslandScene';

const parent = document.getElementById('game')!;
const dpr = Math.min(window.devicePixelRatio || 1, tuning.view.maxDevicePixelRatio);

// The canvas is drawn at device resolution and shown at CSS size, so the
// painted art stays sharp on high-density phone screens.
const game = new Phaser.Game({
  type: Phaser.WEBGL,
  parent,
  backgroundColor: '#2B524C',
  width: parent.clientWidth * dpr,
  height: parent.clientHeight * dpr,
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
  scene: [BootScene, IslandScene],
});

window.addEventListener('resize', () => {
  game.scale.resize(parent.clientWidth * dpr, parent.clientHeight * dpr);
  game.scale.setZoom(1 / dpr);
});

hookPlatform(game);
