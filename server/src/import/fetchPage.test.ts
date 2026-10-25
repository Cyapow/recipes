import { describe, expect, it, vi } from 'vitest';
import { assertPublicUrl, BlockedUrlError, createGuardedLookup, fetchBytes, fetchPage, FetchFailedError, isPublicIp } from './fetchPage.js';

const PUBLIC = '93.184.216.34';
const resolve = async (host: string) => (host === 'evil.test' ? ['10.0.0.5'] : host === 'mixed.test' ? [PUBLIC, '127.0.0.1'] : host === 'empty.test' ? [] : [PUBLIC]);

describe('isPublicIp', () => {
  it.each(['93.184.216.34', '8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '100.63.255.255', '100.128.0.1', '2606:4700:4700::1111', '2a00:1450:4009::200e'])('allows %s', (ip) => {
    expect(isPublicIp(ip)).toBe(true);
  });
  it.each([
    '0.0.0.0', '0.1.2.3', '10.0.0.1', '10.255.255.255', '100.64.0.1', '100.127.255.255', '127.0.0.1', '127.255.255.254', '169.254.169.254', '172.16.0.1', '172.31.255.255',
    '192.0.0.1', '192.168.1.1', '198.18.0.1', '198.19.255.255', '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255',
    '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:a9fe:a9fe', '::127.0.0.1', '::10.0.0.1', '64:ff9b::7f00:1', '2002:7f00:1::', '2001:db8::1', '2001::1', 'not-an-ip', '1.2.3',
  ])('rejects %s', (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });
  it('allows IPv4-mapped public addresses', () => {
    expect(isPublicIp('::ffff:8.8.8.8')).toBe(true);
  });
});

describe('assertPublicUrl', () => {
  it.each([
    'http://127.0.0.1', 'http://10.0.0.5', 'http://169.254.169.254/latest/meta-data', 'http://localhost', 'http://LOCALHOST:8080/x', 'file:///etc/passwd', 'ftp://example.com/x',
    'gopher://example.com', 'javascript:alert(1)', 'http://0x7f.1', 'http://2130706433', 'http://017700000001', 'http://127.1', 'http://0', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/',
    'http://[fe80::1]/', 'http://[fd00::1]:3000/', 'http://user:pw@example.com/', 'http://user@example.com/', 'not a url', '', 'http://evil.test/', 'http://mixed.test/', 'http://empty.test/',
    'http://100.64.0.1/', 'http://192.168.0.1/', 'http://0.0.0.0:3000/', 'http://foo.localhost/',
  ])('rejects %j', async (u) => {
    await expect(assertPublicUrl(u, { resolve })).rejects.toBeInstanceOf(BlockedUrlError);
  });
  it('allows public http and https and returns the parsed URL', async () => {
    expect((await assertPublicUrl('https://example.com/a?b=1', { resolve })).href).toBe('https://example.com/a?b=1');
    expect((await assertPublicUrl('http://93.184.216.34/', { resolve })).hostname).toBe('93.184.216.34');
  });
  it('does not call DNS for IP literals', async () => {
    const r = vi.fn(resolve);
    await assertPublicUrl('http://93.184.216.34/', { resolve: r });
    expect(r).not.toHaveBeenCalled();
  });
});

describe('createGuardedLookup (connect-time DNS validation)', () => {
  const run = (host: string, options: object) =>
    new Promise<{ err: Error | null; res: unknown; family?: number }>((done) =>
      createGuardedLookup(resolve)(host, options, (err: Error | null, res: unknown, family?: number) => done({ err, res, family })),
    );
  it('errors if any resolved address is non-public', async () => {
    expect((await run('mixed.test', {})).err).toBeInstanceOf(BlockedUrlError);
    expect((await run('evil.test', { all: true })).err).toBeInstanceOf(BlockedUrlError);
  });
  it('returns validated addresses in both callback shapes', async () => {
    expect(await run('ok.test', {})).toEqual({ err: null, res: PUBLIC, family: 4 });
    expect(await run('ok.test', { all: true })).toEqual({ err: null, res: [{ address: PUBLIC, family: 4 }], family: undefined });
  });
});

const html = (body: string, headers: Record<string, string> = {}) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
const redirect = (to: string, status = 302) => new Response(null, { status, headers: { location: to } });
const fakeFetch = (routes: Record<string, () => Response>) =>
  vi.fn(async (url: string) => {
    const r = routes[url];
    if (!r) throw new Error(`unexpected fetch ${url}`);
    return r();
  });

