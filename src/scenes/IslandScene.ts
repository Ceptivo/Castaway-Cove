import Phaser from 'phaser';
import tuning from '../data/tuning.json';
import rects from '../data/generated/image06-rects.json';
import { Player } from '../entities/Player';
import type { FishingSpot } from './FishingScene';
import type { HudScene } from './HudScene';
import { getInventory } from '../core/inventory';
import { randomSeed, Rng } from '../core/rng';
import { generateIsland, type IslandData } from '../world/islandGen';
import { addTerrain } from '../world/terrainShader';
import { pointInPolygon } from '../world/walkGrid';

const A = tuning.ambience;
export type Wind = keyof typeof tuning.ambience.palms;
/** Depths: flat ground layers sit far below anything sorted by its foot. */
const DEPTH_TERRAIN = -2e6;
const DEPTH_GROUND = -1e6;

export class IslandScene extends Phaser.Scene {
  private island!: IslandData;
  private player!: Player;
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;
  private fpsText?: Phaser.GameObjects.Text;
  private palms: { sprite: Phaser.GameObjects.Sprite; sway: boolean }[] = [];
  private hud!: HudScene;
  private fishingSpot: FishingSpot | null = null;

  constructor() {
    super('island');
  }

  create(): void {
    const params = new URLSearchParams(location.search);
    const seed = Number(params.get('seed')) || randomSeed();
    this.island = generateIsland(seed);
    const island = this.island;
    const size = island.size;

    addTerrain(this, island).setDepth(DEPTH_TERRAIN);

    this.placeDecals();
    this.placeObjects();
    this.addFire();

    this.player = new Player(this, island.playerStart, island.walk);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, size, size);
    cam.startFollow(this.player.view, true, tuning.view.cameraLerp, tuning.view.cameraLerp);
    this.fitCamera();
    this.scale.on('resize', this.fitCamera, this);
    cam.centerOn(island.playerStart.x, island.playerStart.y);

