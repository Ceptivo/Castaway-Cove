import Phaser from 'phaser';
import layout from '../data/generated/bag-layout.json';
import tuning from '../data/tuning.json';
import { EQUIP_SLOTS, getInventory, item, RECIPES, type EquipSlot, type Inventory, type ItemId, type Recipe, type Stack } from '../core/inventory';

/**
 * The Bag, drawn to look exactly like image 05: the Inventory and Craft tabs
 * on the left, the character's loadout and status on the right, the four
 * meters along the bottom. Everything is placed in image-05 pixels. On a
 * wide screen the panels sit side by side; on a phone the right panel moves
 * under the left one (the brief: "stacked on phones").
 */
const LIGHT = '#EADBB8';
const DARK = '#2A1D12';
const RED = '#E0674A';
const GREEN = '#9BD25A';
const OUTLINE = '#211912';
const BACKDROP = 0x3a2f25;

const SLOT_W = 128;
const SLOT_H = 132;
const COLS = [78, 218, 358, 498];
const ROW_STEP = 147;
const LIST = layout.listBg; // x0, y0, x1, y1
const RIGHT_X = layout.right[0];
const RIGHT_Y = layout.right[1];
const STACKED_RIGHT = { x: layout.left[0], y: 926 + 14 };

type Tab = 'inventory' | 'craft';
type Page = 'loadout' | 'status';
type Selection = { kind: 'slot'; index: number } | { kind: 'equip'; slot: EquipSlot } | { kind: 'recipe'; index: number } | null;
interface Hit {
  x: number;
  y: number;
  w: number;
  h: number;
  panel: 'left' | 'right' | 'list';
  onTap: () => void;
}

const METERS: { key: 'health' | 'energy' | 'water' | 'food'; x: number; colour: number }[] = [
  { key: 'health', x: 782, colour: 0x7ab53c },
  { key: 'energy', x: 941, colour: 0xe3a52a },
  { key: 'water', x: 1097, colour: 0x3f8fd0 },
  { key: 'food', x: 1265, colour: 0xd0532f },
];

export class BagScene extends Phaser.Scene {
  private inv!: Inventory;
  private stage!: Phaser.GameObjects.Container;
  private left!: Phaser.GameObjects.Container;
  private right!: Phaser.GameObjects.Container;
  private list!: Phaser.GameObjects.Container;
  private listMask!: Phaser.GameObjects.Graphics;
  private dynamic: Phaser.GameObjects.GameObject[] = [];
  private hits: Hit[] = [];
  private tab: Tab = 'inventory';
  private page: Page = 'loadout';
  private sel: Selection = null;
  private all = false;
  private binArmed = false;
  private scroll = 0;
  private listHeight = 0;
  private drag?: { y: number; scroll: number; moved: boolean };
  private stacked = true;
  private toast?: Phaser.GameObjects.Container;
  private nameInput?: HTMLInputElement;

  constructor() {
    super('bag');
  }

  create(): void {
    this.inv = getInventory(this.registry);
    this.tab = 'inventory';
    this.page = 'loadout';
    this.sel = null;
    this.scroll = 0;
    this.add.rectangle(0, 0, 10, 10, BACKDROP).setOrigin(0).setName('backdrop');
    this.stage = this.add.container(0, 0);
    this.left = this.add.container(0, 0);
    this.right = this.add.container(0, 0);
    this.stage.add([this.left, this.right]);

    this.left.add(this.add.image(layout.left[0], layout.left[1], 'bag', 'bag_left').setOrigin(0));
    this.right.add(this.add.image(RIGHT_X, RIGHT_Y, 'bag', 'bag_right').setOrigin(0));
    const close = this.add.image(1488, 80, 'bag', 'bag_close');
    this.right.add(close);

    // Plain panel paper under the scrolling list, over the example rows painted in image 05.
    this.left.add(this.add.image(LIST[0], LIST[1], 'bag', 'bag_list_bg').setOrigin(0));
    this.list = this.add.container(0, 0);
    this.left.add(this.list);
    this.listMask = this.make.graphics({}, false);
    this.list.setMask(this.listMask.createGeometryMask());

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onDown(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onMove(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.onUp(p));
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.scrollBy(dy));
    const onBack = (): void => this.closeBag();
    this.game.events.on('back', onBack);
    this.input.keyboard?.on('keydown-ESC', onBack);
    this.events.once('shutdown', () => {
      this.game.events.off('back', onBack);
      this.scale.off('resize', this.fit, this);
      this.nameInput?.remove();
    });
    this.scale.on('resize', this.fit, this);
    this.fit();
    this.redraw();
  }

