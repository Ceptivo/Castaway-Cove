import Phaser from 'phaser';
import tuning from '../data/tuning.json';
import goals from '../data/goals.json';
import layout from '../data/generated/hud-layout.json';
import type { Player } from '../entities/Player';
import type { IslandData } from '../world/islandGen';

/**
 * The island HUD, laid out like image 08 but for a portrait phone: map and
 * the castaway's portrait, name, bars and coins top left; settings and the
 * goal panel top right; Map, Create, Inventory and the hand button along the
 * bottom right. Positions are in points on a 360pt-wide screen; on wider
 * screens each group keeps to its own corner.
 */
const DESIGN_W = 360;
const DESIGN_H = 640;
const M = 10;

const TEXT_LIGHT = '#F3E8CF';
const TEXT_DARK = '#2A1D12';
const OUTLINE = '#211912';
const BAR_COLOURS = { health: 0xd63a2c, food: 0xe3a52a, water: 0x3f8fd0 } as const;
type Stat = keyof typeof BAR_COLOURS;

interface Bar {
  fill: Phaser.GameObjects.Image;
  text: Phaser.GameObjects.Text;
  max: number;
}

export class HudScene extends Phaser.Scene {
  private player!: Player;
  private island!: IslandData;
  private k = 1;
  private insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private hitAreas: Phaser.Geom.Rectangle[] = [];
  private bars = {} as Record<Stat, Bar>;
  private arrow!: Phaser.GameObjects.Graphics;
  private mapRect = new Phaser.Geom.Rectangle();
  private message?: Phaser.GameObjects.Container;
  private root!: Phaser.GameObjects.Container;

  constructor() {
    super('hud');
  }

  init(data: { player: Player; island: IslandData }): void {
    this.player = data.player;
    this.island = data.island;
  }

