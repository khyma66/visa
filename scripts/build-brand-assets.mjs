import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

// Only resize/encode the approved transparent master. Never redraw the logo.
const source = new URL('../assets/brand/visathreads-mascot-source.png', import.meta.url);
const output = new URL('../public/assets/brand/', import.meta.url);
await mkdir(output, { recursive: true });
await sharp(source.pathname).resize(120, 120).webp({ quality: 90, alphaQuality: 100 }).toFile(new URL('visathreads-mark-v1.webp', output).pathname);
for (const size of [32, 48]) {
  await sharp(source.pathname).resize(size, size).png().toFile(new URL(`favicon-${size}-v1.png`, output).pathname);
}
await sharp(source.pathname).resize(180, 180).flatten({ background: '#ffffff' }).png().toFile(new URL('apple-touch-icon-v1.png', output).pathname);
console.log('Built header, browser and Apple touch icons from the approved mascot.');
