import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, importRecipe, saveRecipe, type ImportResult, type RecipeInput } from '../api';
import { RecipeForm } from '../components/RecipeForm';
import { draftedBy } from '../lib/aiProvider';
import { describeSaveError } from '../lib/saveError';
import { useDraft } from '../lib/drafts';

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
    title: host, description: null, origin: 'other', sourceName: host, sourceUrl: url,
    servings: null, prepMinutes: null, cookMinutes: null,
    ingredients: [], steps: [], notes: null, tags: [], imageIds: [], gaps: [],
  };
}

export function Import() {
  const nav = useNavigate();
  const kept = useDraft('import');
  const resumed = kept.existing;
  const [url, setUrl] = useState(resumed?.url ?? '');
  const [result, setResult] = useState<{ n: number; value: ImportResult } | null>(
    resumed?.input ? { n: 1, value: { draft: { ...resumed.input, gaps: resumed.gaps ?? [] }, usedAi: false, usable: true } as ImportResult } : null,
  );
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  async function run() {
    if (busyRef.current || !url.trim()) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setFetchFailed(false);
    try {
      const value = await importRecipe(url.trim());
      setFetchFailed(false);
      kept.save({ url: url.trim(), input: value.draft, gaps: value.draft.gaps });
      setResult((r) => ({ n: (r?.n ?? 0) + 1, value }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 502) {
        setFetchFailed(true);
        setResult((r) => ({ n: (r?.n ?? 0) + 1, value: { draft: emptyDraft(url.trim()), usedAi: false, usable: false } }));
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

  const { gaps, ...initial } = result?.value.draft ?? ({} as ImportResult['draft']);

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
        <button type="submit" className="primary" disabled={busy || !url.trim()}>
          {busy ? (<><span className="spinner" aria-hidden="true" /> Importing…</>) : 'Import'}
        </button>
      </form>
      {error && <p className="field-error" role="alert">{error}</p>}
      {fetchFailed && <p className="field-error" role="alert">Couldn't fetch that page. You can still type the recipe in below.</p>}
      {result?.value.aiError && <p className="field-error" role="alert">{result.value.aiError.error}</p>}
      {result?.value.usable && draftedBy(result.value.provider) && <p className="hint">{draftedBy(result.value.provider)}</p>}
      {result && !fetchFailed && !result.value.usable && !result.value.aiError && <p className="field-error" role="alert">Couldn't find a recipe on that page</p>}
      {result && (
        <RecipeForm key={result.n} initial={initial as RecipeInput} gaps={gaps} onSave={onSave} saving={saving} onChange={(input) => kept.save({ url, input })} />
      )}
    </main>
  );
}
