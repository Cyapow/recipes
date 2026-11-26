import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDb } from '../db.js';
import { createFavouritesRepo } from '../favourites/repo.js';
import { createRecipeRepo } from '../recipes/repo.js';
import { createMealsRepo, type MealsRepo, type StageInput } from './repo.js';

describe('meals repo', () => {
  let db: Database;
  let repo: MealsRepo;
  let recipes: ReturnType<typeof createRecipeRepo>;
  let a: string;
  let b: string;
  let c: string;

  const makeRecipe = (title: string) =>
    recipes.create({
      title,
      description: null,
      origin: 'mine',
      brand: 'Mine',
      sourceName: null,
      sourceUrl: null,
      servings: 4,
      prepMinutes: 10,
      cookMinutes: 60,
      ingredients: [],
      steps: [],
      notes: null,
      tags: [],
      imageIds: [],
    }).id;

  const stage = (over: Partial<StageInput> = {}): StageInput => ({
    recipeId: a,
    offsetMinutes: 120,
    durationMinutes: 30,
    estimated: false,
    text: 'Take the lamb out to come up to room temperature',
    stepIndices: [0, 1],
    doneAt: null,
    ...over,
  });

  const newMeal = (title = 'Sunday lunch', serveAt = '2026-11-29T13:00:00.000Z') =>
    repo.create({
      title,
      serveAt,
      recipes: [
        { recipeId: a, course: 'main' },
        { recipeId: b, course: 'side' },
      ],
    });

  const count = (table: string, mealId: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE meal_id = ?`).get(mealId) as { n: number }).n;

  beforeEach(() => {
    db = openDb(':memory:');
    recipes = createRecipeRepo(db, createFavouritesRepo(db));
    repo = createMealsRepo(db);
    a = makeRecipe('Roast lamb');
    b = makeRecipe('Roast potatoes');
    c = makeRecipe('Trifle');
  });

  it('creates a meal with its recipes, snapshotting each title', () => {
    const meal = newMeal();
    expect(meal.recipes.map((r) => [r.recipeTitle, r.course, r.position])).toEqual([
      ['Roast lamb', 'main', 0],
      ['Roast potatoes', 'side', 1],
    ]);
    expect(meal.stages).toEqual([]);
    expect(meal.watchOut).toEqual([]);
    expect(meal.scheduleStale).toBe(false);
    expect(meal.scheduledAt).toBeNull();
  });

  it('replaceStages writes stages in order with their own text and clears the stale flag', () => {
    const meal = newMeal();
    const got = repo.replaceStages(
      meal.id,
      [stage(), stage({ recipeId: b, offsetMinutes: 60, text: 'Parboil the potatoes', stepIndices: [2] })],
      ['the oven is busy'],
    )!;
    expect(got.stages.map((s) => s.position)).toEqual([0, 1]);
    expect(got.stages.map((s) => s.text)).toEqual([
      'Take the lamb out to come up to room temperature',
      'Parboil the potatoes',
    ]);
    expect(got.stages[0]!.stepIndices).toEqual([0, 1]);
    expect(got.watchOut).toEqual(['the oven is busy']);
    expect(got.scheduledAt).not.toBeNull();
    expect(got.scheduleStale).toBe(false);
    expect(repo.replaceStages('nope', [], [])).toBeUndefined();
  });

  it('stores stages furthest before serving first, however they were sent', () => {
    const meal = newMeal();
    const got = repo.update(meal.id, {
      stages: [
        stage({ offsetMinutes: 180, text: 'Season' }),
        stage({ offsetMinutes: 60, text: 'Roast' }),
        stage({ offsetMinutes: 10, text: 'Carve' }),
        // Appended by hand, as the plan view's own form does: it belongs two days before everything else.
        stage({ offsetMinutes: 2880, text: 'Make the stock' }),
      ],
    })!;
    expect(got.stages.map((s) => [s.offsetMinutes, s.text])).toEqual([
      [2880, 'Make the stock'],
      [180, 'Season'],
      [60, 'Roast'],
      [10, 'Carve'],
    ]);
    expect(got.stages.map((s) => s.position)).toEqual([0, 1, 2, 3]);
  });

  it('keeps the order stages arrived in where their offsets are equal', () => {
    const meal = newMeal();
    const texts = ['first', 'second', 'third'];
    const got = repo.update(meal.id, { stages: texts.map((text) => stage({ offsetMinutes: 90, text })) })!;
    expect(got.stages.map((s) => s.text)).toEqual(texts);
  });

  it('update leaves absent keys alone and ticks a stage through stages', () => {
    const meal = newMeal();
    repo.replaceStages(meal.id, [stage()], ['careful']);

    const renamed = repo.update(meal.id, { title: 'Lunch' })!;
    expect(renamed.title).toBe('Lunch');
    expect(renamed.serveAt).toBe('2026-11-29T13:00:00.000Z');
    expect(renamed.stages).toHaveLength(1);
    expect(renamed.watchOut).toEqual(['careful']);
    expect(renamed.recipes).toHaveLength(2);

    const ticked = repo.update(meal.id, {
      stages: [stage({ doneAt: '2026-11-29T10:00:00.000Z' })],
    })!;
    expect(ticked.stages[0]!.doneAt).toBe('2026-11-29T10:00:00.000Z');
    expect(ticked.title).toBe('Lunch');
    expect(repo.update('nope', { title: 'x' })).toBeUndefined();
  });

  it('changing the recipe set while stages exist sets scheduleStale', () => {
    const meal = newMeal();
    repo.replaceStages(meal.id, [stage()], []);

    const same = repo.update(meal.id, {
      recipes: [
        { recipeId: a, course: 'main' },
        { recipeId: b, course: 'side' },
      ],
    })!;
    expect(same.scheduleStale).toBe(false);

    const afterAddingARecipe = repo.update(meal.id, {
      recipes: [
        { recipeId: a, course: 'main' },
        { recipeId: b, course: 'side' },
        { recipeId: c, course: 'dessert' },
      ],
    })!;
    expect(afterAddingARecipe.scheduleStale).toBe(true);
    expect(afterAddingARecipe.recipes.map((r) => r.recipeTitle)).toEqual([
      'Roast lamb',
      'Roast potatoes',
      'Trifle',
    ]);

    const withNoStages = newMeal('Supper');
    const changed = repo.update(withNoStages.id, { recipes: [{ recipeId: c, course: 'dessert' }] })!;
    expect(changed.recipes.map((r) => r.recipeTitle)).toEqual(['Trifle']);
    expect(changed.scheduleStale).toBe(false);
  });

  it('a stale schedule is cleared by replaceStages', () => {
    const meal = newMeal();
    repo.replaceStages(meal.id, [stage()], []);
    expect(repo.update(meal.id, { recipes: [{ recipeId: c, course: 'dessert' }] })!.scheduleStale).toBe(true);
    expect(repo.replaceStages(meal.id, [stage({ recipeId: c })], [])!.scheduleStale).toBe(false);
  });

  it('deleting a recipe leaves the meal readable, with no link', () => {
    const meal = newMeal();
    repo.replaceStages(meal.id, [stage()], []);
    expect(() => recipes.delete(a)).not.toThrow();
    const got = repo.get(meal.id)!;
    expect(got.recipes[0]!.recipeId).toBeNull();
    expect(got.recipes[0]!.recipeTitle).toBe('Roast lamb');
    expect(got.recipes[1]!.recipeId).toBe(b);
    expect(got.stages[0]!.recipeId).toBeNull();
    expect(got.stages[0]!.text).toBe('Take the lamb out to come up to room temperature');
  });

  it('editing the recipe set keeps the entry of a deleted recipe, first, with its title', () => {
    const meal = newMeal();
    repo.replaceStages(meal.id, [stage()], []);
    recipes.delete(a);
    const got = repo.update(meal.id, {
      recipes: [
        { recipeId: b, course: 'side' },
        { recipeId: c, course: 'dessert' },
      ],
    })!;
    expect(got.recipes.map((r) => [r.recipeId, r.recipeTitle, r.position])).toEqual([
      [null, 'Roast lamb', 0],
      [b, 'Roast potatoes', 1],
      [c, 'Trifle', 2],
    ]);
    // a second edit does not duplicate or reorder it
    const again = repo.update(meal.id, { recipes: [{ recipeId: b, course: 'main' }] })!;
    expect(again.recipes.map((r) => [r.recipeTitle, r.position])).toEqual([
      ['Roast lamb', 0],
      ['Roast potatoes', 1],
    ]);
  });

  it('changing only a recipe course does not mark the schedule stale', () => {
    const meal = newMeal();
    repo.replaceStages(meal.id, [stage()], []);
    const got = repo.update(meal.id, {
      recipes: [
        { recipeId: a, course: 'starter' },
        { recipeId: b, course: 'side' },
      ],
    })!;
    expect(got.recipes[0]!.course).toBe('starter');
    expect(got.scheduleStale).toBe(false);
  });

  it('a meal whose recipes have all been deleted still lists and reads', () => {
    const meal = newMeal();
    repo.replaceStages(meal.id, [stage()], []);
    recipes.delete(a);
    recipes.delete(b);
    expect(repo.list().map((m) => [m.title, m.recipeCount, m.stageCount])).toEqual([['Sunday lunch', 2, 1]]);
    const got = repo.get(meal.id)!;
    expect(got.recipes.map((r) => [r.recipeId, r.recipeTitle])).toEqual([
      [null, 'Roast lamb'],
      [null, 'Roast potatoes'],
    ]);
    expect(got.stages[0]!.text).toBe('Take the lamb out to come up to room temperature');
  });

  it('naming a recipe that does not exist throws', () => {
    expect(() => repo.create({ title: 'x', serveAt: '2026-11-29T13:00:00.000Z', recipes: [{ recipeId: 'nope', course: 'main' }] })).toThrow(/NOT NULL constraint failed: meal_recipes.recipe_title/);
  });

  it('deleting a meal takes its recipes and stages with it', () => {
    const meal = newMeal();
    repo.replaceStages(meal.id, [stage()], []);
    expect(repo.delete(meal.id)).toBe(true);
    expect(repo.delete(meal.id)).toBe(false);
    expect(repo.get(meal.id)).toBeUndefined();
    expect(count('meal_recipes', meal.id)).toBe(0);
    expect(count('meal_stages', meal.id)).toBe(0);
  });

  it('reads stored JSON defensively', () => {
    const meal = newMeal();
    repo.replaceStages(meal.id, [stage()], []);
    db.prepare('UPDATE meals SET watch_out_json = ? WHERE id = ?').run('{"a":1}', meal.id);
    db.prepare('UPDATE meal_stages SET step_indices_json = ? WHERE meal_id = ?').run('not json', meal.id);
    const got = repo.get(meal.id)!;
    expect(got.watchOut).toEqual([]);
    expect(got.stages[0]!.stepIndices).toEqual([]);
    db.prepare('UPDATE meals SET watch_out_json = NULL WHERE id = ?').run(meal.id);
    expect(repo.get(meal.id)!.watchOut).toEqual([]);
  });

  it('list summarises each meal, newest serving time first, counting done stages', () => {
    const early = newMeal('Early', '2026-11-22T13:00:00.000Z');
    const late = newMeal('Late', '2026-11-29T13:00:00.000Z');
    repo.replaceStages(early.id, [stage()], []);
    repo.replaceStages(
      late.id,
      [stage({ doneAt: '2026-11-28T09:00:00.000Z' }), stage({ offsetMinutes: 30 }), stage({ offsetMinutes: 0 })],
      [],
    );
    expect(repo.list().map((m) => [m.title, m.recipeCount, m.stageCount, m.doneCount])).toEqual([
      ['Late', 2, 3, 1],
      ['Early', 2, 1, 0],
    ]);
  });
});
