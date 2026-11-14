import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  addShop, deleteShop, listIngredients, removeIngredient, renameShop, saveIngredient,
  type IngredientRow, type Pack, type Shop,
} from '../api';
import { BackIcon } from '../components/Icons';
import { UNIT_CHOICES, formatAmount } from '../lib/amount';
import { formatPence, parseAmount, parsePence } from '../lib/money';
import { formatItem } from '../lib/text';

type PackDraft = { label: string; amount: string; price: string; club: string };

const toDraft = (p: Pack, unit: string): PackDraft => ({
  label: p.label,
  amount: p.amount === null ? '' : String(Number(p.amount.toFixed(2))),
  price: (p.pricePence / 100).toFixed(2),
  club: p.clubcardPence === null ? '' : (p.clubcardPence / 100).toFixed(2),
});
const blank: PackDraft = { label: '', amount: '', price: '', club: '' };
const unitLabel = (unit: string) => UNIT_CHOICES.find(([u]) => u === unit)?.[1] ?? `${unit}s`;

function summary(r: IngredientRow, shops: Shop[]): string {
  const shop = r.shopId ? shops.find((s) => s.id === r.shopId)?.name : null;
  const price =
    r.packs.length === 0
      ? 'No price yet'
      : r.packs.length === 1
        ? formatPence(r.packs[0]!.clubcardPence ?? r.packs[0]!.pricePence)
        : `${r.packs.length} pack sizes`;
  return [price, shop].filter(Boolean).join(' · ');
}

function IngredientEditor({ row, shops, onSaved, onRemoved }: {
  row: IngredientRow; shops: Shop[]; onSaved: () => void; onRemoved: () => void;
}) {
  const [shopId, setShopId] = useState(row.shopId ?? '');
  const [unit, setUnit] = useState(row.unit);
  const [packs, setPacks] = useState<PackDraft[]>(row.packs.length ? row.packs.map((p) => toDraft(p, row.unit)) : [blank]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const units = UNIT_CHOICES.some(([u]) => u === unit) ? UNIT_CHOICES : [...UNIT_CHOICES, [unit, `${unit}s`] as [string, string]];

  const set = (i: number, patch: Partial<PackDraft>) => setPacks(packs.map((p, n) => (n === i ? { ...p, ...patch } : p)));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const out: Pack[] = [];
    for (const [n, d] of packs.entries()) {
      if (!d.label.trim() && !d.amount.trim() && !d.price.trim() && !d.club.trim()) continue; // an untouched row
      const price = parsePence(d.price);
      const club = d.club.trim() ? parsePence(d.club) : null;
      const amount = d.amount.trim() ? parseAmount(d.amount, unit) : null;
      if (price === null) return setError(`Pack ${n + 1}: enter a price like 1.50`);
      if (d.club.trim() && club === null) return setError(`Pack ${n + 1}: enter the Clubcard price like 1.20`);
      if (club !== null && club > price) return setError(`Pack ${n + 1}: the Clubcard price is higher than the normal price`);
      if (d.amount.trim() && amount === null) {
        return setError(`Pack ${n + 1}: "covers" should be a number${unit === 'g' ? ' like 500 or 1kg' : unit === 'ml' ? ' like 500 or 1l' : ''}`);
      }
      out.push({ label: d.label.trim(), amount, pricePence: price, clubcardPence: club });
    }
    setBusy(true);
    setError(null);
    try {
      await saveIngredient({ item: row.item, shopId: shopId || null, unit, packs: out });
      onSaved();
    } catch {
      setError('Could not save');
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await removeIngredient(row.item);
      onRemoved();
    } catch {
      setError('Could not remove');
      setBusy(false);
    }
  }

  return (
    <form className="ingredient-editor" onSubmit={(e) => void save(e)}>
      <div className="editor-grid">
        <label>
          <span className="sub">Bought from</span>
          <select value={shopId} onChange={(e) => setShopId(e.target.value)} aria-label="Bought from">
            <option value="">{shops[0]?.name ?? 'Default shop'} (usual)</option>
            {shops.slice(1).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label>
          <span className="sub">Pack sizes are counted in</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Counted in">
            {units.map(([u, l]) => <option key={u} value={u}>{l}</option>)}
          </select>
        </label>
      </div>
      {row.usualUnit !== unit && row.recipeCount > 0 && (
        <p className="sub">Your recipes usually measure this in {unitLabel(row.usualUnit)}. Recipes using a different unit can't be added up, so they're flagged instead.</p>
      )}

      <h3 className="planner-sub">Ways to buy it</h3>
      <p className="sub">
        e.g. "Loose": covers 1, £0.30. "Bag of 3": covers 3, £0.80. Leave "covers" empty if one pack does for any amount.
      </p>
      {packs.map((d, i) => (
        <fieldset key={i} className="pack-row">
          <legend className="sub">Pack {i + 1}</legend>
          <label><span className="sub">Name</span>
            <input aria-label={`Pack ${i + 1} name`} value={d.label} placeholder="e.g. bag of 3" onChange={(e) => set(i, { label: e.target.value })} />
          </label>
          <label><span className="sub">Covers ({unitLabel(unit)})</span>
            <input aria-label={`Pack ${i + 1} covers`} inputMode="decimal" value={d.amount} placeholder="any" onChange={(e) => set(i, { amount: e.target.value })} />
          </label>
          <label><span className="sub">Price £</span>
            <input aria-label={`Pack ${i + 1} price`} inputMode="decimal" value={d.price} onChange={(e) => set(i, { price: e.target.value })} />
          </label>
          <label><span className="sub">Clubcard £</span>
            <input aria-label={`Pack ${i + 1} Clubcard price`} inputMode="decimal" value={d.club} onChange={(e) => set(i, { club: e.target.value })} />
          </label>
          {packs.length > 1 && (
            <button type="button" className="muted-btn" aria-label={`Remove pack ${i + 1}`} onClick={() => setPacks(packs.filter((_, n) => n !== i))}>Remove</button>
          )}
        </fieldset>
      ))}
      <button type="button" onClick={() => setPacks([...packs, blank])}>Add another pack size</button>

      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="shopping-actions">
        <button type="submit" className="primary share-btn" disabled={busy}>Save</button>
        {(row.packs.length > 0 || row.shopId !== null) && (
          <button type="button" className="danger clear-btn" disabled={busy} onClick={() => void remove()}>Forget prices</button>
        )}
      </div>
    </form>
  );
}

function Shops({ shops, onChanged }: { shops: Shop[]; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>, failure: string) {
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError((e as { status?: number }).status === 409 ? failure : 'Something went wrong');
    }
  }

  return (
    <details className="shops">
      <summary>Shops ({shops.map((s) => s.name).join(', ')})</summary>
      <p className="sub">The first shop is the one you usually order from. Other shops get their own section on the shopping list.</p>
      <ul className="rows">
        {shops.map((s, i) => (
          <li key={s.id} className="shop-row">
            <input
              aria-label={`Shop name ${i + 1}`}
              defaultValue={s.name}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== s.name) void run(() => renameShop(s.id, v), 'You already have a shop with that name');
              }}
            />
            {shops.length > 1 && (
              <button type="button" className="muted-btn" aria-label={`Remove ${s.name}`} onClick={() => void run(() => deleteShop(s.id), 'You need at least one shop')}>Remove</button>
            )}
          </li>
        ))}
      </ul>
      <form
        className="shop-add"
        onSubmit={(e) => {
          e.preventDefault();
          const v = name.trim();
          if (v) void run(() => addShop(v).then(() => setName('')), 'You already have a shop with that name');
        }}
      >
        <input aria-label="New shop" placeholder="e.g. Aldi" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit">Add shop</button>
      </form>
      {error && <p className="field-error" role="alert">{error}</p>}
    </details>
  );
}

