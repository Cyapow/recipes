import type { Database } from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { createRecipeRepo } from '../recipes/repo.js';
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
 * Settings are excluded on purpose (backup status rows change every run); anything user-meaningful added
 * to settings later must be added to this fingerprint.
 *
 * sha256 over every full recipe (ordered by id, no export timestamp) and the sorted backup-eligible
 * image names. Deliberately excludes the settings table: backup status rows change on every run.
 */
export async function computeFingerprint(db: Database, dataDir: string): Promise<string> {
  const repo = createRecipeRepo(db);
  const recipes = repo
    .list({})
    .map((s) => repo.get(s.id)!)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const images = await listBackupImageNames(dataDir);
  return createHash('sha256').update(canonicalJson({ recipes, images })).digest('hex');
}
