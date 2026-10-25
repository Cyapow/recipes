import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildApp } from '../app.js';
import { openDb } from '../db.js';
import type { RecipeInput } from '../recipes/schema.js';

function make() {
  const config = { dataDir: mkdtempSync(path.join(tmpdir(), 'shop-routes-')) } as never;
  return buildApp({ config, db: openDb(':memory:') });
}

const recipe: RecipeInput = {
  title: 'Bolognese', description: null, origin: 'mine', sourceName: null, sourceUrl: null, servings: null,
  prepMinutes: null, cookMinutes: null,
  ingredients: [
    { group: null, quantity: 500, unit: 'g', item: 'beef mince', note: null },
    { group: null, quantity: 2, unit: 'tins', item: 'chopped tomatoes', note: null },
    { group: null, quantity: null, unit: null, item: 'red wine', note: 'splash' },
  ],
  steps: [], notes: null, tags: [], imageIds: [],
};

async function seed(app: ReturnType<typeof make>) {
  return (await app.inject({ method: 'POST', url: '/api/recipes', payload: recipe })).json().id as string;
}
const add = (app: ReturnType<typeof make>, payload: unknown) =>
  app.inject({ method: 'POST', url: '/api/shopping/add', payload: payload as never });

describe('shopping routes', () => {
  it('starts empty', async () => {
    const res = await make().inject({ url: '/api/shopping' });
    expect(res.json()).toEqual({ items: [] });
  });

  it('adds the chosen ingredients only and returns the list', async () => {
    const app = make();
    const recipeId = await seed(app);
    const res = await add(app, { recipeId, indexes: [2, 0, 0] });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.added).toBe(2);
    expect(body.items.map((i: { text: string }) => i.text)).toEqual(['500g beef mince', 'red wine (splash)']);
    expect(body.items[0].sources).toEqual([{ recipeId, title: 'Bolognese' }]);
    expect((await app.inject({ url: '/api/shopping' })).json().items).toHaveLength(2);
  });

  it('404 for an unknown recipe', async () => {
    expect((await add(make(), { recipeId: 'nope', indexes: [0] })).statusCode).toBe(404);
  });

  it('400 for empty, non-integer, negative, out-of-range or malformed input', async () => {
    const app = make();
    const recipeId = await seed(app);
    for (const body of [
      { recipeId, indexes: [] }, { recipeId, indexes: [0.5] }, { recipeId, indexes: [-1] },
      { recipeId, indexes: [3] }, { recipeId, indexes: [0, 99] }, { recipeId }, { indexes: [0] },
      { recipeId, indexes: ['0'] },
    ]) {
      expect((await add(app, body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await app.inject({ url: '/api/shopping' })).json().items).toEqual([]);
  });

  it('409 when the recipe is already on the list, unless forced', async () => {
    const app = make();
    const recipeId = await seed(app);
    await add(app, { recipeId, indexes: [1] });
    const dup = await add(app, { recipeId, indexes: [1] });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toEqual({ error: 'already_on_list', recipeTitle: 'Bolognese' });
    const forced = await add(app, { recipeId, indexes: [1], force: true });
    expect(forced.statusCode).toBe(200);
    expect(forced.json().items[0].text).toBe('4 tins chopped tomatoes');
  });

  describe('expectedUpdatedAt', () => {
    async function seedWithStamp(app: ReturnType<typeof make>) {
      const id = await seed(app);
      const updatedAt = (await app.inject({ url: `/api/recipes/${id}` })).json().updatedAt as string;
      return { id, updatedAt };
    }

    it('mismatch is 409 recipe_changed and leaves the list untouched', async () => {
      const app = make();
      const { id } = await seedWithStamp(app);
      const res = await add(app, { recipeId: id, indexes: [0], expectedUpdatedAt: '1999-01-01T00:00:00.000Z' });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'recipe_changed' });
      expect((await app.inject({ url: '/api/shopping' })).json().items).toEqual([]);
    });

    it('recipe_changed is checked before already_on_list', async () => {
      const app = make();
      const { id, updatedAt } = await seedWithStamp(app);
      expect((await add(app, { recipeId: id, indexes: [0], expectedUpdatedAt: updatedAt })).statusCode).toBe(200);
      const res = await add(app, { recipeId: id, indexes: [1], expectedUpdatedAt: 'stale' });
      expect(res.json()).toEqual({ error: 'recipe_changed' });
      expect((await add(app, { recipeId: id, indexes: [1], expectedUpdatedAt: updatedAt })).json()).toMatchObject({
        error: 'already_on_list',
      });
      expect((await app.inject({ url: '/api/shopping' })).json().items).toHaveLength(1);
    });

    it('a matching value works, and omitting it still works', async () => {
      const app = make();
      const { id, updatedAt } = await seedWithStamp(app);
      expect((await add(app, { recipeId: id, indexes: [0], expectedUpdatedAt: updatedAt })).statusCode).toBe(200);
      expect((await add(app, { recipeId: id, indexes: [1], force: true })).statusCode).toBe(200);
    });
  });

  it('DELETE one item: 204 then 404', async () => {
    const app = make();
    const recipeId = await seed(app);
    const { items } = (await add(app, { recipeId, indexes: [0] })).json();
    expect((await app.inject({ method: 'DELETE', url: `/api/shopping/${items[0].id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/api/shopping/${items[0].id}` })).statusCode).toBe(404);
  });

  it('DELETE all returns the removed count', async () => {
    const app = make();
    const recipeId = await seed(app);
    await add(app, { recipeId, indexes: [0, 1] });
    const res = await app.inject({ method: 'DELETE', url: '/api/shopping' });
    expect(res.json()).toEqual({ removed: 2 });
    expect((await app.inject({ url: '/api/shopping' })).json().items).toEqual([]);
  });

  it('the same-origin guard blocks a cross-site POST', async () => {
    const app = make();
    const recipeId = await seed(app);
    const res = await app.inject({
      method: 'POST', url: '/api/shopping/add', payload: { recipeId, indexes: [0] },
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(res.statusCode).toBe(403);
    expect((await app.inject({ url: '/api/shopping' })).json().items).toEqual([]);
  });
});
