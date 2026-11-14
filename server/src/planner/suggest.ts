import type { Ingredient } from '../recipes/schema.js';
import { normaliseItemName, normaliseUnit } from '../shopping/normalise.js';

export type PlannerRecipe = { id: string; title: string; ingredients: Ingredient[] };

/** One way of buying an ingredient. `amount` is in the ingredient's unit; null covers whatever is needed. */
export type Pack = { label: string; amount: number | null; pricePence: number; clubcardPence: number | null };
/** How an ingredient is bought. `shop` is null for the default shop; `unit` is '' for whole items. */
export type Pricing = { shop: string | null; unit: string; packs: Pack[] };
export type PricingMap = ReadonlyMap<string, Pricing>;

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

/** A quantity in its base unit: kg becomes g and l becomes ml. No unit is ''. */
export function toBase(quantity: number, unit: string | null): { quantity: number; unit: string } {
  const u = normaliseUnit(unit) ?? '';
  if (u === 'kg') return { quantity: quantity * 1000, unit: 'g' };
  if (u === 'l') return { quantity: quantity * 1000, unit: 'ml' };
  return { quantity, unit: u };
}

/** What you actually pay for a pack: the Clubcard price when there is one. */
export const packPence = (p: Pack): number => p.clubcardPence ?? p.pricePence;

export type PackPick = { label: string; count: number; pence: number };
export type Choice = { picks: PackPick[]; totalPence: number; coveredAmount: number | null };

/** Beyond this many DP cells the exact search is skipped for the best-value pack, repeated. */
const MAX_CELLS = 200_000;

function coverSized(need: number, sized: Pack[]): Choice {
  const scale = [need, ...sized.map((p) => p.amount!)].every(Number.isInteger) ? 1 : 100;
  const target = Math.ceil(need * scale - 1e-9);
  const amounts = sized.map((p) => Math.max(1, Math.round(p.amount! * scale)));
  const costs = sized.map(packPence);
  const counts = sized.map(() => 0);
  if (target > MAX_CELLS) {
    let best = 0;
    for (let i = 1; i < sized.length; i++) if (costs[i]! / amounts[i]! < costs[best]! / amounts[best]!) best = i;
    counts[best] = Math.ceil(target / amounts[best]!);
  } else {
    // best[x] = least it costs to cover at least x
    const best = new Array<number>(target + 1).fill(Infinity);
    const from = new Array<number>(target + 1).fill(-1);
    best[0] = 0;
    for (let x = 1; x <= target; x++) {
      for (let i = 0; i < sized.length; i++) {
        const c = best[Math.max(0, x - amounts[i]!)]! + costs[i]!;
        if (c < best[x]!) {
          best[x] = c;
          from[x] = i;
        }
      }
    }
    for (let x = target; x > 0; ) {
      const i = from[x]!;
      counts[i]!++;
      x = Math.max(0, x - amounts[i]!);
    }
  }
  const picks = sized.flatMap((p, i) => (counts[i]! > 0 ? [{ label: p.label, count: counts[i]!, pence: counts[i]! * costs[i]! }] : []));
  return {
    picks,
    totalPence: picks.reduce((n, p) => n + p.pence, 0),
    coveredAmount: sized.reduce((n, p, i) => n + counts[i]! * p.amount!, 0),
  };
}

/**
 * The cheapest packs that cover `need`. A pack with no amount covers anything and counts as one pack;
 * with no need at all (or only unmeasured use) one cheapest pack is bought. Null when there are no packs.
 */
export function choosePacks(need: number, packs: Pack[]): Choice | null {
  const whole = packs.filter((p) => p.amount === null);
  const sized = packs.filter((p) => p.amount !== null && p.amount > 0);
  const cheapest = (ps: Pack[]) => ps.reduce((a, b) => (packPence(b) < packPence(a) ? b : a));
  const one = (p: Pack): Choice => ({
    picks: [{ label: p.label, count: 1, pence: packPence(p) }], totalPence: packPence(p), coveredAmount: p.amount,
  });
  const options: Choice[] = [];
  if (whole.length) options.push(one(cheapest(whole)));
  if (sized.length) options.push(need > 0 ? coverSized(need, sized) : one(cheapest(sized)));
  if (options.length === 0) return null;
  return options.reduce((a, b) => (b.totalPence < a.totalPence ? b : a));
}

export type BasketItem = {
  key: string;
  item: string;
  /** null for the default shop. */
  shop: string | null;
  /** What this ingredient costs in total; null when it has no packs. */
  pricePence: number | null;
  picks: PackPick[];
  /** Amount the recipes need, in `unit`; null when the packs do not have sizes. */
  needed: number | null;
  unit: string;
  /** Some use could not be measured (a vague amount, or a different unit), so the amount is a floor. */
  unclear: boolean;
  /** Bought beyond what the recipes need, in `unit`. */
  leftover: number | null;
  usedBy: string[];
};
export type Basket = {
  items: BasketItem[];
  totalPence: number;
  /** Totals per shop (null = default shop). */
  byShop: { shop: string | null; totalPence: number }[];
  unpriced: string[];
};

