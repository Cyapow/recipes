import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listRecipes, listTags, type RecipeSummary } from '../api';
import { formatMinutes } from '../lib/text';

type Origin = 'mine' | 'other' | undefined;
const CHIPS: { label: string; origin: Origin }[] = [
  { label: 'All', origin: undefined },
  { label: 'Mine', origin: 'mine' },
  { label: 'From elsewhere', origin: 'other' },
];

export function subtitle(r: RecipeSummary): string {
  const originLabel = r.origin === 'mine' ? 'Mine' : (r.sourceName ?? 'From elsewhere');
  return [originLabel, r.tags[0], formatMinutes(r.totalMinutes)].filter(Boolean).join(' · ');
}

export function Library() {
  const [search, setSearch] = useState('');
  const [origin, setOrigin] = useState<Origin>(undefined);
  const [tag, setTag] = useState<string | undefined>(undefined);
  const [tags, setTags] = useState<string[]>([]);
  const [rows, setRows] = useState<RecipeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listTags().then(setTags).catch(() => {});
  }, []);

  useEffect(() => {
    let live = true;
    listRecipes({ search: search || undefined, origin, tag })
      .then((r) => live && (setRows(r), setError(null)))
      .catch(() => live && setError('Could not load recipes'));
    return () => {
      live = false;
    };
  }, [search, origin, tag]);

  return (
    <main className="page">
      <header className="bar">
        <h1>Recipes</h1>
        <nav className="actions">
          <Link className="btn small" to="/import">Import</Link>
          <Link className="btn small" to="/describe">Describe</Link>
          <Link className="btn small primary" to="/new">New</Link>
        </nav>
      </header>
      <input
        className="search"
        type="search"
        aria-label="Search recipes"
        placeholder="Search recipes"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="chips">
        {CHIPS.map((c) => (
          <button
            key={c.label}
            type="button"
            className={`chip${origin === c.origin ? ' active' : ''}`}
            aria-pressed={origin === c.origin}
            onClick={() => setOrigin(c.origin)}
          >
            {c.label}
          </button>
        ))}
      </div>
      {tags.length > 0 && (
        <div className="chips tags">
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              className={`chip${tag === t ? ' active' : ''}`}
              aria-pressed={tag === t}
              onClick={() => setTag(tag === t ? undefined : t)}
            >
              {t}
            </button>
          ))}
        </div>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
      {rows && rows.length === 0 && <p className="empty">No recipes yet.</p>}
      <ul className="rows">
        {rows?.map((r) => (
          <li key={r.id}>
            <Link className="row" to={`/recipe/${r.id}`}>
              <span className="thumb">
                {r.thumbnailId && <img src={`/api/images/${r.thumbnailId}/thumb`} alt="" />}
              </span>
              <span className="meta">
                <span className="title">{r.title}</span>
                <span className="sub">{subtitle(r)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
