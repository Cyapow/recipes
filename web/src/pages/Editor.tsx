import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { deleteRecipe, getRecipe, saveRecipe, type RecipeInput } from '../api';
import { RecipeForm } from '../components/RecipeForm';
import { describeSaveError } from '../lib/saveError';

const EMPTY: RecipeInput = {
  title: '', description: null, origin: 'mine', sourceName: null, sourceUrl: null,
  servings: null, prepMinutes: null, cookMinutes: null, ingredients: [], steps: [],
  notes: null, tags: [], imageIds: [],
};

export function Editor() {
  const { id } = useParams();
  const nav = useNavigate();
  const [initial, setInitial] = useState<RecipeInput | null>(id ? null : EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    setError(null);
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
  }, [id]);

  async function onSave(input: RecipeInput) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const saved = await saveRecipe(id ?? null, input);
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
      {initial && <RecipeForm key={id ?? 'new'} initial={initial} onSave={onSave} saving={saving} />}
      {id && initial && (
        <button type="button" className="danger" onClick={onDelete}>
          Delete
        </button>
      )}
    </main>
  );
}
