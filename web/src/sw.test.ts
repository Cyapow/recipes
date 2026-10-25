import { describe, expect, it } from 'vitest';
import src from '../public/sw.js?raw';

// sw.js is a classic script; load it the way the browser would, but with a stub `self`
// and a `module` object so its pure routing predicate is exposed.
type Handler = (request: unknown) => Promise<Response>;
const mod: {
  exports: {
    routeFor?: (r: { method: string; pathname: string; mode: string; sameOrigin?: boolean }) => string;
    cacheFirst?: Handler;
    networkFirst?: Handler;
  };
} = { exports: {} };
const store = new Map<string, Response>();
let nextFetch: () => Promise<Response> = async () => new Response('');
const fakeCaches = {
  open: async () => ({
    match: async (k: unknown) => store.get(typeof k === 'string' ? k : (k as { url: string }).url)?.clone(),
    put: async (k: unknown, v: Response) => void store.set(typeof k === 'string' ? k : (k as { url: string }).url, v),
  }),
};
new Function('self', 'module', 'caches', 'fetch', src)(
  { addEventListener() {}, location: { origin: 'http://x' } },
  mod,
  fakeCaches,
  () => nextFetch(),
);
const routeFor = mod.exports.routeFor!;
const req = (pathname: string, mode = 'cors', method = 'GET') => routeFor({ method, pathname, mode, sameOrigin: true });

describe('service worker routing', () => {
  it('never touches API calls', () => {
    expect(req('/api/recipes')).toBe('bypass');
    expect(req('/api/recipes', 'cors', 'POST')).toBe('bypass');
    expect(req('/api/backup/status')).toBe('bypass');
    expect(req('/api')).toBe('bypass');
  });
  it('does not intercept API navigations such as the OAuth redirect', () => {
    expect(req('/api/backup/google/start', 'navigate')).toBe('bypass');
  });
  it('caches content-hashed images cache-first', () => {
    expect(req('/api/images/' + 'a'.repeat(64) + '.jpg')).toBe('cache-first');
    expect(req('/api/images/thumb-' + 'a'.repeat(64) + '.jpg')).toBe('cache-first');
    expect(req('/api/images/other.jpg')).toBe('bypass');
    expect(req('/api/images/' + 'a'.repeat(64) + '.jpg/../x')).toBe('bypass');
  });
  it('caches hashed assets cache-first', () => {
    expect(req('/assets/app-abc123.js')).toBe('cache-first');
    expect(req('/assets/index-abc.css')).toBe('cache-first');
  });
  it('navigations are network-first', () => {
    expect(req('/', 'navigate')).toBe('network-first');
    expect(req('/recipe/123', 'navigate')).toBe('network-first');
  });
  it('bypasses everything else, other methods and cross-origin', () => {
    expect(req('/sw.js')).toBe('bypass');
    expect(req('/manifest.webmanifest')).toBe('bypass');
    expect(req('/assets/app-abc.js', 'cors', 'POST')).toBe('bypass');
    expect(routeFor({ method: 'GET', pathname: '/', mode: 'navigate', sameOrigin: false })).toBe('bypass');
  });
});

const html = (init: ResponseInit = {}) => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, ...init });

describe('service worker caching', () => {
  it('network-first caches the shell only for a plain HTML 200', async () => {
    store.clear();
    nextFetch = async () => html();
    await mod.exports.networkFirst!({ url: 'http://x/recipe/1' });
    expect(store.has('/')).toBe(true);

    store.clear();
    nextFetch = async () => new Response('x', { status: 200, headers: { 'content-type': 'application/json' } });
    await mod.exports.networkFirst!({ url: 'http://x/recipe/1' });
    expect(store.has('/')).toBe(false);

    const redirected = html();
    Object.defineProperty(redirected, 'redirected', { value: true });
    nextFetch = async () => redirected;
    await mod.exports.networkFirst!({ url: 'http://x/recipe/1' });
    expect(store.has('/')).toBe(false);
  });
  it('cache-first never stores an HTML body or a non-200 for an asset url', async () => {
    store.clear();
    nextFetch = async () => html();
    await mod.exports.cacheFirst!({ url: 'http://x/assets/gone.js' });
    expect(store.size).toBe(0);
    nextFetch = async () => new Response('x', { status: 206, headers: { 'content-type': 'text/javascript' } });
    await mod.exports.cacheFirst!({ url: 'http://x/assets/part.js' });
    expect(store.size).toBe(0);
    nextFetch = async () => new Response('ok()', { status: 200, headers: { 'content-type': 'text/javascript' } });
    await mod.exports.cacheFirst!({ url: 'http://x/assets/app.js' });
    expect(store.has('http://x/assets/app.js')).toBe(true);
  });
});
