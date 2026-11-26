import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AiClient, PlanMealRequest } from '../ai/client.js';
import { aiFailure } from '../ai/routes.js';
import type { createRecipeRepo } from '../recipes/repo.js';
import { mergeMealIngredients } from './ingredients.js';
import {
  MAX_STAGES, MAX_STAGE_MINUTES, MAX_STAGE_STEPS, MAX_STAGE_TEXT, MAX_WATCH_OUT, MAX_WATCH_OUT_TEXT,
} from './limits.js';
import { COURSES, type Meal, type MealsRepo, type MealRecipeInput } from './repo.js';
import { describeServeAt, stageWhen } from './when.js';

/**
 * The recipes sent to be scheduled, measured as JSON like MAX_REVISE_RECIPE_CHARS: every field is bounded at once,
 * and a meal is a handful of recipes at 1-3 kB each, so this is generous.
 */
export const MAX_MEAL_CHARS = 20_000;
const MAX_MEAL_RECIPES = 20;

/** An ISO instant, however the client wrote it: stored normalised so every comparison and sort agrees. */
const Instant = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'Not a date' })
  .transform((s) => new Date(s).toISOString());

const RecipeEntry = z.object({ recipeId: z.string().min(1), course: z.enum(COURSES) });
const Recipes = z.array(RecipeEntry).min(1).max(MAX_MEAL_RECIPES);
const Title = z.string().trim().min(1).max(200);

const CreateBody = z.object({ title: Title, serveAt: Instant, recipes: Recipes });
/** Exported so the draft path can be tested against the very schema an edit has to satisfy. */
export const StageBody = z.object({
  recipeId: z.string().min(1).nullable(),
  offsetMinutes: z.number().int().min(0).max(MAX_STAGE_MINUTES),
  durationMinutes: z.number().int().min(1).max(MAX_STAGE_MINUTES).nullable(),
  estimated: z.boolean(),
  text: z.string().trim().min(1).max(MAX_STAGE_TEXT),
  stepIndices: z.array(z.number().int().min(0)).max(MAX_STAGE_STEPS),
  doneAt: Instant.nullable(),
});
const PutBody = z.object({
  title: Title.optional(),
  serveAt: Instant.optional(),
  watchOut: z.array(z.string().trim().min(1).max(MAX_WATCH_OUT_TEXT)).max(MAX_WATCH_OUT).optional(),
  recipes: Recipes.optional(),
  stages: z.array(StageBody).max(MAX_STAGES).optional(),
});

