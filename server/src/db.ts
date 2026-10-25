import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Works from source (server/src) and compiled output (dist/server): the
// build copies migrations next to db.js.
const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export function openDb(file: string): Database.Database {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
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
