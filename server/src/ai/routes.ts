import type { FastifyInstance } from 'fastify';
import { AiInvalidOutputError, AiRefusedError, type AiClient } from './client.js';

export const MAX_DESCRIBE_CHARS = 20_000;

export function registerAiRoutes(app: FastifyInstance, ai: AiClient | undefined) {
  app.post('/api/ai/describe', async (req, reply) => {
    if (!ai) return reply.code(503).send({ error: 'AI not configured' });
    const text = (req.body as { text?: unknown } | null)?.text;
    if (typeof text !== 'string' || text.trim() === '') return reply.code(400).send({ error: 'text is required' });
    if (text.length > MAX_DESCRIBE_CHARS) return reply.code(413).send({ error: 'text is too long' });
    try {
      const draft = await ai.extractRecipe({ kind: 'description', text: text.trim() });
      return { ...draft, origin: 'mine', sourceName: null, sourceUrl: null };
    } catch (err) {
      if (err instanceof AiRefusedError) return reply.code(502).send({ error: 'The AI declined this request' });
      if (err instanceof AiInvalidOutputError) return reply.code(502).send({ error: 'AI returned an invalid recipe' });
      return reply.code(502).send({ error: 'AI request failed' });
    }
  });
}
