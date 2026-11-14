import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildApp } from '../app.js';
import { openDb } from '../db.js';
import type { RecipeInput } from '../recipes/schema.js';

const make = () => buildApp({ config: { dataDir: mkdtempSync(path.join(tmpdir(), 'planner-')) } as never, db: openDb(':memory:') });
type App = ReturnType<typeof make>;

const recipe = (title: string, ...items: string[]): RecipeInput => ({
  title, description: null, origin: 'mine', sourceName: null, sourceUrl: null, servings: null,
  prepMinutes: null, cookMinutes: null,
  ingredients: items.map((item) => ({ group: null, quantity: 1, unit: null, item, note: null })),
  steps: [], notes: null, tags: [], imageIds: [],
});
const seed = async (app: App, r: RecipeInput) =>
  (await app.inject({ method: 'POST', url: '/api/recipes', payload: r })).json().id as string;
const put = (app: App, payload: unknown) => app.inject({ method: 'PUT', url: '/api/planner/prices', payload: payload as never });

describe('planner prices and budget', () => {
  it('saves a price under the normalised name and replaces it on a second save', async () => {
    const app = make();
    expect((await put(app, { item: 'Carrots', pricePence: 80, clubcardPence: null })).statusCode).toBe(200);
    await put(app, { item: 'carrot', pricePence: 90, clubcardPence: 75 });
    const { prices } = (await app.inject({ url: '/api/planner/prices' })).json();
    expect(prices).toHaveLength(1);
    expect(prices[0]).toMatchObject({ key: 'carrot', pricePence: 90, clubcardPence: 75, source: 'manual' });
  });

  it('rejects nonsense prices and a Clubcard price above the normal one', async () => {
    const app = make();
    expect((await put(app, { item: 'x', pricePence: 0, clubcardPence: null })).statusCode).toBe(400);
    expect((await put(app, { item: 'x', pricePence: 1.5, clubcardPence: null })).statusCode).toBe(400);
    expect((await put(app, { item: '  ', pricePence: 100, clubcardPence: null })).statusCode).toBe(400);
    expect((await put(app, { item: 'x', pricePence: 100, clubcardPence: 150 })).statusCode).toBe(400);
  });

  it('deletes a price, 404 when there is none', async () => {
    const app = make();
    await put(app, { item: 'onion', pricePence: 100, clubcardPence: null });
    expect((await app.inject({ method: 'DELETE', url: '/api/planner/prices?item=Onions' })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: '/api/planner/prices?item=onion' })).statusCode).toBe(404);
  });

  it('stores, returns and clears the meals budget', async () => {
    const app = make();
    expect((await app.inject({ url: '/api/planner/budget' })).json()).toEqual({ pence: null });
    await app.inject({ method: 'PUT', url: '/api/planner/budget', payload: { pence: 7000 } });
    expect((await app.inject({ url: '/api/planner/budget' })).json()).toEqual({ pence: 7000 });
    await app.inject({ method: 'PUT', url: '/api/planner/budget', payload: { pence: null } });
    expect((await app.inject({ url: '/api/planner/budget' })).json()).toEqual({ pence: null });
    expect((await app.inject({ method: 'PUT', url: '/api/planner/budget', payload: { pence: -5 } })).statusCode).toBe(400);
  });
});

describe('POST /api/planner/plan', () => {
  it('returns the basket, the budget and suggestions needing the least extra shopping', async () => {
    const app = make();
    const base = await seed(app, recipe('Carrot soup', 'carrots', 'onion', 'stock'));
    await seed(app, recipe('Stew', 'carrots', 'onion', 'beef mince', 'potato'));
    await seed(app, recipe('Cake', 'flour', 'eggs'));
    await put(app, { item: 'carrot', pricePence: 80, clubcardPence: null });
    await app.inject({ method: 'PUT', url: '/api/planner/budget', payload: { pence: 7000 } });

    const res = await app.inject({ method: 'POST', url: '/api/planner/plan', payload: { recipeIds: [base] } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.budgetPence).toBe(7000);
    expect(body.basket.totalPence).toBe(80);
    expect(body.basket.unpriced).toEqual(['onion', 'stock']);
    expect(body.suggestions.map((s: { title: string }) => s.title)).toEqual(['Stew']);
    expect(body.suggestions[0].extra).toEqual(['beef mince', 'potato']);
  });

  it('404 for an unknown recipe, 400 for no recipes', async () => {
    const app = make();
    expect((await app.inject({ method: 'POST', url: '/api/planner/plan', payload: { recipeIds: ['nope'] } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/planner/plan', payload: { recipeIds: [] } })).statusCode).toBe(400);
  });
});
