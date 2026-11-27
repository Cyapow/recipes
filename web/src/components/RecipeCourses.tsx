import { useRef, useState } from 'react';
import { COURSES, type Course } from '../../../server/src/meals/courses';
import type { RecipeSummary } from '../api';
import { RecipeBrowser } from './RecipeBrowser';
import { RecipeFace } from './RecipeFace';

/**
 * Picking the recipes a meal is made of and saying what each one is. Shared by making a meal and changing the
 * recipes of one that exists, so the two offer the same thing in the same words.
 *
 * Browsing is the library's own: the same search, the same filters, the same rows, so looking for the thing with
 * squash in it works here as it does there. Narrowing changes what you browse, never what you have chosen — see
 * pinned, below. Its filters are its own and start clean, because a meal is planned in one sitting.
 */
export function RecipeCourses({ courses, atLimit = false, onToggle, onCourse }: {
  /** The picked recipes by id, each with its course. Held by the caller, so a changed search cannot lose a tick. */
  courses: Record<string, Course>;
  /** As many recipes as a meal may hold are picked: nothing more can be ticked, rather than the save being refused. */
  atLimit?: boolean;
  onToggle: (id: string) => void;
  onCourse: (id: string, course: Course) => void;
}) {
  // Every recipe this picker has shown, so a picked one can still be named once a search or a filter hides it.
  // It is fed from results that arrived, so a picked recipe the first load never delivered — it failed, or a filter
  // applied before it landed cancelled it — is in neither list until a load succeeds. Known; see the branch notes.
  const seen = useRef(new Map<string, RecipeSummary>());
  const [results, setResults] = useState<RecipeSummary[] | null>(null);

  const row = (r: RecipeSummary) => (
    <li key={r.id}>
      <label className="planner-pick">
        <input
          type="checkbox"
          aria-label={r.title}
          checked={r.id in courses}
          disabled={atLimit && !(r.id in courses)}
          onChange={() => onToggle(r.id)}
        />
        <RecipeFace recipe={r} />
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

  // Picked recipes the current results leave out, pinned above them. Unnarrowed, the results hold everything, so
  // nothing is pinned and ticking a row never moves it; only a search or filter that would hide a choice brings it back.
  const pinned = Object.keys(courses)
    .filter((id) => !results?.some((r) => r.id === id))
    .flatMap((id) => {
      const r = seen.current.get(id);
      return r ? [r] : [];
    });

  return (
    <RecipeBrowser
      renderRow={row}
      onResults={(rs) => {
        for (const r of rs) seen.current.set(r.id, r);
        setResults(rs);
      }}
      beforeList={
        pinned.length > 0 ? (
          <>
            <p className="sub">Already picked</p>
            <ul className="rows">{pinned.map(row)}</ul>
          </>
        ) : null
      }
    />
  );
}
