import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { openDb } from '../db.js';
import { BlockedUrlError, FetchFailedError } from './fetchPage.js';

const html = readFileSync(new URL('../../test-fixtures/bbc-goodfood.html', import.meta.url), 'utf8');
const images = { save: vi.fn(async () => 'a'.repeat(64) + '.jpg'), path: vi.fn(), dir: '/x' };
const fetchBytes = vi.fn(async () => ({ bytes: Buffer.from('i'), contentType: 'image/jpeg', finalUrl: 'x' }));
const make = (fetchPage: never) => buildApp({ config: { dataDir: '/nonexistent' } as never, db: openDb(':memory:'), images, fetchPage, fetchBytes });
const post = (app: ReturnType<typeof make>, payload: unknown) => app.inject({ method: 'POST', url: '/api/import', payload: payload as never });

describe('POST /api/import', () => {
  it('returns the import result', async () => {
    const fetchPage = vi.fn(async () => ({ html, finalUrl: 'https://www.bbcgoodfood.com/r' }));
    const res = await post(make(fetchPage as never), { url: ' https://www.bbcgoodfood.com/r ' });
    expect(res.statusCode).toBe(200);
    expect(fetchPage).toHaveBeenCalledWith('https://www.bbcgoodfood.com/r');
    expect(res.json()).toMatchObject({ usedAi: false, usable: true, draft: { title: 'Easy pancakes', origin: 'other', sourceName: 'bbcgoodfood.com' } });
  });
  it('400 on missing, empty, non-string or oversized url without fetching', async () => {
    const fetchPage = vi.fn();
    const app = make(fetchPage as never);
    for (const body of [{}, { url: '' }, { url: 5 }, { url: 'http://x.test/' + 'a'.repeat(3000) }]) {
      const res = await post(app, body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "That URL can't be fetched" });
    }
    expect(fetchPage).not.toHaveBeenCalled();
  });
  it('400 for blocked URLs with a generic message', async () => {
    const res = await post(make((async () => { throw new BlockedUrlError(); }) as never), { url: 'http://10.0.0.1/' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "That URL can't be fetched" });
  });
  it('502 when the fetch fails', async () => {
    const res = await post(make((async () => { throw new FetchFailedError(); }) as never), { url: 'https://x.test/' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: "Couldn't fetch that page" });
  });
  it('rejects real private URLs end to end with the default fetcher (no network used)', async () => {
    const app = buildApp({ config: { dataDir: '/nonexistent' } as never, db: openDb(':memory:'), images });
    for (const url of ['http://127.0.0.1/', 'http://169.254.169.254/', 'file:///etc/passwd', 'http://[::1]/']) {
      expect((await post(app, { url })).statusCode).toBe(400);
    }
  });
});
