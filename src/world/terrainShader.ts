import Phaser from 'phaser';
import tuning from '../data/tuning.json';
import type { Fields, IslandData } from './islandGen';

const I = tuning.island;
const A = tuning.ambience;

/** The fields are packed into a texture's RGB channels over these ranges. */
const COAST_RANGE: [number, number] = [-224, 96];
const GRASS_RANGE: [number, number] = [-64, 64];
const DIRT_RANGE: [number, number] = [-32, 32];

/**
 * The island ground, drawn every frame by one fragment shader. Each layer
 * (shallows, wet sand, beach, camp dirt, grass and its dark ragged edge) is
 * a painted texture blended in by the island's fields, so the ground stays
 * sharp at any zoom and needs no baking at load. The tide foam breathes in
 * the same pass.
 */
export function addTerrain(scene: Phaser.Scene, island: IslandData): Phaser.GameObjects.Shader {
  scene.textures.addCanvas('fields', packFields(island.fields));
  const c = (hex: string): string => {
    const n = parseInt(hex.slice(1), 16);
    return `vec3(${((n >> 16) & 255) / 255}, ${((n >> 8) & 255) / 255}, ${(n & 255) / 255})`;
  };
  const f = (n: number): string => n.toFixed(3);
  const frag = `
precision highp float;
uniform float time;
uniform vec2 resolution;
uniform sampler2D iChannel0; // fields: r coast, g grass, b camp dirt
uniform sampler2D iChannel1; // deep water (from image 06)
uniform sampler2D iChannel2; // sand
uniform sampler2D iChannel3; // grass
varying vec2 fragCoord;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 u = fract(p);
  u = u * u * (3.0 - 2.0 * u);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec3 over(vec3 base, vec3 top, float a) { return mix(base, top, clamp(a, 0.0, 1.0)); }

void main() {
  vec2 world = vec2(fragCoord.x, resolution.y - fragCoord.y);
  vec3 fld = texture2D(iChannel0, world / resolution).rgb;
  float coast = mix(${f(COAST_RANGE[0])}, ${f(COAST_RANGE[1])}, fld.r);
  float grass = mix(${f(GRASS_RANGE[0])}, ${f(GRASS_RANGE[1])}, fld.g);
  float dirt = mix(${f(DIRT_RANGE[0])}, ${f(DIRT_RANGE[1])}, fld.b);

  vec2 drift = vec2(${f(A.waterDriftX)}, ${f(A.waterDriftY)}) * time * 0.001;
  vec3 water = texture2D(iChannel1, (world - drift) / 256.0).rgb;
  vec3 sandTex = texture2D(iChannel2, world / 512.0).rgb;
  vec3 sand = sandTex;
  vec3 wetSand = sandTex * (${c('#7F6A3F')} / ${c('#AD8549')});
  vec3 dirtTex = texture2D(iChannel2, world.yx / 512.0 + 0.37).rgb * (${c('#A07940')} / ${c('#AD8549')});
  vec3 grassTex = texture2D(iChannel3, world / 512.0).rgb;
  vec3 shallow = mix(water, ${c('#56806A')}, 0.5);

  // Out to sea, then the shallows, lightening toward the shore.
  vec3 col = water;
  col = over(col, shallow, smoothstep(${f(-I.shallowWidth)}, ${f(-I.shallowWidth * 0.35)}, coast));
  col = over(col, mix(wetSand, shallow, 0.62), smoothstep(-70.0, -4.0, coast) * 0.75);

  // Tide foam: two broken rings that swell in turn.
  float breath = 0.5 + 0.5 * sin(time * 0.001 * 6.2832 / ${f(A.foamBreathSeconds)});
  float broken = smoothstep(0.35, 0.7, vnoise(world / 60.0 + vec2(time * 0.00004, 0.0)));
  float inner = smoothstep(-16.0 - 4.0 * breath, -9.0, coast) * (1.0 - smoothstep(-5.0, -1.0, coast));
  float outer = smoothstep(-48.0, -38.0 + 3.0 * breath, coast) * (1.0 - smoothstep(-34.0, -26.0, coast));
  col = over(col, ${c('#D5DFC9')}, inner * broken * (0.5 + 0.45 * breath));
  col = over(col, ${c('#D5DFC9')}, outer * broken * (0.45 - 0.3 * breath));

  // Wet sand with a dark damp line at the waterline, then the dry beach.
  col = over(col, wetSand, smoothstep(-2.0, 2.0, coast));
  col = over(col, ${c('#4E4128')}, smoothstep(-1.0, 1.0, coast) * (1.0 - smoothstep(2.0, 7.0, coast)) * 0.35);
  col = over(col, sand, smoothstep(${f(I.wetSandWidth - 8)}, ${f(I.wetSandWidth + 8)}, coast));
  col = over(col, dirtTex, smoothstep(-10.0, 10.0, dirt) * smoothstep(${f(I.wetSandWidth)}, ${f(I.wetSandWidth + 30)}, coast));

  // Grass: a shadow on the sand side, the grass, a darker ragged rim.
  float g = grass + 7.0 * (vnoise(world / 14.0) - 0.5) + 4.0 * (vnoise(world / 5.0) - 0.5);
  col = over(col, ${c('#3F3C18')}, smoothstep(${f(-I.grassEdgeShadow - 6)}, ${f(-I.grassEdgeShadow + 4)}, g) * 0.5);
  col = over(col, grassTex, smoothstep(-1.2, 1.2, g));
  col = over(col, ${c('#3F3C18')}, smoothstep(-1.0, 1.0, g) * (1.0 - smoothstep(3.0, 16.0, g)) * 0.55);

  gl_FragColor = vec4(col, 1.0);
}`;
  const base = new Phaser.Display.BaseShader('terrain', frag);
  return scene.add.shader(base, 0, 0, island.size, island.size, ['fields', 'tex_water', 'tex_sand', 'tex_grass']).setOrigin(0);
}

/** The fields as an opaque RGB canvas, one pixel per field cell. */
function packFields(f: Fields): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = f.w;
  canvas.height = f.h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(f.w, f.h);
  const d = img.data;
  const enc = (v: number, [lo, hi]: [number, number]): number => Math.round((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo) * 255);
  for (let k = 0, n = f.w * f.h; k < n; k++) {
    d[k * 4] = enc(f.coast[k], COAST_RANGE);
    d[k * 4 + 1] = enc(f.grass[k], GRASS_RANGE);
    d[k * 4 + 2] = enc(f.campDirt[k], DIRT_RANGE);
    d[k * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
