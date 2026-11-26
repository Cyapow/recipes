import type { Database } from 'better-sqlite3';

export const COURSES = ['starter', 'main', 'side', 'dessert', 'other'] as const;
export type Course = (typeof COURSES)[number];

export type MealRecipe = {
  id: string;
  /** null once the recipe has been deleted; the title below is the snapshot that keeps the meal readable. */
  recipeId: string | null;
  recipeTitle: string;
  course: Course;
  position: number;
};

/**
 * A stage holds its own text. recipeId and stepIndices are only a back-reference for "show me this step",
 * so editing or deleting the recipe never changes what the meal says.
 */
export type MealStage = {
  id: string;
  recipeId: string | null;
  /** Minutes before serving, counting back: 0 is serving, 120 is two hours before. Never negative. */
  offsetMinutes: number;
  durationMinutes: number | null;
  estimated: boolean;
  text: string;
  stepIndices: number[];
  doneAt: string | null;
  position: number;
};

export type Meal = {
  id: string;
  title: string;
  serveAt: string;
  watchOut: string[];
  scheduleStale: boolean;
  scheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
  recipes: MealRecipe[];
  stages: MealStage[];
};

export type MealSummary = {
  id: string;
  title: string;
  serveAt: string;
  recipeCount: number;
  stageCount: number;
  doneCount: number;
};

export type MealRecipeInput = { recipeId: string; course: Course };
export type NewMeal = { title: string; serveAt: string; recipes: MealRecipeInput[] };
export type StageInput = {
  recipeId: string | null;
  offsetMinutes: number;
  durationMinutes: number | null;
  estimated: boolean;
  text: string;
  stepIndices: number[];
  doneAt: string | null;
};
export type MealPatch = {
  title?: string;
  serveAt?: string;
  watchOut?: string[];
  recipes?: MealRecipeInput[];
  stages?: StageInput[];
};

type MealRow = {
  id: string;
  title: string;
  serve_at: string;
  watch_out_json: string | null;
  schedule_stale: number;
  scheduled_at: string | null;
  created_at: string;
  updated_at: string;
};
type RecipeRow = {
  id: string;
  recipe_id: string | null;
  recipe_title: string;
  course: Course;
  position: number;
};
type StageRow = {
  id: string;
  recipe_id: string | null;
  offset_minutes: number;
  duration_minutes: number | null;
  estimated: number;
  text: string;
  step_indices_json: string | null;
  done_at: string | null;
  position: number;
};

/** Forgiving about stored shapes, like normaliseSteps: invalid JSON or a non-array reads as []. Never throws. */
function parseArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