  create(): void {
    this.build();
    this.scale.on('resize', this.build, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.build, this));
  }

  /** True when a screen point (game pixels) is on a HUD element, so a tap there doesn't walk. */
  isOverHud(x: number, y: number): boolean {
    return this.hitAreas.some((r) => r.contains(x, y));
  }

  showMessage(text: string): void {
    this.message?.destroy();
    const k = this.k;
    const label = this.add
      .text(0, 0, text, { fontFamily: 'Nunito, sans-serif', fontStyle: '700', fontSize: `${13 * k}px`, color: TEXT_LIGHT })
      .setOrigin(0.5);
    const w = label.width + 28 * k;
    const h = label.height + 14 * k;
    const pill = this.add.graphics();
    pill.fillStyle(0x211912, 0.82).fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    const { width, height } = this.scale;
    const y = height - this.insets.bottom - (M + 64 + 30) * k;
    const box = this.add.container(width / 2, y, [pill, label]).setAlpha(0);
    this.message = box;
    this.tweens.add({ targets: box, alpha: 1, y: y - 10 * k, duration: 220, ease: 'Quad.easeOut' });
    this.tweens.add({ targets: box, alpha: 0, delay: 2200, duration: 400, onComplete: () => box.destroy() });
  }

  setStat(stat: Stat, value: number): void {
    const bar = this.bars[stat];
    const v = Math.max(0, Math.min(bar.max, value));
    const [x0, , x1] = layout.barFill;
    const frameW = bar.fill.frame.width;
    bar.fill.setCrop(0, 0, x0 + (x1 - x0) * (v / bar.max) + (v >= bar.max ? frameW - x1 : 0), bar.fill.frame.height);
    bar.text.setText(`${Math.round(v)}/${bar.max}`);
  }

  private build(): void {
    this.root?.destroy();
    this.message?.destroy();
    this.message = undefined;
    this.hitAreas = [];
    const { width, height } = this.scale;
    this.k = Math.min(width / DESIGN_W, height / DESIGN_H);
    this.insets = readInsets(this.registry.get('dpr') ?? 1);
    this.root = this.add.container(0, 0);
    this.buildTopLeft();
    this.buildTopRight();
    this.buildBottom();
  }

  // Left-anchored and right-anchored points, in game pixels.
  private L(x: number): number {
    return this.insets.left + x * this.k;
  }

  private R(x: number): number {
    return this.scale.width - this.insets.right - (DESIGN_W - x) * this.k;
  }

  private T(y: number): number {
    return this.insets.top + y * this.k;
  }

  private B(y: number): number {
    return this.scale.height - this.insets.bottom - (DESIGN_H - y) * this.k;
  }

  /** Place a HUD atlas frame with its top-left at (x, y), sized to w points wide. */
  private piece(frame: string, x: number, y: number, w: number): Phaser.GameObjects.Image {
    const img = this.add.image(x, y, 'hud', frame).setOrigin(0);
    img.setScale((w * this.k) / img.width);
    this.root.add(img);
    return img;
  }

  private text(x: number, y: number, s: string, size: number, colour: string, origin: [number, number] = [0, 0]): Phaser.GameObjects.Text {
    const t = this.add
      .text(x, y, s, {
        fontFamily: 'Oswald, sans-serif',
        fontStyle: '700',
        fontSize: `${size * this.k}px`,
        color: colour,
        stroke: colour === TEXT_LIGHT ? OUTLINE : undefined,
        strokeThickness: colour === TEXT_LIGHT ? 3 * this.k : 0,
      })
      .setOrigin(...origin);
    this.root.add(t);
    return t;
  }

  private button(frame: string, x: number, y: number, w: number, onTap: () => void): Phaser.GameObjects.Image {
    const img = this.piece(frame, x, y, w);
    const base = img.scale;
    img.setOrigin(0.5).setPosition(x + img.displayWidth / 2, y + img.displayHeight / 2);
    img.setInteractive({ useHandCursor: true });
    img.on('pointerdown', () => {
      this.tweens.add({ targets: img, scale: base * 0.92, duration: 70, yoyo: true });
      onTap();
    });
    this.hitAreas.push(img.getBounds());
    return img;
  }

  private buildTopLeft(): void {
    const stats = tuning.stats;
    // Parchment map with the island drawn into it.
    const mapW = 96;
    const map = this.piece('minimap', this.L(M), this.T(M), mapW);
    this.hitAreas.push(map.getBounds());
    const inner = { x: 14, y: 16, w: map.width - 28, h: map.height - 30 };
    const s = map.scale;
    this.mapRect.setTo(map.x + inner.x * s, map.y + inner.y * s, inner.w * s, inner.h * s);
    const key = drawIslandMap(this, this.island, Math.round(this.mapRect.width), Math.round(this.mapRect.height));
    this.root.add(this.add.image(this.mapRect.x, this.mapRect.y, key).setOrigin(0));
    this.arrow = this.add.graphics();
    this.root.add(this.arrow);

    // Portrait, name, bars, coins.
    this.piece('portrait', this.L(112), this.T(M), 52);
    this.text(this.L(170), this.T(M - 2), stats.playerName, 19, TEXT_LIGHT);
    const rows: [Stat, string, number][] = [
      ['health', 'icon_health', stats.health],
      ['food', 'icon_food', stats.food],
      ['water', 'icon_water', stats.water],
    ];
    rows.forEach(([stat, icon, max], i) => {
      const y = 36 + i * 24;
      const ic = this.piece(icon, 0, 0, 18);
      ic.setPosition(this.L(178) - ic.displayWidth / 2, this.T(y + 10) - ic.displayHeight / 2);
      this.piece('bar_track', this.L(190), this.T(y), 100);
      const fill = this.piece('bar_fill', this.L(190), this.T(y), 100).setTint(BAR_COLOURS[stat]);
      const text = this.text(this.L(282), this.T(y + 10.5), '', 12, TEXT_LIGHT, [1, 0.5]);
      this.bars[stat] = { fill, text, max };
      this.setStat(stat, max);
    });

    const pill = this.add.graphics();
    pill.fillStyle(0x211912, 0.62).fillRoundedRect(this.L(170), this.T(110), 96 * this.k, 26 * this.k, 8 * this.k);
    this.root.add(pill);
    const coin = this.piece('icon_coin', this.L(172), this.T(111), 24);
    coin.setY(this.T(123) - coin.displayHeight / 2);
    this.text(this.L(201), this.T(123), String(stats.startingCoins), 15, TEXT_LIGHT, [0, 0.5]);
    this.button('button_plus', this.L(241), this.T(112), 22, () => this.showMessage("The shop isn't open yet."));
  }

  private buildTopRight(): void {
    this.button('settings', this.R(DESIGN_W - M - 36), this.T(M), 36, () => this.showMessage('Settings are coming in a later update.'));

    // The goal panel: the first goal in the brief's chain.
    const w = 156;
    const panel = this.piece('quest_panel', this.R(DESIGN_W - M - w), this.T(146), w);
    this.hitAreas.push(panel.getBounds());
    const s = panel.scale / this.k; // points per atlas pixel
    const px = (ax: number): number => panel.x + ax * s * this.k;
    const py = (ay: number): number => panel.y + ay * s * this.k;
    const goal = goals.goals[0];
    this.text(px(53), py(36), goal.title, 14, TEXT_DARK, [0, 0.5]);
    const task = this.text(px(16), py(85), `- ${goal.task}`, 10.5, TEXT_DARK, [0, 0.5]);
    const count = this.text(px(panel.width - 20), py(85), `0/${goal.target}`, 11, TEXT_DARK, [1, 0.5]);
    // Long goals shrink to fit beside the count.
    const room = count.x - count.width - 6 * this.k - task.x;
    if (task.width > room) task.setScale(room / task.width);
  }

  private buildBottom(): void {
    const size = 68;
    const top = DESIGN_H - M - 64;
    this.button('button_map', this.R(76), this.B(top), size, () => this.showMessage('The map is coming in a later update.'));
    this.button('button_create', this.R(148), this.B(top), size, () => this.showMessage('Crafting is coming in a later update.'));
    this.button('button_inventory', this.R(220), this.B(top), size, () => this.showMessage('The bag is coming in the next update.'));
    this.button('button_hand', this.R(DESIGN_W - M - 60), this.B(top + 2), 60, () => this.showMessage('Nothing to use here.'));
  }

  update(): void {
    // The castaway's arrow on the map, pointing the way he faces.
    const r = this.mapRect;
    const b = mapBounds(this.island);
    const x = r.x + ((this.player.x - b.x) / b.size) * r.width;
    const y = r.y + ((this.player.y - b.y) / b.size) * r.height;
    const a = Math.PI - Phaser.Math.DegToRad(this.player.heading);
    const k = this.k;
    const g = this.arrow.clear();
    g.setPosition(x, y).setRotation(a);
    g.fillStyle(0xf1ead8, 1).lineStyle(1.5 * k, 0x211912, 1);
    g.beginPath();
    g.moveTo(0, -7 * k);
    g.lineTo(5 * k, 5 * k);
    g.lineTo(0, 2.5 * k);
    g.lineTo(-5 * k, 5 * k);
    g.closePath();
    g.fillPath().strokePath();
  }
}

