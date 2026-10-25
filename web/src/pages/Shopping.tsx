import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { clearShopping, listShopping, removeShoppingItem, type ShoppingItem } from '../api';
import { BackIcon } from '../components/Icons';
import { shareText, shoppingShareText } from '../lib/share';

const CONFIRM_MS = 4000;

type Status =
  | { kind: 'none' }
  | { kind: 'text'; text: string }
  | { kind: 'manual'; text: string };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function Shopping() {
  const [items, setItems] = useState<ShoppingItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'none' });
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const inFlight = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  const load = useCallback(() => {
    const mine = ++seq.current;
    listShopping()
      .then((r) => {
        if (mine !== seq.current) return;
        setItems(r);
        setLoadError(false);
      })
      .catch(() => {
        if (mine === seq.current) setLoadError(true);
      });
  }, []);

  useEffect(() => {
    load();
    const onVisible = () => {
      if (document.visibilityState !== 'hidden') load();
    };
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      seq.current++;
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearTimeout(timer.current);
    };
  }, [load]);

  async function guarded(fn: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await fn();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const remove = (it: ShoppingItem) =>
    guarded(async () => {
      setActionError(null);
      try {
        await removeShoppingItem(it.id);
        seq.current++; // an older in-flight fetch must not bring the row back
        setItems((cur) => cur && cur.filter((x) => x.id !== it.id));
      } catch {
        setActionError(`Could not remove ${it.text}`);
      }
    });

  function onClear() {
    if (inFlight.current) return;
    if (!confirmClear) {
      setConfirmClear(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setConfirmClear(false), CONFIRM_MS);
      return;
    }
    window.clearTimeout(timer.current);
    setConfirmClear(false);
    void guarded(async () => {
      setActionError(null);
      try {
        await clearShopping();
        seq.current++;
        setItems([]);
        setStatus({ kind: 'none' });
      } catch {
        setActionError('Could not clear the list');
      }
    });
  }

  const onShare = () =>
    guarded(async () => {
      setActionError(null);
      if (!items || items.length === 0) {
        setStatus({ kind: 'text', text: 'Nothing to share' });
        return;
      }
      const text = shoppingShareText(items);
      const outcome = await shareText(text);
      setStatus(
        outcome === 'copied' ? { kind: 'text', text: 'Copied to the clipboard' }
          : outcome === 'manual' ? { kind: 'manual', text }
          : { kind: 'none' },
      );
    });

  const recipes = new Set(items?.flatMap((i) => i.sources.map((s) => s.recipeId))).size;

  return (
    <main className="page shopping">
      <header className="cook-bar">
        <Link className="btn round-btn" to="/" aria-label="Back to library"><BackIcon /></Link>
      </header>
      <h1>Shopping list</h1>

      {loadError && (
        <div className="load-error">
          <p className="field-error" role="alert">Could not load the shopping list</p>
          <button type="button" onClick={load}>Retry</button>
        </div>
      )}
      {actionError && <p className="field-error" role="alert">{actionError}</p>}

      {items && items.length === 0 && (
        <>
          <p className="empty">Nothing here yet. Open a recipe and tick what you already have.</p>
          <Link className="btn" to="/">Back to library</Link>
        </>
      )}

      {items && items.length > 0 && (
        <>
          <p className="sub">{plural(items.length, 'item', 'items')} from {plural(recipes, 'recipe', 'recipes')}</p>
          <ul className="rows shopping-rows">
            {items.map((it) => (
              <li key={it.id} className="shopping-row">
                <span className="shopping-meta">
                  <span className="shopping-text">{it.text}</span>
                  {it.sources.length > 0 && (
                    <span className="sub">{it.sources.map((s) => s.title).join(', ')}</span>
                  )}
                </span>
                <button type="button" className="round-btn remove-btn" aria-label={`Remove ${it.text}`} onClick={() => void remove(it)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {items && (
        <div className="shopping-actions">
          <button type="button" className="primary share-btn" onClick={() => void onShare()}>Share list</button>
          {items.length > 0 && (
            <button type="button" className={`danger clear-btn${confirmClear ? ' confirming' : ''}`} onClick={onClear}>
              {confirmClear ? 'Tap again to clear' : 'Clear list'}
            </button>
          )}
        </div>
      )}

      <p className="hint" role="status">{status.kind === 'text' ? status.text : ''}</p>
      {status.kind === 'manual' && (
        <div className="manual-share">
          <p className="hint">Copy this list</p>
          <textarea readOnly value={status.text} rows={Math.min(12, status.text.split('\n').length + 1)} onFocus={(e) => e.currentTarget.select()} />
        </div>
      )}
    </main>
  );
}