export function createMealsRepo(db: Database) {
  const getMeal = db.prepare('SELECT * FROM meals WHERE id = ?');
  const recipeRows = db.prepare('SELECT * FROM meal_recipes WHERE meal_id = ? ORDER BY position');
  const stageRows = db.prepare('SELECT * FROM meal_stages WHERE meal_id = ? ORDER BY position');
  const insertMeal = db.prepare(
    `INSERT INTO meals (id, title, serve_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
  );
  const insertRecipe = db.prepare(
    `INSERT INTO meal_recipes (id, meal_id, recipe_id, recipe_title, course, position)
     VALUES (?, ?, ?, (SELECT title FROM recipes WHERE id = ?), ?, ?)`,
  );
  const insertStage = db.prepare(
    `INSERT INTO meal_stages
       (id, meal_id, recipe_id, offset_minutes, duration_minutes, estimated, text, step_indices_json, done_at, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const deleteLinkedRecipes = db.prepare('DELETE FROM meal_recipes WHERE meal_id = ? AND recipe_id IS NOT NULL');
  const orphanRecipeIds = db.prepare(
    'SELECT id FROM meal_recipes WHERE meal_id = ? AND recipe_id IS NULL ORDER BY position',
  );
  const setRecipePosition = db.prepare('UPDATE meal_recipes SET position = ? WHERE id = ?');
  const deleteStages = db.prepare('DELETE FROM meal_stages WHERE meal_id = ?');
  const list = db.prepare(
    `SELECT m.id, m.title, m.serve_at,
       (SELECT COUNT(*) FROM meal_recipes WHERE meal_id = m.id) AS recipe_count,
       (SELECT COUNT(*) FROM meal_stages WHERE meal_id = m.id) AS stage_count,
       (SELECT COUNT(*) FROM meal_stages WHERE meal_id = m.id AND done_at IS NOT NULL) AS done_count
     FROM meals m ORDER BY m.serve_at DESC, m.created_at DESC`,
  );

  function writeRecipes(mealId: string, recipes: MealRecipeInput[]): void {
    // Rows whose recipe has been deleted (recipe_id NULL) are kept: a caller can only name live recipes, so
    // replacing everything would silently erase the deleted recipe's entry and its title snapshot, and the
    // stages that still refer to it would no longer say where they came from. They go first, in their
    // existing order, so the list does not reorder itself on every edit.
    deleteLinkedRecipes.run(mealId);
    const orphans = orphanRecipeIds.all(mealId) as { id: string }[];
    orphans.forEach((o, i) => setRecipePosition.run(i, o.id));
    // The title is read from the recipe again here, so a renamed recipe updates its snapshot on the next
    // edit. That is intended; only a deleted recipe's title is frozen.
    recipes.forEach((r, i) =>
      insertRecipe.run(crypto.randomUUID(), mealId, r.recipeId, r.recipeId, r.course, orphans.length + i),
    );
  }

  /**
   * Stages are stored furthest before serving first, whatever order the caller sent them in: an edit that appends
   * a make-ahead stage, or retimes one, must not leave the plan's day headings or the live view's "what's next"
   * out of order. applySchedule sorts the same way for a fresh draft; doing it here as well means the order of a
   * stored schedule is the server's, once, for every path that writes one. Array.sort is stable, so stages at the
   * same offset keep the order they arrived in.
   */
  function writeStages(mealId: string, stages: StageInput[]): void {
    deleteStages.run(mealId);
    [...stages]
      .sort((x, y) => y.offsetMinutes - x.offsetMinutes)
      .forEach((s, i) =>
        insertStage.run(
          crypto.randomUUID(),
          mealId,
          s.recipeId,
          s.offsetMinutes,
          s.durationMinutes,
          s.estimated ? 1 : 0,
          s.text,
          JSON.stringify(s.stepIndices),
          s.doneAt,
          i,
        ),
      );
  }

  function read(id: string): Meal | undefined {
    const m = getMeal.get(id) as MealRow | undefined;
    if (!m) return undefined;
    return {
      id: m.id,
      title: m.title,
      serveAt: m.serve_at,
      watchOut: parseArray<string>(m.watch_out_json),
      scheduleStale: m.schedule_stale === 1,
      scheduledAt: m.scheduled_at,
      createdAt: m.created_at,
      updatedAt: m.updated_at,
      recipes: (recipeRows.all(id) as RecipeRow[]).map((r) => ({
        id: r.id,
        recipeId: r.recipe_id,
        recipeTitle: r.recipe_title,
        course: r.course,
        position: r.position,
      })),
      stages: (stageRows.all(id) as StageRow[]).map((s) => ({
        id: s.id,
        recipeId: s.recipe_id,
        offsetMinutes: s.offset_minutes,
        durationMinutes: s.duration_minutes,
        estimated: s.estimated === 1,
        text: s.text,
        stepIndices: parseArray<number>(s.step_indices_json),
        doneAt: s.done_at,
        position: s.position,
      })),
    };
  }

  return {
    /** Newest serving time first. */
    list(): MealSummary[] {
      return (
        list.all() as {
          id: string;
          title: string;
          serve_at: string;
          recipe_count: number;
          stage_count: number;
          done_count: number;
        }[]
      ).map((r) => ({
        id: r.id,
        title: r.title,
        serveAt: r.serve_at,
        recipeCount: r.recipe_count,
        stageCount: r.stage_count,
        doneCount: r.done_count,
      }));
    },
    get(id: string): Meal | undefined {
      return read(id);
    },
    create: db.transaction((n: NewMeal): Meal => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      insertMeal.run(id, n.title, n.serveAt, now, now);
      writeRecipes(id, n.recipes);
      return read(id)!;
    }),
    /** Absent keys are left alone. A changed recipe set marks an existing schedule stale. */
    update: db.transaction((id: string, p: MealPatch): Meal | undefined => {
      const before = read(id);
      if (!before) return undefined;
      const sets: string[] = ['updated_at = @now'];
      const params: Record<string, unknown> = { id, now: new Date().toISOString() };
      if (p.title !== undefined) {
        sets.push('title = @title');
        params.title = p.title;
      }
      if (p.serveAt !== undefined) {
        sets.push('serve_at = @serveAt');
        params.serveAt = p.serveAt;
      }
      if (p.watchOut !== undefined) {
        sets.push('watch_out_json = @watchOut');
        params.watchOut = JSON.stringify(p.watchOut);
      }
      if (p.recipes !== undefined) {
        const stored = new Set(before.recipes.map((r) => r.recipeId).filter((x) => x !== null));
        const given = new Set(p.recipes.map((r) => r.recipeId));
        const differs = stored.size !== given.size || [...given].some((x) => !stored.has(x));
        // A meal with no stages has no schedule to have fallen behind.
        if (differs && before.stages.length > 0) sets.push('schedule_stale = 1');
        writeRecipes(id, p.recipes);
      }
      if (p.stages !== undefined) writeStages(id, p.stages);
      db.prepare(`UPDATE meals SET ${sets.join(', ')} WHERE id = @id`).run(params);
      return read(id);
    }),
    /** Writes a freshly made schedule: the stages, the notes it could not resolve, and no longer stale. */
    replaceStages: db.transaction(
      (id: string, stages: StageInput[], watchOut: string[]): Meal | undefined => {
        if (!getMeal.get(id)) return undefined;
        writeStages(id, stages);
        const now = new Date().toISOString();
        db.prepare(
          `UPDATE meals SET watch_out_json = ?, schedule_stale = 0, scheduled_at = ?, updated_at = ? WHERE id = ?`,
        ).run(JSON.stringify(watchOut), now, now, id);
        return read(id);
      },
    ),
    /**
     * Every meal with its recipes and stages, for the backup fingerprint: ordered by meal id, then position.
     * Left out are the things that move on every write without the meal meaning anything different: the
     * created, updated and scheduled times, and the ids of recipe and stage rows (writeRecipes and
     * writeStages mint new ones on each save). doneAt stays in, because a ticked stage is real work.
     */
    forFingerprint(): unknown[] {
      return (db.prepare('SELECT id FROM meals ORDER BY id').all() as { id: string }[]).map(({ id }) => {
        const m = read(id)!;
        return {
          id: m.id,
          title: m.title,
          serveAt: m.serveAt,
          watchOut: m.watchOut,
          scheduleStale: m.scheduleStale,
          recipes: m.recipes.map(({ id: _id, ...r }) => r),
          stages: m.stages.map(({ id: _id, ...s }) => s),
        };
      });
    },
    delete: db.transaction((id: string): boolean => {
      return db.prepare('DELETE FROM meals WHERE id = ?').run(id).changes > 0;
    }),
  };
}

export type MealsRepo = ReturnType<typeof createMealsRepo>;
