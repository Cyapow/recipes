import type { FastifyInstance } from 'fastify';
import { BlockedUrlError, FetchFailedError } from './fetchPage.js';
import { importFromUrl, type ImportDeps } from './importUrl.js';

const MAX_URL_CHARS = 2048;

export function registerImportRoutes(app: FastifyInstance, deps: ImportDeps) {
  app.post('/api/import', async (req, reply) => {
    const url = (req.body as { url?: unknown } | null)?.url;
    if (typeof url !== 'string' || url.trim() === '' || url.length > MAX_URL_CHARS) {
      return reply.code(400).send({ error: "That URL can't be fetched" });
    }
    try {
      return await importFromUrl(url.trim(), deps);
    } catch (err) {
      if (err instanceof BlockedUrlError) return reply.code(400).send({ error: "That URL can't be fetched" });
      if (err instanceof FetchFailedError) return reply.code(502).send({ error: "Couldn't fetch that page" });
      throw err;
    }
  });
}
