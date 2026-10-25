import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { addToShopping, ApiError, getRecipe, type Recipe } from '../api';
import { BackIcon, CartIcon } from '../components/Icons';
import { formatAmount, formatIngredientLine, formatMinutes, formatQuantity, originLabel } from '../lib/text';

type Notice =
  | { kind: 'added'; count: number }
  | { kind: 'duplicate'; title: string }
  | { kind: 'changed' }
  | { kind: 'error' };

function LoadFailure({ message }: { message: string }) {
  return (
    <main className="page">
      <p className="field-error" role="alert">{message}</p>
      <Link className="btn" to="/">Back to library</Link>
    </main>
  );
}

/** Keyed by id so all page state (ticks, notices, in-flight guard) is remounted per recipe. */
export function RecipeOverview() {
  const { id = '' } = useParams();
  const [reloads, setReloads] = useState(0);
  return <Overview key={`${id}:${reloads}`} id={id} onReload={() => setReloads((n) => n + 1)} />;
}

function Overview({ id, onReload }: { id: string; onReload: () => void }) {
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [have, setHave] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const inFlight = useRef(false);
  const addAgainRef = useRef<HTMLButtonElement>(null);
  const duplicate = notice?.kind === 'duplicate';

  useEffect(() => {
    if (duplicate) addAgainRef.current?.focus();
  }, [duplicate]);

  useEffect(() => {
    let live = true;
    getRecipe(id)
      .then((r) => live && setRecipe(r))
      .catch((e: unknown) => {
        if (live) setError(e instanceof ApiError && e.status === 404 ? 'Recipe not found' : 'Could not load recipe');
      });
    return () => {
      live = false;
    };
  }, [id]);

  if (error) return <LoadFailure message={error} />;
  if (!recipe) return <main className="page"><p className="empty">Loading…</p></main>;

  const total = recipe.ingredients.length;
  const needed = recipe.ingredients.map((_, i) => i).filter((i) => !have.has(i));
  const allTicked = total > 0 && needed.length === 0;
  const meta = [
    recipe.servings != null &&
      `${formatQuantity(recipe.servings)} ${recipe.servings === 1 ? 'serving' : 'servings'}`,
    formatMinutes(recipe.prepMinutes) && `Prep ${formatMinutes(recipe.prepMinutes)}`,
    formatMinutes(recipe.cookMinutes) && `Cook ${formatMinutes(recipe.cookMinutes)}`,
  ].filter(Boolean).join(' · ');

  const toggle = (i: number) => {
    setNotice((n) => (n?.kind === 'added' ? null : n));
    setHave((prev) => {
      const next = new Set(prev);
      if (!next.delete(i)) next.add(i);
      return next;
    });
  };
  const setAll = (all: boolean) => {
    setNotice((n) => (n?.kind === 'added' ? null : n));
    setHave(all ? new Set(recipe!.ingredients.map((_, i) => i)) : new Set());
  };

  async function add(force?: boolean) {
    if (inFlight.current || needed.length === 0) return;
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    const rid = recipe!.id;
    try {
      const res = await addToShopping(rid, needed, force, recipe!.updatedAt);
      setNotice({ kind: 'added', count: res.added });
    } catch (e) {
      const body = e instanceof ApiError && e.status === 409 ? (e.body as { error?: string; recipeTitle?: string } | undefined) : undefined;
      if (body?.error === 'recipe_changed') setNotice({ kind: 'changed' });
      else setNotice(body ? { kind: 'duplicate', title: body.recipeTitle ?? recipe!.title } : { kind: 'error' });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="page overview">
      <header className="cook-bar">
        <Link className="btn round-btn" to="/" aria-label="Back to library"><BackIcon /></Link>
        <span className="cook-label">{originLabel(recipe)}{recipe.tags[0] ? ` · ${recipe.tags[0]}` : ''}</span>
        <Link className="btn" to={`/recipe/${encodeURIComponent(recipe.id)}/edit`}>Edit</Link>
        <Link className="btn round-btn" to="/shopping" aria-label="Shopping list"><CartIcon /></Link>
      </header>
      <h1>{recipe.title}</h1>
      <p className="sub">{meta}</p>
      {recipe.imageIds[0] && (
        <img className="cook-hero" src={`/api/images/${recipe.imageIds[0]}`} alt={recipe.title} />
      )}

      {total === 0 ? (
        <p className="empty">No ingredients listed.</p>
      ) : (
        <section className="have-section">
          <h2>What do we already have?</h2>
          <p className="hint">Tick the ingredients that are already in the cupboard. We'll list the rest.</p>
          <div className="have-bar">
            <span className="have-count">{have.size} of {total} ticked</span>
            <button type="button" className="link-btn" onClick={() => setAll(!allTicked)}>
              {allTicked ? 'Untick all' : 'Tick all'}
            </button>
          </div>
          <ul className="have-list">
            {recipe.ingredients.map((ing, i) => {
              const ticked = have.has(i);
              const qty = formatAmount(ing);
              return (
                <li key={i}>
                  <label className={`have-row${ticked ? ' ticked' : ''}`}>
                    <input type="checkbox" checked={ticked} onChange={() => toggle(i)} aria-label={`We have this: ${formatIngredientLine(ing)}`} />
                    <span className="have-text">
                      {qty && <b>{qty}</b>}
                      <span>{ing.item}{ing.note ? ` (${ing.note})` : ''}</span>
                    </span>
                    <span className="have-tag">{ticked ? 'Have it' : 'Need'}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {notice?.kind === 'added' && (
        <p className="status" role="status">
          Added {notice.count} {notice.count === 1 ? 'item' : 'items'} to your shopping list{' '}
          <Link to="/shopping">View shopping list</Link>
        </p>
      )}
      {notice?.kind === 'error' && <p className="field-error" role="alert">Could not add to the shopping list</p>}
      {notice?.kind === 'changed' && (
        <div className="status dup" role="alert">
          <p>This recipe was changed on another device. Reload to see the latest ingredients.</p>
          <div className="dup-actions">
            <button type="button" className="primary" onClick={onReload}>Reload</button>
          </div>
        </div>
      )}
      {notice?.kind === 'duplicate' && (
        <div className="status dup" role="alert">
          <p>{notice.title} is already on your shopping list.</p>
          <div className="dup-actions">
            <button type="button" ref={addAgainRef} className="primary" onClick={() => void add(true)}>Add again</button>
            <button type="button" onClick={() => setNotice(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className={`overview-actions${total === 0 ? ' solo' : ''}`}>
        <Link className="btn outline" to={`/recipe/${encodeURIComponent(recipe.id)}/cook`}>Start cooking</Link>
        {total > 0 && (
          <button type="button" className={`primary${needed.length === 0 ? ' muted-btn' : ''}${busy ? ' busy' : ''}`} aria-disabled={needed.length === 0 || busy} aria-busy={busy} onClick={() => void add()}>
            {busy ? 'Adding…' : needed.length === 0 ? 'Nothing to add' : `Add ${needed.length} to shopping list`}
          </button>
        )}
      </div>
    </main>
  );
}
