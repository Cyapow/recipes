import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { RecipeInputSchema } from './schema.js';
import type { createRecipeRepo } from './repo.js';

const ListQuerySchema = z.object({
  search: z.string().optional(),
  origin: z.enum(['mine', 'other']).optional(),
  tag: z.string().optional(),
});

export function registerRecipeRoutes(app: FastifyInstance, repo: ReturnType<typeof createRecipeRepo>) {
  app.get('/api/recipes', async (req, reply) => {
    const q = ListQuerySchema.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'Invalid query', issues: q.error.issues });
    return repo.list(q.data);
  });

  app.get<{ Params: { id: string } }>('/api/recipes/:id', async (req, reply) => {
    const r = repo.get(req.params.id);
    return r ?? reply.code(404).send({ error: 'Not found' });
  });

  app.post('/api/recipes', async (req, reply) => {
    const p = RecipeInputSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'Invalid recipe', issues: p.error.issues });
    return reply.code(201).send(repo.create(p.data));
  });

  app.put<{ Params: { id: string } }>('/api/recipes/:id', async (req, reply) => {
    const p = RecipeInputSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'Invalid recipe', issues: p.error.issues });
    const r = repo.update(req.params.id, p.data);
    return r ?? reply.code(404).send({ error: 'Not found' });
  });

  app.delete<{ Params: { id: string } }>('/api/recipes/:id', async (req, reply) => {
    return repo.delete(req.params.id)
      ? reply.code(204).send()
      : reply.code(404).send({ error: 'Not found' });
  });

  app.get('/api/tags', async () => repo.tags());
}
