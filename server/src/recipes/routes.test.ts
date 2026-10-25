import { describe, it, expect } from 'vitest';
import { buildApp } from '../app.js';
import { openDb } from '../db.js';
import type { RecipeInput } from './schema.js';

function make() {
  const config = {} as never;
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
  steps: ['Toast it'],
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
});
