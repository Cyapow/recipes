import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseTagKey, type Tag } from './categories.js';
import { RecipeInputSchema } from './schema.js';
import type { createRecipeRepo } from './repo.js';

const many = z.union([z.string(), z.array(z.string())]).optional();
const arr = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

const ListQuerySchema = z.object({
  search: z.string().optional(),
  origin: z.enum(['mine', 'other']).optional(),
  brand: many,
  tag: many,
});

export function registerRecipeRoutes(app: FastifyInstance, repo: ReturnType<typeof createRecipeRepo>) {
  app.get('/api/recipes', async (req, reply) => {
    const q = ListQuerySchema.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'Invalid query', issues: q.error.issues });
    const tags: Tag[] = [];
    for (const key of arr(q.data.tag)) {
      const t = parseTagKey(key);
      if (!t) return reply.code(400).send({ error: `Invalid tag: ${key}` });
      tags.push(t);
    }
    return repo.list({ search: q.data.search, origin: q.data.origin, brands: arr(q.data.brand), tags });
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

  app.get('/api/tags', async () => repo.facets());
}
