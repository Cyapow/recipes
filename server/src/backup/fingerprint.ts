import type { Database } from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { createAuthRepo } from '../auth/repo.js';
import { createRecipeRepo } from '../recipes/repo.js';
import { createFavouritesRepo } from '../favourites/repo.js';
import { listBackupImageNames } from './run.js';

/** JSON with object keys sorted at every level, so key order never affects the result. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x === undefined ? null : x)).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const parts = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`);
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/**
 * sha256 over every full recipe (ordered by id, no export timestamp), the sorted backup-eligible image
 * names and the allowlisted email addresses, so an allowlist edit alone still triggers an upload.
 *
 * Deliberately excluded: the settings table (backup status rows change on every run) and sessions
 * (they change on every sign-in and mean nothing after a restore). Anything user-meaningful added to
 * either later must be added here. Only the addresses are hashed, not their added-at times.
 */
export async function computeFingerprint(db: Database, dataDir: string): Promise<string> {
  const repo = createRecipeRepo(db, createFavouritesRepo(db));
  const recipes = repo
    .list({})
    .map((s) => repo.get(s.id)!)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const images = await listBackupImageNames(dataDir);
  const allowed = createAuthRepo(db).listAllowed().map((a) => a.email);
  return createHash('sha256').update(canonicalJson({ recipes, images, allowed })).digest('hex');
}
