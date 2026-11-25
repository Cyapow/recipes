import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getBackupStatus, listRecipes, getFacets, setFavourite, type BackupStatus, type Facets, type RecipeSummary } from '../api';
import { tagKey, type Tag } from '../../../server/src/recipes/categories';
import { FilterSheet, type Filters } from '../components/FilterSheet';
import { FavouriteButton } from '../components/FavouriteButton';
import { BackupBanner } from '../components/BackupBanner';
import { CameraIcon, CartIcon, ChevronIcon, CloseIcon, GearIcon, LinkIcon, ListIcon, PlusIcon, SearchIcon, SparklesIcon } from '../components/Icons';
import { useMyEmail, withStar } from '../lib/favourite';
import { formatMinutes, originLabel } from '../lib/text';
import { monogram, monogramColors } from '../lib/monogram';
import { draftHref, draftKindLabel, draftTitle, listDrafts, removeDraft, type Draft } from '../lib/drafts';

const STORAGE_KEY = 'recipes.libraryFilters';

function isTag(t: unknown): t is Tag {
  return !!t && typeof t === 'object' && typeof (t as Tag).group === 'string' && typeof (t as Tag).name === 'string';
}

function loadFilters(): Filters {
  try {
    const raw = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    if (raw && Array.isArray(raw.brands) && Array.isArray(raw.tags)) {
      return {
        brands: raw.brands.filter((b: unknown) => typeof b === 'string'),
        tags: raw.tags.filter(isTag),
      };
    }
  } catch { /* storage unavailable or malformed */ }
  return { brands: [], tags: [] };
}

export function subtitle(r: RecipeSummary): string {
  return [originLabel(r), r.tags[0]?.name, formatMinutes(r.totalMinutes)].filter(Boolean).join(' · ');
}

export function Library() {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [sheetOpen, setSheetOpen] = useState(false);
  const filtersBtn = useRef<HTMLButtonElement>(null);
  const [facets, setFacets] = useState<Facets>({ brands: [], tags: [] });
  const [rows, setRows] = useState<RecipeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [backupFailed, setBackupFailed] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>(() => listDrafts());
  const me = useMyEmail();

  useEffect(() => {
    getBackupStatus().then(setBackup).catch(() => setBackupFailed(true));
  }, []);

  useEffect(() => {
    getFacets().then(setFacets).catch(() => {});
  }, []);

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filters)); } catch { /* ignore */ }
  }, [filters]);

  useEffect(() => {
    let live = true;
    listRecipes({
      search: search || undefined,
      brands: filters.brands.length ? filters.brands : undefined,
      tags: filters.tags.length ? filters.tags : undefined,
    })
      .then((r) => live && (setRows(r), setError(null)))
      .catch(() => live && setError('Could not load recipes'));
    return () => {
      live = false;
    };
  }, [search, filters]);

  // Updated in place by id: a star is not an edit, so the list neither reloads nor re-sorts under the finger.
  const star = async (id: string, on: boolean) => {
    if (!me) return;
    const put = (value: boolean) =>
      setRows((cur) => cur && cur.map((r) => (r.id === id ? { ...r, favouritedBy: withStar(r.favouritedBy, me, value) } : r)));
    put(on);
    try {
      await setFavourite(id, on);
    } catch {
      put(!on);
    }
  };

  const activeCount = filters.brands.length + filters.tags.length;
  const closeSheet = () => {
    setSheetOpen(false);
    filtersBtn.current?.focus();
  };

  return (
    <main className="page">
      <header className="bar">
        <h1 className="library-title">Recipes</h1>
        <nav className="actions">
          <Link className="btn icon-btn" to="/new" aria-label="New recipe"><PlusIcon /></Link>
          <Link className="btn icon-btn" to="/planner" aria-label="Meal planner"><ListIcon /></Link>
          <Link className="btn icon-btn" to="/shopping" aria-label="Shopping list"><CartIcon /></Link>
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
        <Link className="btn cta outline" to="/photos"><CameraIcon />From photos</Link>
      </div>
      <div className="filter-bar">
        <button ref={filtersBtn} type="button" className="btn small filter-btn" aria-haspopup="dialog" onClick={() => setSheetOpen(true)}>
          {activeCount > 0 ? `Filters · ${activeCount}` : 'Filters'}
        </button>
        {filters.brands.map((b) => (
          <button
            key={`b:${b}`}
            type="button"
            className="chip active pill"
            aria-label={`Remove filter ${b}`}
            onClick={() => setFilters({ ...filters, brands: filters.brands.filter((x) => x !== b) })}
          >
            {b}<CloseIcon />
          </button>
        ))}
        {filters.tags.map((t) => (
          <button
            key={`t:${tagKey(t)}`}
            type="button"
            className="chip active pill"
            aria-label={`Remove filter ${t.name}`}
            onClick={() => setFilters({ ...filters, tags: filters.tags.filter((x) => tagKey(x) !== tagKey(t)) })}
          >
            {t.name}<CloseIcon />
          </button>
        ))}
      </div>
      <FilterSheet
        open={sheetOpen}
        facets={facets}
        filters={filters}
        count={rows?.length ?? 0}
        onChange={setFilters}
        onClose={closeSheet}
      />
      {drafts.length > 0 && (
        <section className="drafts" aria-label="Drafts">
          <h2>Drafts</h2>
          <ul className="rows">
            {drafts.map((d) => (
              <li key={d.id} className="draft-card">
                <span className="meta">
                  <span className="title">{draftTitle(d)}</span>
                  <span className="sub">{draftKindLabel(d.kind)} · {new Date(d.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                </span>
                <span className="draft-actions">
                  <Link className="btn small primary" to={draftHref(d)} aria-label={`Resume draft ${draftTitle(d)}`}>Resume</Link>
                  <button
                    type="button"
                    className="btn small danger-text"
                    aria-label={`Discard draft ${draftTitle(d)}`}
                    onClick={() => {
                      if (!window.confirm('Discard this draft?')) return;
                      removeDraft(d.id);
                      setDrafts(listDrafts());
                    }}
                  >
                    Discard
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
      {rows && rows.length === 0 && <p className="empty">No recipes yet.</p>}
      <ul className="rows">
        {rows?.map((r) => (
          <li key={r.id} className="row-item">
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
            {me && (
              <FavouriteButton className="row-fav" title={r.title} on={r.favouritedBy.includes(me)} onToggle={() => star(r.id, !r.favouritedBy.includes(me))} />
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
