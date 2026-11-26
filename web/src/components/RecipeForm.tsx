import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { cropImage, uploadImage, type Box1000, type Facets } from '../api';
import type { Gap, Ingredient, RecipeInput, Step } from '../../../server/src/recipes/schema';
import { canonicalUnit } from '../../../server/src/recipes/amount';
import { IngredientRows } from './IngredientRows';
import { KNOWN_BRANDS, TAG_GROUPS, canonicalBrand, normaliseTags, originForBrand, type TagGroup } from '../../../server/src/recipes/categories';
import { parseTags } from '../lib/text';
import { derive, stepId } from '../lib/stepIdentity';
import { StepEditor } from './StepEditor';
import type { StepMarks } from '../lib/stepMarks';
import { CropDialog } from './CropDialog';

export type RecipeFormProps = {
  initial: RecipeInput;
  gaps?: Gap[];
  onSave(input: RecipeInput): void;
  /** Disables Save and relabels it while a save is in flight. */
  saving?: boolean;
  /** Called (debounced) with the form's current contents after the user changes something, so a draft can be kept. */
  onChange?(input: RecipeInput): void;
  /** Brands and tags already in use; offered as suggestions only. */
  facets?: Facets;
  /** From a photos draft: the card photo the dish picture was cut from, and the box used. Offers Adjust / Use whole photo on the first photo. */
  dishCrop?: ({ sourceImageId: string } & Box1000) | null;
  /** Called when the dish crop changes: the new box after Adjust, null once the crop photo is replaced or removed. */
  onDishCropChange?(crop: ({ sourceImageId: string } & Box1000) | null): void;
  /** Which steps a revision added or reworded, shown beside each step. Keyed by step identity, so `initial.steps` must be the very objects the marks were built from. */
  marks?: StepMarks;
  /** Set by the form to a function returning its current contents, so the editor can revise what is on screen. */
  inputRef?: { current: (() => RecipeInput) | null };
};

// Form state is seeded from `initial` once: callers must change `key` to load a different recipe/draft.

const num = (s: string): number | null => {
  const n = s.trim() === '' ? NaN : Number(s);
  return Number.isFinite(n) ? n : null;
};
const str = (s: string): string | null => (s.trim() === '' ? null : s.trim());