  /** Side by side when it fits, otherwise stacked; scaled to fill the screen. */
  private fit(): void {
    const { width, height } = this.scale;
    (this.children.getByName('backdrop') as Phaser.GameObjects.Rectangle).setSize(width, height);
    const pad = 12 * (this.registry.get('dpr') ?? 1);
    const wide = { w: 1510 - 34, h: 926 - 14 };
    const tall = { w: 800 - 34, h: STACKED_RIGHT.y + 902 - 14 };
    const sWide = Math.min((width - 2 * pad) / wide.w, (height - 2 * pad) / wide.h);
    const sTall = Math.min((width - 2 * pad) / tall.w, (height - 2 * pad) / tall.h);
    this.stacked = sTall > sWide;
    const s = this.stacked ? sTall : sWide;
    const box = this.stacked ? tall : wide;
    this.stage.setScale(s).setPosition((width - box.w * s) / 2 - 34 * s, (height - box.h * s) / 2 - 14 * s);
    this.right.setPosition(this.stacked ? STACKED_RIGHT.x - RIGHT_X : 0, this.stacked ? STACKED_RIGHT.y - RIGHT_Y : 0);
    const g = this.listMask.clear().fillStyle(0xffffff);
    g.fillRect(this.stage.x + LIST[0] * s, this.stage.y + LIST[1] * s, (LIST[2] - LIST[0]) * s, (LIST[3] - LIST[1]) * s);
  }

  // ---------------------------------------------------------------- drawing

  private redraw(): void {
    for (const o of this.dynamic) o.destroy();
    this.dynamic = [];
    this.hits = [];
    this.list.removeAll(true);
    this.drawTabs();
    if (this.tab === 'inventory') this.drawSlots();
    else this.drawRecipes();
    this.drawBottomBar();
    this.drawHeader();
    if (this.page === 'loadout') this.drawLoadout();
    else this.drawStatus();
    this.drawMeters();
    this.drawSideTabs();
    this.hit('right', 1450, 42, 78, 78, () => this.closeBag());
    this.applyScroll();
  }

  private keep<T extends Phaser.GameObjects.GameObject>(o: T, panel: 'left' | 'right'): T {
    (panel === 'left' ? this.left : this.right).add(o);
    this.dynamic.push(o);
    return o;
  }

  private label(panel: 'left' | 'right' | 'list', x: number, y: number, s: string, size: number, colour = LIGHT, ox = 0, oy = 0.5, font = 'Oswald'): Phaser.GameObjects.Text {
    const t = this.add
      .text(x, y, s, {
        fontFamily: `${font}, sans-serif`,
        fontStyle: '700',
        fontSize: `${size}px`,
        color: colour,
        stroke: colour === DARK ? undefined : OUTLINE,
        strokeThickness: colour === DARK ? 0 : Math.max(3, size / 9),
      })
      .setOrigin(ox, oy);
    if (panel === 'list') this.list.add(t);
    else this.keep(t, panel);
    return t;
  }

  private hit(panel: Hit['panel'], x: number, y: number, w: number, h: number, onTap: () => void): void {
    this.hits.push({ panel, x, y, w, h, onTap });
  }

  /** An item's picture fitted into a box, or nothing if it has no art yet. */
  private icon(container: Phaser.GameObjects.Container, id: ItemId, cx: number, cy: number, size: number): Phaser.GameObjects.Image | null {
    const ic = item(id).icon;
    if (!ic || !this.textures.get(ic[0]).has(ic[1])) {
      const t = this.add
        .text(cx, cy, item(id).name.toUpperCase(), { fontFamily: 'Oswald, sans-serif', fontStyle: '700', fontSize: '22px', color: LIGHT, align: 'center', wordWrap: { width: size } })
        .setOrigin(0.5)
        .setAlpha(0.75);
      container.add(t);
      if (container !== this.list) this.dynamic.push(t);
      return null;
    }
    const img = this.add.image(cx, cy, ic[0], ic[1]);
    img.setScale(Math.min(size / img.width, size / img.height));
    container.add(img);
    if (container !== this.list) this.dynamic.push(img);
    return img;
  }

