import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { describeRecipe, saveRecipe, type AiProviderName, type Gap, type RecipeInput } from '../api';
import { RecipeForm } from '../components/RecipeForm';
import { describeAiError } from '../lib/aiError';
import { draftedBy } from '../lib/aiProvider';
import { describeSaveError } from '../lib/saveError';
import { useDraft } from '../lib/drafts';
import { useFacets } from '../lib/useFacets';
import { useGapAnswers } from '../lib/useGapAnswers';

export function Describe() {
  const facets = useFacets();
  const nav = useNavigate();
  const kept = useDraft('describe');
  const resumed = kept.existing;
  const [text, setText] = useState(resumed?.text ?? '');
  const [draft, setDraft] = useState<{ n: number; input: RecipeInput; provider?: AiProviderName } | null>(
    resumed?.input ? { n: 1, input: resumed.input } : null,
  );
  const [gaps, setGaps] = useState<Gap[]>(resumed?.gaps ?? []);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // Answering: the form is reloaded (new key) with the revision. The draft is seconds old and unsaved, so there are
  // no step marks, no change summary and no Undo here — the editor has those for instructions typed by hand.
  const formInput = useRef<(() => RecipeInput) | null>(null);
  const [revision, setRevision] = useState(0);
  const { answering, answerError, onAnswer } = useGapAnswers({
    gaps,
    setGaps,
    // The panel is only on screen while there is a draft, so there is always one to fall back on.
    current: () => formInput.current?.() ?? draft!.input,
    onRevised: (input) => {
      setDraft((d) => (d ? { ...d, input } : d));
      setRevision((n) => n + 1);
    },
  });

  // A remounted form reports nothing until the person edits it, so the revision is written to the device draft here.
  // This runs after the old form's unmount flush, which would otherwise overwrite it with the pre-answer contents.
  useEffect(() => {
    if (revision > 0 && draft) kept.save({ text, input: draft.input, gaps });
  }, [revision]);

  async function create() {
    if (busyRef.current || !text.trim()) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const { gaps: g, provider, model: _model, ...input } = await describeRecipe(text);
      kept.save({ text, input: input as RecipeInput, gaps: g });
      setGaps(g);
      setDraft((d) => ({ n: (d?.n ?? 0) + 1, input: input as RecipeInput, provider }));
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
      {draft && draftedBy(draft.provider) && <p className="hint">{draftedBy(draft.provider)}</p>}
      {draft && (
        <RecipeForm facets={facets} key={`${draft.n}:${revision}`} initial={draft.input} gaps={gaps} onAnswer={onAnswer} answering={answering} answerError={answerError} inputRef={formInput} onSave={onSave} saving={saving} onChange={(input) => kept.save({ text, input })} />
      )}
    </main>
  );
}