export function registerMealRoutes(
  app: FastifyInstance,
  deps: { meals: MealsRepo; recipes: ReturnType<typeof createRecipeRepo>; ai: AiClient | undefined },
) {
  const { meals, recipes, ai } = deps;

  const bad = (reply: FastifyReply, error = 'Invalid request') => reply.code(400).send({ error });

  /** The recipes a meal still has, in order. A recipe deleted since is skipped; its snapshot title lives on the meal. */
  const liveRecipes = (meal: Meal) =>
    meal.recipes.flatMap((r) => {
      const recipe = r.recipeId ? recipes.get(r.recipeId) : undefined;
      return recipe ? [{ course: r.course, recipe }] : [];
    });

  /** The meal as the screen reads it: the server alone decides every clock time and day grouping. */
  const present = (meal: Meal) => ({
    ...meal,
    serveText: describeServeAt(meal.serveAt),
    stages: meal.stages.map((s) => ({ ...s, ...stageWhen(meal.serveAt, s.offsetMinutes) })),
    ingredients: mergeMealIngredients(liveRecipes(meal).map(({ recipe }) => ({ title: recipe.title, ingredients: recipe.ingredients }))),
  });

  /** A person cannot act on a constraint failure from the database, so the ids are checked first. */
  const recipeProblem = (entries: MealRecipeInput[]): string | null => {
    if (new Set(entries.map((r) => r.recipeId)).size !== entries.length) return 'A recipe can only be in a meal once';
    if (entries.some((r) => !recipes.get(r.recipeId))) return 'One of those recipes no longer exists';
    return null;
  };

  // The list reads its serving times the same way the meal page does: the server's words, in the server's timezone.
  app.get('/api/meals', async () => ({
    meals: meals.list().map((m) => ({ ...m, serveText: describeServeAt(m.serveAt) })),
  }));

  app.post('/api/meals', async (req, reply) => {
    const p = CreateBody.safeParse(req.body);
    if (!p.success) return bad(reply);
    const problem = recipeProblem(p.data.recipes);
    if (problem) return bad(reply, problem);
    return present(meals.create(p.data));
  });

  app.get<{ Params: { id: string } }>('/api/meals/:id', async (req, reply) => {
    const meal = meals.get(req.params.id);
    return meal ? present(meal) : reply.code(404).send({ error: 'Not found' });
  });

  app.put<{ Params: { id: string } }>('/api/meals/:id', async (req, reply) => {
    const p = PutBody.safeParse(req.body);
    if (!p.success) return bad(reply);
    if (!meals.get(req.params.id)) return reply.code(404).send({ error: 'Not found' });
    const problem = p.data.recipes && recipeProblem(p.data.recipes);
    if (problem) return bad(reply, problem);
    if (p.data.stages?.some((s) => s.recipeId !== null && !recipes.get(s.recipeId))) {
      return bad(reply, 'One of those stages refers to a recipe that no longer exists');
    }
    const meal = meals.update(req.params.id, p.data);
    return meal ? present(meal) : reply.code(404).send({ error: 'Not found' });
  });

  app.delete<{ Params: { id: string } }>('/api/meals/:id', async (req, reply) =>
    meals.delete(req.params.id) ? { ok: true } : reply.code(404).send({ error: 'Not found' }),
  );

  app.post<{ Params: { id: string } }>('/api/meals/:id/schedule', async (req, reply) => {
    // The order matters: nothing here may cost an AI call until every cheaper check has passed.
    if (!ai) return reply.code(503).send({ error: 'AI not configured' });
    const meal = meals.get(req.params.id);
    if (!meal) return reply.code(404).send({ error: 'Not found' });
    const replace = (req.body as { replace?: unknown } | null)?.replace === true;
    if (meal.stages.length > 0 && !replace) {
      const done = meal.stages.filter((s) => s.doneAt !== null).length;
      return reply.code(409).send({
        error: 'This meal already has a schedule. Drafting again would replace it, along with any changes and ticks.',
        code: 'has_stages',
        stages: meal.stages.length,
        done,
      });
    }

    // One pass builds both arrays: the model names a recipe by position and the server maps it back to an id by
    // position, so if these ever drifted a stage would silently lose its recipe.
    const recipeIds: string[] = [];
    const planRecipes: PlanMealRequest['recipes'] = [];
    for (const { course, recipe } of liveRecipes(meal)) {
      const { id, createdAt: _c, updatedAt: _u, favouritedBy: _f, ...input } = recipe;
      recipeIds.push(id);
      planRecipes.push({ course, recipe: input });
    }
    if (planRecipes.length === 0) return bad(reply, 'None of the recipes in this meal exist any more');
    if (JSON.stringify(planRecipes).length > MAX_MEAL_CHARS) {
      return reply.code(413).send({ error: 'This meal is too long to schedule' });
    }

    let plan: Awaited<ReturnType<AiClient['planMeal']>>;
    try {
      plan = await ai.planMeal({
        title: meal.title,
        // Local words, not a UTC instant: "13:00Z" does not tell the model it is lunchtime here.
        serveAt: describeServeAt(meal.serveAt),
        recipes: planRecipes,
        recipeIds,
      });
    } catch (err) {
      return aiFailure(err, reply);
    }
    // Outside the try: a storage failure after the AI has been paid for is not an AI failure, and calling it one
    // would invite a retry that pays again.
    const saved = meals.replaceStages(meal.id, plan.stages, plan.watchOut);
    return saved ? present(saved) : reply.code(404).send({ error: 'Not found' });
  });
}
