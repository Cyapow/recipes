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

const selectAll = (e: { currentTarget: HTMLTextAreaElement }) => {
  const t = e.currentTarget;
  t.select();
  t.setSelectionRange(0, t.value.length); // iOS ignores select() alone
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const ARM_GUARD_MS = 500;
const REFETCH_GAP_MS = 300;
const signature = (l: ShoppingItem[]) => l.map((i) => `${i.id}:${i.text}`).join('|');

export function Shopping() {
  const [items, setItems] = useState<ShoppingItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'none' });
  const [confirmClear, setConfirmClear] = useState(false);
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
  const seq = useRef(0);
  const lastLoad = useRef(-Infinity);
  const inFlight = useRef(false); // Share / Clear
  const pending = useRef(new Set<string>()); // per-row removals
  const itemsRef = useRef<ShoppingItem[] | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const armedAt = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const removeBtns = useRef(new Map<string, HTMLButtonElement>());
  const focusTarget = useRef<string | 'heading' | null>(null);

  const disarm = useCallback(() => {
    window.clearTimeout(timer.current);
    setConfirmClear(false);
  }, []);

  const applyItems = useCallback((next: ShoppingItem[]) => {
    const prev = itemsRef.current;
    itemsRef.current = next;
    setItems(next);
    if (prev && signature(prev) !== signature(next)) {
      setStatus({ kind: 'none' });
      disarm();
    }
  }, [disarm]);

  const load = useCallback((fromEvent = false) => {
    const now = Date.now();
    if (fromEvent && now - lastLoad.current < REFETCH_GAP_MS) return;
    lastLoad.current = now;
    const mine = ++seq.current;
    listShopping()
      .then((r) => {
        if (mine !== seq.current) return;
        applyItems(r);
        setLoadError(false);
      })
      .catch(() => {
        if (mine === seq.current) setLoadError(true);
      });
  }, [applyItems]);

  useEffect(() => {
    load();
    const onFocus = () => load(true);
    const onVisible = () => {
      if (document.visibilityState !== 'hidden') load(true);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      seq.current++;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearTimeout(timer.current);
    };
  }, [load]);

  useEffect(() => {
    const t = focusTarget.current;
    if (!t) return;
    focusTarget.current = null;
    if (t === 'heading') heading.current?.focus();
    else removeBtns.current.get(t)?.focus();
  }, [items]);

  async function remove(it: ShoppingItem) {
    if (pending.current.has(it.id)) return;
    disarm();
    pending.current.add(it.id);
    setRemoving(new Set(pending.current));
    setActionError(null);
    try {
      await removeShoppingItem(it.id);
      seq.current++; // an older in-flight fetch must not bring the row back
      const cur = itemsRef.current ?? [];
      const idx = cur.findIndex((x) => x.id === it.id);
      const rest = cur.filter((x) => x.id !== it.id);
      const neighbour = rest[idx] ?? rest[idx - 1];
      focusTarget.current = neighbour ? neighbour.id : 'heading';
      applyItems(rest);
      setStatus({ kind: 'text', text: `Removed ${it.text}` });
    } catch {
      setActionError(`Could not remove ${it.text}`);
    } finally {
      pending.current.delete(it.id);
      setRemoving(new Set(pending.current));
    }
  }

  function onClear() {
    if (inFlight.current) return;
    if (!confirmClear) {
      armedAt.current = Date.now();
      setConfirmClear(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setConfirmClear(false), CONFIRM_MS);
      return;
    }
    if (Date.now() - armedAt.current < ARM_GUARD_MS) return;
    disarm();
    inFlight.current = true;
    setActionError(null);
    clearShopping()
      .then(() => {
        seq.current++;
        applyItems([]);
        setStatus({ kind: 'none' });
      })
      .catch(() => setActionError('Could not clear the list'))
      .finally(() => {
        inFlight.current = false;
      });
  }

  async function onShare() {
    if (inFlight.current) return;
    disarm();
    inFlight.current = true;
    setActionError(null);
    try {
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
    } finally {
      inFlight.current = false;
    }
  }

  const recipes = new Set(items?.flatMap((i) => i.sources.map((s) => s.recipeId))).size;

  return (
    <main className="page shopping">
      <header className="cook-bar">
        <Link className="btn round-btn" to="/" aria-label="Back to library"><BackIcon /></Link>
      </header>
      <h1 ref={heading} tabIndex={-1}>Shopping list</h1>

      {loadError && items && <p className="hint">Couldn't refresh the list</p>}
      {loadError && !items && (
        <div className="load-error">
          <p className="field-error" role="alert">Could not load the shopping list</p>
          <button type="button" onClick={() => load()}>Retry</button>
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
          <p className="sub">{plural(items.length, 'item', 'items')}{recipes > 0 && ` from ${plural(recipes, 'recipe', 'recipes')}`}</p>
          <ul className="rows shopping-rows">
            {items.map((it) => (
              <li key={it.id} className="shopping-row">
                <span className="shopping-meta">
                  <span className="shopping-text">{it.text}</span>
                  {it.sources.length > 0 && (
                    <span className="sub">{it.sources.map((s) => s.title).join(', ')}</span>
                  )}
                </span>
                <button
                  type="button"
                  className="round-btn remove-btn"
                  aria-label={`Remove ${it.text}`}
                  aria-busy={removing.has(it.id) || undefined}
                  ref={(el) => { if (el) removeBtns.current.set(it.id, el); else removeBtns.current.delete(it.id); }}
                  onClick={() => void remove(it)}
                >
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
            <button type="button" className={`danger clear-btn${confirmClear ? ' confirming' : ''}`} onClick={onClear} onBlur={disarm}>
              {confirmClear ? 'Tap again to clear' : 'Clear list'}
            </button>
          )}
        </div>
      )}

      <p className="hint" role="status">{status.kind === 'text' ? status.text : ''}</p>
      {status.kind === 'manual' && (
        <div className="manual-share">
          <p className="hint" id="manual-hint">Copy this list</p>
          <textarea
            readOnly
            aria-label="Shopping list text, copy this"
            aria-describedby="manual-hint"
            value={status.text}
            rows={Math.min(12, status.text.split('\n').length + 1)}
            onFocus={selectAll}
            onClick={selectAll}
          />
        </div>
      )}
    </main>
  );
}
