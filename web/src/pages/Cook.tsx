import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getRecipe, type Recipe } from '../api';
import { CameraIcon, CloseIcon, ListIcon, SunIcon } from '../components/Icons';
import { useSwipe } from '../hooks/useSwipe';
import { useWakeLock } from '../hooks/useWakeLock';
import { formatAmount, formatIngredientLine } from '../lib/text';

type Ingredient = Recipe['ingredients'][number];

function LoadFailure({ message }: { message: string }) {
  return (
    <main className="page">
      <p className="field-error" role="alert">{message}</p>
      <Link className="btn" to="/">Back to library</Link>
    </main>
  );
}

/** Keyed by id so the step, sheet and in-flight load are all remounted per recipe. */
export function Cook() {
  const { id = '' } = useParams();
  return <CookSlides key={id} id={id} />;
}

function KeepOn({ wake }: { wake: ReturnType<typeof useWakeLock> }) {
  if (!wake.supported) return <p className="keep-on unsupported">Your browser can't keep the screen on</p>;
  return (
    <label className="keep-on">
      <SunIcon />
      <span>Keep screen on</span>
      <input
        type="checkbox"
        aria-label="Keep screen on"
        checked={wake.enabled}
        onChange={(e) => wake.setEnabled(e.target.checked)}
      />
    </label>
  );
}

/** Ingredients linked to a step; ignores indexes that are out of range or not integers. */
function linkedIngredients(all: Ingredient[], links: unknown): Ingredient[] {
  if (!Array.isArray(links)) return [];
  const seen = new Set<number>();
  const out: Ingredient[] = [];
  for (const i of links) {
    if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= all.length || seen.has(i)) continue;
    seen.add(i);
    out.push(all[i]);
  }
  return out;
}