describe('fetchPage', () => {
  it('returns html and the final URL, following redirects manually', async () => {
    const f = fakeFetch({ 'http://a.test/': () => redirect('/b'), 'http://a.test/b': () => redirect('https://c.test/final'), 'https://c.test/final': () => html('<p>hi</p>') });
    expect(await fetchPage('http://a.test/', { fetchImpl: f, resolve })).toEqual({ html: '<p>hi</p>', finalUrl: 'https://c.test/final' });
    for (const call of f.mock.calls) expect((call as unknown[])[1]).toMatchObject({ redirect: 'manual' });
  });
  it('sends a browser-compatible user agent', async () => {
    const f = fakeFetch({ 'http://a.test/': () => html('<p>hi</p>') });
    await fetchPage('http://a.test/', { fetchImpl: f, resolve });
    const init = (f.mock.calls[0] as unknown[])[1] as { headers: Record<string, string> };
    expect(init.headers['user-agent']).toBe('Mozilla/5.0 (compatible; RecipeBookImporter/1.0)');
  });
  it('rejects a redirect from a public URL to a private address', async () => {
    const f = fakeFetch({ 'http://a.test/': () => redirect('http://192.168.1.1/admin') });
    await expect(fetchPage('http://a.test/', { fetchImpl: f, resolve })).rejects.toBeInstanceOf(BlockedUrlError);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it.each(['file:///etc/passwd', 'http://localhost/', 'http://evil.test/', 'http://[::1]/', 'ftp://a.test/'])('rejects redirect to %s', async (to) => {
    const f = fakeFetch({ 'http://a.test/': () => redirect(to) });
    await expect(fetchPage('http://a.test/', { fetchImpl: f, resolve })).rejects.toBeInstanceOf(BlockedUrlError);
  });
  it('rejects blocked initial URLs without fetching', async () => {
    const f = vi.fn();
    await expect(fetchPage('http://169.254.169.254/', { fetchImpl: f, resolve })).rejects.toBeInstanceOf(BlockedUrlError);
    expect(f).not.toHaveBeenCalled();
  });
  it('gives up after 5 redirects', async () => {
    const f = vi.fn(async (u: string) => redirect(`http://a.test/${Number(u.split('/').pop() || 0) + 1}`));
    await expect(fetchPage('http://a.test/0', { fetchImpl: f, resolve })).rejects.toBeInstanceOf(FetchFailedError);
    expect(f).toHaveBeenCalledTimes(6);
  });
  it('rejects a redirect with no Location', async () => {
    await expect(fetchPage('http://a.test/', { fetchImpl: async () => new Response(null, { status: 302 }), resolve })).rejects.toBeInstanceOf(FetchFailedError);
  });
  it('rejects non-2xx and wrong content types, accepts missing content-type', async () => {
    await expect(fetchPage('http://a.test/', { fetchImpl: async () => new Response('x', { status: 404 }), resolve })).rejects.toBeInstanceOf(FetchFailedError);
    await expect(fetchPage('http://a.test/', { fetchImpl: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }), resolve })).rejects.toBeInstanceOf(FetchFailedError);
    await expect(fetchPage('http://a.test/', { fetchImpl: async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } }), resolve })).rejects.toBeInstanceOf(FetchFailedError);
    const noType = new Response('<p>x</p>');
    noType.headers.delete('content-type');
    expect((await fetchPage('http://a.test/', { fetchImpl: async () => noType, resolve })).html).toBe('<p>x</p>');
    expect((await fetchPage('http://a.test/', { fetchImpl: async () => html('<p/>', { 'content-type': 'application/xhtml+xml' }), resolve })).html).toBe('<p/>');
  });
  it('enforces the 2 MB cap by content-length', async () => {
    const f = async () => html('x', { 'content-length': String(3 * 1024 * 1024) });
    await expect(fetchPage('http://a.test/', { fetchImpl: f, resolve })).rejects.toBeInstanceOf(FetchFailedError);
  });
  it('aborts streaming as soon as the cap is exceeded', async () => {
    let pulled = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(512 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    const f = async () => new Response(stream, { headers: { 'content-type': 'text/html' } });
    await expect(fetchPage('http://a.test/', { fetchImpl: f, resolve })).rejects.toBeInstanceOf(FetchFailedError);
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(10); // 2 MB cap = 4 chunks; never reads an unbounded body
  });
  it('times out', async () => {
    const f = (_u: string, init: { signal: AbortSignal }) => new Promise<Response>((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
    await expect(fetchPage('http://a.test/', { fetchImpl: f as never, resolve, timeoutMs: 20 })).rejects.toBeInstanceOf(FetchFailedError);
  });
  it('times out while reading a stalled body', async () => {
    const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) });
    const f = async () => new Response(stream, { headers: { 'content-type': 'text/html' } });
    await expect(fetchPage('http://a.test/', { fetchImpl: f, resolve, timeoutMs: 20 })).rejects.toBeInstanceOf(FetchFailedError);
  });
  it('turns network errors into FetchFailedError', async () => {
    await expect(fetchPage('http://a.test/', { fetchImpl: async () => { throw new Error('ECONNREFUSED'); }, resolve })).rejects.toBeInstanceOf(FetchFailedError);
  });
  it('propagates a connect-time block as BlockedUrlError', async () => {
    const f = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: new BlockedUrlError() }); };
    await expect(fetchPage('http://a.test/', { fetchImpl: f, resolve })).rejects.toBeInstanceOf(BlockedUrlError);
  });
});

describe('fetchBytes', () => {
  const png = () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
  it('returns bytes, content type and final url, following guarded redirects', async () => {
    const f = fakeFetch({ 'http://a.test/i': () => redirect('http://b.test/i.png'), 'http://b.test/i.png': png });
    const out = await fetchBytes('http://a.test/i', { fetchImpl: f, resolve });
    expect([...out.bytes]).toEqual([1, 2, 3]);
    expect(out.contentType).toBe('image/png');
    expect(out.finalUrl).toBe('http://b.test/i.png');
  });
  it('blocks private redirects and non-image types', async () => {
    await expect(fetchBytes('http://a.test/i', { fetchImpl: fakeFetch({ 'http://a.test/i': () => redirect('http://10.0.0.1/x.png') }), resolve })).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(fetchBytes('http://a.test/i', { fetchImpl: async () => html('<p/>'), resolve })).rejects.toBeInstanceOf(FetchFailedError);
  });
  it('caps images at 15 MB', async () => {
    const f = async () => new Response('x', { headers: { 'content-type': 'image/jpeg', 'content-length': String(16 * 1024 * 1024) } });
    await expect(fetchBytes('http://a.test/i', { fetchImpl: f, resolve })).rejects.toBeInstanceOf(FetchFailedError);
    const ok = async () => new Response(new Uint8Array(3 * 1024 * 1024), { headers: { 'content-type': 'image/jpeg' } });
    expect((await fetchBytes('http://a.test/i', { fetchImpl: ok, resolve })).bytes.length).toBe(3 * 1024 * 1024);
  });
});
