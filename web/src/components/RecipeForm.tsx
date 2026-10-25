import { useState, type ChangeEvent, type FormEvent } from 'react';
import { uploadImage } from '../api';
import type { RecipeInput } from '../../../server/src/recipes/schema';
import { formatIngredientLine, formatIngredients, parseIngredients, parseLines, parseTags } from '../lib/text';

export type RecipeFormProps = {
  initial: RecipeInput;
  gaps?: string[];
  onSave(input: RecipeInput): void;
  /** Disables Save and relabels it while a save is in flight. */
  saving?: boolean;
};

// Form state is seeded from `initial` once: callers must change `key` to load a different recipe/draft.

const num = (s: string): number | null => {
  const n = s.trim() === '' ? NaN : Number(s);
  return Number.isFinite(n) ? n : null;
};
const str = (s: string): string | null => (s.trim() === '' ? null : s.trim());

export function RecipeForm({ initial, gaps, onSave, saving = false }: RecipeFormProps) {
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description ?? '');
  const [origin, setOrigin] = useState(initial.origin);
  const [sourceName, setSourceName] = useState(initial.sourceName ?? '');
  const [sourceUrl, setSourceUrl] = useState(initial.sourceUrl ?? '');
  const [servings, setServings] = useState(initial.servings?.toString() ?? '');
  const [prep, setPrep] = useState(initial.prepMinutes?.toString() ?? '');
  const [cook, setCook] = useState(initial.cookMinutes?.toString() ?? '');
  const [ingredients, setIngredients] = useState(formatIngredients(initial.ingredients));
  const [steps, setSteps] = useState(initial.steps.map((s) => s.text).join('\n'));
  const [notes, setNotes] = useState(initial.notes ?? '');
  const [tags, setTags] = useState(initial.tags.join(', '));
  const [error, setError] = useState<string | null>(null);
  const [imageIds, setImageIds] = useState(initial.imageIds);
  const [pending, setPending] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

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

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Enter a title');
      return;
    }
    if (pending > 0) {
      setError('Wait for the photo upload to finish before saving');
      return;
    }
    setError(null);
    const parsedIngredients = parseIngredients(ingredients);
    // Interim: links index into the ingredient list, so they only survive while that list is unchanged.
    const sameIngredients =
      parsedIngredients.length === initial.ingredients.length &&
      parsedIngredients.every((ing, i) => formatIngredientLine(ing) === formatIngredientLine(initial.ingredients[i]));
    onSave({
      ...initial,
      title: title.trim(),
      description: str(description),
      origin,
      sourceName: str(sourceName),
      sourceUrl: str(sourceUrl),
      servings: num(servings),
      prepMinutes: num(prep),
      cookMinutes: num(cook),
      ingredients: parsedIngredients,
      steps: parseLines(steps).map((text, i) => {
        const prev = initial.steps[i];
        if (!prev || prev.text !== text) return { text, imageId: null, ingredients: [] };
        return {
          ...prev,
          ingredients: sameIngredients ? prev.ingredients.filter((n) => n < parsedIngredients.length) : [],
        };
      }),
      notes: str(notes),
      tags: parseTags(tags),
      imageIds,
    });
  }

  return (
    <>
      {gaps && gaps.length > 0 && (
        <section className="gaps" aria-label="Check these">
          <h2>Check these</h2>
          <ul>
            {gaps.map((g) => (
              <li key={g}>{g}</li>
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
          Origin
          <select value={origin} onChange={(e) => setOrigin(e.target.value as 'mine' | 'other')}>
            <option value="mine">Mine</option>
            <option value="other">From elsewhere</option>
          </select>
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
          <label htmlFor="f-ingredients">Ingredients</label>
          <textarea id="f-ingredients" aria-describedby="h-ingredients" rows={8} value={ingredients} onChange={(e) => setIngredients(e.target.value)} />
          <small id="h-ingredients">One per line, e.g. "2 cups flour (sifted)". Start a line with # for a heading.</small>
        </div>
        <div className="field">
          <label htmlFor="f-steps">Steps</label>
          <textarea id="f-steps" aria-describedby="h-steps" rows={8} value={steps} onChange={(e) => setSteps(e.target.value)} />
          <small id="h-steps">One step per line.</small>
        </div>
        <label>
          Notes
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="field">
          <label htmlFor="f-tags">Tags</label>
          <input id="f-tags" aria-describedby="h-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
          <small id="h-tags">Comma-separated.</small>
        </div>
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
                    onClick={() => setImageIds((ids) => ids.filter((x) => x !== imgId))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="submit" className="primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>
    </>
  );
}
