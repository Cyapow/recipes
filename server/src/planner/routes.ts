import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { createRecipeRepo } from '../recipes/repo.js';
import type { ShoppingRepo } from '../shopping/repo.js';
import type { PlannerRepo } from './repo.js';
import { buildBasket, ingredientKey, suggest, type PlannerRecipe } from './suggest.js';

const MAX_PENCE = 1_000_000; // £10,000: a typo guard, not a real limit
const pence = z.number().int().min(1).max(MAX_PENCE);

const PriceBody = z.object({
  item: z.string().trim().min(1).max(200),
  pricePence: pence,
  clubcardPence: pence.nullable(),
  packNote: z.string().trim().max(100).nullable().optional(),
  butcher: z.boolean().optional(),
});
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

  app.get('/api/planner/prices', async () => ({ prices: planner.listPrices() }));

  app.put('/api/planner/prices', async (req, reply) => {
    const p = PriceBody.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'Invalid request', issues: p.error.issues });
    if (p.data.clubcardPence !== null && p.data.clubcardPence > p.data.pricePence) {
      return reply.code(400).send({ error: 'The Clubcard price cannot be higher than the normal price' });
    }
    const saved = planner.setPrice(p.data.item, p.data);
    return saved ? { price: saved } : reply.code(400).send({ error: 'Invalid request' });
  });

  app.delete<{ Querystring: { item?: string } }>('/api/planner/prices', async (req, reply) =>
    req.query.item && planner.removePrice(req.query.item) ? reply.code(204).send() : reply.code(404).send({ error: 'Not found' }),
  );

  app.get('/api/planner/budget', async () => ({ pence: planner.getBudgetPence() }));

  app.put('/api/planner/budget', async (req, reply) => {
    const p = BudgetBody.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'Invalid request', issues: p.error.issues });
    planner.setBudgetPence(p.data.pence);
    return { pence: p.data.pence };
  });

  // Puts the picked recipes on the shared shopping list, leaving out butcher items (they are not part of the
  // online order). A recipe already on the list is reported, not added twice.
  app.post('/api/planner/add-to-shopping', async (req, reply) => {
    const p = PlanBody.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'Invalid request', issues: p.error.issues });
    const found = [...new Set(p.data.recipeIds)].map((id) => recipes.get(id));
    if (found.some((r) => !r)) return reply.code(404).send({ error: 'Not found' });
    const prices = planner.priceMap();
    const alreadyOnList: string[] = [];
    const butcher = new Set<string>();
    let added = 0;
    for (const r of found as NonNullable<(typeof found)[number]>[]) {
      const keep = r.ingredients.filter((ing) => {
        const isButcher = prices.get(ingredientKey(ing.item))?.butcher === true;
        if (isButcher) butcher.add(ing.item.trim().toLowerCase());
        return !isButcher;
      });
      if (keep.length === 0) continue;
      const res = shopping.add({ id: r.id, title: r.title }, keep);
      if ('alreadyOnList' in res) alreadyOnList.push(r.title);
      else added++;
    }
    return { added, alreadyOnList, butcherItems: [...butcher] };
  });

  app.post('/api/planner/plan', async (req, reply) => {
    const p = PlanBody.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'Invalid request', issues: p.error.issues });
    const ids = [...new Set(p.data.recipeIds)];
    const selected = ids.map(load);
    if (selected.some((r) => !r)) return reply.code(404).send({ error: 'Not found' });
    const picked = selected as PlannerRecipe[];
    const all = recipes.list({}).map((s) => load(s.id)).filter((r): r is PlannerRecipe => r !== undefined);
    const prices = planner.priceMap();
    return {
      selected: picked.map((r) => ({ id: r.id, title: r.title })),
      basket: buildBasket(picked, prices),
      suggestions: suggest(picked, all, prices).slice(0, 12),
      budgetPence: planner.getBudgetPence(),
    };
  });
}