/**
 * The shop for a set of recipes. Each ingredient's quantities are added up across the recipes (only where the
 * recipe uses the ingredient's own unit) and the cheapest packs that cover it are chosen. Anything that cannot be
 * measured is flagged `unclear`, never guessed. Unpriced items add nothing and are listed separately.
 */
export function buildBasket(recipes: PlannerRecipe[], pricing: PricingMap): Basket {
  type Acc = { item: string; amount: number; unclear: boolean; usedBy: string[] };
  const acc = new Map<string, Acc>();
  for (const r of recipes) {
    const names = recipeItems(r);
    for (const [key, item] of names) {
      const a = acc.get(key) ?? { item, amount: 0, unclear: false, usedBy: [] };
      a.usedBy.push(r.title);
      acc.set(key, a);
    }
    for (const ing of r.ingredients) {
      const key = ingredientKey(ing.item);
      const a = acc.get(key);
      if (!a || !names.has(key)) continue;
      const pr = pricing.get(key);
      if (ing.quantity !== null && ing.quantity > 0) {
        const b = toBase(ing.quantity, ing.unit);
        if (pr && b.unit === pr.unit) a.amount += b.quantity;
        else a.unclear = true;
      } else a.unclear = true;
    }
  }
  const items: BasketItem[] = [...acc.entries()]
    .map(([key, a]) => {
      const pr = pricing.get(key);
      const choice = pr ? choosePacks(a.amount, pr.packs) : null;
      const sized = pr?.packs.some((p) => p.amount !== null) ?? false;
      return {
        key, item: a.item, shop: pr?.shop ?? null,
        pricePence: choice?.totalPence ?? null,
        picks: choice?.picks ?? [],
        needed: sized ? a.amount : null,
        unit: pr?.unit ?? '',
        unclear: a.unclear,
        leftover: choice?.coveredAmount != null && a.amount > 0 ? Math.max(0, Math.round((choice.coveredAmount - a.amount) * 100) / 100) : null,
        usedBy: a.usedBy,
      };
    })
    .sort((x, y) => x.item.localeCompare(y.item));
  const shops = new Map<string | null, number>();
  for (const i of items) if (i.pricePence !== null) shops.set(i.shop, (shops.get(i.shop) ?? 0) + i.pricePence);
  return {
    items,
    totalPence: items.reduce((n, i) => n + (i.pricePence ?? 0), 0),
    byShop: [...shops.entries()].map(([shop, totalPence]) => ({ shop, totalPence })),
    unpriced: items.filter((i) => i.pricePence === null).map((i) => i.item),
  };
}

export type Suggestion = {
  id: string;
  title: string;
  /** Ingredients the picked recipes already cover. */
  shared: string[];
  /** Ingredients you would still need; `shop` is null for the default shop. */
  extra: { item: string; shop: string | null }[];
  /** What adding this recipe adds to the total, packs and leftovers taken into account. */
  extraPence: number;
  /** Extras with no price yet, so extraPence is a floor. */
  unpricedExtra: string[];
};

/**
 * Other recipes ranked by how little extra shopping they need on top of the picked ones: fewest extra
 * ingredients first, then most shared. Recipes sharing nothing are left out.
 */
export function suggest(selected: PlannerRecipe[], all: PlannerRecipe[], pricing: PricingMap): Suggestion[] {
  const have = new Set(selected.flatMap((r) => [...recipeItems(r).keys()]));
  const picked = new Set(selected.map((r) => r.id));
  const base = buildBasket(selected, pricing).totalPence;
  const out: Suggestion[] = [];
  for (const r of all) {
    if (picked.has(r.id)) continue;
    const shared: string[] = [];
    const extra: Suggestion['extra'] = [];
    for (const [key, name] of recipeItems(r)) {
      if (have.has(key)) shared.push(name);
      else extra.push({ item: name, shop: pricing.get(key)?.shop ?? null });
    }
    if (shared.length === 0) continue;
    const withIt = buildBasket([...selected, r], pricing);
    out.push({
      id: r.id, title: r.title, shared, extra,
      extraPence: withIt.totalPence - base,
      unpricedExtra: extra.map((e) => e.item).filter((n) => withIt.unpriced.includes(n)),
    });
  }
  return out.sort(
    (a, b) => a.extra.length - b.extra.length || b.shared.length - a.shared.length || a.title.localeCompare(b.title),
  );
}