  private drawTabs(): void {
    // The art has Inventory raised; shade whichever tab isn't open.
    const g = this.keep(this.add.graphics(), 'left');
    if (this.tab === 'craft') {
      g.fillStyle(0x1e160f, 0.38).fillRoundedRect(172, 34, 214, 84, 12);
      g.fillStyle(0xf2dfb0, 0.12).fillRoundedRect(396, 34, 318, 84, 12);
    }
    this.hit('left', 40, 18, 348, 106, () => this.setTab('inventory'));
    this.hit('left', 392, 26, 326, 98, () => this.setTab('craft'));
  }

  private drawSlots(): void {
    const inv = this.inv;
    let y = LIST[1] + 9;
    const section = (title: string, start: number, count: number): void => {
      const header = this.add.image(68, y, 'bag', 'bag_header').setOrigin(0);
      this.list.add(header);
      const used = inv.slots.slice(start, start + count).filter(Boolean).length;
      this.label('list', 123, y + 31, `${title} ${used}/${count}`, 38);
      y += 78;
      for (let k = 0; k < count; k++) {
        const col = k % 4;
        if (col === 0 && k > 0) y += ROW_STEP;
        this.drawSlot(start + k, COLS[col], y);
      }
      y += SLOT_H + 41;
    };
    section('POCKETS', 0, inv.pockets.length);
    if (inv.backpack.length) section('BACKPACK', inv.pockets.length, inv.backpack.length);
    else {
      this.label('list', 123, y + 31, 'NO BACKPACK', 38).setAlpha(0.6);
      y += 80;
    }
    this.listHeight = y - LIST[1];
  }

  private drawSlot(index: number, x: number, y: number): void {
    const tile = this.add.image(x, y, 'bag', 'bag_slot').setOrigin(0);
    this.list.add(tile);
    const s = this.inv.slotAt(index);
    if (s) this.drawStackInTile(this.list, s, x, y, SLOT_W, SLOT_H);
    if (this.sel?.kind === 'slot' && this.sel.index === index) this.list.add(this.ring(x, y, SLOT_W, SLOT_H));
    this.hit('list', x, y, SLOT_W, SLOT_H, () => this.select(s ? { kind: 'slot', index } : null));
  }

  /** Icon, wear bar and count badge, as image 05 draws them. */
  private drawStackInTile(c: Phaser.GameObjects.Container, s: Stack, x: number, y: number, w: number, h: number): void {
    this.icon(c, s.id, x + w / 2, y + h / 2 - 8, Math.min(w, h) - 34);
    const g = this.add.graphics();
    c.add(g);
    if (c !== this.list) this.dynamic.push(g);
    const max = item(s.id).durability;
    if (s.wear !== undefined && max) {
      const k = s.wear / max;
      g.fillStyle(0x1d1611, 1).fillRoundedRect(x + 10, y + h - 22, w - 52, 13, 5);
      g.fillStyle(k > 0.5 ? 0x7ab53c : k > 0.25 ? 0xe3a52a : 0xd0532f, 1).fillRoundedRect(x + 12, y + h - 20, (w - 56) * k, 9, 4);
    }
    if (c === this.list || s.count > 1) {
      g.fillStyle(0x2a2119, 0.95).fillRoundedRect(x + w - 40, y + h - 32, 34, 28, 7);
      const t = this.add.text(x + w - 23, y + h - 18, String(s.count), { fontFamily: 'Oswald, sans-serif', fontStyle: '700', fontSize: '24px', color: LIGHT }).setOrigin(0.5);
      c.add(t);
      if (c !== this.list) this.dynamic.push(t);
    }
  }

  private ring(x: number, y: number, w: number, h: number): Phaser.GameObjects.Graphics {
    return this.add.graphics().lineStyle(6, 0xf0d58c, 1).strokeRoundedRect(x - 2, y - 2, w + 4, h + 4, 14);
  }

  private drawRecipes(): void {
    let y = LIST[1] + 10;
    RECIPES.forEach((r, i) => {
      this.drawRecipe(r, i, 68, y, 600, 128);
      y += 140;
    });
    this.listHeight = y - LIST[1];
  }

