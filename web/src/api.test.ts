import { afterEach, describe, expect, it, vi } from 'vitest';
import { onUnauthorized } from './lib/session';
import { addAllowed, ApiError, getMe, listAllowed, signOut, signInWithGoogle, addToShopping, clearShopping, listShopping, removeShoppingItem } from './api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

describe('shopping api', () => {
  it('lists items', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { items: [{ id: 'a' }] })));
    expect(await listShopping()).toEqual([{ id: 'a' }]);
  });
  it('adds and sends force only when set', async () => {
    const f = vi.fn(async () => json(200, { added: 2, items: [] }));
    vi.stubGlobal('fetch', f);
    expect(await addToShopping('r1', [0, 2])).toEqual({ added: 2 });
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ recipeId: 'r1', indexes: [0, 2] });
    await addToShopping('r1', [0], true);
    expect(JSON.parse((f.mock.calls[1] as unknown as [string, RequestInit])[1].body as string).force).toBe(true);
  });
  it('throws ApiError 409 carrying the parsed body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(409, { error: 'already_on_list', recipeTitle: 'Soup' })));
    const err = await addToShopping('r1', [0]).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.message).toBe('Request failed (409)');
    expect(err.body).toEqual({ error: 'already_on_list', recipeTitle: 'Soup' });
  });
  it('body is undefined for non-JSON errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    const err = await listShopping().catch((e) => e);
    expect(err.body).toBeUndefined();
    expect(err.status).toBe(500);
  });
  it('removes and clears', async () => {
    const f = vi.fn(async (_u: string, init?: RequestInit) =>
      init?.method === 'DELETE' && _u === '/api/shopping' ? json(200, { removed: 3 }) : new Response(null, { status: 204 }),
    );
    vi.stubGlobal('fetch', f);
    await removeShoppingItem('x y');
    expect(f.mock.calls[0][0]).toBe('/api/shopping/x%20y');
    await expect(clearShopping()).resolves.toBeUndefined();
  });
});

describe('401 handling', () => {
  const status = (n: number) => vi.stubGlobal('fetch', vi.fn(async () => json(n, { error: 'x' })));
  it('notifies once and still throws the ApiError', async () => {
    status(401);
    const fn = vi.fn();
    const off = onUnauthorized(fn);
    const err = await listShopping().catch((e) => e);
    off();
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('does not notify for other statuses', async () => {
    status(500);
    const fn = vi.fn();
    const off = onUnauthorized(fn);
    await listShopping().catch(() => {});
    off();
    expect(fn).not.toHaveBeenCalled();
  });
  it('does not notify for the three endpoints the gate drives itself', async () => {
    const fn = vi.fn();
    const off = onUnauthorized(fn);
    status(401);
    await getMe().catch(() => {});
    await signOut().catch(() => {});
    await signInWithGoogle('bad').catch(() => {});
    off();
    expect(fn).not.toHaveBeenCalled();
  });

  it('notifies for the allowlist endpoints: a 401 there means signed out like anywhere else', async () => {
    status(401);
    const fn = vi.fn();
    const off = onUnauthorized(fn);
    await listAllowed().catch(() => {});
    await addAllowed('a@b.c').catch(() => {});
    off();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