    const kb = this.input.keyboard!;
    this.keys = kb.addKeys({
      up: 'UP',
      down: 'DOWN',
      left: 'LEFT',
      right: 'RIGHT',
      w: 'W',
      a: 'A',
      s: 'S',
      d: 'D',
    }) as typeof this.keys;
    this.scene.launch('hud', { player: this.player, island });
    const hud = this.scene.get('hud') as HudScene;
    this.hud = hud;
    const onContext = (what: string): void => {
      if (what === 'fish') this.openFishing();
    };
    const onFishingDone = (): void => this.closeFishing();
    const onOpenBag = (): void => this.openBag();
    const onBagClosed = (): void => this.closeBag();
    this.game.events.on('context', onContext);
    this.game.events.on('fishing-done', onFishingDone);
    this.game.events.on('open-bag', onOpenBag);
    this.game.events.on('bag-closed', onBagClosed);
    this.events.once('shutdown', () => {
      this.game.events.off('context', onContext);
      this.game.events.off('fishing-done', onFishingDone);
      this.game.events.off('open-bag', onOpenBag);
      this.game.events.off('bag-closed', onBagClosed);
    });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (hud.isOverHud(p.x, p.y)) return;
      this.player.walkTo({ x: p.worldX, y: p.worldY });
    });

    if (params.has('debug')) this.fpsText = this.add.text(8, 8, '', { fontFamily: 'monospace', fontSize: '24px', color: '#fff' }).setScrollFactor(0).setDepth(1e7);
    // Lets automated screenshots drive the castaway.
    (window as unknown as { castaway: unknown }).castaway = { scene: this, player: this.player, island };
  }

  /** Zoom so a fixed amount of world fits across the screen's short side. */
  private fitCamera(): void {
    const { width, height } = this.scale;
    this.cameras.main.setZoom(Math.min(width, height) / tuning.view.worldUnitsAcrossShortSide);
  }

  private placeDecals(): void {
    for (const d of this.island.decals) {
      this.add.image(d.x, d.y, 'world', d.frame).setScale(d.scale).setFlipX(d.flip).setDepth(DEPTH_GROUND + d.y * 0.01);
    }
  }

  private placeObjects(): void {
    this.anims.create({
      key: 'palm_sway',
      frames: this.anims.generateFrameNames('world', { prefix: 'palm_sway_', start: 0, end: 4 }),
      frameRate: A.palms.windy.swayFps,
      repeat: -1,
      yoyo: true,
    });
    for (const o of this.island.objects) {
      if (o.kind === 'prop' && o.frame === 'campfire') continue;
      const s = this.add.sprite(o.x, o.y, 'world', o.frame).setOrigin(0.5, 1).setScale(o.scale).setFlipX(o.flip);
      s.setDepth(o.layer === 'ground' ? DEPTH_GROUND + 100 + o.y * 0.01 : o.y);
      if (o.kind === 'palm') this.palms.push({ sprite: s, sway: !!o.sway });
    }
    this.setWind(A.startWind as Wind);
  }

  /** Palms move with the wind: a slow lean when calm, the sway loop when windy. */
  setWind(wind: Wind): void {
    const w = A.palms[wind];
    const rng = new Rng(this.island.seed ^ 0xa11ce);
    for (const { sprite, sway } of this.palms) {
      this.tweens.killTweensOf(sprite);
      if (sway && w.swayFps > 0) {
        sprite.play({ key: 'palm_sway', frameRate: w.swayFps * rng.range(0.85, 1.15), startFrame: rng.int(0, 4) });
      } else {
        sprite.stop();
        if (sway) sprite.setFrame('palm_sway_0');
      }
      const period = w.leanSeconds * 1000 * rng.range(0.85, 1.15);
      sprite.setAngle(-w.leanDeg);
      this.tweens.add({
        targets: sprite,
        angle: w.leanDeg,
        duration: period / 2,
        delay: rng.range(0, period),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

  /** The lit campfire: the ring from image 06, a flickering flame and its glow. */
  private addFire(): void {
    const fire = this.island.fire;
    const ring = this.island.objects.find((o) => o.frame === 'campfire')!;
    this.add.sprite(ring.x, ring.y, 'world', 'campfire').setOrigin(0.5, 1).setDepth(ring.y);
    const [fx0, , fx1, fy1] = rects.campfire_flame;
    const [cx0, , cx1, cy1] = rects.campfire;
    const flame = this.add
      .image(fire.x + (fx0 + fx1) / 2 - (cx0 + cx1) / 2, fire.y + fy1 - cy1, 'world', 'campfire_flame')
      .setOrigin(0.5, 1)
      .setDepth(ring.y + 0.1);
    const glow = this.add
      .image(fire.x, fire.y - 50, 'fire_glow')
      .setScale(1.6)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(ring.y + 0.2);
    this.time.addEvent({
      delay: A.fireFlickerMs,
      loop: true,
      callback: () => {
        flame.setScale(Phaser.Math.FloatBetween(0.94, 1.04), Phaser.Math.FloatBetween(0.92, 1.08));
        flame.setAlpha(Phaser.Math.FloatBetween(0.85, 1));
        glow.setAlpha(Phaser.Math.FloatBetween(0.75, 1));
      },
    });
  }

  /** The world pauses while a first-person minigame is open. */
  /** On the dock, or standing at the water's edge (with a little give so it doesn't flicker). */
  private updateFishingSpot(): void {
    if (pointInPolygon(this.player, this.island.dockDeck)) {
      this.fishingSpot = 'dock';
      return;
    }
    const f = this.island.fields;
    const i = Math.min(f.w - 1, Math.max(0, Math.floor(this.player.x / f.cell)));
    const j = Math.min(f.h - 1, Math.max(0, Math.floor(this.player.y / f.cell)));
    const fromWater = f.coast[j * f.w + i];
    const edge = tuning.fishing.shoreEdge;
    if (fromWater < edge || (this.fishingSpot === 'shore' && fromWater < edge + 25)) this.fishingSpot = 'shore';
    else this.fishingSpot = null;
  }

  private openFishing(): void {
    if (this.scene.isActive('fishing') || !this.fishingSpot) return;
    this.player.stop();
    this.scene.pause();
    // No other islands are out at sea yet, so the horizon is open water.
    this.scene.launch('fishing', { spot: this.fishingSpot, landInView: false });
    this.scene.bringToTop('hud');
    this.hud.setMinigame(true);
  }

  private closeFishing(): void {
    this.scene.stop('fishing');
    this.hud.setMinigame(false);
    this.scene.resume();
    const fish = getInventory(this.registry).count('raw_fish');
    if (fish) this.hud.showMessage(`Raw fish in your bag: ${fish}`);
  }

  /** The Bag covers the screen and pauses the world (the brief). */
  private openBag(): void {
    if (this.scene.isActive('bag') || this.scene.isActive('fishing')) return;
    this.player.stop();
    this.scene.pause();
    this.scene.launch('bag');
    this.scene.bringToTop('bag');
  }

  private closeBag(): void {
    this.scene.stop('bag');
    this.scene.resume();
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50) / 1000;
    const k = this.keys;
    const dir = {
      x: (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0),
      y: (k.down.isDown || k.s.isDown ? 1 : 0) - (k.up.isDown || k.w.isDown ? 1 : 0),
    };
    this.player.update(dt, dir);
    // Fishing needs deep enough water: for now, from the dock (image 07's view).
    this.updateFishingSpot();
    this.hud.setContext(this.fishingSpot ? 'fish' : null);
    if (this.fpsText) this.fpsText.setText(`${Math.round(this.game.loop.actualFps)} fps`);
  }
}
