import Fastify, { type FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import type { Config } from './config.js';

export type AppDeps = { config: Config; db: Database };

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate('deps', deps);
  app.get('/api/health', async () => ({ ok: true }));
  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
}
