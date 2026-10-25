import Fastify, { type FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import type { Config } from './config.js';
import { createRecipeRepo } from './recipes/repo.js';
import { registerRecipeRoutes } from './recipes/routes.js';

export type AppDeps = { config: Config; db: Database };

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate('deps', deps);
  app.get('/api/health', async () => ({ ok: true }));
  registerRecipeRoutes(app, createRecipeRepo(deps.db));
  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
}
