import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createMeal, listMeals, listRecipes, type MealSummaryWithServeText, type RecipeSummary } from '../api';
import type { Course } from '../../../server/src/meals/courses';
import { MAX_MEAL_RECIPES } from '../../../server/src/meals/limits';
import { BackIcon } from '../components/Icons';
import { RecipeCourses } from '../components/RecipeCourses';
import { describeMealError } from '../lib/mealError';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function Meals() {
  const navigate = useNavigate();
  const [meals, setMeals] = useState<MealSummaryWithServeText[] | null>(null);
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
      setError(describeMealError(err, 'Could not create the meal'));
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
                  {' '}{m.serveText} · {plural(m.recipeCount, 'recipe', 'recipes')}
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
          <input maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sunday lunch" />
        </label>
        <label className="budget-field">
          When do you want to eat?
          <input type="datetime-local" value={serveAt} onChange={(e) => setServeAt(e.target.value)} />
        </label>
        <h3 className="planner-sub">Recipes</h3>
        {pickedIds.length >= MAX_MEAL_RECIPES && (
          <p className="sub">A meal holds {MAX_MEAL_RECIPES} recipes at most. Untick one to pick another.</p>
        )}
        <RecipeCourses
          recipes={recipes}
          courses={courses}
          atLimit={pickedIds.length >= MAX_MEAL_RECIPES}
          onToggle={toggle}
          onCourse={(id, course) => setCourses((c) => ({ ...c, [id]: course }))}
        />
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="shopping-actions">
          <button type="submit" className="primary share-btn" disabled={!ready || saving}>Create meal</button>
        </div>
      </form>
    </main>
  );
}
