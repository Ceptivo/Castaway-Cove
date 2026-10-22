import tuning from '../data/tuning.json';
import campData from '../data/camp.json';
import rects from '../data/generated/image06-rects.json';
import rockArt from '../data/generated/rocks.json';
import { Noise2D } from '../core/noise';
import { Rng } from '../core/rng';
import { WalkGrid } from './walkGrid';

export interface Vec {
  x: number;
  y: number;
}

/** Ellipse at an object's foot that the castaway can't walk through. */
export interface Collider {
  rx: number;
  ry: number;
  oy: number;
}

export type ObjectKind = 'palm' | 'rock' | 'fern' | 'prop';

export interface PlacedObject {
  kind: ObjectKind;
  frame: string;
  x: number;
  y: number;
  scale: number;
  flip: boolean;
  /** Palms only: plays the idle sway loop instead of a still angle. */
  sway?: boolean;
  /** 'ground' objects (dock, raft) draw under everything that stands up. */
  layer?: 'ground';
  collider?: Collider;
}

export interface Decal {
  frame: string;
  x: number;
  y: number;
  scale: number;
  flip: boolean;
}

/** Scalar fields sampled on a grid; the terrain painter turns them into ground. */
export interface Fields {
  cell: number;
  w: number;
  h: number;
  /** Positive inland, 0 at the waterline, negative out to sea (world units). */
  coast: Float32Array;
  /** Positive where grass grows. */
  grass: Float32Array;
  /** Positive inside the camp's packed-dirt clearing and its path. */
  campDirt: Float32Array;
}

export interface IslandData {
  seed: number;
  size: number;
  center: Vec;
  fields: Fields;
  fire: Vec;
  playerStart: Vec;
  objects: PlacedObject[];
  decals: Decal[];
  walk: WalkGrid;
}

const I = tuning.island;
const C = tuning.camp;
const R = tuning.resources;

type RectName = keyof typeof rects;

function footOf(name: RectName): Vec {
  const [x0, , x1, y1] = rects[name];
  return { x: (x0 + x1) / 2, y: y1 };
}

/** Where a prop from image 06 goes, given where the fire is in the world. */
function fromImage06(fire: Vec, p: Vec): Vec {
  const f = footOf('campfire');
  return { x: fire.x + p.x - f.x, y: fire.y + p.y - f.y };
}

function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(p.x - a.x - abx * t, p.y - a.y - aby * t);
}

