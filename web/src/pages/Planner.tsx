import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  addPlanToShopping, getBudget, getPlan, listRecipes, saveBudget, savePrice,
  type BasketItem, type Plan, type RecipeSummary,
} from '../api';
import { BackIcon } from '../components/Icons';
import { formatPence, parsePence } from '../lib/money';
import { formatItem } from '../lib/text';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const pounds = (pence: number | null) => (pence === null ? '' : (pence / 100).toFixed(2));

function PriceEditor({ item, initial, onSaved }: { item: string; initial?: BasketItem; onSaved: () => void }) {
  const [butcher, setButcher] = useState(initial?.butcher ?? false);
  const [price, setPrice] = useState(pounds(initial?.normalPence ?? null));
  const [club, setClub] = useState(pounds(initial?.clubcardPence ?? null));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const p = parsePence(price);
    const c = !butcher && club.trim() ? parsePence(club) : null;
    if (p === null || (!butcher && club.trim() && c === null)) return setError('Enter prices like 1.50');
    if (c !== null && c > p) return setError('Clubcard price is higher than the normal price');
    setBusy(true);
    setError(null);
    try {
      await savePrice(item, p, c, butcher);
      onSaved();
    } catch {
      setError('Could not save the price');
      setBusy(false);
    }
  }

  return (
    <form className="price-editor" onSubmit={(e) => void save(e)}>
      <label className="butcher-flag">
        <input type="checkbox" checked={butcher} onChange={(e) => setButcher(e.target.checked)} />
        <span>From the butcher</span>
      </label>
      <label>
        <span className="sub">{butcher ? 'Usual cost £' : 'Price £'}</span>
        <input inputMode="decimal" aria-label={`Price of ${item}`} value={price} onChange={(e) => setPrice(e.target.value)} />
      </label>
      {!butcher && (
        <label>
          <span className="sub">Clubcard £</span>
          <input inputMode="decimal" aria-label={`Clubcard price of ${item}`} value={club} onChange={(e) => setClub(e.target.value)} />
        </label>
      )}
      <button type="submit" disabled={busy}>Save</button>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
  );
}

