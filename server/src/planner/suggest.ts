import type { Ingredient } from '../recipes/schema.js';
import { normaliseItemName } from '../shopping/normalise.js';

export type PlannerRecipe = { id: string; title: string; ingredients: Ingredient[] };
export type Price = { pricePence: number; clubcardPence: number | null; butcher?: boolean };
export type PriceMap = ReadonlyMap<string, Price>;

/** Cupboard basics: never counted as something to buy or as a reason two recipes match. */
const STAPLES = new Set([
  'salt', 'pepper', 'black pepper', 'water', 'oil', 'olive oil', 'vegetable oil', 'sunflower oil',
  'rapeseed oil', 'cooking oil', 'sea salt', 'ground black pepper',
]);

export const ingredientKey = (item: string): string => normaliseItemName(item);

/** The distinct, non-staple ingredients of a recipe, as normalised key to display name. */
export function recipeItems(r: PlannerRecipe): Map<string, string> {
  const out = new Map<string, string>();
  for (const ing of r.ingredients) {
    const key = ingredientKey(ing.item);
    if (key && !STAPLES.has(key) && !out.has(key)) out.set(key, ing.item.trim().toLowerCase());
  }
  return out;
}

/** What you actually pay: the Clubcard price when there is one. */
export const effectivePence = (p: Price): number => p.clubcardPence ?? p.pricePence;

export type BasketItem = {
  key: string;
  item: string;
  /** What it counts for in the total (Clubcard price when set); null when unpriced. */
  pricePence: number | null;
  /** The prices as entered, so they can be edited. */
  normalPence: number | null;
  clubcardPence: number | null;
  /** Bought from the butcher, and the price is a usual cost rather than a shop price. */
  butcher: boolean;
  usedBy: string[];
};
export type Basket = { items: BasketItem[]; totalPence: number; butcherPence: number; unpriced: string[] };

/**
 * The shop for a set of recipes. An ingredient two recipes share is bought once (one pack), which is
 * where the saving comes from. Unpriced items add nothing to the total and are listed separately.
 */
export function buildBasket(recipes: PlannerRecipe[], prices: PriceMap): Basket {
  const byKey = new Map<string, BasketItem>();
  for (const r of recipes) {
    for (const [key, item] of recipeItems(r)) {
      const existing = byKey.get(key);
      if (existing) existing.usedBy.push(r.title);
      else {
        const p = prices.get(key);
        byKey.set(key, {
          key, item, usedBy: [r.title],
          pricePence: p ? effectivePence(p) : null,
          normalPence: p?.pricePence ?? null,
          clubcardPence: p?.clubcardPence ?? null,
          butcher: p?.butcher === true,
        });
      }
    }
  }
  const items = [...byKey.values()].sort((a, b) => a.item.localeCompare(b.item));
  return {
    items,
    totalPence: items.reduce((n, i) => n + (i.pricePence ?? 0), 0),
    butcherPence: items.reduce((n, i) => n + (i.butcher ? (i.pricePence ?? 0) : 0), 0),
    unpriced: items.filter((i) => i.pricePence === null).map((i) => i.item),
  };
}

export type Suggestion = {
  id: string;
  title: string;
  /** Ingredients the picked recipes already cover. */
  shared: string[];
  /** Ingredients you would still need to buy. */
  extra: string[];
  /** Which of the extras come from the butcher. */
  butcherExtra: string[];
  /** Cost of the extras that have a price. */
  extraPence: number;
  /** Extras with no price yet, so extraPence is a floor. */
  unpricedExtra: string[];
};

/**
 * Other recipes ranked by how little extra shopping they need on top of the picked ones: fewest extra
 * ingredients first, then most shared. Recipes sharing nothing are left out.
 */
export function suggest(selected: PlannerRecipe[], all: PlannerRecipe[], prices: PriceMap): Suggestion[] {
  const have = new Set(selected.flatMap((r) => [...recipeItems(r).keys()]));
  const picked = new Set(selected.map((r) => r.id));
  const out: Suggestion[] = [];
  for (const r of all) {
    if (picked.has(r.id)) continue;
    const items = recipeItems(r);
    const shared: string[] = [];
    const extra: string[] = [];
    let extraPence = 0;
    const unpricedExtra: string[] = [];
    const butcherExtra: string[] = [];
    for (const [key, name] of items) {
      if (have.has(key)) shared.push(name);
      else {
        extra.push(name);
        const p = prices.get(key);
        if (p) extraPence += effectivePence(p);
        else unpricedExtra.push(name);
        if (p?.butcher) butcherExtra.push(name);
      }
    }
    if (shared.length === 0) continue;
    out.push({ id: r.id, title: r.title, shared, extra, butcherExtra, extraPence, unpricedExtra });
  }
  return out.sort(
    (a, b) =>
      a.extra.length - b.extra.length || b.shared.length - a.shared.length || a.title.localeCompare(b.title),
  );
}
