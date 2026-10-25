/* Recipes service worker. Small on purpose:
 *  - navigations: network-first, falling back to a cached "/" shell when offline
 *  - /assets/* (content-hashed, immutable) and /api/images/<hash>.jpg: cache-first
 *  - everything else, notably every other /api/* call: not intercepted at all
 * Nothing is precached, so a stale worker can never pin an old index.html while online.
 */
const CACHE = 'recipes-v1';
const IMAGE_RE = /^\/api\/images\/(thumb-)?[a-f0-9]{64}\.jpg$/;

/** Pure routing decision: 'bypass' | 'cache-first' | 'network-first'. */
function routeFor({ method, pathname, mode, sameOrigin }) {
  if (method !== 'GET' || sameOrigin === false) return 'bypass';
  if (pathname === '/api' || pathname.startsWith('/api/')) return IMAGE_RE.test(pathname) ? 'cache-first' : 'bypass';
  if (pathname.startsWith('/assets/')) return 'cache-first';
  if (mode === 'navigate') return 'network-first';
  return 'bypass';
}

if (typeof module !== 'undefined') module.exports = { routeFor, cacheFirst, networkFirst };

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Only a plain, non-redirected HTML 200 may become the offline shell. */
function canCacheShell(res) {
  return res.ok && !res.redirected && (res.headers.get('content-type') || '').includes('text/html');
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  // Never cache an HTML body for an asset/image URL (e.g. an SPA fallback page): it would poison the cache.
  if (res.status === 200 && !(res.headers.get('content-type') || '').includes('text/html')) await cache.put(request, res.clone());
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) {
      if (canCacheShell(res)) await cache.put('/', res.clone()); // SPA: every navigation is the same shell
      return res;
    }
    const shell = res.status >= 500 ? await cache.match('/') : undefined;
    return shell || res;
  } catch (err) {
    const shell = await cache.match('/');
    if (shell) return shell;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const route = routeFor({
    method: request.method,
    pathname: url.pathname,
    mode: request.mode,
    sameOrigin: url.origin === self.location.origin,
  });
  if (route === 'cache-first') event.respondWith(cacheFirst(request));
  else if (route === 'network-first') event.respondWith(networkFirst(request));
});
