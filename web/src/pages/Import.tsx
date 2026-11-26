import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, importRecipe, saveRecipe, type Gap, type ImportResult, type RecipeInput } from '../api';
import { RecipeForm } from '../components/RecipeForm';
import { draftedBy } from '../lib/aiProvider';
import { describeSaveError } from '../lib/saveError';
import { useDraft } from '../lib/drafts';
import { useFacets } from '../lib/useFacets';
import { useGapAnswers } from '../lib/useGapAnswers';

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./i, '');
  } catch {
    return u;
  }
};

/** Empty draft for a page we couldn't fetch: the user can still fill it in by hand. */
function emptyDraft(url: string): ImportResult['draft'] {
  const host = hostOf(url);
  return {
    title: host, description: null, origin: 'other', brand: null, sourceName: host, sourceUrl: url,
    servings: null, prepMinutes: null, cookMinutes: null,
    ingredients: [], steps: [], notes: null, tags: [], imageIds: [], gaps: [],
  };
}

export function Import() {
  const facets = useFacets();
  const nav = useNavigate();
  const kept = useDraft('import');
  const resumed = kept.existing;
  const [url, setUrl] = useState(resumed?.url ?? '');
  // The imported recipe seeds the form; the rest of the result says how the import went.
  const [result, setResult] = useState<{ n: number; input: RecipeInput; meta: Omit<ImportResult, 'draft'> } | null>(
    resumed?.input ? { n: 1, input: resumed.input, meta: { usedAi: false, usable: true } } : null,
  );
  const [gaps, setGaps] = useState<Gap[]>(resumed?.gaps ?? []);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // Answering: the form is reloaded (new key) with the revision. The answers go to /api/ai/revise, so the page is
  // not fetched again. The draft is seconds old and unsaved, so no step marks, no summary and no Undo here.
  const { answering, answerError, onAnswer, clearAnswerError, inputRef, revision } = useGapAnswers({
    gaps,
    setGaps,
    input: result?.input ?? null,
    onRevised: (input) => setResult((r) => (r ? { ...r, input } : r)),
    save: (input, merged) => kept.save({ url, input, gaps: merged }),
  });

  async function run() {
    if (busyRef.current || answering || !url.trim()) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    clearAnswerError();
    setFetchFailed(false);
    try {
      const { draft: imported, ...meta } = await importRecipe(url.trim());
      const { gaps: g, ...input } = imported;
      setFetchFailed(false);
      kept.save({ url: url.trim(), input, gaps: g });
      setGaps(g);
      setResult((r) => ({ n: (r?.n ?? 0) + 1, input, meta }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 502) {
        const { gaps: g, ...input } = emptyDraft(url.trim());
        setFetchFailed(true);
        setGaps(g);
        setResult((r) => ({ n: (r?.n ?? 0) + 1, input, meta: { usedAi: false, usable: false } }));
        return;
      }
      setFetchFailed(false);
      setResult(null);
      setError(e instanceof Error && e.message ? e.message : 'Could not import that page');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function onSave(input: RecipeInput) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const saved = await saveRecipe(null, input);
      kept.clear();
      nav(`/recipe/${saved.id}`);
    } catch (e) {
      setError(describeSaveError(e));
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <main className="page">
      <header className="bar">
        <h1>Import from a web page</h1>
        <Link className="btn small" to="/">Cancel</Link>
      </header>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <label>
          Recipe page address
          <input
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (e.target.value.trim()) kept.save({ url: e.target.value });
            }}
            placeholder="https://www.bbcgoodfood.com/recipes/…"
          />
        </label>
        <button type="submit" className="primary" disabled={busy || answering || !url.trim()}>
          {busy ? (<><span className="spinner" aria-hidden="true" /> Importing…</>) : 'Import'}
        </button>
      </form>
      {error && <p className="field-error" role="alert">{error}</p>}
      {fetchFailed && <p className="field-error" role="alert">Couldn't fetch that page. You can still type the recipe in below.</p>}
      {result?.meta.aiError && <p className="field-error" role="alert">{result.meta.aiError.error}</p>}
      {result?.meta.usable && draftedBy(result.meta.provider) && <p className="hint">{draftedBy(result.meta.provider)}</p>}
      {result && !fetchFailed && !result.meta.usable && !result.meta.aiError && <p className="field-error" role="alert">Couldn't find a recipe on that page</p>}
      {result && (
        <RecipeForm facets={facets} key={`${result.n}:${revision}`} initial={result.input} gaps={gaps} onAnswer={onAnswer} answering={answering} answerError={answerError} inputRef={inputRef} onSave={onSave} saving={saving} onChange={(input) => kept.save({ url, input })} />
      )}
    </main>
  );
}
