// Screenshots for milestone review: a 360x780 phone in portrait and a desktop
// browser, as the brief asks. Needs the dev server running (npm run dev).
//
//   node tools/screenshots.mjs [baseUrl] [seed]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const seed = process.argv[3] ?? '20261022';
const out = 'screenshots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

const errors = [];

async function shoot(name, viewport, scale, actions) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: scale, isMobile: scale > 1, hasTouch: scale > 1 });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  await page.goto(`${base}?seed=${seed}&debug`);
  await page.waitForFunction(() => window.castaway, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${name}.png` });
  if (actions) await actions(page, name);
  await page.close();
}

// Walk him with the keyboard to show facing changes.
async function walkAbout(page, name) {
  const steps = [
    ['ArrowRight', 'walk-right'],
    ['ArrowUp', 'walk-up'],
    ['ArrowLeft', 'walk-left'],
    ['ArrowDown', 'walk-down'],
  ];
  for (const [key, label] of steps) {
    await page.keyboard.down(key);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/${name}-${label}.png` });
    await page.keyboard.up(key);
    await page.waitForTimeout(150);
  }
}

await shoot('phone-360x780', { width: 360, height: 780 }, 2, walkAbout);
await shoot('desktop-1280x800', { width: 1280, height: 800 }, 1);

// A zoomed-out overview of the whole island (debug view).
{
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  await page.goto(`${base}?seed=${seed}`);
  await page.waitForFunction(() => window.castaway, null, { timeout: 60000 });
  await page.evaluate(() => {
    const { scene, island } = window.castaway;
    const cam = scene.cameras.main;
    scene.scale.off('resize');
    cam.stopFollow();
    cam.setZoom(scene.scale.width / island.size);
    cam.centerOn(island.size / 2, island.size / 2);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/overview.png` });
  await page.close();
}

await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('screenshots written to', out);
