import type { Database } from 'better-sqlite3';
import crypto from 'node:crypto';
import { normaliseTags, type Tag, type TagGroup } from './categories.js';
import { normaliseSteps, type Recipe, type RecipeInput, type RecipeSummary } from './schema.js';

type Row = {
  id: string;
  title: string;
  description: string | null;
  origin: 'mine' | 'other';
  brand: string | null;
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

export type ListQuery = { search?: string; origin?: 'mine' | 'other'; brands?: string[]; tags?: Tag[] };

export type Facets = {
  brands: { name: string; count: number }[];
  tags: { group: TagGroup; name: string; count: number }[];
};

function parseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function toRecipe(r: Row): Recipe {
  const ingredients = JSON.parse(r.ingredients_json);
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    origin: r.origin,
    brand: r.brand,
    sourceName: r.source_name,
    sourceUrl: r.source_url,
    servings: r.servings,
    prepMinutes: r.prep_minutes,
    cookMinutes: r.cook_minutes,
    ingredients,
    steps: normaliseSteps(parseJson(r.steps_json), Array.isArray(ingredients) ? ingredients.length : 0),
    notes: r.notes,
    tags: normaliseTags(parseJson(r.tags_json)),
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
    brand: r.brand,
    sourceName: r.source_name,
    tags: normaliseTags(parseJson(r.tags_json)),
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
    brand: i.brand,
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
    (id, title, description, origin, brand, source_name, source_url, servings, prep_minutes, cook_minutes, notes,
     ingredients_json, steps_json, tags_json, image_ids_json, created_at, updated_at)
    VALUES (@id, @title, @description, @origin, @brand, @source_name, @source_url, @servings, @prep_minutes, @cook_minutes, @notes,
     @ingredients_json, @steps_json, @tags_json, @image_ids_json, @now, @now)`);
  const updateStmt = db.prepare(`UPDATE recipes SET
    title=@title, description=@description, origin=@origin, brand=@brand, source_name=@source_name, source_url=@source_url,
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
          `(title LIKE @search ESCAPE '\\' OR ingredients_json LIKE @search ESCAPE '\\' OR brand LIKE @search ESCAPE '\\' OR EXISTS (SELECT 1 FROM json_each(recipes.tags_json) WHERE json_extract(value, '$.name') LIKE @search ESCAPE '\\'))`,
        );
      }
      if (q.origin) {
        params.origin = q.origin;
        where.push('origin = @origin');
      }
      if (q.brands?.length) {
        const names = q.brands.map((b, i) => {
          params[`b${i}`] = b.toLowerCase();
          return `@b${i}`;
        });
        where.push(`lower(brand) IN (${names.join(', ')})`);
      }
      const byGroup = new Map<TagGroup, string[]>();
      for (const t of q.tags ?? []) byGroup.set(t.group, [...(byGroup.get(t.group) ?? []), t.name]);
      let g = 0;
      for (const [group, names] of byGroup) {
        params[`g${g}`] = group;
        const marks = names.map((n, i) => {
          params[`t${g}_${i}`] = n.toLowerCase();
          return `@t${g}_${i}`;
        });
        where.push(
          `EXISTS (SELECT 1 FROM json_each(recipes.tags_json) t WHERE json_extract(t.value, '$.group') = @g${g} AND lower(json_extract(t.value, '$.name')) IN (${marks.join(', ')}))`,
        );
        g++;
      }
      const sql = `SELECT * FROM recipes ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC, title`;
      return (db.prepare(sql).all(params) as Row[]).map(toSummary);
    },
    facets(): Facets {
      const brands = db
        .prepare(`SELECT brand AS name, COUNT(*) AS count FROM recipes WHERE brand IS NOT NULL GROUP BY brand ORDER BY count DESC, name`)
        .all() as Facets['brands'];
      const rows = db.prepare('SELECT tags_json FROM recipes').all() as { tags_json: string }[];
      const counts = new Map<string, { group: TagGroup; name: string; count: number }>();
      for (const r of rows) {
        for (const t of normaliseTags(parseJson(r.tags_json))) {
          const key = `${t.group}:${t.name.toLowerCase()}`;
          const hit = counts.get(key);
          if (hit) hit.count++;
          else counts.set(key, { group: t.group, name: t.name, count: 1 });
        }
      }
      const tags = [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      return { brands, tags };
    },
    brandForHost(host: string): string | null {
      const want = host.toLowerCase().replace(/^www\./, '');
      const rows = db
        .prepare(`SELECT brand, source_url FROM recipes WHERE brand IS NOT NULL AND source_url IS NOT NULL ORDER BY created_at DESC, rowid DESC`)
        .all() as { brand: string; source_url: string }[];
      for (const r of rows) {
        try {
          if (new URL(r.source_url).hostname.toLowerCase().replace(/^www\./, '') === want) return r.brand;
        } catch {
          /* unparseable URL: skip */
        }
      }
      return null;
    },
  };
  return repo;
}
