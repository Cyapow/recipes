import { useEffect, useRef, useState } from 'react';
import { COURSES, type Course } from '../../../server/src/meals/courses';
import { listRecipes, type RecipeSummary } from '../api';
import { SearchIcon } from './Icons';

/**
 * Picking the recipes a meal is made of and saying what each one is. Shared by making a meal and changing the
 * recipes of one that exists, so the two offer the same thing in the same words.
 *
 * The search is the server's, the same call the library makes, so it matches a recipe's ingredients, brand and tags
 * and not only its title: when you are assembling a meal, "squash" is how you look for the thing with squash in it.
 * Searching narrows what you browse, never what you have chosen — see pinned, below.
 */
export function RecipeCourses({ courses, atLimit = false, onToggle, onCourse }: {
  /** The picked recipes by id, each with its course. Held by the caller, so a changed search cannot lose a tick. */
  courses: Record<string, Course>;
  /** As many recipes as a meal may hold are picked: nothing more can be ticked, rather than the save being refused. */
  atLimit?: boolean;
  onToggle: (id: string) => void;
  onCourse: (id: string, course: Course) => void;
}) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<RecipeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Every recipe this picker has shown, so a picked one can still be named once a search no longer returns it. The
  // first load is unsearched, so everything pickable has been seen before any search can hide it.
  const seen = useRef(new Map<string, RecipeSummary>());

  useEffect(() => {
    let live = true;
    // No debounce, matching the library's own search field: the box is on the same machine as the database.
    listRecipes({ search: search || undefined })
      .then((rs) => {
        if (!live) return;
        for (const r of rs) seen.current.set(r.id, r);
        setResults(rs);
        setError(null);
      })
      .catch(() => live && setError('Could not load your recipes'));
    return () => {
      live = false;
    };
  }, [search]);

  // Picked recipes the current results leave out, pinned above them. With no search the results hold everything, so
  // nothing is pinned and ticking a row never moves it; only a search that would hide a choice brings it back.
  const pinned = Object.keys(courses)
    .filter((id) => !results?.some((r) => r.id === id))
    .flatMap((id) => {
      const r = seen.current.get(id);
      return r ? [r] : [];
    });

  const row = (r: RecipeSummary) => (
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
  );

  return (
    <>
      <label className="search-field">
        <SearchIcon />
        <input
          type="search"
          aria-label="Search recipes"
          placeholder="Search recipes"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      {error && <p className="field-error" role="alert">{error}</p>}
      {pinned.length > 0 && (
        <>
          <p className="sub">Already picked</p>
          <ul className="rows planner-recipes">{pinned.map(row)}</ul>
        </>
      )}
      {results && results.length === 0 && (
        <p className="empty">{search ? 'No recipes match that.' : 'No recipes yet.'}</p>
      )}
      <ul className="rows planner-recipes">{results?.map(row)}</ul>
    </>
  );
}
