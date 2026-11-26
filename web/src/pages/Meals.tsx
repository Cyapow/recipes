import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, createMeal, listMeals, listRecipes, type MealSummary, type RecipeSummary } from '../api';
import { COURSES, type Course } from '../../../server/src/meals/repo';
import { BackIcon } from '../components/Icons';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const whenText = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function failureMessage(e: unknown): string {
  const body = e instanceof ApiError ? (e.body as { error?: unknown } | undefined) : undefined;
  return typeof body?.error === 'string' ? body.error : 'Could not create the meal';
}

export function Meals() {
  const navigate = useNavigate();
  const [meals, setMeals] = useState<MealSummary[] | null>(null);
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null);
  /** The ticked recipes, each with its course. */
  const [courses, setCourses] = useState<Record<string, Course>>({});
  const [title, setTitle] = useState('');
  const [serveAt, setServeAt] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listMeals().then(setMeals).catch(() => setLoadError('Could not load your meals'));
    listRecipes().then(setRecipes).catch(() => setLoadError('Could not load your recipes'));
  }, []);

  const pickedIds = Object.keys(courses);
  const serveDate = serveAt ? new Date(serveAt) : null;
  const ready = pickedIds.length > 0 && title.trim() !== '' && serveDate !== null && !Number.isNaN(serveDate.getTime());

  function toggle(id: string) {
    setCourses((c) => (id in c ? Object.fromEntries(Object.entries(c).filter(([k]) => k !== id)) : { ...c, [id]: 'main' }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    try {
      const meal = await createMeal({
        title: title.trim(),
        // A datetime-local value is wall-clock time with no zone; the Date constructor reads it as local time.
        serveAt: new Date(serveAt).toISOString(),
        recipes: pickedIds.map((recipeId) => ({ recipeId, course: courses[recipeId] })),
      });
      navigate(`/meals/${encodeURIComponent(meal.id)}`);
    } catch (err) {
      setError(failureMessage(err));
      setSaving(false);
    }
  }

  return (
    <main className="page planner">
      <header className="cook-bar">
        <Link className="btn round-btn" to="/" aria-label="Back to library"><BackIcon /></Link>
      </header>
      <h1>Meals</h1>
      {loadError && <p className="field-error" role="alert">{loadError}</p>}

      {meals && meals.length === 0 && <p className="empty">No meals yet.</p>}
      <ul className="rows">
        {meals?.map((m) => (
          <li key={m.id}>
            <Link className="planner-pick" to={`/meals/${encodeURIComponent(m.id)}`}>
              <span>
                <strong>{m.title}</strong>
                <span className="sub">
                  {' '}{whenText(m.serveAt)} · {plural(m.recipeCount, 'recipe', 'recipes')}
                  {m.stageCount > 0 ? ` · ${m.doneCount} of ${plural(m.stageCount, 'step', 'steps')} done` : ' · no schedule yet'}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <h2>Plan a meal</h2>
      <form onSubmit={(e) => void submit(e)}>
        <label className="budget-field">
          Name
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sunday lunch" />
        </label>
        <label className="budget-field">
          When do you want to eat?
          <input type="datetime-local" value={serveAt} onChange={(e) => setServeAt(e.target.value)} />
        </label>
        <h3 className="planner-sub">Recipes</h3>
        {recipes && recipes.length === 0 && <p className="empty">No recipes yet.</p>}
        <ul className="rows planner-recipes">
          {recipes?.map((r) => (
            <li key={r.id}>
              <label className="planner-pick">
                <input type="checkbox" checked={r.id in courses} onChange={() => toggle(r.id)} />
                <span>{r.title}</span>
              </label>
              {r.id in courses && (
                <select
                  aria-label={`Course for ${r.title}`}
                  value={courses[r.id]}
                  onChange={(e) => setCourses((c) => ({ ...c, [r.id]: e.target.value as Course }))}
                >
                  {COURSES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
            </li>
          ))}
        </ul>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="shopping-actions">
          <button type="submit" className="primary share-btn" disabled={!ready || saving}>Create meal</button>
        </div>
      </form>
    </main>
  );
}
