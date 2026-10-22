import itemData from '../data/items.json';
import recipeData from '../data/recipes.json';
import tuning from '../data/tuning.json';

export type ItemId = keyof typeof itemData.items;
export type EquipSlot = 'weapon' | 'tool' | 'backpack' | 'accessory' | 'cap' | 'hoodie' | 'pants' | 'boots';
export type Recipe = (typeof recipeData.recipes)[number];

export interface ItemDef {
  name: string;
  icon?: string[];
  stack: number;
  slot?: string;
  use?: string;
  info: string;
  attack?: number;
  defence?: number;
  durability?: number;
  capacity?: number;
}

export interface Stack {
  id: ItemId;
  count: number;
  /** Uses left, for tools and clothing. */
  wear?: number;
}

export const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'tool', 'backpack', 'accessory', 'cap', 'hoodie', 'pants', 'boots'];

export function item(id: ItemId): ItemDef {
  return itemData.items[id] as ItemDef;
}

/**
 * What he carries: pockets, a backpack whose size depends on the bag he
 * wears, and the gear he has on. Each slot holds a stack of one item.
 */
export class Inventory {
  pockets: (Stack | null)[];
  backpack: (Stack | null)[];
  equipped: Record<EquipSlot, Stack | null>;
  name: string = tuning.stats.playerName;
  level = 1;
  xp = 0;
  day = 1;
  coins: number = tuning.stats.startingCoins;

  constructor() {
    this.pockets = Array(itemData.pockets).fill(null);
    this.equipped = Object.fromEntries(EQUIP_SLOTS.map((s) => [s, null])) as Record<EquipSlot, Stack | null>;
    for (const [slot, id] of Object.entries(itemData.startEquipped)) this.equipped[slot as EquipSlot] = this.fresh(id as ItemId, 1);
    this.backpack = Array(this.backpackSize()).fill(null);
  }

  private fresh(id: ItemId, count: number): Stack {
    const d = item(id).durability;
    return d ? { id, count, wear: d } : { id, count };
  }

  backpackSize(): number {
    const b = this.equipped.backpack;
    return b ? (item(b.id).capacity ?? 0) : 0;
  }

  /** Pockets then backpack, as one list of slots. */
  get slots(): (Stack | null)[] {
    return [...this.pockets, ...this.backpack];
  }

  slotAt(i: number): Stack | null {
    return i < this.pockets.length ? this.pockets[i] : this.backpack[i - this.pockets.length];
  }

  private setSlot(i: number, s: Stack | null): void {
    if (i < this.pockets.length) this.pockets[i] = s;
    else this.backpack[i - this.pockets.length] = s;
  }

  count(id: ItemId): number {
    return this.slots.reduce((n, s) => n + (s?.id === id ? s.count : 0), 0);
  }

  /** How many of id would fit right now. */
  room(id: ItemId): number {
    const max = item(id).stack;
    return this.slots.reduce((n, s) => n + (s === null ? max : s.id === id && s.wear === undefined ? max - s.count : 0), 0);
  }

  /** Adds up to n; returns how many didn't fit. */
  add(id: ItemId, n: number): number {
    const max = item(id).stack;
    const all = this.slots;
    for (let i = 0; i < all.length && n > 0; i++) {
      const s = all[i];
      if (s && s.id === id && s.wear === undefined && s.count < max) {
        const k = Math.min(n, max - s.count);
        s.count += k;
        n -= k;
      }
    }
    for (let i = 0; i < all.length && n > 0; i++) {
      if (all[i] === null) {
        const k = Math.min(n, max);
        this.setSlot(i, this.fresh(id, k));
        n -= k;
      }
    }
    return n;
  }

  /** Removes up to n of id across stacks; returns how many were removed. */
  remove(id: ItemId, n: number): number {
    let took = 0;
    const all = this.slots;
    for (let i = all.length - 1; i >= 0 && took < n; i--) {
      const s = all[i];
      if (s?.id !== id) continue;
      const k = Math.min(n - took, s.count);
      s.count -= k;
      took += k;
      if (s.count <= 0) this.setSlot(i, null);
    }
    return took;
  }

