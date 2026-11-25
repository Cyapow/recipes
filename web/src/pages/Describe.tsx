import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { describeRecipe, saveRecipe, type AiDraft, type RecipeInput } from '../api';
import { RecipeForm } from '../components/RecipeForm';
import { describeAiError } from '../lib/aiError';
import { draftedBy } from '../lib/aiProvider';
import { describeSaveError } from '../lib/saveError';
import { useDraft } from '../lib/drafts';
import { useFacets } from '../lib/useFacets';

export function Describe() {
  const facets = useFacets();
  const nav = useNavigate();
  const kept = useDraft('describe');
  const resumed = kept.existing;
  const [text, setText] = useState(resumed?.text ?? '');
  const [draft, setDraft] = useState<{ n: number; value: AiDraft } | null>(
    resumed?.input ? { n: 1, value: { ...resumed.input, gaps: resumed.gaps ?? [] } as AiDraft } : null,
  );
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
      const { gaps: g, provider: _p, model: _m, ...input } = value;
      kept.save({ text, input: input as RecipeInput, gaps: g });
      setDraft((d) => ({ n: (d?.n ?? 0) + 1, value }));
    } catch (e) {
      setError(describeAiError(e, 'Could not create a draft'));
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

  const { gaps, provider, model: _model, ...initial } = draft?.value ?? ({} as AiDraft);

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
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value.trim()) kept.save({ text: e.target.value });
          }}
          placeholder="e.g. my spag bol: brown the mince with an onion, add a tin of tomatoes and a splash of red wine…"
        />
      </label>
      <p className="hint">Tip: tap the microphone on your keyboard to dictate. Only what you say is used; anything missing is flagged, not filled in.</p>
      <button type="button" className="primary" onClick={create} disabled={busy || !text.trim()}>
        {busy ? (<><span className="spinner" aria-hidden="true" /> Creating…</>) : 'Create draft'}
      </button>
      {error && <p className="field-error" role="alert">{error}</p>}
      {draft && draftedBy(provider) && <p className="hint">{draftedBy(provider)}</p>}
      {draft && (
        <RecipeForm facets={facets} key={draft.n} initial={initial as RecipeInput} gaps={gaps} onSave={onSave} saving={saving} onChange={(input) => kept.save({ text, input })} />
      )}
    </main>
  );
}
