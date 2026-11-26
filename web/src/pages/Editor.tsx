import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { deleteRecipe, getRecipe, reviseRecipe, saveRecipe, type Gap, type RecipeInput } from '../api';
import { RecipeForm } from '../components/RecipeForm';
import { ReviseBox } from '../components/ReviseBox';
import { describeAiError } from '../lib/aiError';
import { summariseChanges } from '../lib/reviseSummary';
import { stepMarks, type StepMarks } from '../lib/stepMarks';
import { describeSaveError } from '../lib/saveError';
import { useDraft } from '../lib/drafts';
import { useFacets } from '../lib/useFacets';

const EMPTY: RecipeInput = {
  title: '', description: null, origin: 'mine', brand: 'Mine', sourceName: null, sourceUrl: null,
  servings: null, prepMinutes: null, cookMinutes: null, ingredients: [], steps: [],
  notes: null, tags: [], imageIds: [],
};

export function Editor() {
  const facets = useFacets();
  const { id } = useParams();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const draft = useDraft(id ? 'edit' : 'new', id);
  const [initial, setInitial] = useState<RecipeInput | null>(draft.existing?.input ?? (id ? null : EMPTY));

  // Revising: the form is reloaded (new key) with the revision, and the contents before it are kept for Undo.
  const formInput = useRef<(() => RecipeInput) | null>(null);
  const [revision, setRevision] = useState(0);
  const [gaps, setGaps] = useState<Gap[]>(draft.existing?.gaps ?? []);
  const [marks, setMarks] = useState<StepMarks | undefined>();
  const [summary, setSummary] = useState<string[] | null>(null);
  const [reviseBusy, setReviseBusy] = useState(false);
  const [reviseError, setReviseError] = useState<string | null>(null);
  const before = useRef<RecipeInput | null>(null);
  const beforeGaps = useRef<Gap[]>([]);

  // A remounted form reports nothing until the person edits it, so the revision is written to the device draft here.
  // This runs after the old form's unmount flush, which would otherwise overwrite it with the pre-revision contents.
  useEffect(() => {
    if (revision > 0 && initial) draft.save({ input: initial, gaps });
  }, [revision]);

  useEffect(() => {
    setError(null);
    // Loading different contents drops anything the last revision left behind: no route re-renders this editor with
    // another :id today, but an undo that wrote recipe A's steps over recipe B would be a bad way to find out.
    setSummary(null);
    setMarks(undefined);
    before.current = null;
    beforeGaps.current = [];
    if (draft.existing?.input) {
      setInitial(draft.existing.input);
      return;
    }
    if (!id) {
      setInitial(EMPTY);
      return;
    }
    setInitial(null);
    let live = true;
    getRecipe(id)
      .then(({ id: _i, createdAt: _c, updatedAt: _u, ...input }) => live && setInitial(input))
      .catch(() => live && setError('Could not load recipe'));
    return () => {
      live = false;
    };
  }, [id, draft.existing]);

  async function onRevise(instruction: string) {
    if (!initial || reviseBusy) return;
    const current = formInput.current?.() ?? initial;
    setReviseError(null);
    if (!current.title.trim()) {
      setReviseError('Give the recipe a title first, then describe what to change.');
      return;
    }
    setReviseBusy(true);
    try {
      const { gaps: newGaps, stepsFrom, provider: _p, model: _m, ...next } = await reviseRecipe(current, instruction);
      // `next.steps` goes to the form as-is: the marks are keyed to those very objects.
      setMarks(stepMarks(current.steps, next.steps, stepsFrom));
      setSummary(summariseChanges(current, next, stepsFrom));
      // The undo snapshot is the form as it is NOW, not as it was when the call went out: the form stays live while
      // the AI works, and anything typed meanwhile would otherwise be lost by the remount with no way back.
      // The revision still acts on the snapshot it was sent, so in that case the summary describes the change
      // against what was sent while Undo restores what was last on screen. Deliberate: losing the typing is worse.
      before.current = formInput.current?.() ?? current;
      beforeGaps.current = gaps;
      setGaps(newGaps);
      setInitial(next);
      setRevision((n) => n + 1);
    } catch (e) {
      setReviseError(describeAiError(e, 'Could not revise the recipe'));
    } finally {
      setReviseBusy(false);
    }
  }

  function onUndo() {
    if (!before.current) return;
    setInitial(before.current);
    before.current = null;
    setMarks(undefined);
    setSummary(null);
    // Undo restores exactly the contents from before the apply, and a resumed draft's or an earlier revision's
    // "Check these" list is part of those contents.
    setGaps(beforeGaps.current);
    beforeGaps.current = [];
    setRevision((n) => n + 1);
  }

  async function onSave(input: RecipeInput) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const saved = await saveRecipe(id ?? null, input);
      draft.clear();
      nav(`/recipe/${saved.id}`);
    } catch (e) {
      setError(describeSaveError(e));
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!id || !window.confirm('Delete this recipe?')) return;
    try {
      await deleteRecipe(id);
      draft.clear();
      nav('/');
    } catch {
      setError('Could not delete recipe');
    }
  }

  return (
    <main className="page">
      <header className="bar">
        <h1>{id ? 'Edit recipe' : 'New recipe'}</h1>
        <Link className="btn small" to="/">Cancel</Link>
      </header>
      {error && <p className="field-error" role="alert">{error}</p>}
      {initial && <ReviseBox busy={reviseBusy} error={reviseError} summary={summary} onApply={onRevise} onUndo={onUndo} />}
      {initial && <RecipeForm facets={facets} key={`${id ?? 'new'}:${draft.existing?.id ?? ''}:${revision}`} initial={initial} gaps={gaps} marks={marks} inputRef={formInput} onSave={onSave} saving={saving} onChange={(input) => draft.save({ input })} />}
      {id && initial && (
        <button type="button" className="danger" onClick={onDelete}>
          Delete
        </button>
      )}
    </main>
  );
}
