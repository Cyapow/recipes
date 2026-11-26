import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  addPlanToShopping, getBudget, getPlan, listRecipes, saveBudget,
  type BasketItem, type Plan, type RecipeSummary,
} from '../api';
import { BackIcon } from '../components/Icons';
import { formatAmount } from '../lib/amount';
import { formatPence, parsePence } from '../lib/money';
import { formatItem } from '../lib/text';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function BasketRow({ i }: { i: BasketItem }) {
  const picks = i.picks.map((p) => `${p.count} × ${p.label || 'pack'}`).join(' + ');
  return (
    <li className="shopping-row planner-item">
      <span className="shopping-meta">
        <span className="shopping-text">{formatItem(i.item)}</span>
        <span className="sub">
          {i.pricePence === null ? 'No price yet' : `${formatPence(i.pricePence)}${picks ? ` · ${picks}` : ''}`}
          {i.usedBy.length > 1 && ` · shared by ${i.usedBy.length} recipes`}
        </span>
        {i.pricePence !== null && i.needed !== null && i.needed > 0 && (
          <span className="sub">
            Needs {formatAmount(i.needed, i.unit)}
            {i.leftover ? `, ${formatAmount(i.leftover, i.unit)} spare` : ''}
          </span>
        )}
        {i.pricePence !== null && i.unclear && (
          <span className="sub">Some use isn't measured (a vague amount or a different unit), so this may be a little low.</span>
        )}
      </span>
      <Link className="btn edit-price" to={`/ingredients?q=${encodeURIComponent(i.item)}`} aria-label={`${i.pricePence === null ? 'Set a price for' : 'Edit prices for'} ${i.item}`}>
        {i.pricePence === null ? 'Set price' : 'Edit'}
      </Link>
    </li>
  );
}

export function Planner() {
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null);
  const [params] = useSearchParams();
  // A meal hands its recipes over as repeated ?recipe=<id>; they start ticked.
  const fromUrl = useRef([...new Set(params.getAll('recipe'))]);
  const [picked, setPicked] = useState<string[]>(fromUrl.current);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [budget, setBudget] = useState('');
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [adding, setAdding] = useState(false);
  const seq = useRef(0);

  const refresh = useCallback((ids: string[]) => {
    const mine = ++seq.current;
    if (ids.length === 0) return setPlan(null);
    getPlan(ids)
      .then((p) => mine === seq.current && (setPlan(p), setError(null)))
      .catch(() => mine === seq.current && setError('Could not work out the plan'));
  }, []);

  useEffect(() => {
    listRecipes()
      .then((list) => {
        setRecipes(list);
        // Ids from the URL may name recipes that have since gone, and the plan would refuse them.
        const known = new Set(list.map((r) => r.id));
        const start = fromUrl.current.filter((id) => known.has(id));
        if (start.length === 0) return;
        setPicked(start);
        refresh(start);
      })
      .catch(() => setError('Could not load recipes'));
    getBudget().then((b) => b !== null && setBudget((b / 100).toFixed(2))).catch(() => undefined);
  }, [refresh]);

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
      if (r.elsewhere.length) parts.push(`Sorted by shop: ${r.elsewhere.map((e) => `${formatItem(e.item)} (${e.shop})`).join(', ')}`);
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
  const pct = budgetPence ? Math.min(100, Math.round((total / budgetPence) * 100)) : 0;
  const defaultShop = plan?.defaultShop ?? '';
  const shopNames = plan ? [null, ...new Set(plan.basket.items.map((i) => i.shop).filter((s): s is string => s !== null))] : [];
  const subtotal = (shop: string | null) => plan?.basket.byShop.find((b) => b.shop === shop)?.totalPence ?? 0;

  return (
    <main className="page planner">
      <header className="cook-bar">
        <Link className="btn round-btn" to="/" aria-label="Back to library"><BackIcon /></Link>
        <Link className="btn" to="/ingredients">Ingredients and prices</Link>
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
            {shopNames.map((shop) => {
              const items = plan.basket.items.filter((i) => i.shop === shop);
              if (items.length === 0) return null;
              return (
                <div key={shop ?? 'default'}>
                  {shopNames.length > 1 && (
                    <h3 className="planner-sub">{shop ?? defaultShop} · {formatPence(subtotal(shop))}</h3>
                  )}
                  <ul className="rows shopping-rows">
                    {items.map((i) => <BasketRow key={i.key} i={i} />)}
                  </ul>
                </div>
              );
            })}
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
                          : `Needs ${plural(s.extra.length, 'extra thing', 'extra things')}: ${s.extra.map((x) => formatItem(x.item) + (x.shop ? ` (${x.shop})` : '')).join(', ')}`}
                      </p>
                      <p className="sub">
                        Uses what you have: {s.shared.map(formatItem).join(', ')}
                        {` · adds about ${formatPence(s.extraPence)}${s.unpricedExtra.length ? ' (plus unpriced items)' : ''}`}
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