const isNotFound = (e: unknown) =>
  (e as { status?: number } | null)?.status === 404 || (e instanceof Error && e.message.includes('(404)'));

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'file', 'image', 'color']);
const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  ((t.tagName === 'INPUT' && !NON_TEXT_INPUTS.has((t as HTMLInputElement).type)) ||
    t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

function UseChip({ ing }: { ing: Ingredient }) {
  const qty = formatAmount(ing);
  const item = ing.item + (ing.note ? ` (${ing.note})` : '');
  return <li>{qty && <><b>{qty}</b>{' '}</>}{item}</li>;
}

function IngredientsSheet({ ingredients, onClose }: { ingredients: Ingredient[]; onClose(): void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => closeRef.current?.focus(), []);

  // Escape works wherever focus is; the background is inert so the document is the right place.
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [onClose]);

  // Lock background scroll while the sheet is open; restore on close/unmount.
  useEffect(() => {
    document.body.classList.add('cook-scroll-lock');
    return () => document.body.classList.remove('cook-scroll-lock');
  }, []);

  const groups: { name: string | null; items: Ingredient[] }[] = [];
  for (const ing of ingredients) {
    const g = groups[groups.length - 1];
    if (g && g.name === ing.group) g.items.push(ing);
    else groups.push({ name: ing.group, items: [ing] });
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const f = panelRef.current?.querySelectorAll<HTMLElement>('button, [tabindex="0"]');
    if (!f || f.length === 0) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="cook-sheet-backdrop" onClick={onClose}>
      <div
        ref={panelRef}
        className="cook-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Ingredients"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="cook-sheet-head">
          <h2>Ingredients</h2>
          <button ref={closeRef} type="button" className="btn small" onClick={onClose}>Close</button>
        </div>
        <div className="cook-sheet-list" tabIndex={0}>
          {groups.length === 0 && <p className="empty">No ingredients</p>}
          {groups.map((g, gi) => (
            <div key={gi}>
              {g.name && <h3>{g.name}</h3>}
              <ul>
                {g.items.map((ing, ii) => (
                  <li key={ii}>{formatIngredientLine(ing)}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CookSlides({ id }: { id: string }) {
  const navigate = useNavigate();
  const wake = useWakeLock();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [sheet, setSheet] = useState(false);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const openerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    let live = true;
    getRecipe(id)
      .then((r) => live && setRecipe(r))
      .catch((e: unknown) => {
        if (live) setError(isNotFound(e) ? 'Recipe not found' : 'Could not load recipe');
      });
    return () => {
      live = false;
    };
  }, [id]);

  const total = recipe?.steps.length ?? 0;
  const cur = Math.max(0, Math.min(step, total - 1));
  const last = cur >= total - 1;
  const overview = `/recipe/${encodeURIComponent(id)}`;

  const go = (delta: number) => setStep((s) => Math.max(0, Math.min(Math.min(s, total - 1) + delta, total - 1)));
  const goRef = useRef(go);
  goRef.current = go;

  useEffect(() => {
    if (total === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || isTyping(e.target)) return;
      if (sheet) return;
      if (e.key === 'ArrowRight') goRef.current(1);
      else if (e.key === 'ArrowLeft') goRef.current(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [total, sheet]);

  useEffect(() => {
    if (wasOpen.current && !sheet) openerRef.current?.focus();
    wasOpen.current = sheet;
  }, [sheet]);

  const closeSheet = useCallback(() => setSheet(false), []);
  const swipe = useSwipe({ onLeft: () => !sheet && go(1), onRight: () => !sheet && go(-1) });

  if (error) return <LoadFailure message={error} />;
  if (!recipe) return <main className="page"><p className="empty">Loading…</p></main>;

  if (total === 0) {
    return (
      <main className="page cook-empty">
        <h1>{recipe.title}</h1>
        {recipe.description && <p>{recipe.description}</p>}
        {recipe.notes && <p>{recipe.notes}</p>}
        <KeepOn wake={wake} />
        <Link className="btn" to={overview}>Back to recipe</Link>
      </main>
    );
  }

  const s = recipe.steps[cur];
  const uses = linkedIngredients(recipe.ingredients, s.ingredients);
  const hasText = s.text.trim().length > 0;
  const photo = s.imageId && !failedImages.has(s.imageId) ? s.imageId : null;
  const onNext = () => (last ? navigate(overview) : go(1));

  return (
    <div className="cook-page">
      <div className="cook-main" inert={sheet}>
        <header className="cook-head">
          <Link className="btn icon-btn" to={overview} aria-label="Leave cook mode"><CloseIcon /></Link>
          <span className="cook-step-label">{`Step ${cur + 1} of ${total}`}</span>
          <button
            ref={openerRef}
            type="button"
            className="btn icon-btn cook-sheet-btn"
            aria-label="Ingredients"
            aria-haspopup="dialog"
            onClick={() => setSheet(true)}
          >
            <ListIcon />
          </button>
          <KeepOn wake={wake} />
        </header>

        <div className="cook-progress" aria-hidden="true">
          {recipe.steps.map((_, i) => <span key={i} className={i <= cur ? 'done' : undefined} />)}
        </div>

        <div className="cook-body" {...swipe}>
          {photo ? (
            <img
              key={photo}
              className="cook-photo"
              src={`/api/images/${photo}`}
              alt={`Photo for step ${cur + 1}`}
              loading="lazy"
              onError={() => setFailedImages((f) => new Set(f).add(photo))}
            />
          ) : (
            <div className="cook-photo-ph" aria-hidden="true"><CameraIcon /></div>
          )}
          {hasText ? <p className="cook-text" aria-live="polite">{s.text}</p> : <div className="cook-fill" />}
          {uses.length > 0 && (
            <section className="cook-uses" aria-label="Uses">
              <div className="cook-uses-title" aria-hidden="true">Uses</div>
              <ul>
                {uses.map((ing, i) => <UseChip key={i} ing={ing} />)}
              </ul>
            </section>
          )}
        </div>

        <div className="cook-nav">
          <button
            type="button"
            className="cook-back"
            aria-disabled={cur === 0}
            onClick={() => cur > 0 && go(-1)}
          >
            Back
          </button>
          <button type="button" className="primary cook-next" onClick={onNext}>{last ? 'Done' : 'Next step'}</button>
        </div>
      </div>
      {sheet && <IngredientsSheet ingredients={recipe.ingredients} onClose={closeSheet} />}
    </div>
  );
}
