import Phaser from 'phaser';
import tuning from '../data/tuning.json';
import rects from '../data/generated/image06-rects.json';
import { Player } from '../entities/Player';
import { randomSeed, Rng } from '../core/rng';
import { generateIsland, type IslandData } from '../world/islandGen';
import { addTerrain } from '../world/terrainShader';

const A = tuning.ambience;
/** Depths: flat ground layers sit far below anything sorted by its foot. */
const DEPTH_TERRAIN = -2e6;
const DEPTH_GROUND = -1e6;

export class IslandScene extends Phaser.Scene {
  private island!: IslandData;
  private player!: Player;
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;
  private fpsText?: Phaser.GameObjects.Text;

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
    cam.startFollow(this.player.sprite, true, tuning.view.cameraLerp, tuning.view.cameraLerp);
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
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.player.walkTo({ x: p.worldX, y: p.worldY }));

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
    const rng = new Rng(this.island.seed ^ 0xa11ce);
    this.anims.create({
      key: 'palm_sway',
      frames: this.anims.generateFrameNames('world', { prefix: 'palm_sway_', start: 0, end: 4 }),
      frameRate: A.palmSwayFps,
      repeat: -1,
      yoyo: true,
    });
    for (const o of this.island.objects) {
      if (o.kind === 'prop' && o.frame === 'campfire') continue;
      const s = this.add.sprite(o.x, o.y, 'world', o.frame).setOrigin(0.5, 1).setScale(o.scale).setFlipX(o.flip);
      s.setDepth(o.layer === 'ground' ? DEPTH_GROUND + 100 + o.y * 0.01 : o.y);
      if (o.kind === 'palm') {
        if (o.sway) {
          s.play({ key: 'palm_sway', startFrame: rng.int(0, 4) });
        } else {
          s.setAngle(-A.palmRockDeg);
          this.tweens.add({
            targets: s,
            angle: A.palmRockDeg,
            duration: rng.range(1800, 2800),
            delay: rng.range(0, 1500),
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
          });
        }
      }
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

  update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50) / 1000;
    const k = this.keys;
    const dir = {
      x: (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0),
      y: (k.down.isDown || k.s.isDown ? 1 : 0) - (k.up.isDown || k.w.isDown ? 1 : 0),
    };
    this.player.update(dt, dir);
    if (this.fpsText) this.fpsText.setText(`${Math.round(this.game.loop.actualFps)} fps`);
  }
}
