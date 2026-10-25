/**
 * Regenerates the PWA icons from web/public/icon.svg (run: npm run icons).
 * Output is committed; rerun only when the SVG changes.
 * The SVG is full-bleed with its glyph inside the central 60%, so the same art
 * serves as the normal and the maskable icon.
 */
import path from 'node:path';
import sharp from 'sharp';

const pub = path.resolve(import.meta.dirname, '../web/public');
const targets: [string, number][] = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-maskable-512.png', 512],
  ['apple-touch-icon.png', 180],
];
for (const [name, size] of targets) {
  await sharp(path.join(pub, 'icon.svg'), { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(path.join(pub, name));
  console.log(`wrote ${name}`);
}