  private drawRecipe(r: Recipe, i: number, x: number, y: number, w: number, h: number): void {
    const g = this.add.graphics();
    this.list.add(g);
    g.fillStyle(0x2a2119, 0.55).fillRoundedRect(x, y, w, h, 12);
    g.lineStyle(3, 0x1d1611, 0.9).strokeRoundedRect(x, y, w, h, 12);
    const tile = this.add.image(x + 12, y + 12, 'bag', 'bag_slot').setOrigin(0).setDisplaySize(104, 104);
    this.list.add(tile);
    this.icon(this.list, r.makes as ItemId, x + 64, y + 64, 80);
    this.label('list', x + 130, y + 32, item(r.makes as ItemId).name.toUpperCase(), 34);
    // Costs: icon (or name) and have/need, red when short.
    let cx = x + 130;
    for (const [id, need] of Object.entries(r.cost)) {
      const have = this.inv.count(id as ItemId);
      const ok = have >= (need as number);
      const ic = item(id as ItemId).icon;
      if (ic && this.textures.get(ic[0]).has(ic[1])) {
        const img = this.add.image(cx + 18, y + 88, ic[0], ic[1]);
        img.setScale(36 / Math.max(img.width, img.height));
        this.list.add(img);
        cx += 40;
      } else {
        const t = this.label('list', cx, y + 88, item(id as ItemId).name.toUpperCase(), 22, LIGHT, 0, 0.5);
        cx += t.width + 8;
      }
      const t = this.label('list', cx, y + 88, `${have}/${need}`, 26, ok ? LIGHT : RED, 0, 0.5);
      cx += t.width + 22;
    }
    const lock = r.blueprint ? 'NEEDS A BLUEPRINT' : r.station === 'workbench' ? 'NEEDS A WORKBENCH' : r.station === 'research' ? 'NEEDS A RESEARCH TABLE' : '';
    if (lock) this.label('list', x + w - 16, y + 32, lock, 20, '#C9B48A', 1, 0.5);
    else if (this.inv.canCraft(r)) this.label('list', x + w - 16, y + 32, 'READY', 22, GREEN, 1, 0.5);
    if (this.sel?.kind === 'recipe' && this.sel.index === i) this.list.add(this.ring(x, y, w, h));
    this.hit('list', x, y, w, h, () => this.select({ kind: 'recipe', index: i }));
  }

  private drawBottomBar(): void {
    const sel = this.sel;
    let name = '';
    let info = this.tab === 'inventory' ? 'Tap something to select it.' : 'Tap a recipe to select it.';
    let action = this.tab === 'inventory' ? 'USE' : 'CRAFT';
    let enabled = false;
    if (this.tab === 'craft') {
      const [x0, y0] = layout.barPlain;
      this.keep(this.add.image(x0, y0, 'bag', 'bag_bar_plain').setOrigin(0), 'left');
    }
    if (sel?.kind === 'slot' || sel?.kind === 'equip') {
      const s = sel.kind === 'slot' ? this.inv.slotAt(sel.index) : this.inv.equipped[sel.slot];
      if (s) {
        const d = item(s.id);
        name = d.name.toUpperCase();
        info = d.info;
        if (sel.kind === 'equip') {
          action = 'TAKE OFF';
          enabled = sel.slot !== 'backpack';
        } else if (d.slot) {
          action = 'EQUIP';
          enabled = true;
        } else if (d.use === 'cook') {
          action = 'COOK';
          enabled = true;
        }
      }
    } else if (sel?.kind === 'recipe') {
      const r = RECIPES[sel.index];
      name = item(r.makes as ItemId).name.toUpperCase();
      info = item(r.makes as ItemId).info;
      enabled = this.inv.canCraft(r);
    }
    const btn = this.keep(this.add.image(156, 852, 'bag', 'bag_button'), 'left');
    if (!enabled) btn.setTint(0x8c8c78);
    this.label('left', 156, 850, action, action.length > 5 ? 34 : 44, enabled ? LIGHT : '#C9C0A8', 0.5, 0.5);
    this.hit('left', 72, 808, 168, 89, () => this.act());

    const textX = this.tab === 'inventory' ? 352 : 262;
    const textW = (this.tab === 'inventory' ? 584 : 680) - textX;
    if (name) this.label('left', textX, 830, name, 28, LIGHT, 0, 0.5);
    const body = this.add
      .text(textX, name ? 850 : 852, info, { fontFamily: 'Nunito, sans-serif', fontStyle: '700', fontSize: '20px', color: '#D8C9A6', wordWrap: { width: textW } })
      .setOrigin(0, name ? 0 : 0.5);
    this.keep(body, 'left');

    if (this.tab === 'inventory') {
      const s = sel?.kind === 'slot' ? this.inv.slotAt(sel.index) : null;
      const n = s ? (this.all ? s.count : 1) : 0;
      this.label('left', 295, 852, s ? `${n}/${s.count}` : '-', 34, LIGHT, 0.5, 0.5);
      this.hit('left', 252, 812, 86, 80, () => {
        this.all = !this.all;
        this.binArmed = false;
        this.redraw();
      });
      const bin = this.keep(this.add.image(641, 852, 'bag', 'bag_bin'), 'left');
      if (this.binArmed) bin.setTint(0xff8a6a);
      this.hit('left', 592, 806, 100, 94, () => this.binTap());
    }
  }