function BasketRow({ i, onSaved }: { i: BasketItem; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const open = editing || i.pricePence === null;
  return (
    <li className="shopping-row planner-item">
      <span className="shopping-meta">
        <span className="shopping-text">{formatItem(i.item)}</span>
        <span className="sub">
          {i.pricePence !== null ? `${i.butcher ? 'About ' : ''}${formatPence(i.pricePence)}` : 'No price yet'}
          {i.usedBy.length > 1 && ` · shared by ${i.usedBy.length} recipes`}
        </span>
        {open && <PriceEditor item={i.item} initial={i} onSaved={() => { setEditing(false); onSaved(); }} />}
      </span>
      {!open && (
        <button type="button" className="edit-price" aria-label={`Edit price of ${i.item}`} onClick={() => setEditing(true)}>Edit</button>
      )}
    </li>
  );
}

export function Planner() {
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [budget, setBudget] = useState('');
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [adding, setAdding] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    listRecipes().then(setRecipes).catch(() => setError('Could not load recipes'));
    getBudget().then((b) => b !== null && setBudget((b / 100).toFixed(2))).catch(() => undefined);
  }, []);

  const refresh = useCallback((ids: string[]) => {
    const mine = ++seq.current;
    if (ids.length === 0) return setPlan(null);
    getPlan(ids)
      .then((p) => mine === seq.current && (setPlan(p), setError(null)))
      .catch(() => mine === seq.current && setError('Could not work out the plan'));
  }, []);

  function toggle(id: string) {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    setPicked(next);
    setStatus('');
    refresh(next);
  }

  async function onBudgetBlur() {
    const text = budget.trim();
    const pence = text ? parsePence(text) : null;
    if (text && pence === null) return setBudgetError('Enter an amount like 70');
    setBudgetError(null);
    try {
      await saveBudget(pence);
      refresh(picked);
    } catch {
      setBudgetError('Could not save the budget');
    }
  }

  async function addAll() {
    if (!plan || adding) return;
    setAdding(true);
    setStatus('');
    try {
      const r = await addPlanToShopping(plan.selected.map((x) => x.id));
      const parts = [`Added ${plural(r.added, 'recipe', 'recipes')} to the shopping list`];
      if (r.butcherItems.length) parts.push(`Butcher items are in their own section: ${r.butcherItems.map(formatItem).join(', ')}`);
      if (r.alreadyOnList.length) parts.push(`Already on the list: ${r.alreadyOnList.join(', ')}`);
      setStatus(parts.join('. '));
    } catch {
      setStatus('Could not add everything to the shopping list');
    } finally {
      setAdding(false);
    }
  }

  const total = plan?.basket.totalPence ?? 0;
  const budgetPence = plan?.budgetPence ?? null;
  const over = budgetPence !== null && total > budgetPence;
  const shopItems = plan?.basket.items.filter((i) => !i.butcher) ?? [];
  const butcherItems = plan?.basket.items.filter((i) => i.butcher) ?? [];
  const pct = budgetPence ? Math.min(100, Math.round((total / budgetPence) * 100)) : 0;

  return (
    <main className="page planner">
      <header className="cook-bar">
        <Link className="btn round-btn" to="/" aria-label="Back to library"><BackIcon /></Link>
      </header>
      <h1>Meal planner</h1>
      <p className="sub">Pick a recipe or two. We'll suggest others that need only a few extra things.</p>

      <label className="budget-field">
        Weekly meals budget (£)
        <input
          inputMode="decimal"
          placeholder="e.g. 70"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          onBlur={() => void onBudgetBlur()}
        />
        <span className="sub">Just the part of the shop that goes on these recipes, not the whole £130.</span>
      </label>
      {budgetError && <p className="field-error" role="alert">{budgetError}</p>}
      {error && <p className="field-error" role="alert">{error}</p>}

      <h2>Your meals</h2>
      {recipes && recipes.length === 0 && <p className="empty">No recipes yet.</p>}
      <ul className="rows planner-recipes">
        {recipes?.map((r) => (
          <li key={r.id}>
            <label className="planner-pick">
              <input type="checkbox" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} />
              <span>{r.title}</span>
            </label>
          </li>
        ))}
      </ul>

      {plan && (
        <>
          <section aria-label="Cost so far">
            <h2>Estimated cost</h2>
            <p className="planner-total">
              {formatPence(total)}
              {budgetPence !== null && <span className="sub"> of {formatPence(budgetPence)}</span>}
            </p>
            {budgetPence !== null && (
              <div className="meter" role="img" aria-label={`${pct}% of budget`}>
                <div className={`meter-fill${over ? ' over' : ''}`} style={{ width: `${pct}%` }} />
              </div>
            )}
            {over && <p className="field-error" role="status">{formatPence(total - budgetPence!)} over budget</p>}
            {budgetPence !== null && !over && (
              <p className="sub" role="status">{formatPence(budgetPence - total)} left</p>
            )}
            {plan.basket.unpriced.length > 0 && (
              <p className="sub">
                {plural(plan.basket.unpriced.length, 'item has', 'items have')} no price yet, so this is a minimum.
              </p>
            )}
            <ul className="rows shopping-rows">
              {shopItems.map((i) => <BasketRow key={i.key} i={i} onSaved={() => refresh(picked)} />)}
            </ul>
            {butcherItems.length > 0 && (
              <>
                <h3 className="planner-sub">From the butcher · about {formatPence(plan.basket.butcherPence)}</h3>
                <p className="sub">Kept in their own section on the shopping list. Included in the total at your usual cost.</p>
                <ul className="rows shopping-rows">
                  {butcherItems.map((i) => <BasketRow key={i.key} i={i} onSaved={() => refresh(picked)} />)}
                </ul>
              </>
            )}
          </section>

          {plan.suggestions.length > 0 && (
            <section aria-label="Suggestions">
              <h2>Goes well with those</h2>
              <ul className="rows">
                {plan.suggestions.map((s) => (
                  <li key={s.id} className="planner-suggestion">
                    <div>
                      <strong>{s.title}</strong>
                      <p className="sub">
                        {s.extra.length === 0
                          ? 'Nothing extra to buy'
                          : `Needs ${plural(s.extra.length, 'extra thing', 'extra things')}: ${s.extra.map((x) => formatItem(x) + (s.butcherExtra.includes(x) ? ' (butcher)' : '')).join(', ')}`}
                      </p>
                      <p className="sub">
                        Uses what you have: {s.shared.map(formatItem).join(', ')}
                        {s.extra.length > 0 && ` · about ${formatPence(s.extraPence)} more${s.unpricedExtra.length ? ' (plus unpriced items)' : ''}`}
                      </p>
                    </div>
                    <button type="button" onClick={() => toggle(s.id)} aria-label={`Add ${s.title}`}>Add</button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="shopping-actions">
            <button type="button" className="primary share-btn" disabled={adding} onClick={() => void addAll()}>
              Add {plural(plan.selected.length, 'recipe', 'recipes')} to shopping list
            </button>
          </div>
          <p className="hint" role="status">{status}</p>
        </>
      )}
    </main>
  );
}
