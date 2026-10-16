import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { test } from 'node:test';
import sharp from 'sharp';

const root = new URL('../', import.meta.url);
const asset = name => new URL(`public/assets/brand/${name}`, root);

test('current integrated logo retains its aspect ratio, transparency and small payload', async () => {
  const path = asset('visathreads-integrated-logo.png').pathname;
  const info = await sharp(path).metadata();
  assert.equal(info.width, 687); assert.equal(info.height, 240);
  assert.equal(info.hasAlpha, true); assert((await stat(path)).size < 35_000);
  const css = await readFile(new URL('src/styles/globals.css', root), 'utf8');
  assert.match(css, /\.integrated-brand-logo\s*\{[^}]*object-fit: contain;/);
});

test('brand assets are small, correctly sized and transparent where needed', async () => {
  for (const [file, size, alpha, maxBytes] of [
    ['visathreads-mark-v1.webp', 120, true, 15_000],
    ['favicon-32-v1.png', 32, true, 5_000],
    ['favicon-48-v1.png', 48, true, 8_000],
    ['apple-touch-icon-v1.png', 180, false, 50_000],
  ]) {
    const path = asset(file).pathname;
    const info = await sharp(path).metadata();
    assert.equal(info.width, size); assert.equal(info.height, size);
    assert.equal(info.hasAlpha, alpha); assert((await stat(path)).size < maxBytes);
    if (alpha) {
      const { data, info: pixels } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.equal(data[3], 0, 'Exterior corner must be transparent');
      const center = ((Math.floor(size / 2) * pixels.width) + Math.floor(size / 2)) * 4;
      assert(data[center + 3] >= 250, 'Mascot body must remain effectively opaque after resampling');
    }
  }
});

test('all page metadata uses the matching local browser and touch icons', async () => {
  const layout = await readFile(new URL('src/app/layout.tsx', root), 'utf8');
  for (const name of ['favicon-32-v1.png', 'favicon-48-v1.png', 'apple-touch-icon-v1.png']) {
    assert(layout.includes(`/assets/brand/${name}`));
  }
  assert(!layout.includes('/favicon.svg'));
});

test('branding remains visible and keyboard-accessible on narrow screens', async () => {
  const css = await readFile(new URL('src/styles/globals.css', root), 'utf8');
  assert.match(css, /\.site-brand:focus-visible\s*\{[^}]*outline:/);
  assert.match(css, /\.brand-mark\s*\{[^}]*display: block;[^}]*object-fit: contain;/);
  assert.match(css, /@media \(max-width: 479px\)[\s\S]*?\.site-brand \.brand-wordmark \{ display: none; \}/);
  assert(!css.includes('.brand-wood'));
});
