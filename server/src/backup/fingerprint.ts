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
 * Everything the fingerprint hashes: every full recipe (ordered by id), the sorted backup-eligible image
 * names, the allowlisted email addresses and the sorted favourite pairs.
 *
 * Recipes go in without favouritedBy: a star is hashed once, under `favourites`, and is not recipe content.
 */
export async function fingerprintPayload(db: Database, dataDir: string) {
  const favourites = createFavouritesRepo(db);
  const repo = createRecipeRepo(db, favourites);
  const recipes = repo
    .list({})
    .map((s) => {
      const { favouritedBy: _stars, ...recipe } = repo.get(s.id)!;
      return recipe;
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const images = await listBackupImageNames(dataDir);
  const allowed = createAuthRepo(db).listAllowed().map((a) => a.email);
  return { recipes, images, allowed, favourites: favourites.allPairs() };
}

/**
 * sha256 over {@link fingerprintPayload}, with no export timestamp, so an allowlist edit or a new star
 * alone still triggers an upload.
 *
 * Deliberately excluded: the settings table (backup status rows change on every run), sessions (they
 * change on every sign-in and mean nothing after a restore) and display names (cosmetic, re-fetched from
 * Google at the next sign-in). Anything else user-meaningful added later must be added here. Only the
 * addresses are hashed, not their added-at times; favourites go in as email and recipe id pairs.
 */
export async function computeFingerprint(db: Database, dataDir: string): Promise<string> {
  return createHash('sha256').update(canonicalJson(await fingerprintPayload(db, dataDir))).digest('hex');
}
