import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { createRecipeRepo } from '../recipes/repo.js';
import { normaliseUnit } from '../shopping/normalise.js';
import type { ShoppingRepo } from '../shopping/repo.js';
import type { PlannerRepo } from './repo.js';
import { buildBasket, ingredientKey, recipeItems, suggest, toBase, type PlannerRecipe } from './suggest.js';

const MAX_PENCE = 1_000_000; // £10,000: a typo guard, not a real limit
const pence = z.number().int().min(1).max(MAX_PENCE);

const PackBody = z
  .object({
    label: z.string().trim().max(60),
    amount: z.number().positive().max(10_000_000).nullable(),
    pricePence: pence,
    clubcardPence: pence.nullable(),
  })
  .refine((p) => p.clubcardPence === null || p.clubcardPence <= p.pricePence, {
    message: 'The Clubcard price cannot be higher than the normal price',
  });
const IngredientBody = z.object({
  item: z.string().trim().min(1).max(200),
  shopId: z.string().min(1).nullable(),
  /** '' means whole items. */
  unit: z.string().trim().max(30),
  packs: z.array(PackBody).max(12),
});
const ShopBody = z.object({ name: z.string().trim().min(1).max(60) });
const BudgetBody = z.object({ pence: pence.nullable() });
const PlanBody = z.object({ recipeIds: z.array(z.string().min(1)).min(1).max(12) });

