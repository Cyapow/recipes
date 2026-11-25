import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { signedIn } from '../auth/testing.js';
import { openDb } from '../db.js';
import type { RecipeInput } from '../recipes/schema.js';

const recipe: RecipeInput = {
  title: 'Toast',
  description: null,
  origin: 'mine',
  sourceName: null,
  sourceUrl: null,
  servings: null,
  prepMinutes: 1,
  cookMinutes: 2,
  ingredients: [{ group: null, quantity: 2, unit: 'slice', item: 'bread', note: null }],
  steps: [{ text: 'Toast it', imageId: null, ingredients: [0] }],
  notes: null,
  tags: ['quick'],
  imageIds: [],
};

function setup() {
  const config = { dataDir: mkdtempSync(path.join(tmpdir(), 'favourites-routes-')) } as never;
  const db = openDb(':memory:');
  const app = signedIn(buildApp({ config, db }), db, 'me@example.com');
  const other = signedIn(buildApp({ config, db }), db, 'you@example.com');
  return { app, other, db };
}

type Client = ReturnType<typeof setup>['app'];

const create = async (app: Client) =>
  (await app.inject({ method: 'POST', url: '/api/recipes', payload: recipe })).json().id as string;
const star = (app: Client, id: string, method: 'PUT' | 'DELETE' = 'PUT') =>
  app.inject({ method, url: `/api/recipes/${id}/favourite` });
const stars = async (app: Client, id: string) => (await app.inject({ url: `/api/recipes/${id}` })).json().favouritedBy;

describe('starring a recipe', () => {
  it('stars a recipe for the signed-in person only', async () => {
    const { app } = setup();
    const id = await create(app);
    const res = await star(app, id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(await stars(app, id)).toEqual(['me@example.com']);
  });

  it('ignores any email the caller tries to supply', async () => {
    const { app } = setup();
    const id = await create(app);
    await app.inject({
      method: 'PUT',
      url: `/api/recipes/${id}/favourite?email=you@example.com`,
      payload: { email: 'you@example.com' },
    });
    expect(await stars(app, id)).toEqual(['me@example.com']);
  });

  it('starring twice is still one star and still 200', async () => {
    const { app } = setup();
    const id = await create(app);
    await star(app, id);
    expect((await star(app, id)).statusCode).toBe(200);
    expect(await stars(app, id)).toEqual(['me@example.com']);
  });

  it('unstars, and unstarring something unstarred is 200', async () => {
    const { app } = setup();
    const id = await create(app);
    expect((await star(app, id, 'DELETE')).statusCode).toBe(200);
    await star(app, id);
    const res = await star(app, id, 'DELETE');
    expect(res.json()).toEqual({ ok: true });
    expect(await stars(app, id)).toEqual([]);
  });

  it('404s for a recipe that does not exist, with no row written', async () => {
    const { app, db } = setup();
    for (const method of ['PUT', 'DELETE'] as const) {
      const res = await star(app, 'nope', method);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Not found' });
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM favourites').get()).toEqual({ n: 0 });
  });

  it('signed out, both routes are 401', async () => {
    const { app } = setup();
    const id = await create(app);
    for (const method of ['PUT', 'DELETE'] as const) {
      const res = await app.injectAnon({ method, url: `/api/recipes/${id}/favourite` });
      expect(res.statusCode).toBe(401);
    }
    expect(await stars(app, id)).toEqual([]);
  });

  it('one person starring does not star for the other', async () => {
    const { app, other } = setup();
    const id = await create(app);
    await star(app, id);
    await star(other, id);
    await star(other, id, 'DELETE');
    expect(await stars(app, id)).toEqual(['me@example.com']);
  });

  it('does not touch the recipe row', async () => {
    const { app } = setup();
    const id = await create(app);
    const before = (await app.inject({ url: `/api/recipes/${id}` })).json();
    await star(app, id);
    const after = (await app.inject({ url: `/api/recipes/${id}` })).json();
    expect({ ...after, favouritedBy: [] }).toEqual({ ...before, favouritedBy: [] });
  });
});