  private drawHeader(): void {
    const inv = this.inv;
    this.label('right', 800, 80, String(inv.level), 52, LIGHT, 0.5, 0.5);
    const name = this.label('right', 846, 78, inv.name.toUpperCase(), 46, LIGHT, 0, 0.5);
    const pencil = this.keep(this.add.image(name.x + name.width + 30, 80, 'bag', 'pencil'), 'right');
    this.hit('right', name.x, 50, name.width + 60, 60, () => this.rename(name));
    // Experience toward the next level, and the day.
    const x0 = pencil.x + 34;
    const x1 = 1222;
    this.label('right', x1, 66, `DAY ${inv.day}`, 26, '#D8C9A6', 1, 0.5);
    const g = this.keep(this.add.graphics(), 'right');
    g.fillStyle(0x1d1611, 1).fillRoundedRect(x0, 88, x1 - x0, 12, 5);
    g.fillStyle(0xe3c25a, 1).fillRoundedRect(x0 + 2, 90, Math.max(0, (x1 - x0 - 4) * (inv.xp / inv.xpForNext())), 8, 4);
    this.label('right', 1327, 80, String(inv.coins), 46, LIGHT, 0.5, 0.5);
    this.hit('right', 1375, 58, 50, 50, () => this.showToast("The shop isn't open yet."));
  }

  private drawLoadout(): void {
    const inv = this.inv;
    for (const slot of EQUIP_SLOTS) {
      const [x0, y0, x1, y1] = layout.equip[slot];
      const s = inv.equipped[slot];
      if (s) {
        this.keep(this.add.image(x0, y0, 'bag', 'bag_equip').setOrigin(0).setDisplaySize(x1 - x0, y1 - y0), 'right');
        this.drawStackInTile(this.right, s, x0, y0, x1 - x0, y1 - y0);
      }
      if (this.sel?.kind === 'equip' && this.sel.slot === slot) this.keep(this.ring(x0, y0, x1 - x0, y1 - y0), 'right');
      this.hit('right', x0, y0, x1 - x0, y1 - y0, () => this.select(s ? { kind: 'equip', slot } : null));
    }
    // The castaway in the middle, holding his weapon or tool.
    this.keep(this.add.ellipse(1075, 580, 230, 44, 0x211912, 0.22), 'right');
    const man = this.keep(this.add.image(1075, 586, 'character', 'castaway_030').setOrigin(0.5, 1), 'right');
    man.setScale(390 / man.height);
    const held = inv.equipped.weapon ?? inv.equipped.tool;
    const ic = held && item(held.id).icon;
    if (ic && this.textures.get(ic[0]).has(ic[1])) {
      const img = this.keep(this.add.image(985, 470, ic[0], ic[1]), 'right');
      img.setScale(120 / Math.max(img.width, img.height)).setAngle(-15);
    }
    this.label('right', 1006, 710, String(inv.attack()), 46);
    this.label('right', 1164, 710, String(inv.defence()), 46);
  }

  private statusEffects(): { name: string; what: string }[] {
    const st = this.stats();
    const out: { name: string; what: string }[] = [];
    if (st.food > 70) out.push({ name: 'Well fed', what: 'Slow health regen.' });
    if (st.energy < 15) out.push({ name: 'Exhausted', what: 'Slower movement and work.' });
    return out;
  }

