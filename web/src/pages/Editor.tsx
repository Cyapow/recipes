import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { deleteRecipe, getRecipe, saveRecipe, type RecipeInput } from '../api';
import { RecipeForm } from '../components/RecipeForm';

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

  useEffect(() => {
    if (!id) return;
    getRecipe(id)
      .then(({ id: _i, createdAt: _c, updatedAt: _u, ...input }) => setInitial(input))
      .catch(() => setError('Could not load recipe'));
  }, [id]);

  async function onSave(input: RecipeInput) {
    try {
      const saved = await saveRecipe(id ?? null, input);
      nav(`/recipe/${saved.id}`);
    } catch {
      setError('Could not save recipe');
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
      {initial && <RecipeForm initial={initial} onSave={onSave} />}
      {id && initial && (
        <button type="button" className="danger" onClick={onDelete}>
          Delete
        </button>
      )}
    </main>
  );
}
