process.env.TZ = 'Europe/London';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from 'better-sqlite3';
import { buildApp } from '../app.js';
import { openDb } from '../db.js';
import { signedIn } from '../auth/testing.js';
import { AiRefusedError, AiRequestError, type AiClient, type PlanMealRequest } from '../ai/client.js';
import { createFavouritesRepo } from '../favourites/repo.js';
import { createRecipeRepo } from '../recipes/repo.js';
import { createMealsRepo, type StageInput } from './repo.js';
import { MAX_MEAL_CHARS } from './routes.js';

const SERVE = '2026-11-29T13:00:00.000Z';

describe('meal routes', () => {
  let db: Database;
  let recipes: ReturnType<typeof createRecipeRepo>;
  let a: string;
  let b: string;
  let planMeal: ReturnType<typeof vi.fn>;

  const makeRecipe = (title: string, notes: string | null = null) =>
    recipes.create({
      title, description: null, origin: 'mine', brand: 'Mine', sourceName: null, sourceUrl: null,
      servings: 4, prepMinutes: 10, cookMinutes: 60,
      ingredients: [{ group: null, quantity: 500, unit: 'g', item: 'lamb', note: null }],
      steps: ['Season', 'Roast'].map((text) => ({ text, imageId: null, ingredients: [] })),
      notes, tags: [], imageIds: [],
    }).id;

  const stage = (over: Partial<StageInput> = {}): StageInput => ({
    recipeId: a, offsetMinutes: 120, durationMinutes: 30, estimated: false, text: 'Season the lamb', stepIndices: [0], doneAt: null, ...over,
  });
  const makePlan = () => ({
    stages: [stage(), stage({ offsetMinutes: 2880, text: 'Salt it', recipeId: b })],
    watchOut: ['Oven is shared'],
    provider: 'openai' as const,
    model: 'gpt-x',
  });
  let plan: ReturnType<typeof makePlan>;

  const make = (ai: AiClient | null = { planMeal } as never) =>
    signedIn(buildApp({ config: { dataDir: '/nonexistent' } as never, db, ai: ai ?? undefined }), db);
  const create = (app: ReturnType<typeof make>, over: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST', url: '/api/meals',
      payload: { title: 'Sunday lunch', serveAt: SERVE, recipes: [{ recipeId: a, course: 'main' }, { recipeId: b, course: 'dessert' }], ...over },
    });
  const schedule = (app: ReturnType<typeof make>, id: string, payload: unknown = {}) =>
    app.inject({ method: 'POST', url: `/api/meals/${id}/schedule`, payload: payload as never });
  const created = async (app: ReturnType<typeof make>) => (await create(app)).json().id as string;

  beforeEach(() => {
    db = openDb(':memory:');
    recipes = createRecipeRepo(db, createFavouritesRepo(db));
    a = makeRecipe('Roast lamb');
    b = makeRecipe('Sticky toffee');
    plan = makePlan();
    planMeal = vi.fn().mockResolvedValue(plan);
  });

  it('creates, reads back and lists a meal', async () => {
    const app = make();
    const res = await create(app);
    expect(res.statusCode).toBe(200);
    const id = res.json().id as string;
    const got = await app.inject({ method: 'GET', url: `/api/meals/${id}` });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toMatchObject({ id, title: 'Sunday lunch', serveAt: SERVE });
    expect(got.json().recipes.map((r: { recipeTitle: string }) => r.recipeTitle)).toEqual(['Roast lamb', 'Sticky toffee']);
    const list = await app.inject({ method: 'GET', url: '/api/meals' });
    expect(list.json().meals).toEqual([{ id, title: 'Sunday lunch', serveAt: SERVE, recipeCount: 2, stageCount: 0, doneCount: 0 }]);
  });

  it('a meal read back carries its merged ingredients and each stage at and dayGroup', async () => {
    const app = make();
    const id = await created(app);
    createMealsRepo(db).update(id, { stages: plan.stages });
    const got = (await app.inject({ method: 'GET', url: `/api/meals/${id}` })).json();
    expect(got.serveText).toBe('Sunday 29 November 2026, 13:00');
    expect(got.ingredients).toHaveLength(1);
    expect(got.ingredients[0]).toMatchObject({ item: 'lamb', unit: 'g', quantity: 1000 });
    expect(got.stages.map((s: { at: string; dayGroup: string }) => [s.at, s.dayGroup])).toEqual([
      ['2026-11-29T11:00:00.000Z', 'on the day'],
      ['2026-11-27T13:00:00.000Z', 'two days before'],
    ]);
  });

  it('400s a create with no recipes, an unknown course, or a serveAt that is not a date', async () => {
    const app = make();
    expect((await create(app, { recipes: [] })).statusCode).toBe(400);
    expect((await create(app, { recipes: [{ recipeId: a, course: 'brunch' }] })).statusCode).toBe(400);
    expect((await create(app, { serveAt: 'soon' })).statusCode).toBe(400);
    expect((await create(app, { title: '  ' })).statusCode).toBe(400);
  });

  it('400s, in plain words, a recipe that does not exist or is named twice', async () => {
    const app = make();
    const missing = await create(app, { recipes: [{ recipeId: 'nope', course: 'main' }] });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error).toBe('One of those recipes no longer exists');
    const twice = await create(app, { recipes: [{ recipeId: a, course: 'main' }, { recipeId: a, course: 'side' }] });
    expect(twice.statusCode).toBe(400);
    expect(twice.json().error).toBe('A recipe can only be in a meal once');
    const id = await created(app);
    const put = await app.inject({ method: 'PUT', url: `/api/meals/${id}`, payload: { recipes: [{ recipeId: 'nope', course: 'main' }] } });
    expect(put.statusCode).toBe(400);
  });

  it('404s an unknown meal on get, put, delete and schedule', async () => {
    const app = make();
    expect((await app.inject({ method: 'GET', url: '/api/meals/nope' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: '/api/meals/nope', payload: { title: 'x' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/api/meals/nope' })).statusCode).toBe(404);
    expect((await schedule(app, 'nope')).statusCode).toBe(404);
    expect(planMeal).not.toHaveBeenCalled();
  });

  it('deletes a meal', async () => {
    const app = make();
    const id = await created(app);
    expect((await app.inject({ method: 'DELETE', url: `/api/meals/${id}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/meals/${id}` })).statusCode).toBe(404);
  });

  it('schedules a meal and stores the drafted stages', async () => {
    const app = make();
    const id = await created(app);
    const res = await schedule(app, id);
    expect(res.statusCode).toBe(200);
    expect(planMeal).toHaveBeenCalledTimes(1);
    expect(res.json().stages).toHaveLength(2);
    expect(res.json().stages[0]).toMatchObject({ text: 'Season the lamb', at: '2026-11-29T11:00:00.000Z', dayGroup: 'on the day' });
    expect(res.json().watchOut).toEqual(['Oven is shared']);
    const stored = (await app.inject({ method: 'GET', url: `/api/meals/${id}` })).json();
    expect(stored.stages).toHaveLength(2);
    expect(stored.scheduleStale).toBe(false);
  });

  it('sends the recipes and their ids from one pass, with the serving time in local words', async () => {
    const app = make();
    const id = await created(app);
    await schedule(app, id);
    const sent = planMeal.mock.calls[0]![0] as PlanMealRequest;
    expect(sent.recipeIds).toEqual([a, b]);
    expect(sent.recipes.map((r) => r.recipe.title)).toEqual(['Roast lamb', 'Sticky toffee']);
    expect(sent.recipes.map((r) => r.course)).toEqual(['main', 'dessert']);
    expect(sent.serveAt).toBe('Sunday 29 November 2026, 13:00');
  });

  it('skips a recipe that has been deleted, keeping the ids and recipes aligned', async () => {
    const app = make();
    const id = await created(app);
    recipes.delete(a);
    await schedule(app, id);
    const sent = planMeal.mock.calls[0]![0] as PlanMealRequest;
    expect(sent.recipeIds).toEqual([b]);
    expect(sent.recipes.map((r) => r.recipe.title)).toEqual(['Sticky toffee']);
  });

  it('409s a second schedule, naming what would be lost, and makes no AI call', async () => {
    const app = make();
    const id = await created(app);
    createMealsRepo(db).update(id, { stages: [stage(), stage({ doneAt: '2026-11-29T09:00:00.000Z' })] });
    const res = await schedule(app, id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'has_stages', stages: 2, done: 1 });
    expect(planMeal).not.toHaveBeenCalled();
  });

  it('replaces the stages when told to, dropping the ticks', async () => {
    const app = make();
    const id = await created(app);
    createMealsRepo(db).update(id, { stages: [stage({ doneAt: '2026-11-29T09:00:00.000Z' })] });
    const res = await schedule(app, id, { replace: true });
    expect(res.statusCode).toBe(200);
    expect(planMeal).toHaveBeenCalledTimes(1);
    const after = (await app.inject({ method: 'GET', url: `/api/meals/${id}` })).json();
    expect(after.stages).toHaveLength(2);
    expect(after.stages.every((s: { doneAt: string | null }) => s.doneAt === null)).toBe(true);
  });

  it('503s a schedule when no AI is configured, without touching the meal', async () => {
    const app = make(null);
    const id = await created(app);
    const res = await schedule(app, id);
    expect(res.statusCode).toBe(503);
    expect((await app.inject({ method: 'GET', url: `/api/meals/${id}` })).json().stages).toEqual([]);
  });

  it('413s a meal whose recipes exceed MAX_MEAL_CHARS, without calling the AI', async () => {
    const big = makeRecipe('Huge', 'x'.repeat(MAX_MEAL_CHARS));
    const app = make();
    const id = (await create(app, { recipes: [{ recipeId: big, course: 'main' }] })).json().id as string;
    const res = await schedule(app, id);
    expect(res.statusCode).toBe(413);
    expect(planMeal).not.toHaveBeenCalled();
  });

  it('answers the first failing check when several fail at once, and calls the AI for none', async () => {
    const big = makeRecipe('Huge', 'x'.repeat(MAX_MEAL_CHARS));
    const noAi = make(null);
    const app = make();
    // Oversized and already scheduled: 409 outranks 413.
    const id = (await create(app, { recipes: [{ recipeId: big, course: 'main' }] })).json().id as string;
    createMealsRepo(db).update(id, { stages: [stage()] });
    expect((await schedule(app, id)).statusCode).toBe(409);
    // No AI as well: 503 outranks 409. Unknown meal and no AI: 503 outranks 404.
    expect((await schedule(noAi, id)).statusCode).toBe(503);
    expect((await schedule(noAi, 'nope')).statusCode).toBe(503);
    expect(planMeal).not.toHaveBeenCalled();
  });

  it('400s a schedule when none of the meal\'s recipes exist any more, without calling the AI', async () => {
    const app = make();
    const id = (await create(app, { recipes: [{ recipeId: a, course: 'main' }] })).json().id as string;
    recipes.delete(a);
    const res = await schedule(app, id);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('None of the recipes in this meal exist any more');
    expect(planMeal).not.toHaveBeenCalled();
  });

  it('maps a provider failure to its plain-language sentence', async () => {
    const app = make();
    const id = await created(app);
    planMeal.mockRejectedValueOnce(new AiRequestError('no_credit'));
    const res = await schedule(app, id);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'The AI account is out of credit. Add credit or switch provider.', code: 'no_credit' });
    planMeal.mockRejectedValueOnce(new AiRefusedError());
    expect((await schedule(app, id)).json().code).toBe('other');
    expect((await app.inject({ method: 'GET', url: `/api/meals/${id}` })).json().stages).toEqual([]);
  });

  it('put retimes the meal and ticks a stage', async () => {
    const app = make();
    const id = await created(app);
    await schedule(app, id);
    const got = (await app.inject({ method: 'GET', url: `/api/meals/${id}` })).json();
    const stages = got.stages.map((s: StageInput & { id: string }, i: number) => ({
      recipeId: s.recipeId, offsetMinutes: s.offsetMinutes, durationMinutes: s.durationMinutes, estimated: s.estimated,
      text: s.text, stepIndices: s.stepIndices, doneAt: i === 0 ? '2026-11-27T10:00:00.000Z' : null,
    }));
    const res = await app.inject({
      method: 'PUT', url: `/api/meals/${id}`,
      payload: { title: 'Later lunch', serveAt: '2026-11-29T15:00:00+00:00', stages },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ title: 'Later lunch', serveAt: '2026-11-29T15:00:00.000Z' });
    expect(res.json().stages[0].doneAt).toBe('2026-11-27T10:00:00.000Z');
    expect(res.json().stages[0].at).toBe('2026-11-29T13:00:00.000Z');
  });

  it('put 400s a stage with a negative offset or a recipe that does not exist', async () => {
    const app = make();
    const id = await created(app);
    const put = (s: unknown) => app.inject({ method: 'PUT', url: `/api/meals/${id}`, payload: { stages: [s] } });
    expect((await put(stage({ offsetMinutes: -5 }))).statusCode).toBe(400);
    expect((await put(stage({ recipeId: 'nope' }))).statusCode).toBe(400);
    expect((await put(stage({ text: ' ' }))).statusCode).toBe(400);
    expect((await put(stage())).statusCode).toBe(200);
  });

  it('every meal route is behind the auth guard', async () => {
    const app = make();
    const calls: [string, string][] = [
      ['GET', '/api/meals'], ['POST', '/api/meals'], ['GET', '/api/meals/x'],
      ['PUT', '/api/meals/x'], ['DELETE', '/api/meals/x'], ['POST', '/api/meals/x/schedule'],
    ];
    for (const [method, url] of calls) {
      const res = await app.injectAnon({ method: method as 'GET', url });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });
});
