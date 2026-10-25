import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { describeRecipe, saveRecipe, type RecipeDraft, type RecipeInput } from '../api';
import { RecipeForm } from '../components/RecipeForm';
import { describeSaveError } from '../lib/saveError';

export function Describe() {
  const nav = useNavigate();
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<{ n: number; value: RecipeDraft } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  async function create() {
    if (busyRef.current || !text.trim()) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const value = await describeRecipe(text);
      setDraft((d) => ({ n: (d?.n ?? 0) + 1, value }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setError(
        msg === 'AI not configured'
          ? 'AI is not configured on this server (no Anthropic API key set).'
          : `Could not create a draft${msg ? `: ${msg}` : ''}`,
      );
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
    } catch (e) {
      setError(describeSaveError(e));
      savingRef.current = false;
      setSaving(false);
    }
  }

  const { gaps, ...initial } = draft?.value ?? ({} as RecipeDraft);

  return (
    <main className="page">
      <header className="bar">
        <h1>Describe a recipe</h1>
        <Link className="btn small" to="/">Cancel</Link>
      </header>
      <label>
        Tell me the recipe in your own words
        <textarea
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. my spag bol: brown the mince with an onion, add a tin of tomatoes and a splash of red wine…"
        />
      </label>
      <p className="hint">Tip: tap the microphone on your keyboard to dictate. Only what you say is used; anything missing is flagged, not filled in.</p>
      <button type="button" className="primary" onClick={create} disabled={busy || !text.trim()}>
        {busy ? (<><span className="spinner" aria-hidden="true" /> Creating…</>) : 'Create draft'}
      </button>
      {error && <p className="field-error" role="alert">{error}</p>}
      {draft && (
        <RecipeForm key={draft.n} initial={initial as RecipeInput} gaps={gaps} onSave={onSave} saving={saving} />
      )}
    </main>
  );
}
