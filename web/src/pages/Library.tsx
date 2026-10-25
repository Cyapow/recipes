import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getBackupStatus, listRecipes, listTags, type BackupStatus, type RecipeSummary } from '../api';
import { BackupBanner } from '../components/BackupBanner';
import { ChevronIcon, GearIcon, LinkIcon, PlusIcon, SearchIcon, SparklesIcon } from '../components/Icons';
import { formatMinutes, originLabel } from '../lib/text';
import { monogram, monogramColors } from '../lib/monogram';

type Origin = 'mine' | 'other' | undefined;
const CHIPS: { label: string; origin: Origin }[] = [
  { label: 'All', origin: undefined },
  { label: 'Mine', origin: 'mine' },
  { label: 'From elsewhere', origin: 'other' },
];

export function subtitle(r: RecipeSummary): string {
  return [originLabel(r), r.tags[0], formatMinutes(r.totalMinutes)].filter(Boolean).join(' · ');
}

export function Library() {
  const [search, setSearch] = useState('');
  const [origin, setOrigin] = useState<Origin>(undefined);
  const [tag, setTag] = useState<string | undefined>(undefined);
  const [tags, setTags] = useState<string[]>([]);
  const [rows, setRows] = useState<RecipeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [backupFailed, setBackupFailed] = useState(false);

  useEffect(() => {
    getBackupStatus().then(setBackup).catch(() => setBackupFailed(true));
  }, []);

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
        <h1 className="library-title">Recipes</h1>
        <nav className="actions">
          <Link className="btn icon-btn" to="/new" aria-label="New recipe"><PlusIcon /></Link>
          <Link className="btn icon-btn" to="/settings" aria-label="Settings"><GearIcon /></Link>
        </nav>
      </header>
      {backup && <BackupBanner banner={backup.banner} lastError={backup.lastError} />}
      {backupFailed && <p className="hint" role="status">Couldn't check backup status</p>}
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
      <div className="cta-row">
        <Link className="btn cta primary" to="/describe"><SparklesIcon />Describe it</Link>
        <Link className="btn cta outline" to="/import"><LinkIcon />From a link</Link>
      </div>
      <div className="segmented">
        {CHIPS.map((c) => (
          <button
            key={c.label}
            type="button"
            className={origin === c.origin ? 'active' : undefined}
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
              {r.thumbnailId ? (
                <span className="thumb"><img src={`/api/images/${r.thumbnailId}/thumb`} alt="" /></span>
              ) : (
                <span className="thumb" aria-hidden="true" style={{ background: monogramColors(r.title).bg, color: monogramColors(r.title).fg }}>
                  {monogram(r.title)}
                </span>
              )}
              <span className="meta">
                <span className="title">{r.title}</span>
                <span className="sub">{subtitle(r)}</span>
              </span>
              <ChevronIcon />
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
