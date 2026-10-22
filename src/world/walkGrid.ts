import type { Vec } from './islandGen';

/**
 * Coarse grid of where the castaway's feet may go, with A* for tap-to-walk.
 * Obstacles are blocked already grown by the castaway's radius, so movement
 * only has to test the single foot point.
 */
export class WalkGrid {
  readonly w: number;
  readonly h: number;
  private cells: Uint8Array;

  constructor(
    size: number,
    readonly cell: number,
  ) {
    this.w = Math.ceil(size / cell);
    this.h = this.w;
    this.cells = new Uint8Array(this.w * this.h);
  }

  fill(walkable: (x: number, y: number) => boolean): void {
    for (let j = 0; j < this.h; j++)
      for (let i = 0; i < this.w; i++) this.cells[j * this.w + i] = walkable((i + 0.5) * this.cell, (j + 0.5) * this.cell) ? 1 : 0;
  }

  allowPolygon(poly: Vec[]): void {
    this.forCellsIn(poly, (k) => (this.cells[k] = 1));
  }

  private forCellsIn(poly: Vec[], fn: (k: number) => void): void {
    const xs = poly.map((p) => p.x);
    const ys = poly.map((p) => p.y);
    const i0 = Math.max(0, Math.floor(Math.min(...xs) / this.cell));
    const i1 = Math.min(this.w - 1, Math.floor(Math.max(...xs) / this.cell));
    const j0 = Math.max(0, Math.floor(Math.min(...ys) / this.cell));
    const j1 = Math.min(this.h - 1, Math.floor(Math.max(...ys) / this.cell));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++)
        if (pointInPolygon({ x: (i + 0.5) * this.cell, y: (j + 0.5) * this.cell }, poly)) fn(j * this.w + i);
  }

  blockEllipse(cx: number, cy: number, rx: number, ry: number, pad = 0): void {
    rx += pad;
    ry += pad;
    const i0 = Math.max(0, Math.floor((cx - rx) / this.cell));
    const i1 = Math.min(this.w - 1, Math.floor((cx + rx) / this.cell));
    const j0 = Math.max(0, Math.floor((cy - ry) / this.cell));
    const j1 = Math.min(this.h - 1, Math.floor((cy + ry) / this.cell));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = ((i + 0.5) * this.cell - cx) / rx;
        const y = ((j + 0.5) * this.cell - cy) / ry;
        if (x * x + y * y <= 1) this.cells[j * this.w + i] = 0;
      }
  }

  walkable(x: number, y: number): boolean {
    const i = Math.floor(x / this.cell);
    const j = Math.floor(y / this.cell);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return false;
    return this.cells[j * this.w + i] === 1;
  }

  /** True if a straight walk from a to b stays on walkable cells. */
  clearLine(a: Vec, b: Vec): boolean {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.ceil(dist / (this.cell * 0.4));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      if (!this.walkable(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
    }
    return true;
  }

  /** Nearest walkable point to p, searching outward ring by ring. */
  nearestWalkable(p: Vec, maxRings = 40): Vec | null {
    const ci = Math.floor(p.x / this.cell);
    const cj = Math.floor(p.y / this.cell);
    for (let r = 0; r <= maxRings; r++) {
      let best: Vec | null = null;
      let bestD = Infinity;
      for (let j = cj - r; j <= cj + r; j++)
        for (let i = ci - r; i <= ci + r; i++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
          if (i < 0 || j < 0 || i >= this.w || j >= this.h || !this.cells[j * this.w + i]) continue;
          const q = { x: (i + 0.5) * this.cell, y: (j + 0.5) * this.cell };
          const d = Math.hypot(q.x - p.x, q.y - p.y);
          if (d < bestD) {
            bestD = d;
            best = q;
          }
        }
      if (best) return r === 0 ? p : best;
    }
    return null;
  }

  /** A* over the grid, then straightened so he walks in direct lines. */
  findPath(from: Vec, to: Vec): Vec[] | null {
    const goal = this.walkable(to.x, to.y) ? to : this.nearestWalkable(to);
    if (!goal) return null;
    if (this.clearLine(from, goal)) return [goal];
    const w = this.w;
    const si = Math.floor(from.x / this.cell) + Math.floor(from.y / this.cell) * w;
    const gi = Math.floor(goal.x / this.cell) + Math.floor(goal.y / this.cell) * w;
    const g = new Float32Array(this.w * this.h).fill(Infinity);
    const came = new Int32Array(this.w * this.h).fill(-1);
    const closed = new Uint8Array(this.w * this.h);
    const heap = new MinHeap();
    const gx = gi % w;
    const gy = Math.floor(gi / w);
    const hCost = (k: number): number => {
      const dx = Math.abs((k % w) - gx);
      const dy = Math.abs(Math.floor(k / w) - gy);
      return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy);
    };
    g[si] = 0;
    heap.push(si, hCost(si));
    const dirs = [
      [1, 0, 1],
      [-1, 0, 1],
      [0, 1, 1],
      [0, -1, 1],
      [1, 1, Math.SQRT2],
      [1, -1, Math.SQRT2],
      [-1, 1, Math.SQRT2],
      [-1, -1, Math.SQRT2],
    ];
    let found = false;
    let expanded = 0;
    while (heap.size > 0 && expanded < 60000) {
      const k = heap.pop();
      if (closed[k]) continue;
      closed[k] = 1;
      expanded++;
      if (k === gi) {
        found = true;
        break;
      }
      const x = k % w;
      const y = Math.floor(k / w);
      for (const [dx, dy, cost] of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= this.h) continue;
        const n = ny * w + nx;
        if (!this.cells[n] || closed[n]) continue;
        // No cutting corners past a blocked cell.
        if (dx && dy && (!this.cells[y * w + nx] || !this.cells[ny * w + x])) continue;
        const ng = g[k] + cost;
        if (ng < g[n]) {
          g[n] = ng;
          came[n] = k;
          heap.push(n, ng + hCost(n));
        }
      }
    }
    if (!found) return null;
    const cells: Vec[] = [];
    for (let k = gi; k !== si && k !== -1; k = came[k]) cells.push({ x: ((k % w) + 0.5) * this.cell, y: (Math.floor(k / w) + 0.5) * this.cell });
    cells.reverse();
    cells[cells.length - 1] = goal;
    // String-pull: skip every waypoint that has a clear line past it.
    const out: Vec[] = [];
    let anchor = from;
    let i = 0;
    while (i < cells.length) {
      let j = cells.length - 1;
      while (j > i && !this.clearLine(anchor, cells[j])) j--;
      out.push(cells[j]);
      anchor = cells[j];
      i = j + 1;
    }
    return out;
  }
}

class MinHeap {
  private keys: number[] = [];
  private pri: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, priority: number): void {
    const keys = this.keys;
    const pri = this.pri;
    let i = keys.length;
    keys.push(key);
    pri.push(priority);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (pri[p] <= priority) break;
      keys[i] = keys[p];
      pri[i] = pri[p];
      i = p;
    }
    keys[i] = key;
    pri[i] = priority;
  }

  pop(): number {
    const keys = this.keys;
    const pri = this.pri;
    const top = keys[0];
    const lastK = keys.pop()!;
    const lastP = pri.pop()!;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && pri[r] < pri[l] ? r : l;
        if (pri[c] >= lastP) break;
        keys[i] = keys[c];
        pri[i] = pri[c];
        i = c;
      }
      keys[i] = lastK;
      pri[i] = lastP;
    }
    return top;
  }
}

export function pointInPolygon(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
