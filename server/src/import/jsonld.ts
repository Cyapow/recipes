import * as cheerio from 'cheerio';
import type { RecipeInput } from '../recipes/schema.js';

type Json = unknown;
type Obj = Record<string, Json>;
const isObj = (v: Json): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Decode HTML entities and strip any markup from a JSON-LD string. */
function clean(v: Json): string {
  if (typeof v !== 'string') return '';
  const text = v.includes('&') || v.includes('<') ? cheerio.load(`<div>${v}</div>`).root().text() : v;
  return text.replace(/\s+/g, ' ').trim();
}

function hasType(node: Obj, type: string): boolean {
  const t = node['@type'];
  return Array.isArray(t) ? t.includes(type) : t === type;
}

function collect(v: Json, out: Obj[], depth = 0): void {
  if (depth > 6) return;
  if (Array.isArray(v)) return v.forEach((x) => collect(x, out, depth + 1));
  if (!isObj(v)) return;
  out.push(v);
  if (v['@graph']) collect(v['@graph'], out, depth + 1);
}

function findRecipe(html: string): Obj | null {
  const $ = cheerio.load(html);
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    let data: Json;
    try {
      data = JSON.parse($(el).text());
    } catch {
      continue;
    }
    const nodes: Obj[] = [];
    collect(data, nodes);
    const found = nodes.find((n) => hasType(n, 'Recipe') && clean(n.name) !== '');
    if (found) return found;
  }
  return null;
}

export function parseDuration(v: Json): number | null {
  if (typeof v !== 'string') return null;
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(v.trim());
  if (!m || v.trim().length <= 1) return null;
  const [d, h, mi, s] = [m[1], m[2], m[3], m[4]].map((x) => (x ? Number(x) : 0)) as [number, number, number, number];
  const total = Math.round(d * 1440 + h * 60 + mi + s / 60);
  return total > 0 ? total : null;
}

function parseServings(v: Json): number | null {
  const first = Array.isArray(v) ? v[0] : v;
  if (typeof first === 'number') return Number.isFinite(first) && first > 0 ? first : null;
  if (typeof first !== 'string') return null;
  const m = /\d+(?:\.\d+)?/.exec(first);
  return m ? Number(m[0]) : null;
}

function flattenSteps(v: Json, out: string[], depth = 0): void {
  if (depth > 5 || v == null) return;
  if (typeof v === 'string') {
    const parts = v.includes('\n') ? v.split('\n') : [v];
    for (const p of parts) if (clean(p)) out.push(clean(p));
  } else if (Array.isArray(v)) {
    v.forEach((x) => flattenSteps(x, out, depth + 1));
  } else if (isObj(v)) {
    if (hasType(v, 'HowToSection') || v.itemListElement) flattenSteps(v.itemListElement, out, depth + 1);
    else {
      const text = clean(v.text) || clean(v.name);
      if (text) out.push(text);
    }
  }
}

function asList(v: Json): string[] {
  if (typeof v === 'string') return v.split(',');
  if (Array.isArray(v)) return v.flatMap(asList);
  return [];
}

export function parseRecipeJsonLd(html: string): RecipeInput | null {
  const r = findRecipe(html);
  if (!r) return null;
  const ingredients = (Array.isArray(r.recipeIngredient) ? r.recipeIngredient : [])
    .map(clean)
    .filter(Boolean)
    .map((item) => ({ group: null, quantity: null, unit: null, item, note: null }));
  const steps: string[] = [];
  flattenSteps(r.recipeInstructions, steps);
  const tags: string[] = [];
  for (const t of [...asList(r.recipeCategory), ...asList(r.recipeCuisine), ...asList(r.keywords)]) {
    const tag = clean(t).toLowerCase();
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return {
    title: clean(r.name),
    description: clean(r.description) || null,
    origin: 'other',
    sourceName: null,
    sourceUrl: null,
    servings: parseServings(r.recipeYield),
    prepMinutes: parseDuration(r.prepTime),
    cookMinutes: parseDuration(r.cookTime),
    ingredients,
    steps: steps.map((text) => ({ text, imageId: null, ingredients: [] })),
    notes: null,
    tags: tags.slice(0, 8),
    imageIds: [],
  };
}

function imageFrom(v: Json): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (Array.isArray(v)) {
    for (const x of v) {
      const u = imageFrom(x);
      if (u) return u;
    }
    return null;
  }
  if (isObj(v)) return imageFrom(v.url) ?? imageFrom(v.contentUrl);
  return null;
}

/** Recipe image from JSON-LD, else og:image; absolute URL resolved against `base`, or null. */
export function findImageUrl(html: string, base: string): string | null {
  const raw = (findRecipe(html) && imageFrom(findRecipe(html)!.image)) || cheerio.load(html)('meta[property="og:image"]').attr('content')?.trim() || null;
  if (!raw) return null;
  try {
    return new URL(raw, base).toString();
  } catch {
    return null;
  }
}
