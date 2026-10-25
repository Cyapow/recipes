import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getRecipe, type Recipe } from '../api';
import { useWakeLock } from '../hooks/useWakeLock';
import { formatIngredientLine, originLabel } from '../lib/text';

function LoadFailure({ message }: { message: string }) {
  return (
    <main className="page">
      <p className="field-error" role="alert">{message}</p>
      <Link className="btn" to="/">Back to library</Link>
    </main>
  );
}

export function Cook() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const wake = useWakeLock();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    let live = true;
    setRecipe(null);
    setError(null);
    setStep(0);
    getRecipe(id)
      .then((r) => live && setRecipe(r))
      .catch((e: unknown) =>
        live && setError(e instanceof Error && e.message.includes('(404)') ? 'Recipe not found' : 'Could not load recipe'),
      );
    return () => {
      live = false;
    };
  }, [id]);

  if (error) return <LoadFailure message={error} />;
  if (!recipe) return <main className="page"><p className="empty">Loading…</p></main>;

  const total = recipe.steps.length;
  const last = step >= total - 1;
  const label = [originLabel(recipe), recipe.tags[0]].filter(Boolean).join(' · ');
  const groups: { name: string | null; items: Recipe['ingredients'] }[] = [];
  for (const ing of recipe.ingredients) {
    const g = groups[groups.length - 1];
    if (g && g.name === ing.group) g.items.push(ing);
    else groups.push({ name: ing.group, items: [ing] });
  }

  return (
    <main className="page cook">
      <header className="cook-bar">
        <Link className="btn" to="/" aria-label="Back to library">←</Link>
        <span className="cook-label">{label}</span>
        <Link className="btn" to={`/recipe/${encodeURIComponent(recipe.id)}/edit`}>Edit</Link>
      </header>
      <h1 className="cook-title">{recipe.title}</h1>

      {wake.supported ? (
        <label className="keep-on">
          <span>☀ Keep screen on</span>
          <input
            type="checkbox"
            aria-label="Keep screen on"
            checked={wake.enabled}
            onChange={(e) => wake.setEnabled(e.target.checked)}
          />
        </label>
      ) : (
        <p className="keep-on unsupported">Your browser can't keep the screen on</p>
      )}

      {groups.length > 0 && (
        <section className="ingredients">
          <h2>Ingredients</h2>
          {groups.map((g, gi) => (
            <div key={gi}>
              {g.name && <h3>{g.name}</h3>}
              <ul>
                {g.items.map((ing, ii) => (
                  <li key={ii}>{formatIngredientLine(ing)}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {total > 0 ? (
        <section className="step-card" aria-live="polite">
          <p className="step-count">Step {step + 1} of {total}</p>
          <p className="step-text">{recipe.steps[step]}</p>
          <div className="step-nav">
            <button type="button" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
            <button
              type="button"
              className="primary"
              onClick={() => (last ? navigate('/') : setStep(step + 1))}
            >
              {last ? 'Done' : 'Next step'}
            </button>
          </div>
        </section>
      ) : (
        (recipe.notes || recipe.description) && (
          <section className="step-card">
            {recipe.description && <p>{recipe.description}</p>}
            {recipe.notes && <p>{recipe.notes}</p>}
          </section>
        )
      )}
    </main>
  );
}
