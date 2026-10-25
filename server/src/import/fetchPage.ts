import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

/** Thrown when a URL (or a redirect hop, or a resolved address) is not allowed. Never says which rule matched. */
export class BlockedUrlError extends Error {
  constructor() {
    super("That URL can't be fetched");
    this.name = 'BlockedUrlError';
  }
}

/** Thrown for any other failure to fetch (network, status, content type, size, timeout). */
export class FetchFailedError extends Error {
  constructor(message = "Couldn't fetch that page") {
    super(message);
    this.name = 'FetchFailedError';
  }
}

export type Resolver = (hostname: string) => Promise<string[]>;
/** Sent as a desktop browser: some recipe sites (behind Cloudflare) reject unfamiliar agents. Personal, single-user use. */
export const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export type FetchImpl = (url: string, init: { redirect: 'manual'; signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;
export type FetchOpts = { fetchImpl?: FetchImpl; resolve?: Resolver; timeoutMs?: number };

export const PAGE_MAX_BYTES = 2 * 1024 * 1024;
export const IMAGE_MAX_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

const defaultResolve: Resolver = async (hostname) => (await dnsLookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

// ---- address classification -------------------------------------------------

function ipv4ToNum(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return null;
  return parts.reduce((n, p) => n * 256 + Number(p), 0);
}

const V4_BLOCKED: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 3], // 224/4 multicast and 240/4 reserved, incl. broadcast
];

function v4Public(n: number): boolean {
  return !V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((n & mask) >>> 0) === ((ipv4ToNum(base)! & mask) >>> 0);
  });
}

