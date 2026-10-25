import type { Database } from 'better-sqlite3';
import crypto from 'node:crypto';
import type { Recipe, RecipeInput, RecipeSummary } from './schema.js';

type Row = {
  id: string;
  title: string;
  description: string | null;
  origin: 'mine' | 'other';
  source_name: string | null;
  source_url: string | null;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  notes: string | null;
  ingredients_json: string;
  steps_json: string;
  tags_json: string;
  image_ids_json: string;
  created_at: string;
  updated_at: string;
};

export type ListQuery = { search?: string; origin?: 'mine' | 'other'; tag?: string };

function toRecipe(r: Row): Recipe {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    origin: r.origin,
    sourceName: r.source_name,
    sourceUrl: r.source_url,
    servings: r.servings,
    prepMinutes: r.prep_minutes,
    cookMinutes: r.cook_minutes,
    ingredients: JSON.parse(r.ingredients_json),
    steps: JSON.parse(r.steps_json),
    notes: r.notes,
    tags: JSON.parse(r.tags_json),
    imageIds: JSON.parse(r.image_ids_json),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toSummary(r: Row): RecipeSummary {
  const imageIds: string[] = JSON.parse(r.image_ids_json);
  const hasTime = r.prep_minutes !== null || r.cook_minutes !== null;
  return {
    id: r.id,
    title: r.title,
    origin: r.origin,
    sourceName: r.source_name,
    tags: JSON.parse(r.tags_json),
    thumbnailId: imageIds[0] ?? null,
    totalMinutes: hasTime ? (r.prep_minutes ?? 0) + (r.cook_minutes ?? 0) : null,
  };
}

function values(id: string, i: RecipeInput) {
  return {
    id,
    title: i.title,
    description: i.description,
    origin: i.origin,
    source_name: i.sourceName,
    source_url: i.sourceUrl,
    servings: i.servings,
    prep_minutes: i.prepMinutes,
    cook_minutes: i.cookMinutes,
    notes: i.notes,
    ingredients_json: JSON.stringify(i.ingredients),
    steps_json: JSON.stringify(i.steps),
    tags_json: JSON.stringify(i.tags),
    image_ids_json: JSON.stringify(i.imageIds),
  };
}

export function createRecipeRepo(db: Database) {
  const insert = db.prepare(`INSERT INTO recipes
    (id, title, description, origin, source_name, source_url, servings, prep_minutes, cook_minutes, notes,
     ingredients_json, steps_json, tags_json, image_ids_json, created_at, updated_at)
    VALUES (@id, @title, @description, @origin, @source_name, @source_url, @servings, @prep_minutes, @cook_minutes, @notes,
     @ingredients_json, @steps_json, @tags_json, @image_ids_json, @now, @now)`);
  const updateStmt = db.prepare(`UPDATE recipes SET
    title=@title, description=@description, origin=@origin, source_name=@source_name, source_url=@source_url,
    servings=@servings, prep_minutes=@prep_minutes, cook_minutes=@cook_minutes, notes=@notes,
    ingredients_json=@ingredients_json, steps_json=@steps_json, tags_json=@tags_json,
    image_ids_json=@image_ids_json, updated_at=@now WHERE id=@id`);
  const getStmt = db.prepare('SELECT * FROM recipes WHERE id = ?');

  const repo = {
    create(input: RecipeInput): Recipe {
      const id = crypto.randomUUID();
      insert.run({ ...values(id, input), now: new Date().toISOString() });
      return repo.get(id)!;
    },
    get(id: string): Recipe | undefined {
      const row = getStmt.get(id) as Row | undefined;
      return row ? toRecipe(row) : undefined;
    },
    update(id: string, input: RecipeInput): Recipe | undefined {
      const info = updateStmt.run({ ...values(id, input), now: new Date().toISOString() });
      return info.changes ? repo.get(id) : undefined;
    },
    delete(id: string): boolean {
      return db.prepare('DELETE FROM recipes WHERE id = ?').run(id).changes > 0;
    },
    list(q: ListQuery): RecipeSummary[] {
      const where: string[] = [];
      const params: Record<string, string> = {};
      if (q.search?.trim()) {
        const esc = q.search.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
        params.search = `%${esc}%`;
        where.push(
          `(title LIKE @search ESCAPE '\\' OR ingredients_json LIKE @search ESCAPE '\\' OR tags_json LIKE @search ESCAPE '\\')`,
        );
      }
      if (q.origin) {
        params.origin = q.origin;
        where.push('origin = @origin');
      }
      if (q.tag) {
        where.push('EXISTS (SELECT 1 FROM json_each(recipes.tags_json) WHERE value = @tag)');
        params.tag = q.tag;
      }
      const sql = `SELECT * FROM recipes ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC, title`;
      return (db.prepare(sql).all(params) as Row[]).map(toSummary);
    },
    tags(): string[] {
      const rows = db
        .prepare('SELECT DISTINCT value FROM recipes, json_each(recipes.tags_json)')
        .all() as { value: string }[];
      return rows.map((r) => r.value).sort();
    },
  };
  return repo;
}