  private drawStatus(): void {
    const [x0, y0] = layout.statusBg;
    this.keep(this.add.image(x0, y0, 'bag', 'bag_status_bg').setOrigin(0), 'right');
    const fx = this.statusEffects();
    this.label('right', 790, 170, 'STATUS', 44);
    if (!fx.length) this.label('right', 790, 240, 'Nothing affecting you right now.', 28, '#D8C9A6', 0, 0.5, 'Nunito');
    fx.forEach((e, i) => {
      const y = 240 + i * 92;
      this.label('right', 790, y, e.name.toUpperCase(), 34);
      this.label('right', 790, y + 38, e.what, 26, '#D8C9A6', 0, 0.5, 'Nunito');
    });
  }

  private drawSideTabs(): void {
    const n = this.statusEffects().length;
    this.label('right', 1465, 545, `STATUS (${n})`, 40, LIGHT, 0.5, 0.5).setAngle(-90).setAlpha(this.page === 'status' ? 1 : 0.85);
    if (this.page === 'status') {
      const g = this.keep(this.add.graphics(), 'right');
      g.fillStyle(0x1e160f, 0.35).fillRoundedRect(1424, 190, 72, 218, 10);
    }
    this.hit('right', 1420, 184, 84, 230, () => this.setPage('loadout'));
    this.hit('right', 1426, 436, 80, 222, () => this.setPage('status'));
  }

  private stats(): Record<'health' | 'energy' | 'water' | 'food', number> {
    const s = this.registry.get('stats') as Record<string, number> | undefined;
    const t = tuning.stats;
    return { health: s?.health ?? t.health, energy: s?.energy ?? t.energy, water: s?.water ?? t.water, food: s?.food ?? t.food };
  }

  private drawMeters(): void {
    const st = this.stats();
    const g = this.keep(this.add.graphics(), 'right');
    for (const m of METERS) {
      const max = tuning.stats[m.key];
      const v = st[m.key];
      g.fillStyle(m.colour, 1).fillRoundedRect(m.x + 4, 852, (131 - 8) * Math.max(0, v / max), 11, 4);
      g.fillStyle(0xffffff, 0.2).fillRoundedRect(m.x + 6, 853, Math.max(0, (131 - 12) * (v / max)), 3, 2);
      this.label('right', m.x + 88, 813, `${Math.round(v)}/${max}`, 28, LIGHT, 0.5, 0.5);
    }
  }

  // ---------------------------------------------------------------- actions

  private setTab(t: Tab): void {
    if (t === this.tab) return;
    this.tab = t;
    this.sel = null;
    this.scroll = 0;
    this.binArmed = false;
    this.redraw();
  }

  private setPage(p: Page): void {
    this.page = p;
    if (p === 'status' && this.sel?.kind === 'equip') this.sel = null;
    this.redraw();
  }

  private select(s: Selection): void {
    this.sel = s;
    this.all = false;
    this.binArmed = false;
    this.redraw();
  }

  private act(): void {
    const sel = this.sel;
    if (!sel) return;
    let msg = '';
    if (sel.kind === 'recipe') {
      msg = this.inv.craft(RECIPES[sel.index]);
    } else if (sel.kind === 'equip') {
      msg = this.inv.unequip(sel.slot);
      this.sel = null;
    } else {
      const s = this.inv.slotAt(sel.index);
      if (!s) return;
      const d = item(s.id);
      if (d.slot) {
        msg = this.inv.equip(sel.index);
        this.sel = null;
      } else if (d.use === 'cook') msg = 'Cook it on a lit fire first.';
    }
    if (msg) this.showToast(msg);
    this.redraw();
  }

  private binTap(): void {
    if (this.sel?.kind !== 'slot') return;
    const s = this.inv.slotAt(this.sel.index);
    if (!s) return;
    if (!this.binArmed) {
      this.binArmed = true;
      this.showToast('Tap the bin again to throw it away.');
      this.redraw();
      return;
    }
    const n = this.all ? s.count : 1;
    this.inv.discard(this.sel.index, n);
    this.showToast(`Threw away ${n} ${item(s.id).name.toLowerCase()}.`);
    this.binArmed = false;
    if (!this.inv.slotAt(this.sel.index)) this.sel = null;
    this.redraw();
  }

