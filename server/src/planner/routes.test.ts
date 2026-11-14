import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildApp } from '../app.js';
import { openDb } from '../db.js';
import type { RecipeInput } from '../recipes/schema.js';

const make = () => buildApp({ config: { dataDir: mkdtempSync(path.join(tmpdir(), 'planner-')) } as never, db: openDb(':memory:') });
type App = ReturnType<typeof make>;

const line = (item: string, quantity: number | null = 1, unit: string | null = null) =>
  ({ group: null, quantity, unit, item, note: null });
const recipe = (title: string, ...ingredients: ReturnType<typeof line>[]): RecipeInput => ({
  title, description: null, origin: 'mine', sourceName: null, sourceUrl: null, servings: null,
  prepMinutes: null, cookMinutes: null, ingredients, steps: [], notes: null, tags: [], imageIds: [],
});
const seed = async (app: App, r: RecipeInput) =>
  (await app.inject({ method: 'POST', url: '/api/recipes', payload: r })).json().id as string;
const save = (app: App, payload: unknown) => app.inject({ method: 'PUT', url: '/api/planner/ingredient', payload: payload as never });
const ingredient = (item: string, packs: unknown[], extra: object = {}) => ({ item, shopId: null, unit: '', packs, ...extra });
const pk = (label: string, amount: number | null, pricePence: number, clubcardPence: number | null = null) =>
  ({ label, amount, pricePence, clubcardPence });
const getIngredients = async (app: App) => (await app.inject({ url: '/api/planner/ingredients' })).json();