export function RecipeForm({ initial, gaps, onSave, saving = false, onChange, facets, dishCrop, onDishCropChange, marks, inputRef }: RecipeFormProps) {
  const listId = useId();
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description ?? '');
  const [brand, setBrand] = useState(
    // A draft kept from before brands existed has no brand key: seed it the way migration 007 does.
    initial.brand !== undefined ? (initial.brand ?? '') : initial.origin === 'mine' ? 'Mine' : (canonicalBrand(initial.sourceName) ?? ''),
  );
  const [sourceName, setSourceName] = useState(initial.sourceName ?? '');
  const [sourceUrl, setSourceUrl] = useState(initial.sourceUrl ?? '');
  const [servings, setServings] = useState(initial.servings?.toString() ?? '');
  const [prep, setPrep] = useState(initial.prepMinutes?.toString() ?? '');
  const [cook, setCook] = useState(initial.cookMinutes?.toString() ?? '');
  const [ingredients, setIngredients] = useState<Ingredient[]>(initial.ingredients);
  const [steps, setSteps] = useState<Step[]>(initial.steps);
  const [stepsBusy, setStepsBusy] = useState(false);
  const [notes, setNotes] = useState(initial.notes ?? '');
  const [tags, setTags] = useState<Record<TagGroup, string>>(() => {
    const out: Record<TagGroup, string> = { cuisine: '', meal: '', main: '', other: '' };
    const all = normaliseTags(initial.tags);
    for (const g of TAG_GROUPS) out[g.id] = all.filter((t) => t.group === g.id).map((t) => t.name).join(', ');
    return out;
  });
  const [error, setError] = useState<string | null>(null);
  const [imageIds, setImageIds] = useState(initial.imageIds);
  const [pending, setPending] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [cropBox, setCropBox] = useState<Box1000 | null>(dishCrop ? { x0: dishCrop.x0, y0: dishCrop.y0, x1: dishCrop.x1, y1: dishCrop.y1 } : null);
  const [adjusting, setAdjusting] = useState(false);
  // The id of the crop made for this draft; the actions apply only while it is still the first photo.
  const sourceId = dishCrop?.sourceImageId;
  const [cropId, setCropId] = useState<string | null>(
    dishCrop && initial.imageIds[0] !== undefined && initial.imageIds[0] !== dishCrop.sourceImageId ? initial.imageIds[0] : null,
  );
  const cropIsFirst = !!sourceId && !!cropBox && cropId !== null && imageIds[0] === cropId;

  function useWholePhoto() {
    if (!sourceId) return;
    setCropId(null);
    onDishCropChange?.(null);
    setImageIds((ids) => [sourceId, ...ids.slice(1).filter((x) => x !== sourceId)]);
  }

  async function saveAdjusted(box: Box1000) {
    if (!sourceId) return;
    setAdjusting(false);
    setUploadError(null);
    setPending((n) => n + 1);
    try {
      const id = await cropImage(sourceId, box);
      setCropBox(box);
      setCropId(id);
      onDishCropChange?.({ sourceImageId: sourceId, ...box });
      setImageIds((ids) => [id, ...ids.slice(1).filter((x) => x !== id)]);
    } catch (err) {
      setUploadError(`Could not crop the photo: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setPending((n) => n - 1);
    }
  }

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // allow picking the same file again
    if (files.length === 0) return;
    setUploadError(null);
    setPending((n) => n + files.length);
    for (const file of files) {
      try {
        const id = await uploadImage(file);
        setImageIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
      } catch (err) {
        setUploadError(`Could not upload ${file.name}: ${err instanceof Error ? err.message : 'unknown error'}`);
      } finally {
        setPending((n) => n - 1);
      }
    }
  }

  // A row edit never moves an ingredient, and a move or a delete says exactly which one, so the rows hand back
  // steps whose links have already followed them. Nothing has to be matched up by text.
  function onIngredientsChange(next: { ingredients: Ingredient[]; steps: Step[] }) {
    setIngredients(next.ingredients);
    setSteps((cur) => cur.map((s, i) => derive(s, { ingredients: next.steps[i]?.ingredients ?? s.ingredients })));
  }

  function build(): RecipeInput {
    const parsedIngredients = ingredients
      .map((i) => ({ ...i, item: i.item.trim(), unit: canonicalUnit(i.unit) }))
      .filter((i) => i.item !== '');
    const brandValue = str(brand);
    return {
      ...initial,
      title: title.trim(),
      description: str(description),
      origin: originForBrand(brandValue),
      sourceName: str(sourceName),
      sourceUrl: str(sourceUrl),
      servings: num(servings),
      prepMinutes: num(prep),
      cookMinutes: num(cook),
      ingredients: parsedIngredients,
      steps: steps
        .map((st) => ({
          ...st,
          text: st.text.trim(),
          ingredients: st.ingredients.filter((n) => n < parsedIngredients.length),
        }))
        .filter((st) => st.text !== '' || st.imageId !== null || st.ingredients.length > 0),
      notes: str(notes),
      tags: normaliseTags(TAG_GROUPS.flatMap((g) => parseTags(tags[g.id]).map((name) => ({ group: g.id, name })))),
      brand: brandValue,
      imageIds,
    };
  }

  // Report edits (not the initial values) so the caller can keep a draft. The latest build is also flushed on unmount.
  const touched = useRef(false);
  const latest = useRef<() => RecipeInput>(build);
  latest.current = build;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    touched.current = true;
    if (!onChangeRef.current) return;
    const t = setTimeout(() => onChangeRef.current?.(latest.current()), 400);
    return () => clearTimeout(t);
  }, [title, description, brand, sourceName, sourceUrl, servings, prep, cook, ingredients, steps, notes, tags, imageIds]);
  useEffect(() => {
    if (!inputRef) return;
    inputRef.current = () => latest.current();
    return () => {
      inputRef.current = null;
    };
  }, [inputRef]);
  useEffect(
    () => () => {
      if (touched.current) onChangeRef.current?.(latest.current());
    },
    [],
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Enter a title');
      return;
    }
    if (pending > 0 || stepsBusy) {
      setError('Wait for the photo upload to finish before saving');
      return;
    }
    setError(null);
   
    onSave(build());
  }

  return (
    <>
      {gaps && gaps.length > 0 && (
        <section className="gaps" aria-label="Check these">
          <h2>Check these</h2>
          <ul>
            {gaps.map((g) => (
              <li key={g.about}>{g.question ?? g.about}</li>
            ))}
          </ul>
        </section>
      )}
      <form className="recipe-form" onSubmit={submit} noValidate>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} aria-invalid={!!error} />
        </label>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <label>
          Description
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label>
          Brand
          <input list={`${listId}-brand`} value={brand} onChange={(e) => setBrand(e.target.value)} />
          <datalist id={`${listId}-brand`}>
            {[...new Set([...KNOWN_BRANDS, ...(facets?.brands.map((b) => b.name) ?? [])])].map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </label>
        <label>
          Source name
          <input value={sourceName} onChange={(e) => setSourceName(e.target.value)} />
        </label>
        <label>
          Source URL
          <input type="url" inputMode="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
        </label>
        <div className="row3">
          <label>
            Servings
            <input inputMode="numeric" value={servings} onChange={(e) => setServings(e.target.value)} />
          </label>
          <label>
            Prep minutes
            <input inputMode="numeric" value={prep} onChange={(e) => setPrep(e.target.value)} />
          </label>
          <label>
            Cook minutes
            <input inputMode="numeric" value={cook} onChange={(e) => setCook(e.target.value)} />
          </label>
        </div>
        <div className="field">
          <span className="label-text">Ingredients</span>
          <IngredientRows ingredients={ingredients} steps={steps} onChange={onIngredientsChange} />
        </div>
        <section className="field steps-field" aria-labelledby="h-steps-title">
          <h2 id="h-steps-title">Method</h2>
          <StepEditor steps={steps} ingredients={ingredients} marks={marks} onChange={(next) => { setSteps(next); }} onBusyChange={setStepsBusy} />
        </section>
        <label>
          Notes
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {TAG_GROUPS.map((g) => (
          <div className="field" key={g.id}>
            <label htmlFor={`${listId}-${g.id}`}>{g.label}</label>
            <input
              id={`${listId}-${g.id}`}
              list={`${listId}-${g.id}-list`}
              aria-describedby={`${listId}-tags-hint`}
              value={tags[g.id]}
              onChange={(e) => setTags((cur) => ({ ...cur, [g.id]: e.target.value }))}
            />
            <datalist id={`${listId}-${g.id}-list`}>
              {(facets?.tags ?? []).filter((t) => t.group === g.id).map((t) => (
                <option key={t.name} value={t.name} />
              ))}
            </datalist>
          </div>
        ))}
        <small id={`${listId}-tags-hint`}>Tags are comma-separated.</small>
        <div className="field photos">
          <label htmlFor="f-photos">Add photos</label>
          <input id="f-photos" type="file" accept="image/*" multiple onChange={onPick} />
          {pending > 0 && <small role="status">Uploading…</small>}
          {uploadError && (
            <p className="field-error" role="alert">
              {uploadError}
            </p>
          )}
          {imageIds.length > 0 && (
            <ul className="photo-list">
              {imageIds.map((imgId, i) => (
                <li key={imgId}>
                  <img src={`/api/images/${imgId}/thumb`} alt={`Photo ${i + 1}`} />
                  <button
                    type="button"
                    aria-label={`Remove photo ${i + 1}`}
                    onClick={() => {
                      if (imgId === cropId) {
                        setCropId(null);
                        onDishCropChange?.(null);
                      }
                      setImageIds((ids) => ids.filter((x) => x !== imgId));
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          {cropIsFirst && (
            <div className="photo-actions">
              <button type="button" onClick={() => setAdjusting(true)}>Adjust</button>
              <button type="button" onClick={useWholePhoto}>Use whole photo</button>
            </div>
          )}
        </div>
        <button type="submit" className="primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>
      {adjusting && sourceId && cropBox && (
        <CropDialog imageId={sourceId} box={cropBox} onSave={saveAdjusted} onCancel={() => setAdjusting(false)} />
      )}
    </>
  );
}
