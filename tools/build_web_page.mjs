// Packs the production build (dist/) into one self-contained page: the game
// code, its styles, the fonts and every image inline, so the page loads with
// no further requests. This is what gets published as the shareable link.
//
//   npm run build && node tools/build_web_page.mjs out.html
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const out = process.argv[2] ?? 'dist/castaway-cove.html';
const assetsDir = join(dist, 'assets');
const files = readdirSync(assetsDir);

const dataUri = (path, type) => `data:${type};base64,${readFileSync(path).toString('base64')}`;

// Atlases with their page images inlined, and the ground textures.
const inline = {};
for (const name of ['character', 'world', 'hud', 'fishing']) {
  const atlas = JSON.parse(readFileSync(join(assetsDir, `${name}.json`), 'utf8'));
  for (const t of atlas.textures) t.image = dataUri(join(assetsDir, t.image), t.image.endsWith('.webp') ? 'image/webp' : 'image/png');
  inline[`${name}.json`] = atlas;
}
inline['fishing/dock.jpg'] = dataUri(join(assetsDir, 'fishing', 'dock.jpg'), 'image/jpeg');
for (const t of ['sand', 'grass', 'water']) inline[`textures/${t}.png`] = dataUri(join(assetsDir, 'textures', `${t}.png`), 'image/png');

// Styles: keep only the Latin font faces and inline their woff2 files.
const cssFile = files.find((f) => /^index-.*\.css$/.test(f));
let css = readFileSync(join(assetsDir, cssFile), 'utf8');
css = css.replace(/@font-face\{[^}]*\}/g, (face) => {
  const woff2 = face.match(/url\(\.?\/?([^)]*?latin-700-normal[^)]*?\.woff2)\)/);
  if (!woff2 || face.includes('latin-ext')) return '';
  const uri = dataUri(join(assetsDir, woff2[1].replace(/^assets\//, '')), 'font/woff2');
  return face.replace(/src:[^;}]*/, `src:url(${uri}) format("woff2")`);
});

const jsFile = files.find((f) => /^index-.*\.js$/.test(f));
const js = readFileSync(join(assetsDir, jsFile), 'utf8').replace(/<\/script/gi, '<\\/script');

const page = `<title>Castaway Cove</title>
<meta name="theme-color" content="#2B524C" />
<style>
  :root { --sea: #2b524c; --parchment: #dcc08a; color-scheme: dark; }
  html, body {
    height: 100%;
    margin: 0;
    overflow: hidden;
    background: var(--sea);
    color: var(--parchment);
    touch-action: none;
    -webkit-user-select: none;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
  }
  #game { position: fixed; inset: 0; }
  #game canvas { display: block; }
  /* On wide screens (desktop, landscape) show the game at a portrait
     phone's shape in the middle; phones in portrait get the full screen. */
  @media (min-aspect-ratio: 3/4) {
    html, body { background: #1b3531; }
    #game {
      right: 0;
      left: 0;
      margin: 0 auto;
      width: calc(100vh * 360 / 780);
      box-shadow: 0 0 0 2px #211912, 0 12px 48px rgba(0, 0, 0, 0.55);
    }
  }
${css}
</style>
<div id="game"></div>
<script>window.__CASTAWAY_ASSETS = ${JSON.stringify(inline)};</script>
<script type="module">
${js}
</script>
`;
writeFileSync(out, page);
console.log(`${out}: ${(page.length / 1024 / 1024).toFixed(1)} MB`);
