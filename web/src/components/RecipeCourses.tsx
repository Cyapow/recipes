import { COURSES, type Course } from '../../../server/src/meals/courses';
import type { RecipeSummary } from '../api';

/**
 * Picking the recipes a meal is made of and saying what each one is. Shared by making a meal and changing the
 * recipes of one that exists, so the two offer the same thing in the same words.
 */
export function RecipeCourses({ recipes, courses, atLimit = false, onToggle, onCourse }: {
  recipes: RecipeSummary[] | null;
  /** The picked recipes by id, each with its course. */
  courses: Record<string, Course>;
  /** As many recipes as a meal may hold are picked: nothing more can be ticked, rather than the save being refused. */
  atLimit?: boolean;
  onToggle: (id: string) => void;
  onCourse: (id: string, course: Course) => void;
}) {
  return (
    <>
      {recipes && recipes.length === 0 && <p className="empty">No recipes yet.</p>}
      <ul className="rows planner-recipes">
        {recipes?.map((r) => (
          <li key={r.id}>
            <label className="planner-pick">
              <input
                type="checkbox"
                checked={r.id in courses}
                disabled={atLimit && !(r.id in courses)}
                onChange={() => onToggle(r.id)}
              />
              <span>{r.title}</span>
            </label>
            {r.id in courses && (
              <select
                aria-label={`Course for ${r.title}`}
                value={courses[r.id]}
                onChange={(e) => onCourse(r.id, e.target.value as Course)}
              >
                {COURSES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
