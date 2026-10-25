import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { rename, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export const IMAGE_ID_RE = /^[a-f0-9]{64}\.jpg$/;
const MAX_WIDTH = 1600;
const THUMB_WIDTH = 400;

export type ImageStore = {
  save(bytes: Buffer): Promise<string>;
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

  return {
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
  };
}