  private rename(nameText: Phaser.GameObjects.Text): void {
    if (this.nameInput) return;
    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const m = nameText.getWorldTransformMatrix();
    const k = rect.width / this.scale.width;
    const input = document.createElement('input');
    input.value = this.inv.name;
    input.maxLength = 14;
    input.setAttribute('aria-label', 'Your name');
    const h = 54 * this.stage.scale * k;
    Object.assign(input.style, {
      position: 'fixed',
      left: `${rect.left + m.tx * k}px`,
      top: `${rect.top + m.ty * k - h / 2}px`,
      width: `${300 * this.stage.scale * k}px`,
      height: `${h}px`,
      font: `700 ${Math.round(h * 0.75)}px Oswald, sans-serif`,
      textTransform: 'uppercase',
      color: LIGHT,
      background: '#2a2119',
      border: '2px solid #f0d58c',
      borderRadius: '6px',
      padding: '0 6px',
      zIndex: '10',
    });
    document.body.appendChild(input);
    this.nameInput = input;
    input.focus();
    input.select();
    const done = (): void => {
      const v = input.value.trim();
      if (v) this.inv.name = v;
      input.remove();
      this.nameInput = undefined;
      this.redraw();
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());
    input.addEventListener('blur', done, { once: true });
  }

  private showToast(text: string): void {
    this.toast?.destroy();
    const { width, height } = this.scale;
    const k = Math.min(width / 360, height / 640);
    const t = this.add.text(0, 0, text, { fontFamily: 'Nunito, sans-serif', fontStyle: '700', fontSize: `${13 * k}px`, color: '#F3E8CF' }).setOrigin(0.5);
    const w = t.width + 28 * k;
    const h = t.height + 14 * k;
    const pill = this.add.graphics().fillStyle(0x211912, 0.9).fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    const box = this.add.container(width / 2, height / 2, [pill, t]);
    this.toast = box;
    this.tweens.add({ targets: box, alpha: 0, delay: 1600, duration: 400, onComplete: () => box.destroy() });
  }

  private closeBag(): void {
    this.nameInput?.blur();
    this.game.events.emit('bag-closed');
  }

  // ---------------------------------------------------------------- input

  private toLocal(p: Phaser.Input.Pointer, panel: Hit['panel']): { x: number; y: number } {
    const s = this.stage.scale;
    let x = (p.x - this.stage.x) / s;
    let y = (p.y - this.stage.y) / s;
    if (panel === 'right') {
      x -= this.right.x;
      y -= this.right.y;
    }
    if (panel === 'list') y += this.scroll;
    return { x, y };
  }

  private inList(p: Phaser.Input.Pointer): boolean {
    const { x, y } = this.toLocal(p, 'left');
    return x >= LIST[0] && x <= LIST[2] && y >= LIST[1] && y <= LIST[3];
  }

  private onDown(p: Phaser.Input.Pointer): void {
    this.drag = this.inList(p) ? { y: p.y, scroll: this.scroll, moved: false } : undefined;
  }

  private onMove(p: Phaser.Input.Pointer): void {
    if (!this.drag || !p.isDown) return;
    const dy = (p.y - this.drag.y) / this.stage.scale;
    if (Math.abs(dy) > 10) this.drag.moved = true;
    if (this.drag.moved) {
      this.scroll = this.drag.scroll - dy;
      this.applyScroll();
    }
  }

  private onUp(p: Phaser.Input.Pointer): void {
    if (this.drag?.moved) {
      this.drag = undefined;
      return;
    }
    this.drag = undefined;
    const inList = this.inList(p);
    for (const h of this.hits) {
      if (h.panel === 'list' && !inList) continue;
      const { x, y } = this.toLocal(p, h.panel);
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
        h.onTap();
        return;
      }
    }
  }

  private scrollBy(dy: number): void {
    this.scroll += dy / this.stage.scale;
    this.applyScroll();
  }

  private applyScroll(): void {
    const view = LIST[3] - LIST[1];
    const max = Math.max(0, this.listHeight - view + 10);
    this.scroll = Phaser.Math.Clamp(this.scroll, 0, max);
    this.list.setY(-this.scroll);
    // The thumb on the painted scroll track.
    let thumb = this.left.getByName('thumb') as Phaser.GameObjects.Graphics | null;
    if (!thumb) {
      thumb = this.add.graphics().setName('thumb');
      this.left.add(thumb);
    }
    thumb.clear();
    if (max > 0) {
      const top = 152;
      const len = 596;
      const h = Math.max(60, (len * view) / this.listHeight);
      const y = top + ((len - h) * this.scroll) / max;
      thumb.fillStyle(0xb39a6e, 0.9).fillRoundedRect(684, y, 9, h, 4);
    }
  }
}