describe('shops', () => {
  it('starts with Tesco and Butcher, adds, renames and removes', async () => {
    const app = make();
    const first = (await app.inject({ url: '/api/planner/shops' })).json().shops;
    expect(first.map((s: { name: string }) => s.name)).toEqual(['Tesco', 'Butcher']);
    const added = (await app.inject({ method: 'POST', url: '/api/planner/shops', payload: { name: 'Aldi' } })).json().shop;
    expect(added.name).toBe('Aldi');
    expect((await app.inject({ method: 'POST', url: '/api/planner/shops', payload: { name: 'aldi' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'PUT', url: `/api/planner/shops/${added.id}`, payload: { name: 'Lidl' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/planner/shops/${added.id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/api/planner/shops/${added.id}` })).statusCode).toBe(404);
  });

  it('will not remove the last shop, and ingredients of a removed shop fall back to the default', async () => {
    const app = make();
    await save(app, ingredient('beef shin', [pk('', null, 700)], { shopId: 'butcher' }));
    expect((await app.inject({ method: 'DELETE', url: '/api/planner/shops/butcher' })).statusCode).toBe(204);
    expect((await getIngredients(app)).ingredients[0].shopId).toBeNull();
    expect((await app.inject({ method: 'DELETE', url: '/api/planner/shops/tesco' })).statusCode).toBe(409);
  });
});

describe('ingredients', () => {
  it('lists every ingredient in the recipes with how many recipes use it and the usual unit', async () => {
    const app = make();
    await seed(app, recipe('A', line('onions', 2), line('carrot', 300, 'g'), line('salt')));
    await seed(app, recipe('B', line('onion', 1), line('carrot', 0.5, 'kg')));
    const { ingredients } = await getIngredients(app);
    expect(ingredients.map((i: { key: string; recipeCount: number; usualUnit: string }) => [i.key, i.recipeCount, i.usualUnit])).toEqual([
      ['carrot', 2, 'g'], ['onion', 2, ''],
    ]);
  });

  it('saves packs under the normalised name and replaces them on a second save', async () => {
    const app = make();
    await seed(app, recipe('A', line('onion')));
    expect((await save(app, ingredient('Onions', [pk('loose', 1, 30), pk('bag of 3', 3, 80, 70)]))).statusCode).toBe(200);
    await save(app, ingredient('onion', [pk('bag of 3', 3, 90)]));
    const i = (await getIngredients(app)).ingredients[0];
    expect(i.packs).toHaveLength(1);
    expect(i.packs[0]).toMatchObject({ label: 'bag of 3', amount: 3, pricePence: 90 });
  });

  it('keeps saved ingredients that no recipe uses, with a count of 0', async () => {
    const app = make();
    await save(app, ingredient('saffron', [pk('', null, 500)]));
    expect((await getIngredients(app)).ingredients[0]).toMatchObject({ key: 'saffron', recipeCount: 0 });
  });

  it('rejects nonsense', async () => {
    const app = make();
    const bad = (body: object) => save(app, body).then((r) => r.statusCode);
    expect(await bad(ingredient('x', [pk('', 1, 0)]))).toBe(400);
    expect(await bad(ingredient('x', [pk('', 1, 1.5)]))).toBe(400);
    expect(await bad(ingredient('x', [pk('', 0, 100)]))).toBe(400);
    expect(await bad(ingredient('x', [pk('', 1, 100, 150)]))).toBe(400);
    expect(await bad(ingredient('  ', []))).toBe(400);
    expect(await bad(ingredient('x', [], { unit: 'kg' }))).toBe(400);
    expect(await bad(ingredient('x', [], { shopId: 'nope' }))).toBe(400);
  });

  it('deletes an ingredient, 404 when there is none', async () => {
    const app = make();
    await save(app, ingredient('onion', [pk('', null, 100)]));
    expect((await app.inject({ method: 'DELETE', url: '/api/planner/ingredient?item=Onions' })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: '/api/planner/ingredient?item=onion' })).statusCode).toBe(404);
  });
});

describe('budget', () => {
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
  it('chooses packs for what the recipes need, and suggests recipes needing the least extra', async () => {
    const app = make();
    const base = await seed(app, recipe('Carrot soup', line('carrots', 3), line('onion', 4), line('stock')));
    await seed(app, recipe('Stew', line('carrots', 1), line('onion', 1), line('beef mince', 500, 'g'), line('potato')));
    await seed(app, recipe('Cake', line('flour'), line('eggs')));
    await save(app, ingredient('carrot', [pk('each', 1, 20), pk('bag of 4', 4, 60)]));
    await save(app, ingredient('onion', [pk('loose', 1, 30), pk('bag of 3', 3, 80)]));
    await save(app, ingredient('beef mince', [pk('500g', 500, 450)], { unit: 'g', shopId: 'butcher' }));
    await app.inject({ method: 'PUT', url: '/api/planner/budget', payload: { pence: 7000 } });

    const body = (await app.inject({ method: 'POST', url: '/api/planner/plan', payload: { recipeIds: [base] } })).json();
    expect(body.defaultShop).toBe('Tesco');
    expect(body.budgetPence).toBe(7000);
    const onion = body.basket.items.find((i: { key: string }) => i.key === 'onion');
    expect(onion.pricePence).toBe(110); // 4 onions: a bag of 3 plus one loose
    expect(body.basket.totalPence).toBe(60 + 110); // 3 carrots at 20p ties with the 60p bag of 4
    expect(body.basket.unpriced).toEqual(['stock']);
    expect(body.suggestions.map((s: { title: string }) => s.title)).toEqual(['Stew']);
    expect(body.suggestions[0].extra).toEqual([{ item: 'beef mince', shop: 'Butcher' }, { item: 'potato', shop: null }]);
  });

  it('404 for an unknown recipe, 400 for no recipes', async () => {
    const app = make();
    expect((await app.inject({ method: 'POST', url: '/api/planner/plan', payload: { recipeIds: ['nope'] } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/planner/plan', payload: { recipeIds: [] } })).statusCode).toBe(400);
  });
});

describe('POST /api/planner/add-to-shopping', () => {
  it('puts each ingredient in the section of its shop', async () => {
    const app = make();
    const id = await seed(app, recipe('Stew', line('carrots'), line('beef shin')));
    await save(app, ingredient('beef shin', [pk('', null, 700)], { shopId: 'butcher' }));
    const res = await app.inject({ method: 'POST', url: '/api/planner/add-to-shopping', payload: { recipeIds: [id] } });
    expect(res.json()).toEqual({ added: 1, alreadyOnList: [], elsewhere: [{ item: 'beef shin', shop: 'Butcher' }] });
    const list = (await app.inject({ url: '/api/shopping' })).json().items.map((i: { item: string; section: string }) => [i.item, i.section]);
    expect(list).toEqual([['carrots', 'shop'], ['beef shin', 'Butcher']]);
    const again = await app.inject({ method: 'POST', url: '/api/planner/add-to-shopping', payload: { recipeIds: [id] } });
    expect(again.json().alreadyOnList).toEqual(['Stew']);
  });

  it('404 for an unknown recipe', async () => {
    const res = await make().inject({ method: 'POST', url: '/api/planner/add-to-shopping', payload: { recipeIds: ['x'] } });
    expect(res.statusCode).toBe(404);
  });
});