/** The square of the world the map shows: the island and a little sea. */
function mapBounds(island: IslandData): { x: number; y: number; size: number } {
  const size = tuning.island.radius * 2.5;
  return { x: island.center.x - size / 2, y: island.center.y - size / 2, size };
}

/**
 * The island as the mock-up's map draws it: teal shallows around a sandy
 * rim, green interior, a dark coastline and a faint grid, all washed onto
 * the parchment.
 */
function drawIslandMap(scene: Phaser.Scene, island: IslandData, w: number, h: number): string {
  const key = `island_map_${w}x${h}`;
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, w, h)!;
  const ctx = tex.getContext();
  const img = ctx.createImageData(w, h);
  const f = island.fields;
  const b = mapBounds(island);
  const at = (field: Float32Array, wx: number, wy: number): number => {
    const i = Math.min(f.w - 1, Math.max(0, Math.floor(wx / f.cell)));
    const j = Math.min(f.h - 1, Math.max(0, Math.floor(wy / f.cell)));
    return field[j * f.w + i];
  };
  const put = (k: number, c: [number, number, number], a: number): void => {
    img.data[k] = c[0];
    img.data[k + 1] = c[1];
    img.data[k + 2] = c[2];
    img.data[k + 3] = Math.round(a * 255);
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const wx = b.x + ((x + 0.5) / w) * b.size;
      const wy = b.y + ((y + 0.5) / h) * b.size;
      const d = at(f.coast, wx, wy);
      const g = at(f.grass, wx, wy);
      const k = (y * w + x) * 4;
      const edge = Math.abs(d) < b.size / w;
      if (edge) put(k, [56, 44, 30], 0.85);
      else if (d < -tuning.island.shallowWidth * 1.3) continue;
      else if (d < 0) put(k, [52, 108, 112], 0.55 * (1 + d / (tuning.island.shallowWidth * 1.3)) + 0.12);
      else if (g > 0) put(k, [88, 98, 44], 0.85);
      else put(k, [196, 160, 98], 0.7);
    }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = 'rgba(80, 58, 34, 0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 4; i++) {
    const gx = Math.round((w * i) / 4) + 0.5;
    const gy = Math.round((h * i) / 4) + 0.5;
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, h);
    ctx.moveTo(0, gy);
    ctx.lineTo(w, gy);
  }
  ctx.stroke();
  tex.refresh();
  return key;
}

/** Safe-area insets (notches, rounded corners, gesture bar) in game pixels. */
function readInsets(dpr: number): { top: number; right: number; bottom: number; left: number } {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const out = {
    top: parseFloat(cs.paddingTop) * dpr,
    right: parseFloat(cs.paddingRight) * dpr,
    bottom: parseFloat(cs.paddingBottom) * dpr,
    left: parseFloat(cs.paddingLeft) * dpr,
  };
  probe.remove();
  return out;
}
