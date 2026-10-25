import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import type { Config } from './config.js';
import { registerImageRoutes } from './images/routes.js';
import { createImageStore, type ImageStore } from './images/store.js';
import { createRecipeRepo } from './recipes/repo.js';
import { registerRecipeRoutes } from './recipes/routes.js';

export type AppDeps = { config: Config; db: Database; webDir?: string; images?: ImageStore };

const defaultWebDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate('deps', deps);
  app.get('/api/health', async () => ({ ok: true }));
  registerRecipeRoutes(app, createRecipeRepo(deps.db));

  registerImageRoutes(app, deps.images ?? createImageStore(deps.config.dataDir));

  const webDir = deps.webDir ?? defaultWebDir;
  if (existsSync(path.join(webDir, 'index.html'))) {
    app.register(fastifyStatic, { root: webDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'Not found' });
    });
  }
  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
}