export function generateIsland(seed: number): IslandData {
  const rng = new Rng(seed);
  const shapeNoise = new Noise2D(rng);
  const detailNoise = new Noise2D(rng);
  const grassNoise = new Noise2D(rng);
  const size = tuning.world.size;
  const center = { x: size / 2, y: size / 2 };

  // Irregular round outline: a few low harmonics plus noise around the rim.
  const harmonics = I.shapeHarmonics.map((amp, i) => ({ k: i + 2, amp: amp * rng.range(0.5, 1), phase: rng.range(0, Math.PI * 2) }));
  const radiusAt = (theta: number): number => {
    let r = 1;
    for (const h of harmonics) r += h.amp * Math.cos(h.k * theta + h.phase);
    r += I.shapeNoise * shapeNoise.fbm(Math.cos(theta) * 1.3 + 7, Math.sin(theta) * 1.3 + 7, 3);
    return I.radius * r;
  };
  const beachWidthAt = (theta: number): number => {
    const n = (shapeNoise.fbm(Math.cos(theta) * 2 + 31, Math.sin(theta) * 2 + 31, 2) + 1) / 2;
    return I.beachWidthMin + (I.beachWidthMax - I.beachWidthMin) * n;
  };

  // Camp on the west coast, the fire at a fixed distance in from the shore.
  const fire = {
    x: center.x - radiusAt(Math.PI) + C.fireCoastDistance,
    y: center.y + C.fireNorthOffset,
  };
  const raftRect = rects.raft;
  const cove = fromImage06(fire, { x: (raftRect[0] + raftRect[2]) / 2, y: (raftRect[1] + raftRect[3]) / 2 });
  const pathEnd = fromImage06(fire, { x: campData.pathTo[0], y: campData.pathTo[1] });

  // Sandy clearings scattered inland so the grass never reads as one sheet.
  const clearings: { x: number; y: number; r: number }[] = [];
  for (let tries = 0; clearings.length < I.clearings && tries < 400; tries++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(0, 1) ** 0.6 * radiusAt(a);
    const p = { x: center.x + Math.cos(a) * d, y: center.y + Math.sin(a) * d };
    if (radiusAt(a) - d < I.clearingMinCoastDistance) continue;
    if (Math.hypot(p.x - fire.x, p.y - fire.y) < C.keepClearRadius + 150) continue;
    if (clearings.some((c) => Math.hypot(c.x - p.x, c.y - p.y) < 380)) continue;
    clearings.push({ ...p, r: rng.range(I.clearingRadiusMin, I.clearingRadiusMax) });
  }

  const coastAt = (x: number, y: number): number => {
    const dx = x - center.x;
    const dy = y - center.y;
    const theta = Math.atan2(dy, dx);
    let d = radiusAt(theta) - Math.hypot(dx, dy);
    d += I.coastNoise * detailNoise.fbm(x / 260, y / 260, 3);
    // The dock's little bay: open water around the moored raft.
    const bay = Math.hypot(x - cove.x, y - cove.y) - C.coveRadius + 18 * detailNoise.noise(x / 90, y / 90);
    return Math.min(d, bay);
  };

  const campDirtAt = (x: number, y: number): number => {
    const ex = (x - fire.x) / C.clearingRadiusX;
    const ey = (y - fire.y - 30) / C.clearingRadiusY;
    let s = (1 - Math.hypot(ex, ey)) * Math.min(C.clearingRadiusX, C.clearingRadiusY);
    s += C.clearingNoise * grassNoise.fbm(x / 140 + 50, y / 140 + 50, 3);
    const path = C.pathWidth / 2 - distToSegment({ x, y }, fire, pathEnd) + 14 * grassNoise.noise(x / 60, y / 60);
    return Math.max(s, path);
  };

  const grassAt = (x: number, y: number, coast: number, camp: number): number => {
    const theta = Math.atan2(y - center.y, x - center.x);
    let g = coast - beachWidthAt(theta) + I.grassEdgeNoise * grassNoise.fbm(x / 110, y / 110, 4);
    for (const c of clearings) {
      const inside = c.r + 30 * grassNoise.noise(x / 70 + c.x, y / 70) - Math.hypot(x - c.x, y - c.y);
      g = Math.min(g, -inside);
    }
    return Math.min(g, -camp);
  };

  // Sample the fields.
  const w = tuning.world.fieldResolution;
  const cell = size / w;
  const h = w;
  const coast = new Float32Array(w * h);
  const grass = new Float32Array(w * h);
  const campDirt = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    const y = (j + 0.5) * cell;
    for (let i = 0; i < w; i++) {
      const x = (i + 0.5) * cell;
      const k = j * w + i;
      const d = coastAt(x, y);
      coast[k] = d;
      if (d < -I.shallowWidth) {
        grass[k] = -999;
        campDirt[k] = -999;
        continue;
      }
      const cd = d > 0 ? campDirtAt(x, y) : -999;
      campDirt[k] = cd;
      grass[k] = d > 0 ? grassAt(x, y, d, cd) : -999;
    }
  }
  const fields: Fields = { cell, w, h, coast, grass, campDirt };
  const sample = (f: Float32Array, x: number, y: number): number => {
    const i = Math.min(w - 1, Math.max(0, Math.floor(x / cell)));
    const j = Math.min(h - 1, Math.max(0, Math.floor(y / cell)));
    return f[j * w + i];
  };

  // Camp props, laid out exactly as image 06 shows them around the fire.
  const objects: PlacedObject[] = [];
  for (const p of campData.props) {
    const pos = fromImage06(fire, footOf(p.frame as RectName));
    objects.push({
      kind: 'prop',
      frame: p.frame,
      x: pos.x,
      y: pos.y,
      scale: 1,
      flip: false,
      layer: p.layer === 'ground' ? 'ground' : undefined,
      collider: p.collider,
    });
  }
  const dockDeck = campData.dockDeck.map(([x, y]) => fromImage06(fire, { x, y }));

  // Resource nodes. Nothing grows in camp, by the dock, or on another node.
  const placed: { x: number; y: number; r: number }[] = [];
  const keepClear = (x: number, y: number): boolean =>
    Math.hypot(x - fire.x, y - fire.y) < C.keepClearRadius ||
    Math.hypot(x - cove.x, y - cove.y) < C.coveRadius + 160 ||
    distToSegment({ x, y }, fire, pathEnd) < 120;
  const scatter = (
    count: number,
    spacing: number,
    ok: (x: number, y: number) => boolean,
    make: (x: number, y: number) => PlacedObject,
  ): void => {
    let made = 0;
    for (let tries = 0; made < count && tries < count * 200; tries++) {
      const x = rng.range(center.x - I.radius * 1.3, center.x + I.radius * 1.3);
      const y = rng.range(center.y - I.radius * 1.3, center.y + I.radius * 1.3);
      if (keepClear(x, y) || !ok(x, y)) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < Math.max(p.r, spacing))) continue;
      const o = make(x, y);
      objects.push(o);
      placed.push({ x, y, r: spacing });
      made++;
    }
  };

  const palmAngles = ['palm_000', 'palm_045', 'palm_090', 'palm_135', 'palm_180', 'palm_225', 'palm_270', 'palm_315'];
  const makePalm = (x: number, y: number): PlacedObject => {
    const sway = rng.chance(0.5);
    return {
      kind: 'palm',
      frame: sway ? 'palm_sway_0' : rng.pick(palmAngles),
      sway,
      x,
      y,
      scale: rng.range(0.9, 1.08),
      flip: rng.chance(0.5),
      collider: { rx: 24, ry: 12, oy: -6 },
    };
  };
  const wet = I.wetSandWidth;
  scatter(R.palmCoastal, R.palmSpacing, (x, y) => {
    const d = sample(coast, x, y);
    const g = sample(grass, x, y);
    return d > wet + 30 && g < 60;
  }, makePalm);
  scatter(R.palmInland, R.palmSpacing, (x, y) => sample(grass, x, y) > 80, makePalm);

  // Rocks from image 10, in the brief's count, mixed by size.
  const rockMix = Object.entries(R.rockMix) as [keyof typeof rockArt, number][];
  const pickRock = (): { frame: string; w: number; h: number } => {
    let r = rng.next() * rockMix.reduce((t, [, w]) => t + w, 0);
    for (const [group, w] of rockMix) {
      if ((r -= w) <= 0) return rng.pick(rockArt[group]);
    }
    return rng.pick(rockArt.rock_small);
  };
  for (let made = 0, tries = 0; made < R.rocks && tries < R.rocks * 200; tries++) {
    const rock = pickRock();
    const s = rng.range(0.9, 1.1);
    const spacing = Math.max(R.rockSpacing, rock.w * s * 0.75);
    const x = rng.range(center.x - I.radius * 1.3, center.x + I.radius * 1.3);
    const y = rng.range(center.y - I.radius * 1.3, center.y + I.radius * 1.3);
    if (keepClear(x, y) || sample(coast, x, y) < 120 + rock.w * 0.3) continue;
    if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < Math.max(p.r, spacing))) continue;
    objects.push({
      kind: 'rock',
      frame: rock.frame,
      x,
      y,
      scale: s,
      flip: rng.chance(0.5),
      collider: { rx: rock.w * 0.4 * s, ry: rock.h * 0.17 * s, oy: -rock.h * 0.16 * s },
    });
    placed.push({ x, y, r: spacing });
    made++;
  }

  scatter(R.berryFerns, R.fernSpacing, (x, y) => sample(grass, x, y) > 30, (x, y) => ({
    kind: 'fern',
    frame: 'fern',
    x,
    y,
    scale: rng.range(0.85, 1.15),
    flip: rng.chance(0.5),
    collider: { rx: 26, ry: 12, oy: -8 },
  }));

  // Flat details on the sand and dirt.
  const decals: Decal[] = [];
  const pebbleFrames = rockArt.pebble.map((p) => p.frame);
  for (let tries = 0; decals.length < R.pebbles && tries < R.pebbles * 50; tries++) {
    const x = rng.range(center.x - I.radius * 1.3, center.x + I.radius * 1.3);
    const y = rng.range(center.y - I.radius * 1.3, center.y + I.radius * 1.3);
    if (sample(coast, x, y) < wet + 10) continue;
    if (objects.some((o) => o.collider && Math.abs(o.x - x) < o.collider.rx + 30 && Math.abs(o.y + o.collider.oy - y) < o.collider.ry + 30)) continue;
    decals.push({ frame: rng.pick(pebbleFrames), x, y, scale: rng.range(R.pebbleScaleMin, R.pebbleScaleMax), flip: rng.chance(0.5) });
  }
  let starfish = 0;
  for (let tries = 0; starfish < R.starfish && tries < 5000; tries++) {
    const x = rng.range(center.x - I.radius * 1.3, center.x + I.radius * 1.3);
    const y = rng.range(center.y - I.radius * 1.3, center.y + I.radius * 1.3);
    const d = sample(coast, x, y);
    if (d < wet + 10 || d > wet + 90 || sample(grass, x, y) > -20) continue;
    decals.push({ frame: 'starfish', x, y, scale: rng.range(0.7, 0.95), flip: rng.chance(0.5) });
    starfish++;
  }

  const walk = new WalkGrid(size, tuning.world.walkCell);
  walk.fill((x, y) => sample(coast, x, y) > I.walkMinCoastDistance);
  walk.allowPolygon(dockDeck);
  for (const o of objects)
    if (o.collider) walk.blockEllipse(o.x, o.y + o.collider.oy, o.collider.rx, o.collider.ry, tuning.player.collisionRadius);

  const start = fromImage06(fire, {
    x: footOf('campfire').x + campData.playerStart.dx,
    y: footOf('campfire').y + campData.playerStart.dy,
  });

  return { seed, size, center, fields, fire, playerStart: start, objects, decals, walk };
}

