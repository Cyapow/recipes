import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { createAiClient, type AiClient } from './ai/client.js';
import { providerOrder } from './ai/registry.js';
import { registerAiRoutes } from './ai/routes.js';
import { registerAuthGuard } from './auth/guard.js';
import { createAuthRepo } from './auth/repo.js';
import { registerAuthRoutes } from './auth/routes.js';
import { createGoogleIdTokenVerifier, type IdTokenVerifier } from './auth/verify.js';
import type { ImportDeps } from './import/importUrl.js';
import type { Config } from './config.js';
import { registerImageRoutes } from './images/routes.js';
import { registerImportRoutes } from './import/routes.js';
import { fetchBytes, fetchPage } from './import/fetchPage.js';
import { createImageStore, type ImageStore } from './images/store.js';
import { createFavouritesRepo } from './favourites/repo.js';
import { createRecipeRepo } from './recipes/repo.js';
import { registerRecipeRoutes } from './recipes/routes.js';
import { createShoppingRepo } from './shopping/repo.js';
import { registerShoppingRoutes } from './shopping/routes.js';
import { createPlannerRepo } from './planner/repo.js';
import { registerPlannerRoutes } from './planner/routes.js';
import type { DriveClient } from './backup/drive.js';
import { createGoogleAuth, type GoogleAuth } from './backup/google.js';
import { registerBackupRoutes } from './backup/routes.js';
import { loggerOptions } from './logging.js';
import { registerSameOriginGuard } from './security.js';
import { createBackupService, type BackupService } from './backup/service.js';

export type AppDeps = { config: Config; db: Database; webDir?: string; images?: ImageStore;
  ai?: AiClient;
  /** Test seams for the guarded network fetches. */
  fetchPage?: ImportDeps['fetchPage'];
  fetchBytes?: ImportDeps['fetchBytes'];
  /** Test seams for Google: default is built from config; the Drive factory defaults to google.getDriveClient. */
  google?: GoogleAuth;
  driveFactory?: () => Promise<DriveClient | null>;
  /** Overall deadline for one backup run (tests inject a tiny one). */
  backupDeadlineMs?: number | (() => number);
  /** Test seam for Google ID-token verification: default is built from config.googleClientId when one is set. */
  verify?: IdTokenVerifier;
};

/** SPA fallback only for extensionless page routes: a missing asset must 404, never come back as index.html. */
function isSpaRoute(url: string): boolean {
  const pathname = url.split('?')[0]!;
  if (pathname.startsWith('/assets/')) return false;
  const last = pathname.split('/').pop() ?? '';
  return !/\.[A-Za-z0-9]+$/.test(last);
}

const defaultWebDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: loggerOptions(process.env) });
  app.decorate('deps', deps);
  registerSameOriginGuard(app, deps.config);
  const authRepo = createAuthRepo(deps.db);
  registerAuthGuard(app, { repo: authRepo });
  registerAuthRoutes(app, {
    repo: authRepo,
    verify: deps.verify ?? (deps.config.googleClientId ? createGoogleIdTokenVerifier(deps.config.googleClientId) : undefined),
    clientId: deps.config.googleClientId,
    envEmails: deps.config.allowedEmails,
    secureCookie: Boolean(deps.config.publicBaseUrl?.startsWith('https://')),
  });
  app.get('/api/health', async () => ({ ok: true }));
  const favouritesRepo = createFavouritesRepo(deps.db);
  const recipeRepo = createRecipeRepo(deps.db, favouritesRepo);
  registerRecipeRoutes(app, recipeRepo, favouritesRepo);
  const shopping = createShoppingRepo(deps.db);
  registerShoppingRoutes(app, { shopping, recipes: recipeRepo });
  registerPlannerRoutes(app, { planner: createPlannerRepo(deps.db), recipes: recipeRepo, shopping });

  const images = deps.images ?? createImageStore(deps.config.dataDir);
  registerImageRoutes(app, images);

  const ai = deps.ai ?? (providerOrder(deps.config).length > 0 ? createAiClient(deps.config) : undefined);
  const web = {
    fetchPage: deps.fetchPage ?? ((url: string) => fetchPage(url)),
    fetchBytes: deps.fetchBytes ?? ((url: string) => fetchBytes(url)),
    images,
  };
  registerAiRoutes(app, ai, deps.config, web);
  registerImportRoutes(app, { ...web, ai, brandForHost: (host) => recipeRepo.brandForHost(host) });

  const google = deps.google ?? createGoogleAuth(deps.config, path.join(deps.config.dataDir, 'google-token.json'));
  const service = createBackupService({
    db: deps.db,
    dataDir: deps.config.dataDir,
    deadlineMs: deps.backupDeadlineMs,
    getDrive: deps.driveFactory ?? (() => google.getDriveClient()),
  });
  app.decorate('backup', service);
  registerBackupRoutes(app, { db: deps.db, google, service, secureCookie: Boolean(deps.config.publicBaseUrl?.startsWith('https://')) });

  const webDir = deps.webDir ?? defaultWebDir;
  if (existsSync(path.join(webDir, 'index.html'))) {
    app.register(fastifyStatic, { root: webDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && isSpaRoute(req.url)) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'Not found' });
    });
  }
  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
    backup: BackupService;
  }
}
