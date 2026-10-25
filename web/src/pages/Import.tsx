import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { importRecipe, saveRecipe, type ImportResult, type RecipeInput } from '../api';
import { RecipeForm } from '../components/RecipeForm';

export function Import() {
  const nav = useNavigate();
  const [url, setUrl] = useState('');
  const [result, setResult] = useState<{ n: number; value: ImportResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  async function run() {
    if (busyRef.current || !url.trim()) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const value = await importRecipe(url.trim());
      setResult((r) => ({ n: (r?.n ?? 0) + 1, value }));
    } catch (e) {
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
      nav(`/recipe/${saved.id}`);
    } catch {
      setError('Could not save recipe');
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
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.bbcgoodfood.com/recipes/…"
          />
        </label>
        <button type="submit" className="primary" disabled={busy || !url.trim()}>
          {busy ? (<><span className="spinner" aria-hidden="true" /> Importing…</>) : 'Import'}
        </button>
      </form>
      {error && <p className="field-error" role="alert">{error}</p>}
      {result && !result.value.usable && <p className="field-error" role="alert">Couldn't find a recipe on that page</p>}
      {result && (
        <RecipeForm key={result.n} initial={initial as RecipeInput} gaps={gaps} onSave={onSave} saving={saving} />
      )}
    </main>
  );
}