export function registerPlannerRoutes(
  app: FastifyInstance,
  deps: { planner: PlannerRepo; recipes: ReturnType<typeof createRecipeRepo>; shopping: ShoppingRepo },
) {
  const { planner, recipes, shopping } = deps;

  const load = (id: string): PlannerRecipe | undefined => {
    const r = recipes.get(id);
    return r && { id: r.id, title: r.title, ingredients: r.ingredients };
  };
  const loadAll = () => recipes.list({}).map((s) => load(s.id)).filter((r): r is PlannerRecipe => r !== undefined);
  const bad = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, p: { error: { issues: unknown } }) =>
    reply.code(400).send({ error: 'Invalid request', issues: p.error.issues });

  // ---- shops
  app.get('/api/planner/shops', async () => ({ shops: planner.listShops() }));

  app.post('/api/planner/shops', async (req, reply) => {
    const p = ShopBody.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const r = planner.addShop(p.data.name);
    return r === 'exists' ? reply.code(409).send({ error: 'A shop with that name already exists' }) : { shop: r };
  });

  app.put<{ Params: { id: string } }>('/api/planner/shops/:id', async (req, reply) => {
    const p = ShopBody.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const r = planner.renameShop(req.params.id, p.data.name);
    if (r === 'exists') return reply.code(409).send({ error: 'A shop with that name already exists' });
    return r === 'ok' ? { shops: planner.listShops() } : reply.code(404).send({ error: 'Not found' });
  });

  app.delete<{ Params: { id: string } }>('/api/planner/shops/:id', async (req, reply) => {
    const r = planner.removeShop(req.params.id);
    if (r === 'last') return reply.code(409).send({ error: 'You need at least one shop' });
    return r === 'ok' ? reply.code(204).send() : reply.code(404).send({ error: 'Not found' });
  });

  // ---- ingredients: every ingredient in the recipes, plus how it is bought
  app.get('/api/planner/ingredients', async () => {
    const info = new Map(planner.listInfo().map((i) => [i.key, i]));
    const seen = new Map<string, { item: string; recipes: number; units: Map<string, number> }>();
    for (const r of loadAll()) {
      const names = recipeItems(r);
      for (const [key, item] of names) {
        const s = seen.get(key) ?? { item, recipes: 0, units: new Map() };
        s.recipes++;
        seen.set(key, s);
      }
      for (const ing of r.ingredients) {
        const s = seen.get(ingredientKey(ing.item));
        if (!s || ing.quantity === null || !(ing.quantity > 0)) continue;
        const u = toBase(ing.quantity, ing.unit).unit;
        s.units.set(u, (s.units.get(u) ?? 0) + 1);
      }
    }
    const rows = [...seen.entries()].map(([key, s]) => {
      const usual = [...s.units.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
      const i = info.get(key);
      return { key, item: s.item, recipeCount: s.recipes, usualUnit: usual, shopId: i?.shopId ?? null, unit: i?.unit ?? usual, packs: i?.packs ?? [] };
    });
    // Saved ingredients no recipe uses any more stay listed, so their prices are not lost.
    for (const i of info.values()) {
      if (!seen.has(i.key)) rows.push({ key: i.key, item: i.item, recipeCount: 0, usualUnit: i.unit, shopId: i.shopId, unit: i.unit, packs: i.packs });
    }
    rows.sort((a, b) => a.item.localeCompare(b.item));
    return { ingredients: rows, shops: planner.listShops() };
  });

  app.put('/api/planner/ingredient', async (req, reply) => {
    const p = IngredientBody.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const unit = normaliseUnit(p.data.unit) ?? '';
    if (unit === 'kg' || unit === 'l') return reply.code(400).send({ error: 'Count in g or ml, not kg or l' });
    if (p.data.shopId !== null && !planner.listShops().some((s) => s.id === p.data.shopId)) {
      return reply.code(400).send({ error: 'Unknown shop' });
    }
    const saved = planner.saveIngredient({ ...p.data, unit });
    return saved ? { ingredient: saved } : reply.code(400).send({ error: 'Invalid request' });
  });

  app.delete<{ Querystring: { item?: string } }>('/api/planner/ingredient', async (req, reply) =>
    req.query.item && planner.removeIngredient(req.query.item) ? reply.code(204).send() : reply.code(404).send({ error: 'Not found' }),
  );

  // ---- budget
  app.get('/api/planner/budget', async () => ({ pence: planner.getBudgetPence() }));

  app.put('/api/planner/budget', async (req, reply) => {
    const p = BudgetBody.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    planner.setBudgetPence(p.data.pence);
    return { pence: p.data.pence };
  });

  // Puts the picked recipes on the shared shopping list, each ingredient in the section of its shop. A recipe
  // already on the list is reported, not added twice.
  app.post('/api/planner/add-to-shopping', async (req, reply) => {
    const p = PlanBody.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const found = [...new Set(p.data.recipeIds)].map((id) => recipes.get(id));
    if (found.some((r) => !r)) return reply.code(404).send({ error: 'Not found' });
    const pricing = planner.pricing();
    const sectionOf = (ing: { item: string }) => pricing.get(ingredientKey(ing.item))?.shop ?? null;
    const alreadyOnList: string[] = [];
    const elsewhere = new Map<string, string>();
    let added = 0;
    for (const r of found as NonNullable<(typeof found)[number]>[]) {
      if (r.ingredients.length === 0) continue;
      const res = shopping.add({ id: r.id, title: r.title }, r.ingredients, { sectionOf });
      if ('alreadyOnList' in res) alreadyOnList.push(r.title);
      else {
        added++;
        for (const ing of r.ingredients) {
          const shop = sectionOf(ing);
          if (shop) elsewhere.set(ing.item.trim().toLowerCase(), shop);
        }
      }
    }
    return { added, alreadyOnList, elsewhere: [...elsewhere].map(([item, shop]) => ({ item, shop })) };
  });

  // ---- the plan
  app.post('/api/planner/plan', async (req, reply) => {
    const p = PlanBody.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const selected = [...new Set(p.data.recipeIds)].map(load);
    if (selected.some((r) => !r)) return reply.code(404).send({ error: 'Not found' });
    const picked = selected as PlannerRecipe[];
    const pricing = planner.pricing();
    return {
      selected: picked.map((r) => ({ id: r.id, title: r.title })),
      basket: buildBasket(picked, pricing),
      suggestions: suggest(picked, loadAll(), pricing).slice(0, 12),
      budgetPence: planner.getBudgetPence(),
      defaultShop: planner.defaultShop()?.name ?? 'Shop',
    };
  });
}
