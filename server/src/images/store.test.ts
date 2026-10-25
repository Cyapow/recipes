import { mkdtempSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { createImageStore } from './store.js';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'img-store-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

export const png = (w = 800, h = 600) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer();

describe('image store', () => {
  it('saves a png as jpg with a thumbnail <= 400px wide', async () => {
    const store = createImageStore(tmp());
    const id = await store.save(await png(2400, 1200));
    expect(id).toMatch(/^[a-f0-9]{64}\.jpg$/);
    const full = await sharp(store.path(id)!).metadata();
    expect(full.format).toBe('jpeg');
    expect(full.width).toBe(1600);
    const thumb = await sharp(path.join(store.dir, `thumb-${id}`)).metadata();
    expect(thumb.width).toBeLessThanOrEqual(400);
  });

  it('does not enlarge small images', async () => {
    const store = createImageStore(tmp());
    const id = await store.save(await png(100, 100));
    expect((await sharp(store.path(id)!).metadata()).width).toBe(100);
  });

  it('same bytes twice gives one id and one original + one thumb', async () => {
    const store = createImageStore(tmp());
    const bytes = await png();
    const a = await store.save(bytes);
    const b = await store.save(bytes);
    expect(a).toBe(b);
    expect(readdirSync(store.dir).sort()).toEqual([a, `thumb-${a}`].sort());
  });

  it('rejects non-image bytes', async () => {
    const store = createImageStore(tmp());
    await expect(store.save(Buffer.from('hello world, not an image'))).rejects.toThrow();
  });

  it('path() returns undefined for unknown or malformed ids', async () => {
    const store = createImageStore(tmp());
    expect(store.path('a'.repeat(64) + '.jpg')).toBeUndefined();
    expect(store.path('../etc/passwd')).toBeUndefined();
  });

  it('does not touch disk until the first save', () => {
    const d = path.join(tmp(), 'later');
    createImageStore(d);
    expect(existsSync(d)).toBe(false);
  });
});
