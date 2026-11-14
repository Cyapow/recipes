import type { Database } from 'better-sqlite3';
import crypto from 'node:crypto';
import { ingredientKey, type Pack, type Pricing } from './suggest.js';

export type Shop = { id: string; name: string; position: number };
export type StoredPack = Pack & { id: string };
export type IngredientInfo = { key: string; item: string; shopId: string | null; unit: string; packs: StoredPack[] };
export type SaveIngredient = { item: string; shopId: string | null; unit: string; packs: Pack[] };

type InfoRow = { key: string; item: string; shop_id: string | null; unit: string };
type PackRow = { id: string; key: string; label: string; amount: number | null; price_pence: number; clubcard_pence: number | null };

const BUDGET_KEY = 'planner.mealsBudgetPence';

export function createPlannerRepo(db: Database) {
  const shopRows = () => db.prepare('SELECT id, name, position FROM shops ORDER BY position, rowid').all() as Shop[];

  const save = db.transaction((key: string, i: SaveIngredient) => {
    db.prepare(
      `INSERT INTO ingredient_info (key, item, shop_id, unit, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET item = excluded.item, shop_id = excluded.shop_id, unit = excluded.unit, updated_at = excluded.updated_at`,
    ).run(key, i.item.trim().toLowerCase(), i.shopId, i.unit, new Date().toISOString());
    db.prepare('DELETE FROM ingredient_packs WHERE key = ?').run(key);
    const ins = db.prepare(
      'INSERT INTO ingredient_packs (id, key, label, amount, price_pence, clubcard_pence, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    i.packs.forEach((p, n) => ins.run(crypto.randomUUID(), key, p.label.trim(), p.amount, p.pricePence, p.clubcardPence, n));
  });

  return {
    listShops: shopRows,
    /** The first shop: where ingredients with no shop of their own are bought. */
    defaultShop(): Shop | undefined {
      return shopRows()[0];
    },
    addShop(name: string): Shop | 'exists' {
      const n = name.trim();
      if (db.prepare('SELECT 1 FROM shops WHERE name = ?').get(n)) return 'exists';
      const pos = (db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM shops').get() as { p: number }).p;
      const shop = { id: crypto.randomUUID(), name: n, position: pos };
      db.prepare('INSERT INTO shops (id, name, position) VALUES (?, ?, ?)').run(shop.id, shop.name, shop.position);
      return shop;
    },
    renameShop(id: string, name: string): 'ok' | 'exists' | 'missing' {
      const n = name.trim();
      const clash = db.prepare('SELECT id FROM shops WHERE name = ?').get(n) as { id: string } | undefined;
      if (clash && clash.id !== id) return 'exists';
      return db.prepare('UPDATE shops SET name = ? WHERE id = ?').run(n, id).changes > 0 ? 'ok' : 'missing';
    },
    /** The last shop cannot be removed. Its ingredients fall back to the default shop. */
    removeShop(id: string): 'ok' | 'last' | 'missing' {
      const all = shopRows();
      if (!all.some((s) => s.id === id)) return 'missing';
      if (all.length === 1) return 'last';
      db.prepare('DELETE FROM shops WHERE id = ?').run(id);
      return 'ok';
    },
    listInfo(): IngredientInfo[] {
      const packs = db.prepare('SELECT * FROM ingredient_packs ORDER BY position, rowid').all() as PackRow[];
      return (db.prepare('SELECT * FROM ingredient_info ORDER BY item').all() as InfoRow[]).map((r) => ({
        key: r.key, item: r.item, shopId: r.shop_id, unit: r.unit,
        packs: packs.filter((p) => p.key === r.key).map((p) => ({
          id: p.id, label: p.label, amount: p.amount, pricePence: p.price_pence, clubcardPence: p.clubcard_pence,
        })),
      }));
    },
    /** How each known ingredient is bought. A shop that is the default (or gone) reads as null. */
    pricing(): Map<string, Pricing> {
      const shops = shopRows();
      const names = new Map(shops.map((s, i) => [s.id, i === 0 ? null : s.name]));
      return new Map(
        this.listInfo().map((i) => [
          i.key,
          { shop: i.shopId ? (names.get(i.shopId) ?? null) : null, unit: i.unit, packs: i.packs },
        ]),
      );
    },
    /** Undefined when the name has no usable key. */
    saveIngredient(i: SaveIngredient): IngredientInfo | undefined {
      const key = ingredientKey(i.item);
      if (!key) return undefined;
      save(key, i);
      return this.listInfo().find((x) => x.key === key);
    },
    removeIngredient(item: string): boolean {
      return db.prepare('DELETE FROM ingredient_info WHERE key = ?').run(ingredientKey(item)).changes > 0;
    },
    getBudgetPence(): number | null {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(BUDGET_KEY) as { value: string } | undefined;
      const n = row ? Number(row.value) : NaN;
      return Number.isInteger(n) && n > 0 ? n : null;
    },
    setBudgetPence(pence: number | null): void {
      if (pence === null) db.prepare('DELETE FROM settings WHERE key = ?').run(BUDGET_KEY);
      else db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(BUDGET_KEY, String(pence));
    },
  };
}
export type PlannerRepo = ReturnType<typeof createPlannerRepo>;
