import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Works from source (server/src) and compiled output (dist/server): the
// build copies migrations next to db.js.
const defaultMigrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** `migrationsDir` is only overridden by tests that need a schema newer than the shipped one. */
export function openDb(file: string, migrationsDir: string = defaultMigrationsDir): Database.Database {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db, migrationsDir);
  return db;
}

function migrationFiles(migrationsDir: string): string[] {
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/** The schema `user_version` a fully migrated database has with this build. */
export function latestSchemaVersion(migrationsDir: string = defaultMigrationsDir): number {
  return migrationFiles(migrationsDir).length;
}

function migrate(db: Database.Database, migrationsDir: string): void {
  const files = migrationFiles(migrationsDir);
  const current = db.pragma('user_version', { simple: true }) as number;
  files.forEach((f, i) => {
    const version = i + 1;
    if (version <= current) return;
    const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version}`);
    })();
  });
}
