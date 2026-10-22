import Phaser from 'phaser';
import { getInventory } from '../core/inventory';
import fishing from '../data/fishing.json';
import layout from '../data/generated/fishing-layout.json';

/**
 * First-person fishing off the dock, drawn to look exactly like image 07:
 * the painted scene, his hand on the rod in front, the parchment panel and
 * the big button. Everything here is placed in image-07 pixels inside one
 * container scaled to the screen's width; the sky continues above it.
 *
 * Cast (hold, release) > wait (nibbles) > strike (0.85 s) > reel against
 * line tension > result card. Follows the brief's Fishing section.
 */
type Phase = 'ready' | 'charging' | 'flying' | 'waiting' | 'bite' | 'reeling' | 'result';
export type FishingSpot = 'dock' | 'shore';

/**
 * Where he fishes from. The dock is image 07, the beach image 15; both share
 * one layout. The dock counts as deeper water. Points are image pixels:
 * where short and long casts land, where a landed fish comes in, and the
 * bottom of the water for the perspective scale.
 */
const SPOTS = {
  dock: { image: 'fishing_dock', horizon: layout.horizon, castNear: 1010, castFar: 610, reelEnd: [600, 1060], waterBottom: 1080, rodShift: [0, 0], reach: fishing.dockReachBonus, islandRect: layout.islandRect, skyTop: layout.skyTop },
  shore: { image: 'fishing_shore', horizon: layout.shore.horizon, castNear: 850, castFar: 585, reelEnd: [600, 880], waterBottom: 960, rodShift: layout.shore.rodOffset, reach: 0, islandRect: layout.shore.islandRect, skyTop: layout.shore.skyTop },
} as const;
type Catch = (typeof fishing.catches)[number];

const [IMG_W, IMG_H] = layout.size;
const DARK = '#2A1D12';
const LIGHT = '#F3E8CF';
const OUTLINE = '#211912';
const GREEN = 0x7fb64c;
const ORANGE = 0xe8892b;
const MUTED = 0xa08e6c;
const R = fishing.reel;

const COPY: Record<string, [string, string]> = {
  ready: ['HOLD TO CAST', 'Let go when the power bar is where you want it. Longer casts reach bigger fish.'],
  waiting: ['WAIT FOR A BITE', "Watch the float. Nibbles make it twitch. Strike when it's pulled under."],
  bite: ['STRIKE!', 'Tap now, before the fish lets go.'],
  reeling: ['REEL IT IN', 'Hold to reel. Let go when the tension runs high, or the line will snap.'],
  early: ['TOO EARLY', 'You struck on a nibble and scared the fish off.'],
  missed: ['IT GOT AWAY', 'You were too slow on the strike.'],
  snapped: ['THE LINE SNAPPED', 'Too much tension. Let go of the reel when the bar runs high.'],
  slipped: ['IT GOT AWAY', 'Too much slack, and the fish swam off.'],
  landed: ['NICE CATCH', 'Cast again, or head back to the island.'],
};

export class FishingScene extends Phaser.Scene {
  private stage!: Phaser.GameObjects.Container;
  private sky!: Phaser.GameObjects.Rectangle;
  private rod!: Phaser.GameObjects.Image;
  private line!: Phaser.GameObjects.Graphics;
  private bars!: Phaser.GameObjects.Graphics;
  private title!: Phaser.GameObjects.Text;
  private body!: Phaser.GameObjects.Text;
  private button!: Phaser.GameObjects.Image;
  private buttonLabel!: Phaser.GameObjects.Text;
  private barLabels: Phaser.GameObjects.Text[] = [];
  private card?: Phaser.GameObjects.Container;
  private space!: Phaser.Input.Keyboard.Key;