export function Ingredients() {
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<IngredientRow[] | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [onlyUnpriced, setOnlyUnpriced] = useState(false);
  const q = params.get('q') ?? '';

  const load = useCallback(() => {
    listIngredients()
      .then((r) => { setRows(r.ingredients); setShops(r.shops); setError(null); })
      .catch(() => setError('Could not load ingredients'));
  }, []);
  useEffect(load, [load]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => (!t || r.item.includes(t)) && (!onlyUnpriced || r.packs.length === 0));
  }, [rows, q, onlyUnpriced]);
  const unpricedCount = (rows ?? []).filter((r) => r.packs.length === 0).length;

  return (
    <main className="page ingredients">
      <header className="cook-bar">
        <Link className="btn round-btn" to="/planner" aria-label="Back to the meal planner"><BackIcon /></Link>
      </header>
      <h1>Ingredients and prices</h1>
      <p className="sub">Set what each ingredient usually costs, and how it comes: loose, in packs, from which shop.</p>

      <Shops shops={shops} onChanged={load} />

      <label className="search-field">
        <input type="search" aria-label="Search ingredients" placeholder="Search ingredients" value={q}
          onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })} />
      </label>
      <label className="butcher-flag">
        <input type="checkbox" checked={onlyUnpriced} onChange={(e) => setOnlyUnpriced(e.target.checked)} />
        <span>Only ones with no price yet{rows ? ` (${unpricedCount})` : ''}</span>
      </label>

      {error && <p className="field-error" role="alert">{error}</p>}
      {rows && shown.length === 0 && <p className="empty">{rows.length === 0 ? 'No ingredients yet. Add some recipes first.' : 'Nothing matches.'}</p>}
      <ul className="rows shopping-rows">
        {shown.map((r) => {
          const isOpen = open === r.key;
          return (
            <li key={r.key} className="ingredient-item">
              <button type="button" className="ingredient-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.key)}>
                <span className="shopping-meta">
                  <span className="shopping-text">{formatItem(r.item)}</span>
                  <span className="sub">{summary(r, shops)} · {r.recipeCount === 0 ? 'not in any recipe' : `in ${r.recipeCount} ${r.recipeCount === 1 ? 'recipe' : 'recipes'}`}</span>
                </span>
              </button>
              {isOpen && (
                <IngredientEditor
                  row={r}
                  shops={shops}
                  onSaved={() => { setOpen(null); load(); }}
                  onRemoved={() => { setOpen(null); load(); }}
                />
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
