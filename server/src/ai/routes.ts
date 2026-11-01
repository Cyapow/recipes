import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import { AiInvalidOutputError, AiRefusedError, AiRequestError, type AiClient } from './client.js';
import { sourceFromText, type SourceDeps } from '../import/describedSource.js';
import { aiStatus } from './registry.js';

export const MAX_DESCRIBE_CHARS = 20_000;

export function registerAiRoutes(app: FastifyInstance, ai: AiClient | undefined, config: Config, source?: SourceDeps) {
  app.get('/api/ai/status', async () => aiStatus(config));

  app.post('/api/ai/describe', async (req, reply) => {
    if (!ai) return reply.code(503).send({ error: 'AI not configured' });
    const text = (req.body as { text?: unknown } | null)?.text;
    if (typeof text !== 'string' || text.trim() === '') return reply.code(400).send({ error: 'text is required' });
    if (text.length > MAX_DESCRIBE_CHARS) return reply.code(413).send({ error: 'text is too long' });
    try {
      const described = text.trim();
      // The recipe is read from the text alone. A link in it only ever adds the page's photo and its name.
      const [{ draft, provider, model }, from] = await Promise.all([
        ai.extractRecipe({ kind: 'description', text: described }),
        source ? sourceFromText(described, source) : Promise.resolve(null),
      ]);
      return {
        ...draft,
        origin: 'mine',
        sourceName: from?.sourceName ?? null,
        sourceUrl: from?.sourceUrl ?? null,
        imageIds: from?.imageIds ?? draft.imageIds,
        provider,
        model,
      };
    } catch (err) {
      if (err instanceof AiRefusedError) return reply.code(502).send({ error: 'The AI declined this request', code: 'other' });
      if (err instanceof AiInvalidOutputError) return reply.code(502).send({ error: 'AI returned an invalid recipe', code: 'other' });
      if (err instanceof AiRequestError) return reply.code(502).send({ error: err.message, code: err.code });
      return reply.code(502).send({ error: 'AI request failed', code: 'other' });
    }
  });
}
