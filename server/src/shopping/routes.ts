import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { createRecipeRepo } from '../recipes/repo.js';
import type { ShoppingRepo } from './repo.js';

const AddBodySchema = z.object({
  recipeId: z.string().min(1),
  indexes: z.array(z.number().int().min(0)).min(1),
  force: z.boolean().optional(),
  expectedUpdatedAt: z.string().optional(),
});

export function registerShoppingRoutes(
  app: FastifyInstance,
  deps: { shopping: ShoppingRepo; recipes: ReturnType<typeof createRecipeRepo> },
) {
  const { shopping, recipes } = deps;

  app.get('/api/shopping', async () => ({ items: shopping.list() }));

  app.post('/api/shopping/add', async (req, reply) => {
    const p = AddBodySchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'Invalid request', issues: p.error.issues });
    const recipe = recipes.get(p.data.recipeId);
    if (!recipe) return reply.code(404).send({ error: 'Not found' });
    if (p.data.expectedUpdatedAt !== undefined && p.data.expectedUpdatedAt !== recipe.updatedAt) {
      return reply.code(409).send({ error: 'recipe_changed' });
    }
    const indexes = [...new Set(p.data.indexes)].sort((a, b) => a - b);
    if (indexes.some((i) => i >= recipe.ingredients.length)) {
      return reply.code(400).send({ error: 'Ingredient index out of range' });
    }
    const result = shopping.add(
      { id: recipe.id, title: recipe.title },
      indexes.map((i) => recipe.ingredients[i]!),
      { force: p.data.force },
    );
    if ('alreadyOnList' in result) {
      return reply.code(409).send({ error: 'already_on_list', recipeTitle: recipe.title });
    }
    return { added: result.added, items: shopping.list() };
  });

  app.delete<{ Params: { id: string } }>('/api/shopping/:id', async (req, reply) =>
    shopping.remove(req.params.id) ? reply.code(204).send() : reply.code(404).send({ error: 'Not found' }),
  );

  app.delete('/api/shopping', async () => ({ removed: shopping.clear() }));
}