  private phase: Phase = 'ready';
  private holding = false;
  private t = 0; // seconds in the current phase
  private power = 0;
  private cast = 0;
  private biteAt = 0;
  private nibbles: number[] = [];
  private fish?: Catch;
  private kg = 0;
  private tension = 0;
  private progress = 0;
  private burstLeft = 0;
  private nextBurst = 0;
  private float = { x: 0, y: 0, under: 0, twitch: 0 };
  private from = { x: 0, y: 0 };
  private target = { x: 0, y: 0 };
  private rodAngle = 0;
  /** True while the float is out on the water (or flying there). */
  private floatOut = false;
  private lost = 0;
  private levelledUp = false;
  private pulse?: Phaser.Tweens.Tween;
  private spot: (typeof SPOTS)[FishingSpot] = SPOTS.dock;
  /** The distant island shows only when there is land out that way. */
  private landInView = false;

  constructor() {
    super('fishing');
  }

  init(data: { spot?: FishingSpot; landInView?: boolean }): void {
    this.spot = SPOTS[data.spot ?? 'dock'];
    this.landInView = !!data.landInView;
  }

  create(): void {
    this.phase = 'ready';
    this.card = undefined;
    this.sky = this.add.rectangle(0, 0, 10, 10, Phaser.Display.Color.GetColor(...(this.spot.skyTop as unknown as [number, number, number]))).setOrigin(0);
    this.stage = this.add.container(0, 0);
    this.stage.add(this.add.image(0, 0, this.spot.image).setOrigin(0));
    if (this.landInView) {
      const [ix0, , ix1, iy1] = this.spot.islandRect;
      this.stage.add(this.add.image((ix0 + ix1) / 2, iy1, 'fishing', 'distant_island').setOrigin(0.5, 1));
    }
    this.line = this.add.graphics();
    this.stage.add(this.line);

    const [rx0, ry0, rx1, ry1] = layout.rodBox;
    const [px, py] = this.pivot();
    this.rod = this.add.image(px, py, 'fishing', 'rod_hand').setOrigin((px - rx0) / (rx1 - rx0), (py - ry0) / (ry1 - ry0));
    this.stage.add(this.rod);

    // The parchment panel with its instructions.
    const [p0x, p0y, p1x, p1y] = layout.panel;
    this.stage.add(this.add.image(p0x, p0y, 'fishing', 'panel').setOrigin(0).setDisplaySize(p1x - p0x, p1y - p0y));
    const cx = (p0x + p1x) / 2;
    this.title = this.text(cx, p0y + 48, '', 46, DARK, 0.5);
    this.body = this.add
      .text(cx, p0y + 92, '', {
        fontFamily: 'Nunito, sans-serif',
        fontStyle: '700',
        fontSize: '27px',
        color: DARK,
        align: 'center',
        lineSpacing: 6,
        wordWrap: { width: p1x - p0x - 70 },
      })
      .setOrigin(0.5, 0);
    this.stage.add(this.body);

    const [c0x, c0y, c1x, c1y] = layout.close_x;
    const close = this.add.image(c0x, c0y, 'fishing', 'close_x').setOrigin(0).setDisplaySize(c1x - c0x, c1y - c0y);
    close.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.leave());
    this.stage.add(close);

    // Bars: the painted power bar's spot, and a reel-in bar above it while reeling.
    this.bars = this.add.graphics();
    const [b0x, b0y, b1x, b1y] = layout.power_bar;
    const reelBar = this.add.image(b0x, b0y - 70, 'fishing', 'power_bar').setOrigin(0).setDisplaySize(b1x - b0x, b1y - b0y);
    reelBar.setName('reelBar');
    this.stage.add([this.add.image(b0x, b0y, 'fishing', 'power_bar').setOrigin(0).setDisplaySize(b1x - b0x, b1y - b0y), reelBar, this.bars]);
    this.barLabels = [this.text(b0x - 16, (b0y + b1y) / 2, 'POWER', 34, LIGHT, 1, 0.5), this.text(b0x - 16, (b0y + b1y) / 2 - 70, 'REEL', 34, LIGHT, 1, 0.5)];

