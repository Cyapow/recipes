import { useEffect, useRef, useState } from 'react';
import type { Facets } from '../api';
import { TAG_GROUPS, tagKey, type Tag } from '../../../server/src/recipes/categories';

export type Filters = { brands: string[]; tags: Tag[] };

const BRANDS_SHOWN = 8;

export function FilterSheet({ open, facets, filters, count, onChange, onClose }: {
  open: boolean;
  facets: Facets;
  filters: Filters;
  count: number;
  onChange: (f: Filters) => void;
  onClose: () => void;
}) {
  const [allBrands, setAllBrands] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    heading.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  const brands = [...facets.brands].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const shownBrands = allBrands ? brands : brands.slice(0, BRANDS_SHOWN);
  const hasMore = !allBrands && brands.length > BRANDS_SHOWN;
  const active = filters.brands.length + filters.tags.length;

  const toggleBrand = (name: string) =>
    onChange({
      ...filters,
      brands: filters.brands.includes(name) ? filters.brands.filter((b) => b !== name) : [...filters.brands, name],
    });
  const toggleTag = (t: Tag) => {
    const on = filters.tags.some((x) => tagKey(x) === tagKey(t));
    onChange({ ...filters, tags: on ? filters.tags.filter((x) => tagKey(x) !== tagKey(t)) : [...filters.tags, t] });
  };

  return (
    <>
      <div className="sheet-backdrop" data-testid="filter-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="filter-sheet-title">
        <div className="sheet-grab" aria-hidden="true" />
        <h2 id="filter-sheet-title" className="sheet-title" tabIndex={-1} ref={heading}>Filters</h2>
        <div className="sheet-body">
          {brands.length > 0 && (
            <section>
              <h3>Brand</h3>
              <div className="sheet-chips">
                {shownBrands.map((b) => (
                  <button
                    key={b.name}
                    type="button"
                    className={`chip${filters.brands.includes(b.name) ? ' active' : ''}`}
                    aria-pressed={filters.brands.includes(b.name)}
                    onClick={() => toggleBrand(b.name)}
                  >
                    {b.name}
                  </button>
                ))}
                {hasMore && (
                  <button type="button" className="chip" onClick={() => setAllBrands(true)}>More</button>
                )}
              </div>
            </section>
          )}
          {TAG_GROUPS.map((g) => {
            const tags = facets.tags.filter((t) => t.group === g.id);
            if (tags.length === 0) return null;
            return (
              <section key={g.id}>
                <h3>{g.label}</h3>
                <div className="sheet-chips">
                  {tags.map((t) => {
                    const tag: Tag = { group: t.group, name: t.name };
                    const on = filters.tags.some((x) => tagKey(x) === tagKey(tag));
                    return (
                      <button
                        key={tagKey(tag)}
                        type="button"
                        className={`chip${on ? ' active' : ''}`}
                        aria-pressed={on}
                        onClick={() => toggleTag(tag)}
                      >
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
        <div className="sheet-foot">
          <button type="button" className="btn small" disabled={active === 0} onClick={() => onChange({ brands: [], tags: [] })}>
            Clear all
          </button>
          <button type="button" className="btn small primary" onClick={onClose}>
            Show {count} {count === 1 ? 'recipe' : 'recipes'}
          </button>
        </div>
      </div>
    </>
  );
}
