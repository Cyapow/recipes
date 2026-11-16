import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../db.js';

const shipped = path.dirname(new URL(import.meta.url).pathname);

describe('migration 007', () => {
  it('backfills brand from origin/source and wraps tags as other-group objects', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    for (const f of fs.readdirSync(shipped).filter((f) => /^00[1-6]_.*\.sql$/.test(f))) {
      fs.copyFileSync(path.join(shipped, f), path.join(dir, f));
    }
    const file = path.join(dir, 'test.db');
    const old = openDb(file, dir);
    const ins = old.prepare(`INSERT INTO recipes
      (id, title, origin, source_name, ingredients_json, steps_json, tags_json, image_ids_json, created_at, updated_at)
      VALUES (@id, @id, @origin, @source_name, '[]', '[]', @tags, '[]', 'x', 'x')`);
    ins.run({ id: 'a', origin: 'mine', source_name: null, tags: '["pasta","dinner"]' });
    ins.run({ id: 'b', origin: 'other', source_name: 'Hello Fresh', tags: '[]' });
    ins.run({ id: 'c', origin: 'other', source_name: 'bbcgoodfood.com', tags: '[]' });
    ins.run({ id: 'd', origin: 'other', source_name: null, tags: '[]' });
    old.close();

    const db = openDb(file);
    const row = (id: string) =>
      db.prepare('SELECT brand, tags_json FROM recipes WHERE id = ?').get(id) as {
        brand: string | null;
        tags_json: string;
      };
    expect(row('a').brand).toBe('Mine');
    expect(row('b').brand).toBe('HelloFresh');
    expect(row('c').brand).toBe('bbcgoodfood.com');
    expect(row('d').brand).toBeNull();
    expect(row('a').tags_json).toBe(
      '[{"group":"other","name":"pasta"},{"group":"other","name":"dinner"}]',
    );
    expect(row('b').tags_json).toBe('[]');
    db.close();
  });
});
