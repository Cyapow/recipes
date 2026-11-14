import type { Database } from 'better-sqlite3';
import { ingredientKey, type Price } from './suggest.js';

export type StoredPrice = Price & { key: string; item: string; packNote: string | null; source: string; updatedAt: string };

type Row = {
  key: string; item: string; price_pence: number; clubcard_pence: number | null;
  pack_note: string | null; source: string; updated_at: string;
};

const BUDGET_KEY = 'planner.mealsBudgetPence';

export function createPlannerRepo(db: Database) {
  const toPrice = (r: Row): StoredPrice => ({
    key: r.key, item: r.item, pricePence: r.price_pence, clubcardPence: r.clubcard_pence,
    packNote: r.pack_note, source: r.source, updatedAt: r.updated_at,
  });
  return {
    listPrices(): StoredPrice[] {
      return (db.prepare('SELECT * FROM ingredient_prices ORDER BY item').all() as Row[]).map(toPrice);
    },
    priceMap(): Map<string, Price> {
      return new Map(this.listPrices().map((p) => [p.key, { pricePence: p.pricePence, clubcardPence: p.clubcardPence }]));
    },
    /** Returns undefined when the name has no usable key. */
    setPrice(
      item: string,
      p: { pricePence: number; clubcardPence: number | null; packNote?: string | null; source?: string },
    ): StoredPrice | undefined {
      const key = ingredientKey(item);
      if (!key) return undefined;
      db.prepare(
        `INSERT INTO ingredient_prices (key, item, price_pence, clubcard_pence, pack_note, source, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET item = excluded.item, price_pence = excluded.price_pence,
           clubcard_pence = excluded.clubcard_pence, pack_note = excluded.pack_note,
           source = excluded.source, updated_at = excluded.updated_at`,
      ).run(key, item.trim().toLowerCase(), p.pricePence, p.clubcardPence, p.packNote ?? null, p.source ?? 'manual', new Date().toISOString());
      return toPrice(db.prepare('SELECT * FROM ingredient_prices WHERE key = ?').get(key) as Row);
    },
    removePrice(item: string): boolean {
      return db.prepare('DELETE FROM ingredient_prices WHERE key = ?').run(ingredientKey(item)).changes > 0;
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