function parseIPv6(ip: string): number[] | null {
  if (ip.includes('%')) return null;
  let s = ip;
  const dot = s.lastIndexOf(':') + 1;
  if (s.slice(dot).includes('.')) {
    const n = ipv4ToNum(s.slice(dot));
    if (n === null) return null;
    s = `${s.slice(0, dot)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const toGroups = (h: string) => (h === '' ? [] : h.split(':'));
  const head = toGroups(halves[0]!);
  const tail = halves.length === 2 ? toGroups(halves[1]!) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
  return nums.length === 8 && nums.every((n) => !Number.isNaN(n)) ? nums : null;
}

/** True only for addresses on the public internet. Anything unparseable is not public. */
export function isPublicIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return v4Public(ipv4ToNum(ip)!);
  if (family !== 6) return false;
  const g = parseIPv6(ip);
  if (!g) return false;
  const embedded = (hi: number, lo: number) => v4Public(((hi << 16) | lo) >>> 0);
  // ::/96 (unspecified, loopback, v4-compatible) and ::ffff:0:0/96 (v4-mapped): judge the embedded v4.
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0 || g[5] === 0xffff)) return g[5] === 0xffff ? embedded(g[6]!, g[7]!) : false;
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return embedded(g[6]!, g[7]!); // NAT64
  if (g[0] === 0x2002) return embedded(g[1]!, g[2]!); // 6to4
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return false; // Teredo, documentation
  return g[0]! >= 0x2000 && g[0]! <= 0x3fff; // allow-list global unicast 2000::/3 (excludes fc00::/7, fe80::/10, ff00::/8, ...)
}

// ---- URL validation ------------------------------------------------------------

export async function assertPublicUrl(raw: string, opts: { resolve?: Resolver } = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError();
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BlockedUrlError();
  if (url.username || url.password) throw new BlockedUrlError();
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost')) throw new BlockedUrlError();
  if (isIP(host)) {
    if (!isPublicIp(host)) throw new BlockedUrlError();
    return url;
  }
  let addrs: string[];
  try {
    addrs = await (opts.resolve ?? defaultResolve)(host);
  } catch {
    throw new FetchFailedError();
  }
  if (addrs.length === 0 || !addrs.every(isPublicIp)) throw new BlockedUrlError();
  return url;
}

/**
 * A `connect.lookup` for undici/net: resolves and validates every address at connect time,
 * so the socket can only ever be opened to an address that passed the check (no DNS rebinding gap).
 */
export function createGuardedLookup(resolve: Resolver = defaultResolve) {
  return (hostname: string, options: { all?: boolean } | undefined, cb: (err: Error | null, address?: unknown, family?: number) => void) => {
    resolve(hostname).then(
      (addrs) => {
        if (addrs.length === 0 || !addrs.every(isPublicIp)) return cb(new BlockedUrlError());
        if (options?.all) cb(null, addrs.map((address) => ({ address, family: isIP(address) })));
        else cb(null, addrs[0], isIP(addrs[0]!));
      },
      (err: unknown) => cb(err instanceof Error ? err : new Error('lookup failed')),
    );
  };
}

// ---- guarded GET -------------------------------------------------------------------

let realFetch: FetchImpl | undefined;
function defaultFetch(resolve?: Resolver): FetchImpl {
  if (resolve) return makeRealFetch(resolve);
  return (realFetch ??= makeRealFetch(defaultResolve));
}
function makeRealFetch(resolve: Resolver): FetchImpl {
  const dispatcher = new Agent({ connect: { lookup: createGuardedLookup(resolve) as never }, maxRedirections: 0 } as never);
  const impl: FetchImpl = (url, init) => undiciFetch(url, { ...init, dispatcher } as never) as unknown as Promise<Response>;
  return impl;
}

function causedByBlock(err: unknown): boolean {
  for (let e = err, i = 0; e && i < 5; e = (e as { cause?: unknown }).cause, i++) if (e instanceof BlockedUrlError) return true;
  return false;
}

async function guardedGet(
  startUrl: string,
  cfg: { maxBytes: number; accept: (contentType: string) => boolean; acceptHeader: string },
  opts: FetchOpts,
): Promise<{ bytes: Buffer; contentType: string; finalUrl: string }> {
  const fetchImpl = opts.fetchImpl ?? defaultFetch(opts.resolve);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  const aborted = new Promise<never>((_, reject) => ctrl.signal.addEventListener('abort', () => reject(new FetchFailedError('Timed out')), { once: true }));
  aborted.catch(() => {});
  const race = <T>(p: Promise<T>) => Promise.race([p, aborted]);
  try {
    let current = startUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const url = await race(assertPublicUrl(current, { resolve: opts.resolve }));
      let res: Response;
      try {
        res = await race(fetchImpl(url.href, { redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': USER_AGENT, accept: cfg.acceptHeader } }));
      } catch (err) {
        if (err instanceof BlockedUrlError || err instanceof FetchFailedError) throw err;
        throw causedByBlock(err) ? new BlockedUrlError() : new FetchFailedError();
      }
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        void res.body?.cancel().catch(() => {});
        const loc = res.headers.get('location');
        if (!loc) throw new FetchFailedError();
        try {
          current = new URL(loc, url).href;
        } catch {
          throw new BlockedUrlError();
        }
        continue;
      }
      if (!res.ok) {
        void res.body?.cancel().catch(() => {});
        throw new FetchFailedError();
      }
      const contentType = (res.headers.get('content-type') ?? '').trim();
      if (contentType !== '' && !cfg.accept(contentType.toLowerCase())) {
        void res.body?.cancel().catch(() => {});
        throw new FetchFailedError();
      }
      const declared = Number(res.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > cfg.maxBytes) {
        void res.body?.cancel().catch(() => {});
        throw new FetchFailedError('Too large');
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      const reader = res.body?.getReader();
      if (reader) {
        try {
          for (;;) {
            const { done, value } = await race(reader.read());
            if (done) break;
            total += value.byteLength;
            if (total > cfg.maxBytes) throw new FetchFailedError('Too large');
            chunks.push(value);
          }
        } catch (err) {
          void reader.cancel().catch(() => {});
          throw err instanceof FetchFailedError ? err : new FetchFailedError();
        }
      }
      return { bytes: Buffer.concat(chunks), contentType, finalUrl: url.href };
    }
    throw new FetchFailedError('Too many redirects');
  } finally {
    clearTimeout(timer);
    ctrl.abort(); // release any open connection
  }
}

const isHtml = (t: string) => t.startsWith('text/html') || t.startsWith('application/xhtml+xml');

function decodeHtml(bytes: Buffer, contentType: string): string {
  const label = /charset\s*=\s*"?([\w-]+)/i.exec(contentType)?.[1] ?? /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(bytes.subarray(0, 2048).toString('latin1'))?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export async function fetchPage(url: string, opts: FetchOpts = {}): Promise<{ html: string; finalUrl: string }> {
  const r = await guardedGet(url, { maxBytes: PAGE_MAX_BYTES, accept: isHtml, acceptHeader: 'text/html,application/xhtml+xml' }, opts);
  return { html: decodeHtml(r.bytes, r.contentType), finalUrl: r.finalUrl };
}

export function fetchBytes(url: string, opts: FetchOpts = {}): Promise<{ bytes: Buffer; contentType: string; finalUrl: string }> {
  return guardedGet(url, { maxBytes: IMAGE_MAX_BYTES, accept: (t) => t.startsWith('image/'), acceptHeader: 'image/*' }, opts);
}
