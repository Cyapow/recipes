import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { openDb } from '../db.js';

const dirs: string[] = [];
function make() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'img-routes-'));
  dirs.push(dataDir);
  return buildApp({ config: { dataDir } as never, db: openDb(':memory:') });
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const B = '----testboundary';
function multipart(filename: string, type: string, body: Buffer) {
  const head = Buffer.from(
    `--${B}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
  );
  return {
    payload: Buffer.concat([head, body, Buffer.from(`\r\n--${B}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${B}` },
  };
}
const png = () =>
  sharp({ create: { width: 600, height: 400, channels: 3, background: '#336699' } }).png().toBuffer();

describe('image routes', () => {
  it('POST stores an image, GET serves it and its thumb with cache headers', async () => {
    const app = make();
    const res = await app.inject({ method: 'POST', url: '/api/images', ...multipart('a.png', 'image/png', await png()) });
    expect(res.statusCode).toBe(200);
    const { id } = res.json();
    expect(id).toMatch(/^[a-f0-9]{64}\.jpg$/);
    const full = await app.inject({ url: `/api/images/${id}` });
    expect(full.statusCode).toBe(200);
    expect(full.headers['content-type']).toBe('image/jpeg');
    expect(full.headers['cache-control']).toMatch(/max-age=\d{6,}/);
    expect(full.headers['cache-control']).toMatch(/immutable/);
    const thumb = await app.inject({ url: `/api/images/${id}/thumb` });
    expect(thumb.statusCode).toBe(200);
    expect((await sharp(thumb.rawPayload).metadata()).width).toBeLessThanOrEqual(400);
  });

  it('rejects a non-image with 415', async () => {
    const app = make();
    const res = await app.inject({
      method: 'POST', url: '/api/images',
      ...multipart('a.txt', 'text/plain', Buffer.from('just some text')),
    });
    expect(res.statusCode).toBe(415);
  });

  it('rejects a request that is not multipart with 415', async () => {
    const app = make();
    const res = await app.inject({ method: 'POST', url: '/api/images', payload: { a: 1 } });
    expect(res.statusCode).toBe(415);
  });

  it('rejects a missing file part with 400', async () => {
    const app = make();
    const res = await app.inject({
      method: 'POST', url: '/api/images',
      payload: `--${B}\r\nContent-Disposition: form-data; name="x"\r\n\r\nhi\r\n--${B}--\r\n`,
      headers: { 'content-type': `multipart/form-data; boundary=${B}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an upload over 15 MB with 413', async () => {
    const app = make();
    const big = Buffer.alloc(15 * 1024 * 1024 + 1024, 1);
    const res = await app.inject({ method: 'POST', url: '/api/images', ...multipart('big.png', 'image/png', big) });
    expect(res.statusCode).toBe(413);
  });

  it('path traversal ids are 400/404', async () => {
    const app = make();
    for (const url of ['/api/images/..%2Fetc%2Fpasswd', '/api/images/..%2F..%2Fetc%2Fpasswd/thumb', '/api/images/nothex.jpg']) {
      const res = await app.inject({ url });
      expect([400, 404]).toContain(res.statusCode);
    }
  });

  it('unknown but well-formed id is 404', async () => {
    const app = make();
    const res = await app.inject({ url: `/api/images/${'a'.repeat(64)}.jpg` });
    expect(res.statusCode).toBe(404);
  });
});
