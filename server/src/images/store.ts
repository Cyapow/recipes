import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, rename, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { IMAGE_ID_RE } from './ids.js';

export { IMAGE_ID_RE };
const MAX_WIDTH = 1600;
const THUMB_WIDTH = 400;

/** A rectangle in 0-1000 of an image's width and height. */
export type Box1000 = { x0: number; y0: number; x1: number; y1: number };
const MIN_SIDE = 50; // 5% of the image

/** Clamp a box to 0-1000 and put each corner the right way round. */
export function normaliseBox(b: Box1000): Box1000 {
  const clamp = (n: number) => Math.min(1000, Math.max(0, n));
  const [x0, x1] = [clamp(b.x0), clamp(b.x1)].sort((a, c) => a - c) as [number, number];
  const [y0, y1] = [clamp(b.y0), clamp(b.y1)].sort((a, c) => a - c) as [number, number];
  return { x0, y0, x1, y1 };
}

export type ImageStore = {
  save(bytes: Buffer): Promise<string>;
  /** The stored full-size JPEG, or undefined for an unknown id. */
  read(id: string): Promise<Buffer | undefined>;
  /** Save the part of a stored image inside the box as a new image; null when the id is unknown or the box is under 5% either way. */
  crop(id: string, box: Box1000): Promise<string | null>;
  path(id: string): string | undefined;
  dir: string;
};

/** Write to a temp file then rename, so a crash never leaves a half-written file at the final name. */
async function writeAtomic(file: string, bytes: Buffer): Promise<void> {
  const tmp = path.join(path.dirname(file), `.tmp-${randomBytes(6).toString('hex')}`);
  try {
    await writeFile(tmp, bytes);
    await rename(tmp, file);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

export function createImageStore(dataDir: string): ImageStore {
  const dir = path.join(dataDir, 'images'); // created lazily on first save

  const store: ImageStore = {
    dir,
    path(id) {
      if (!IMAGE_ID_RE.test(id)) return undefined;
      const p = path.join(dir, id);
      return existsSync(p) ? p : undefined;
    },
    async save(bytes) {
      // Throws if the bytes are not a decodable image.
      const meta = await sharp(bytes).metadata();
      if (!meta.format) throw new Error('Not an image');
      const id = `${createHash('sha256').update(bytes).digest('hex')}.jpg`;
      const full = path.join(dir, id);
      const thumb = path.join(dir, `thumb-${id}`);
      if (existsSync(full) && existsSync(thumb)) return id;
      mkdirSync(dir, { recursive: true });
      const base = sharp(bytes).rotate();
      const [fullBytes, thumbBytes] = await Promise.all([
        base.clone().resize({ width: MAX_WIDTH, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer(),
        base.clone().resize({ width: THUMB_WIDTH, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer(),
      ]);
      // Thumb first: an original is only visible once its thumb exists.
      await writeAtomic(thumb, thumbBytes);
      await writeAtomic(full, fullBytes);
      return id;
    },
    async read(id) {
      const file = store.path(id);
      return file ? readFile(file) : undefined;
    },
    async crop(id, box) {
      const file = store.path(id);
      if (!file) return null;
      const { x0, y0, x1, y1 } = normaliseBox(box);
      if (!(x1 - x0 >= MIN_SIDE) || !(y1 - y0 >= MIN_SIDE)) return null;
      const bytes = await readFile(file);
      const { width, height } = await sharp(bytes).metadata();
      if (!width || !height) return null;
      const left = Math.min(width - 1, Math.round((x0 / 1000) * width));
      const top = Math.min(height - 1, Math.round((y0 / 1000) * height));
      const w = Math.max(1, Math.min(width - left, Math.round(((x1 - x0) / 1000) * width)));
      const h = Math.max(1, Math.min(height - top, Math.round(((y1 - y0) / 1000) * height)));
      const cropped = await sharp(bytes).extract({ left, top, width: w, height: h }).jpeg({ quality: 90 }).toBuffer();
      return store.save(cropped);
    },
  };
  return store;
}