    const [k0x, k0y, k1x, k1y] = layout.button_big;
    this.button = this.add.image((k0x + k1x) / 2, (k0y + k1y) / 2, 'fishing', 'button_big').setDisplaySize(k1x - k0x, k1y - k0y);
    this.stage.add(this.button);
    this.buttonLabel = this.text((k0x + k1x) / 2, (k0y + k1y) / 2 - 2, '', 58, LIGHT, 0.5, 0.5);
    this.button.setInteractive({ useHandCursor: true });
    this.button.on('pointerdown', () => this.press());
    this.input.on('pointerup', () => this.release());
    this.input.on('gameout', () => this.release());

    this.space = this.input.keyboard!.addKey('SPACE');
    this.space.on('down', () => this.press());
    this.space.on('up', () => this.release());

    const onBack = (): void => this.leave();
    this.game.events.on('back', onBack);
    this.events.once('shutdown', () => {
      this.game.events.off('back', onBack);
      this.scale.off('resize', this.fit, this);
    });
    this.scale.on('resize', this.fit, this);
    this.fit();
    this.setPhase('ready');
  }

  /** Image 07 fills the screen's width, standing on its bottom edge; the sky continues above. */
  private fit(): void {
    const { width, height } = this.scale;
    const s = width / height < IMG_W / IMG_H ? width / IMG_W : height / IMG_H;
    this.stage.setScale(s).setPosition((width - IMG_W * s) / 2, height - IMG_H * s);
    this.sky.setSize(width, Math.max(0, this.stage.y + 2));
  }

  private text(x: number, y: number, s: string, size: number, colour: string, ox = 0.5, oy = 0.5): Phaser.GameObjects.Text {
    const light = colour === LIGHT;
    const t = this.add
      .text(x, y, s, {
        fontFamily: 'Oswald, sans-serif',
        fontStyle: '700',
        fontSize: `${size}px`,
        color: colour,
        stroke: light ? OUTLINE : undefined,
        strokeThickness: light ? 7 : 0,
      })
      .setOrigin(ox, oy);
    this.stage.add(t);
    return t;
  }

  private say(key: keyof typeof COPY): void {
    const [title, body] = COPY[key];
    this.title.setText(title);
    this.body.setText(body);
  }

  private setButton(label: string, tint: number, pulse = false): void {
    this.buttonLabel.setText(label);
    this.button.setTint(tint);
    this.pulse?.stop();
    this.pulse = undefined;
    const [k0x, , k1x] = layout.button_big;
    const base = (k1x - k0x) / this.button.width;
    this.button.setScale(base, this.button.scaleY);
    if (pulse) {
      this.pulse = this.tweens.add({ targets: [this.button, this.buttonLabel], alpha: 0.7, duration: 180, yoyo: true, repeat: -1 });
    } else {
      this.button.setAlpha(1);
      this.buttonLabel.setAlpha(1);
    }
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.t = 0;
    const reel = phase === 'reeling';
    this.barLabels[0].setText(reel ? 'TENSION' : 'POWER');
    this.barLabels[1].setVisible(reel);
    (this.stage.getByName('reelBar') as Phaser.GameObjects.Image).setVisible(reel);
    switch (phase) {
      case 'ready':
        this.power = 0;
        this.floatOut = false;
        this.say('ready');
        this.setButton('HOLD TO CAST', GREEN);
        break;
      case 'charging':
        this.setButton('LET GO TO CAST', GREEN);
        break;
      case 'flying':
        this.setButton('WAIT...', MUTED);
        break;
      case 'waiting': {
        this.say('waiting');
        this.setButton('WAIT...', MUTED);
        this.biteAt = Phaser.Math.FloatBetween(fishing.waitMin, fishing.waitMax);
        const n = Phaser.Math.Between(0, fishing.nibblesMax);
        this.nibbles = Array.from({ length: n }, () => Phaser.Math.FloatBetween(0.6, this.biteAt - 0.5)).sort((a, b) => a - b);
        break;
      }
      case 'bite':
        this.say('bite');
        this.setButton('STRIKE!', ORANGE, true);
        this.cameras.main.shake(120, 0.003);
        break;
      case 'reeling':
        this.say('reeling');
        this.setButton('HOLD TO REEL', GREEN);
        this.tension = 0.15;
        this.progress = R.startProgress;
        this.burstLeft = 0;
        this.nextBurst = this.burstGap();
        break;
      case 'result':
        this.setButton('', MUTED);
        break;
    }
  }

  private press(): void {
    if (this.holding) return;
    this.holding = true;
    if (this.phase === 'ready') this.setPhase('charging');
    else if (this.phase === 'waiting') this.fail('early');
    else if (this.phase === 'bite') this.hook();
  }

  private release(): void {
    if (!this.holding) return;
    this.holding = false;
    if (this.phase === 'charging') this.doCast();
  }

  private doCast(): void {
    this.cast = this.power;
    const d = this.cast;
    this.from = this.rodTip();
    const sp = this.spot;
    this.target = { x: 560 - d * 70 + Phaser.Math.Between(-30, 30), y: Phaser.Math.Linear(sp.castNear, sp.castFar, d) };
    this.float.under = 0;
    this.floatOut = true;
    this.setPhase('flying');
  }

  private hook(): void {
    const reach = this.cast + this.spot.reach;
    const pool = fishing.catches.filter((c) => c.minCast <= reach);
    let r = Math.random() * pool.reduce((t, c) => t + c.odds, 0);
    this.fish = pool.find((c) => (r -= c.odds) <= 0) ?? pool[0];
    const f = this.fish;
    this.kg = Math.round((f.kgMin + (f.kgMax - f.kgMin) * Math.random() ** 1.6) * 10) / 10;
    this.holding = false; // the strike tap isn't a reel
    this.setPhase('reeling');
  }

  private fail(why: 'early' | 'missed' | 'snapped' | 'slipped'): void {
    this.say(why);
    this.setPhase('result');
    this.float.under = 0;
    this.floatOut = false;
    this.cameras.main.shake(why === 'snapped' ? 200 : 80, why === 'snapped' ? 0.006 : 0.002);
    this.time.delayedCall(1700, () => {
      if (this.phase === 'result' && !this.card) this.setPhase('ready');
    });
  }

  private burstGap(): number {
    const f = this.fish;
    const k = f?.bursty ? 0.7 : 1.3;
    return Phaser.Math.FloatBetween(R.burstEveryMin, R.burstEveryMax) * k;
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50) / 1000;
    this.t += dt;
    let angle = Math.sin(this.time.now / 900) * 0.6; // a resting hand isn't perfectly still

    switch (this.phase) {
      case 'charging': {
        // The bar sweeps up and down until he lets go.
        const u = (this.t / fishing.castSweepSeconds) % 2;
        this.power = u < 1 ? u : 2 - u;
        angle += 10 * this.power;
        break;
      }
      case 'flying': {
        const k = Math.min(1, this.t / 0.6);
        angle += -7 * (1 - k);
        this.float.x = Phaser.Math.Linear(this.from.x, this.target.x, k);
        this.float.y = Phaser.Math.Linear(this.from.y, this.target.y, k) - Math.sin(k * Math.PI) * 260;
        if (k >= 1) {
          this.splash(this.target.x, this.target.y, 1);
          this.setPhase('waiting');
        }
        break;
      }
      case 'waiting': {
        if (this.nibbles.length && this.t >= this.nibbles[0]) {
          this.nibbles.shift();
          this.float.twitch = 1;
          this.splash(this.float.x, this.float.y, 0.4);
        }
        if (this.t >= this.biteAt) {
          this.float.under = 1;
          this.splash(this.float.x, this.float.y, 0.8);
          this.setPhase('bite');
        }
        break;
      }
      case 'bite':
        angle -= 3;
        if (this.t > fishing.strikeWindow) {
          this.float.under = 0;
          this.fail('missed');
        }
        break;
      case 'reeling':
        angle += this.reel(dt);
        break;
    }

    if (this.phase === 'waiting' || this.phase === 'bite') {
      this.float.x = this.target.x;
      this.float.y = this.target.y + Math.sin(this.time.now / 380) * 3 + this.float.twitch * 9;
      this.float.twitch = Math.max(0, this.float.twitch - dt * 5);
    }
    this.rodAngle = Phaser.Math.Linear(this.rodAngle, angle, Math.min(1, dt * 14));
    this.rod.setAngle(this.rodAngle);
    this.draw();
  }

  /** One frame of the reel fight; returns how far the rod bends. */
  private reel(dt: number): number {
    const f = this.fish!;
    const fight = f.fight;
    if (this.holding) {
      this.tension += R.tensionRise * dt * (0.6 + 0.8 * fight);
      this.progress += R.reelRate * dt * (1 - 0.6 * fight);
      if (!f.bursty) this.tension += 0.25 * fight * dt;
    } else {
      this.tension -= R.tensionFall * dt;
      this.progress -= R.slipRate * dt * (0.4 + fight);
    }
    this.nextBurst -= dt;
    if (this.nextBurst <= 0 && this.burstLeft <= 0) {
      this.burstLeft = Phaser.Math.FloatBetween(R.burstSecondsMin, R.burstSecondsMax);
      this.nextBurst = this.burstGap();
      this.splash(this.float.x, this.float.y, 0.6);
    }
    let shake = 0;
    if (this.burstLeft > 0) {
      this.burstLeft -= dt;
      const k = f.bursty ? 1.4 : 1;
      this.tension += R.burstTension * fight * k * dt * (this.holding ? 1 : 0.35);
      this.progress -= R.burstPull * fight * k * dt;
      shake = Math.sin(this.time.now / 25) * 2.5;
    }
    this.tension = Phaser.Math.Clamp(this.tension, 0, 1);
    this.progress = Math.min(1, this.progress);
    // The float comes in toward the dock as he wins line back.
    const near = { x: this.spot.reelEnd[0], y: this.spot.reelEnd[1] };
    this.float.x = Phaser.Math.Linear(this.target.x, near.x, this.progress) + shake * 2;
    this.float.y = Phaser.Math.Linear(this.target.y, near.y, this.progress) + Math.sin(this.time.now / 120) * 2;
    if (this.tension >= 1) this.fail('snapped');
    else if (this.progress <= 0) this.fail('slipped');
    else if (this.progress >= 1) this.landed();
    return -2 - this.tension * 7 + shake;
  }

  private landed(): void {
    const f = this.fish!;
    this.setPhase('result');
    this.say('landed');
    this.floatOut = false;
    const reg = this.registry;
    const inv = getInventory(reg);
    // Into the bag; whatever doesn't fit goes back in the sea.
    this.lost = f.rawFish ? inv.add('raw_fish', f.rawFish) : 0;
    this.levelledUp = inv.gainXp(f.xp);
    reg.set('fishCaught', (reg.get('fishCaught') ?? 0) + (f.id === 'old_boot' ? 0 : 1));
    if (f.id !== 'old_boot') reg.set(`caught_${f.id}`, true);
    this.showCard(f);
  }

  /** The parchment result card: the catch, its weight and the reward. */
  private showCard(f: Catch): void {
    const cx = IMG_W / 2;
    const cy = 700;
    const w = 680;
    const h = 700;
    const card = this.add.container(cx, cy);
    card.add(this.add.image(0, 0, 'fishing', 'panel').setDisplaySize(w, h));
    const t = (y: number, s: string, size: number, font = 'Oswald'): Phaser.GameObjects.Text =>
      this.add
        .text(0, y, s, { fontFamily: `${font}, sans-serif`, fontStyle: '700', fontSize: `${size}px`, color: DARK, align: 'center', wordWrap: { width: w - 80 } })
        .setOrigin(0.5);
    const boot = f.id === 'old_boot';
    card.add(t(-290, boot ? 'WELL, IT FLOATED IN' : 'YOU CAUGHT', 30, 'Nunito'));
    card.add(t(-238, boot ? 'AN OLD BOOT' : f.name.toUpperCase(), 62));
    // The fish as image 14 paints it, fitted to the card.
    if (this.textures.get('fishing').has(`fish_${f.id}`)) {
      const pic = this.add.image(0, -100, 'fishing', `fish_${f.id}`);
      pic.setScale(Math.min(1.15, 560 / pic.width, 190 / pic.height));
      card.add(pic);
      pic.setAngle(-8);
      this.tweens.add({ targets: pic, angle: 6, duration: 160, yoyo: true, repeat: 3, ease: 'Sine.easeInOut' });
    }
    card.add(t(30, `${this.kg < 10 ? this.kg.toFixed(1) : Math.round(this.kg)} kg`, 38, 'Nunito'));
    const reward = [f.rawFish ? `+${f.rawFish} Raw fish` : '', `+${f.xp} XP`].filter(Boolean).join('     ');
    card.add(t(84, reward, 36, 'Nunito'));
    const note = this.lost
      ? `Your bag is full. ${this.lost === f.rawFish ? 'You let it go.' : `${this.lost} didn't fit.`}`
      : this.levelledUp
        ? `Level up! You're now level ${getInventory(this.registry).level}.`
        : 'note' in f && f.note
          ? f.note
          : '';
    if (note) card.add(t(132, note, 28, 'Nunito').setAlpha(0.8));
    card.add(this.add.graphics().lineStyle(3, 0x2a1d12, 0.35).lineBetween(-w / 2 + 50, 172, w / 2 - 50, 172));
    const btn = (x: number, label: string, tint: number, onTap: () => void): void => {
      const b = this.add.image(x, 252, 'fishing', 'button_big').setDisplaySize(280, 96).setTint(tint);
      const l = this.add
        .text(x, 250, label, { fontFamily: 'Oswald, sans-serif', fontStyle: '700', fontSize: '34px', color: LIGHT, stroke: OUTLINE, strokeThickness: 6 })
        .setOrigin(0.5);
      b.setInteractive({ useHandCursor: true }).on('pointerdown', onTap);
      card.add([b, l]);
    };
    btn(-150, 'CAST AGAIN', GREEN, () => {
      card.destroy();
      this.card = undefined;
      this.setPhase('ready');
    });
    btn(150, 'BACK TO ISLAND', 0xb07b45, () => this.leave());
    card.setScale(0.6).setAlpha(0);
    this.tweens.add({ targets: card, scale: 1, alpha: 1, duration: 260, ease: 'Back.easeOut' });
    this.stage.add(card);
    this.card = card;
  }

  private leave(): void {
    this.game.events.emit('fishing-done');
  }

  /** The rod's pivot in this view (the beach view holds it a little further right). */
  private pivot(): [number, number] {
    return [layout.rodPivot[0] + this.spot.rodShift[0], layout.rodPivot[1] + this.spot.rodShift[1]];
  }

  private rodTip(): { x: number; y: number } {
    const [px, py] = this.pivot();
    const tx = layout.rodTip[0] + this.spot.rodShift[0];
    const ty = layout.rodTip[1] + this.spot.rodShift[1];
    const a = Phaser.Math.DegToRad(this.rod.angle);
    const dx = tx - px;
    const dy = ty - py;
    return { x: px + dx * Math.cos(a) - dy * Math.sin(a), y: py + dx * Math.sin(a) + dy * Math.cos(a) };
  }

  private splash(x: number, y: number, size: number): void {
    const p = this.persp(y);
    const ring = this.add.ellipse(x, y, 40 * p * size, 12 * p * size).setStrokeStyle(4 * p, 0xe9efe2, 0.9);
    this.stage.addAt(ring, 2);
    this.tweens.add({ targets: ring, scaleX: 3, scaleY: 3, alpha: 0, duration: 700, onComplete: () => ring.destroy() });
  }

  /** Things on the water shrink toward the horizon. */
  private persp(y: number): number {
    const { horizon, waterBottom } = this.spot;
    return Phaser.Math.Clamp(Phaser.Math.Linear(0.3, 1, (y - horizon) / (waterBottom - horizon)), 0.3, 1.1);
  }

  private draw(): void {
    const g = this.line.clear();
    const tip = this.rodTip();
    const cast = this.floatOut;
    // Before a cast the float dangles a little below the tip.
    const fx = cast ? this.float.x : tip.x - 6 + Math.sin(this.time.now / 500) * 4;
    const fy = cast ? this.float.y : tip.y + 150;
    const taut = this.phase === 'reeling' ? this.tension : this.phase === 'flying' ? 0.6 : 0.1;
    const mx = (tip.x + fx) / 2;
    const my = (tip.y + fy) / 2 + (1 - taut) * (cast ? 70 : 10);
    g.lineStyle(2.5, 0x2a2a22, 0.85);
    const curve = new Phaser.Curves.QuadraticBezier(new Phaser.Math.Vector2(tip.x, tip.y), new Phaser.Math.Vector2(mx, my), new Phaser.Math.Vector2(fx, fy));
    curve.draw(g, 24);

    // The float: red over white, outlined like everything else.
    const onWater = cast && this.phase !== 'flying';
    const p = onWater ? this.persp(fy) : 0.8;
    const under = onWater ? this.float.under : 0;
    const r = 13 * p;
    if (under < 1) {
      const top = fy - r * (onWater ? 0.9 : 1.6) * (1 - under);
      g.lineStyle(3 * p, 0x211912, 1);
      g.fillStyle(0xeee4cf, 1).fillCircle(fx, top + r * 0.9, r);
      g.fillStyle(0xc8402f, 1).slice(fx, top + r * 0.9, r, Math.PI, 0, false).fillPath();
      g.strokeCircle(fx, top + r * 0.9, r);
      g.lineBetween(fx, top + r * 0.9 - r, fx, top - r * 0.6);
      if (onWater) {
        // Water closes over the lower half.
        g.fillStyle(0x2f6f73, 0.85).fillEllipse(fx, fy + r * 0.35, r * 2.6, r * 0.9);
      }
    }
    if (onWater) g.lineStyle(2 * p, 0xe9efe2, 0.6).strokeEllipse(fx, fy, r * 3.2, r * 0.9);

    // Bar fills, drawn inside the painted bar tracks.
    const b = this.bars.clear();
    const [b0x, b0y, b1x, b1y] = layout.power_bar;
    const fill = (y0: number, v: number, colour: number): void => {
      const x = b0x + 9;
      const h = b1y - b0y - 18;
      const w = (b1x - b0x - 18) * Phaser.Math.Clamp(v, 0, 1);
      if (w < 2) return;
      b.fillStyle(colour, 1).fillRoundedRect(x, y0 + 9, w, h, 8);
      b.fillStyle(0xffffff, 0.22).fillRoundedRect(x + 4, y0 + 12, Math.max(0, w - 8), h * 0.3, 5);
      b.fillStyle(0x000000, 0.18).fillRect(x + 4, y0 + 9 + h * 0.72, Math.max(0, w - 8), h * 0.2);
    };
    if (this.phase === 'reeling') {
      const c = this.tension < 0.6 ? 0x6fa83f : this.tension < 0.85 ? 0xe3a52a : 0xd63a2c;
      fill(b0y, this.tension, c);
      fill(b0y - 70, this.progress, 0x3f8fd0);
    } else {
      fill(b0y, this.phase === 'charging' || this.phase === 'flying' ? (this.phase === 'charging' ? this.power : this.cast) : 0, 0xe3a52a);
    }
  }
}
