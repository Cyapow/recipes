import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getFacets, listRecipes, type Facets, type RecipeSummary } from '../api';
import { tagKey, type Tag } from '../../../server/src/recipes/categories';
import { FilterSheet, type Filters } from './FilterSheet';
import { CloseIcon, SearchIcon } from './Icons';

/** Changes one row where it stands. The list is not fetched again, so nothing moves under the finger. */
export type RowPatch = (next: Partial<RecipeSummary>) => void;

function isTag(t: unknown): t is Tag {
  return !!t && typeof t === 'object' && typeof (t as Tag).group === 'string' && typeof (t as Tag).name === 'string';
}

/** Filters kept from a previous visit. Anything saved in a shape this no longer understands is dropped, not trusted. */
export function loadFilters(storageKey: string): Filters {
  try {
    const raw = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
    if (raw && Array.isArray(raw.brands) && Array.isArray(raw.tags)) {
      return {
        brands: raw.brands.filter((b: unknown) => typeof b === 'string'),
        tags: raw.tags.filter(isTag),
        // Absent from filters saved before favourites existed.
        people: Array.isArray(raw.people) ? raw.people.filter((e: unknown) => typeof e === 'string') : [],
      };
    }
  } catch { /* storage unavailable or malformed */ }
  return { brands: [], tags: [], people: [] };
}

const NO_FILTERS: Filters = { brands: [], tags: [], people: [] };

/**
 * Browsing the recipe library: the search box, the filters and the results. The library page and the meal recipe
 * picker both render it, so searching for "squash" means the same thing whether you are reading or choosing.
 *
 * What a row looks like is the caller's: it renders one, and is handed a way to change that row in place.
 */
export function RecipeBrowser({ renderRow, storageKey, afterSearch, beforeList, onResults }: {
  renderRow: (recipe: RecipeSummary, patch: RowPatch) => ReactNode;
  /** Where filters survive a page change, in sessionStorage. Omitted: this browser's filters are its own. */
  storageKey?: string;
  /** Rendered between the search box and the filter bar — the library's "Describe it / From a link" row. */
  afterSearch?: ReactNode;
  /** Rendered between the filter bar and the results — the picker's "Already picked" block. */
  beforeList?: ReactNode;
  onResults?: (rows: RecipeSummary[]) => void;
}) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filters>(() => (storageKey ? loadFilters(storageKey) : NO_FILTERS));
  const [sheetOpen, setSheetOpen] = useState(false);
  const filtersBtn = useRef<HTMLButtonElement>(null);
  const [facets, setFacets] = useState<Facets>({ brands: [], tags: [], people: [] });
  const [rows, setRows] = useState<RecipeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Held in a ref so a caller's inline callback cannot restart the fetch on every render.
  const report = useRef(onResults);
  report.current = onResults;

  useEffect(() => {
    getFacets().then(setFacets).catch(() => {});
  }, []);

  useEffect(() => {
    if (!storageKey) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify(filters)); } catch { /* ignore */ }
  }, [storageKey, filters]);

  useEffect(() => {
    let live = true;
    listRecipes({
      search: search || undefined,
      brands: filters.brands.length ? filters.brands : undefined,
      tags: filters.tags.length ? filters.tags : undefined,
      favouritedBy: filters.people.length ? filters.people : undefined,
    })
      .then((r) => {
        if (!live) return;
        setRows(r);
        setError(null);
        report.current?.(r);
      })
      .catch(() => live && setError('Could not load recipes'));
    return () => {
      live = false;
    };
  }, [search, filters]);

  const patch = (id: string): RowPatch => (next) =>
    setRows((cur) => cur && cur.map((r) => (r.id === id ? { ...r, ...next } : r)));

  const personName = (email: string) => facets.people.find((p) => p.email === email)?.name ?? email;
  const activeCount = filters.brands.length + filters.tags.length + filters.people.length;
  const narrowed = search.trim() !== '' || activeCount > 0;
  const closeSheet = () => {
    setSheetOpen(false);
    filtersBtn.current?.focus();
  };

  const chip = (key: string, label: string, onRemove: () => void) => (
    <button key={key} type="button" className="chip active pill" aria-label={`Remove filter ${label}`} onClick={onRemove}>
      {label}<CloseIcon />
    </button>
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
      {afterSearch}
      <div className="filter-bar">
        <button ref={filtersBtn} type="button" className="btn small filter-btn" aria-haspopup="dialog" onClick={() => setSheetOpen(true)}>
          {activeCount > 0 ? `Filters · ${activeCount}` : 'Filters'}
        </button>
        {filters.brands.map((b) => chip(`b:${b}`, b, () => setFilters({ ...filters, brands: filters.brands.filter((x) => x !== b) })))}
        {filters.tags.map((t) =>
          chip(`t:${tagKey(t)}`, t.name, () => setFilters({ ...filters, tags: filters.tags.filter((x) => tagKey(x) !== tagKey(t)) })))}
        {filters.people.map((email) =>
          chip(`p:${email}`, personName(email), () => setFilters({ ...filters, people: filters.people.filter((x) => x !== email) })))}
      </div>
      <FilterSheet
        open={sheetOpen}
        facets={facets}
        filters={filters}
        count={rows?.length ?? 0}
        onChange={setFilters}
        onClose={closeSheet}
      />
      {beforeList}
      {error && <p className="field-error" role="alert">{error}</p>}
      {rows && rows.length === 0 && <p className="empty">{narrowed ? 'No recipes match that.' : 'No recipes yet.'}</p>}
      <ul className="rows">{rows?.map((r) => renderRow(r, patch(r.id)))}</ul>
    </>
  );
}
