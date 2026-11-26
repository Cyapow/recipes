import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, photosRecipe, saveRecipe, uploadImage, type AiProviderName, type Gap, type PhotosDraft, type RecipeInput } from '../api';
import { RecipeForm } from '../components/RecipeForm';
import { draftedBy } from '../lib/aiProvider';
import { describeSaveError } from '../lib/saveError';
import { useDraft } from '../lib/drafts';
import { shrinkImage } from '../lib/shrinkImage';
import { useFacets } from '../lib/useFacets';
import { useGapAnswers } from '../lib/useGapAnswers';

const MAX_PHOTOS = 6;

type DishCrop = PhotosDraft['dishCrop'];

export function Photos() {
  const facets = useFacets();
  const nav = useNavigate();
  const kept = useDraft('photos');
  const resumed = kept.existing;
  const [photoIds, setPhotoIds] = useState<string[]>(resumed?.photoIds ?? []);
  const [dishCrop, setDishCrop] = useState<DishCrop>(resumed?.dishCrop ?? null);
  const [draft, setDraft] = useState<{ n: number; input: RecipeInput; provider?: AiProviderName } | null>(
    resumed?.input ? { n: 1, input: resumed.input } : null,
  );
  const [gaps, setGaps] = useState<Gap[]>(resumed?.gaps ?? []);
  const [pending, setPending] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const full = photoIds.length >= MAX_PHOTOS;

  // Answering: the form is reloaded (new key) with the revision. The answers go to /api/ai/revise, so the card
  // photos are not read again. The draft is seconds old and unsaved, so no step marks, no summary and no Undo here.
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
    if (revision > 0 && draft) kept.save({ photoIds, input: draft.input, gaps });
  }, [revision]);

  function setIds(next: (ids: string[]) => string[]) {
    setPhotoIds((cur) => {
      const ids = next(cur);
      kept.save({ photoIds: ids });
      return ids;
    });
  }

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = ''; // allow picking the same file again
    if (picked.length === 0) return;
    const files = picked.slice(0, Math.max(0, MAX_PHOTOS - photoIds.length));
    setSkipped(picked.length - files.length);
    if (files.length === 0) return;
    setUploadError(null);
    setPending((n) => n + files.length);
    for (const file of files) {
      try {
        const id = await uploadImage(await shrinkImage(file));
        setIds((ids) => (ids.includes(id) || ids.length >= MAX_PHOTOS ? ids : [...ids, id]));
      } catch (err) {
        setUploadError(`Could not upload ${file.name}: ${err instanceof Error ? err.message : 'unknown error'}`);
      } finally {
        setPending((n) => n - 1);
      }
    }
  }

  const move = (i: number, by: -1 | 1) =>
    setIds((ids) => {
      const j = i + by;
      if (j < 0 || j >= ids.length) return ids;
      const next = [...ids];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  async function create() {
    if (busyRef.current || pending > 0 || photoIds.length === 0) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const { gaps: g, provider, model: _m, dishCrop: crop, ...input } = await photosRecipe(photoIds);
      kept.save({ photoIds, input: input as RecipeInput, gaps: g, dishCrop: crop });
      setDishCrop(crop);
      setGaps(g);
      setDraft((d) => ({ n: (d?.n ?? 0) + 1, input: input as RecipeInput, provider }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      const code = e instanceof ApiError ? (e.body as { code?: string } | undefined)?.code : undefined;
      setError(
        msg === 'AI not configured'
          ? 'AI is not configured on this server (no AI key set in .env).'
          : code && code !== 'other'
            ? msg // already a plain-language sentence from the server
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
        <h1>From photos</h1>
        <Link className="btn small" to="/">Cancel</Link>
      </header>
      <p className="hint">Photograph the front and back of the recipe card. Only what is on the card is used; anything missing is flagged, not filled in.</p>
      <div className="photo-picker">
        <input id="photos-input" className="visually-hidden" type="file" accept="image/*" multiple onChange={onPick} disabled={full || pending > 0} />
        <label htmlFor="photos-input" className={`btn${full ? ' disabled' : ''}`}>Add photos</label>
        <p className="hint">Up to {MAX_PHOTOS} photos</p>
        {pending > 0 && <small role="status">Uploading…</small>}
        {skipped > 0 && <small role="status">Only {MAX_PHOTOS} photos — {skipped} skipped</small>}
        {uploadError && <p className="field-error" role="alert">{uploadError}</p>}
        {photoIds.length > 0 && (
          <ul className="photo-list">
            {photoIds.map((id, i) => (
              <li key={id}>
                <img src={`/api/images/${id}/thumb`} alt={`Photo ${i + 1}`} />
                <button type="button" className="photo-remove" aria-label={`Remove photo ${i + 1}`} onClick={() => setIds((ids) => ids.filter((x) => x !== id))}>✕</button>
                <div className="photo-move">
                  <button type="button" aria-label={`Move photo ${i + 1} earlier`} disabled={i === 0} onClick={() => move(i, -1)}>←</button>
                  <button type="button" aria-label={`Move photo ${i + 1} later`} disabled={i === photoIds.length - 1} onClick={() => move(i, 1)}>→</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button type="button" className="primary" onClick={create} disabled={busy || pending > 0 || photoIds.length === 0}>
        {busy ? (<><span className="spinner" aria-hidden="true" /> Creating…</>) : 'Create draft'}
      </button>
      {error && <p className="field-error" role="alert">{error}</p>}
      {draft && draftedBy(draft.provider) && <p className="hint">{draftedBy(draft.provider)}</p>}
      {draft && (
        <RecipeForm
          facets={facets}
          key={`${draft.n}:${revision}`}
          initial={draft.input}
          gaps={gaps}
          onAnswer={onAnswer}
          answering={answering}
          answerError={answerError}
          inputRef={formInput}
          dishCrop={dishCrop}
          onDishCropChange={(c) => kept.save({ dishCrop: c })}
          onSave={onSave}
          saving={saving}
          onChange={(input) => kept.save({ photoIds, input })}
        />
      )}
    </main>
  );
}