  /** Drop n from one slot. */
  discard(i: number, n: number): void {
    const s = this.slotAt(i);
    if (!s) return;
    s.count -= Math.min(n, s.count);
    if (s.count <= 0) this.setSlot(i, null);
  }

  /** Put on or pick up the item in slot i. Returns a message for the player. */
  equip(i: number): string {
    const s = this.slotAt(i);
    if (!s) return '';
    const slot = item(s.id).slot as EquipSlot | undefined;
    if (!slot) return '';
    const worn = this.equipped[slot];
    if (slot === 'backpack') {
      // Swapping bags only works if everything still fits.
      const newSize = item(s.id).capacity ?? 0;
      if (this.backpack.filter(Boolean).length > newSize) return 'Empty your backpack first.';
    }
    this.equipped[slot] = { ...s, count: 1 };
    this.setSlot(i, worn);
    if (slot === 'backpack') this.resizeBackpack();
    return `${item(s.id).name} on.`;
  }

  /** Take worn gear off into the bag. */
  unequip(slot: EquipSlot): string {
    const worn = this.equipped[slot];
    if (!worn) return '';
    if (slot === 'backpack') return 'You need a bag to carry things.';
    const free = this.slots.findIndex((s) => s === null);
    if (free < 0) return 'Your bag is full.';
    this.setSlot(free, worn);
    this.equipped[slot] = null;
    return `${item(worn.id).name} off.`;
  }

  private resizeBackpack(): void {
    const size = this.backpackSize();
    const kept = this.backpack.filter(Boolean) as Stack[];
    this.backpack = Array(size).fill(null);
    kept.slice(0, size).forEach((s, k) => (this.backpack[k] = s));
  }

  canCraft(r: Recipe): boolean {
    if (r.blueprint || r.station !== 'hand') return false;
    return Object.entries(r.cost).every(([id, n]) => this.count(id as ItemId) >= (n as number));
  }

  craft(r: Recipe): string {
    if (r.blueprint) return 'You need a blueprint first.';
    if (r.station === 'workbench') return 'Needs a workbench.';
    if (r.station === 'research') return 'Needs a research table.';
    const missing = Object.entries(r.cost).filter(([id, n]) => this.count(id as ItemId) < (n as number));
    if (missing.length) return `Not enough ${missing.map(([id]) => item(id as ItemId).name.toLowerCase()).join(' or ')}.`;
    for (const [id, n] of Object.entries(r.cost)) this.remove(id as ItemId, n as number);
    if (this.add(r.makes as ItemId, 1) > 0) {
      for (const [id, n] of Object.entries(r.cost)) this.add(id as ItemId, n as number);
      return 'Your bag is full.';
    }
    this.gainXp(tuning.levels.craftXp);
    return `Made ${item(r.makes as ItemId).name.toLowerCase()}.`;
  }

  xpForNext(): number {
    return Math.round(tuning.levels.firstLevelXp * tuning.levels.growth ** (this.level - 1));
  }

  /** Returns true when he levels up. */
  gainXp(n: number): boolean {
    this.xp += n;
    let up = false;
    while (this.xp >= this.xpForNext()) {
      this.xp -= this.xpForNext();
      this.level++;
      up = true;
    }
    return up;
  }

  /** Fists, or the weapon he holds, plus one per level after the first. */
  attack(): number {
    const w = this.equipped.weapon ?? this.equipped.tool;
    const base = w ? (item(w.id).attack ?? itemData.fistAttack) : itemData.fistAttack;
    return base + (this.level - 1);
  }

  defence(): number {
    return EQUIP_SLOTS.reduce((d, s) => d + (this.equipped[s] ? (item(this.equipped[s]!.id).defence ?? 0) : 0), 0);
  }
}

/** The one inventory, kept in the game registry so every scene shares it. */
export function getInventory(registry: Phaser.Data.DataManager): Inventory {
  let inv = registry.get('inventory') as Inventory | undefined;
  if (!inv) {
    inv = new Inventory();
    registry.set('inventory', inv);
  }
  return inv;
}

export const RECIPES = recipeData.recipes;
