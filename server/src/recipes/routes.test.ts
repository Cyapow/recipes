import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildApp } from '../app.js';
import { openDb } from '../db.js';
import type { RecipeInput } from './schema.js';

function make() {
  const config = { dataDir: mkdtempSync(path.join(tmpdir(), 'recipes-routes-')) } as never;
  return buildApp({ config, db: openDb(':memory:') });
}

const base: RecipeInput = {
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

describe('recipe routes', () => {
  it('POST creates (201) and GET returns it', async () => {
    const app = make();
    const res = await app.inject({ method: 'POST', url: '/api/recipes', payload: base });
    expect(res.statusCode).toBe(201);
    const { id } = res.json();
    const got = await app.inject({ url: `/api/recipes/${id}` });
    expect(got.statusCode).toBe(200);
    expect(got.json().title).toBe('Toast');
  });

  it('POST with empty title is 400 with issues', async () => {
    const app = make();
    const res = await app.inject({ method: 'POST', url: '/api/recipes', payload: { ...base, title: '' } });
    expect(res.statusCode).toBe(400);
    expect(Array.isArray(res.json().issues)).toBe(true);
  });

  it('PUT unknown id is 404', async () => {
    const res = await make().inject({ method: 'PUT', url: '/api/recipes/nope', payload: base });
    expect(res.statusCode).toBe(404);
  });

  it('PUT updates, DELETE then GET is 404', async () => {
    const app = make();
    const { id } = (await app.inject({ method: 'POST', url: '/api/recipes', payload: base })).json();
    const put = await app.inject({ method: 'PUT', url: `/api/recipes/${id}`, payload: { ...base, title: 'Bagel' } });
    expect(put.json().title).toBe('Bagel');
    expect((await app.inject({ method: 'DELETE', url: `/api/recipes/${id}` })).statusCode).toBe(204);
    expect((await app.inject({ url: `/api/recipes/${id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/recipes/${id}` })).statusCode).toBe(404);
  });

  it('list honours origin and tags endpoint works', async () => {
    const app = make();
    await app.inject({ method: 'POST', url: '/api/recipes', payload: base });
    await app.inject({ method: 'POST', url: '/api/recipes', payload: { ...base, title: 'Other', origin: 'other', tags: ['x'] } });
    const mine = (await app.inject({ url: '/api/recipes?origin=mine' })).json();
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe('Toast');
    expect((await app.inject({ url: '/api/recipes?origin=bogus' })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/tags' })).json()).toEqual(['quick', 'x']);
  });

  describe('steps', () => {
    const post = (app: ReturnType<typeof make>, steps: unknown, ingredients = base.ingredients) =>
      app.inject({ method: 'POST', url: '/api/recipes', payload: { ...base, ingredients, steps } });
    const H = 'c'.repeat(64) + '.jpg';

    it('(a) string steps are stored and returned as Steps', async () => {
      const app = make();
      const res = await post(app, ['Toast it', 'Butter it']);
      expect(res.statusCode).toBe(201);
      const expected = [
        { text: 'Toast it', imageId: null, ingredients: [] },
        { text: 'Butter it', imageId: null, ingredients: [] },
      ];
      expect(res.json().steps).toEqual(expected);
      expect((await app.inject({ url: `/api/recipes/${res.json().id}` })).json().steps).toEqual(expected);
    });

    it('(b) Step objects round-trip with imageId and links (links sorted and deduped)', async () => {
      const app = make();
      const ings = [base.ingredients[0], base.ingredients[0], base.ingredients[0]];
      const res = await post(app, [{ text: 'Mix', imageId: H, ingredients: [2, 0, 2] }], ings);
      expect(res.statusCode).toBe(201);
      expect(res.json().steps).toEqual([{ text: 'Mix', imageId: H, ingredients: [0, 2] }]);
    });

    it('(c) out-of-range, negative and fractional links are 400', async () => {
      const app = make();
      for (const n of [1, 5, -1, 1.5]) {
        const res = await post(app, [{ text: 'x', imageId: null, ingredients: [n] }]);
        expect(res.statusCode, String(n)).toBe(400);
        expect(Array.isArray(res.json().issues)).toBe(true);
      }
      expect((await post(app, [{ text: 'x', imageId: null, ingredients: [0] }])).statusCode).toBe(201);
    });

    it('(d) a bad imageId is 400', async () => {
      const app = make();
      for (const imageId of ['../x.jpg', 'abc.jpg', H.toUpperCase()]) {
        expect((await post(app, [{ text: 'x', imageId, ingredients: [] }])).statusCode, imageId).toBe(400);
      }
    });

    it('(e) a legacy row is served as a Step and saved back in Step shape', async () => {
      const db = openDb(':memory:');
      const config = { dataDir: mkdtempSync(path.join(tmpdir(), 'recipes-routes-')) } as never;
      const app = buildApp({ config, db });
      const { id } = (await post(app, ['x'])).json();
      db.prepare('UPDATE recipes SET steps_json = ? WHERE id = ?').run('["Brown the mince"]', id);
      const got = (await app.inject({ url: `/api/recipes/${id}` })).json();
      expect(got.steps).toEqual([{ text: 'Brown the mince', imageId: null, ingredients: [] }]);
      const { id: _i, createdAt, updatedAt, ...input } = got;
      const put = await app.inject({ method: 'PUT', url: `/api/recipes/${id}`, payload: input });
      expect(put.statusCode).toBe(200);
      const raw = db.prepare('SELECT steps_json FROM recipes WHERE id = ?').get(id) as { steps_json: string };
      expect(JSON.parse(raw.steps_json)).toEqual([{ text: 'Brown the mince', imageId: null, ingredients: [] }]);
    });
  });
});
