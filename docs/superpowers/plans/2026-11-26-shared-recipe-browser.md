# Shared Recipe Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One component browses the recipe library — search, filters, chips, results — and both the library page and the meal recipe picker render it.

**Architecture:** `RecipeBrowser` owns the search box, the filter bar, `FilterSheet`, the facets and `listRecipes` calls, and the results list. Each caller passes `renderRow(recipe, patch)` and keeps its own page furniture. `RecipeFace` holds the thumbnail-title-subtitle block both rows show.

**Tech Stack:** React 19, react-router 7, TypeScript ESM, vitest + @testing-library/react + jsdom.

**Spec:** `docs/superpowers/specs/2026-11-26-shared-recipe-browser-design.md`

**Execution:** native, in this session, on branch `feat/shared-recipe-browser` cut from `main`.

## Global Constraints

- No change to `listRecipes`, `getFacets`, `FilterSheet` or any server route. Everything needed exists.
- The library must not regress: `Library.test.tsx`, `Library.favourites.test.tsx` and `Editor.drafts.test.tsx` pass, with changes only where this plan names them.
- Ticking or starring a recipe never reloads or re-sorts the list.
- Every control `RecipeBrowser` renders is `type="button"`: it now sits inside the Meals and Meal `<form>` elements.
- Filter kinds stay as they are: brands, tags, favourited-by.
- One error message for a failed load, `Could not load recipes`, replacing the picker's `Could not load your recipes`.
- Empty list copy: `No recipes match that.` when a search or any filter is active, `No recipes yet.` otherwise.

## Review Focus

1. A button inside the picker that is not `type="button"` submits the meal form and creates a meal — Task 4 pins that opening Filters does not call `createMeal`.
2. A filter that hides a ticked recipe must pin it under "Already picked", exactly as a search does — Task 4.
3. Starring a recipe must patch that row only: no refetch, no re-sort — Task 3.
4. Filters restored from an older session, malformed or missing fields, must not break the page — Task 2.
5. Two browsers on one device must not share filters: without a `storageKey` nothing is read or written — Task 2.

---

### Task 1: `RecipeFace`

**Files:**
- Create: `web/src/components/RecipeFace.tsx`
- Create: `web/src/components/RecipeFace.test.tsx`
- Modify: `web/src/pages/Library.tsx` (drop its `subtitle`, its monogram and thumb markup)

**Interfaces:**
- Produces: `export function RecipeFace({ recipe }: { recipe: RecipeSummary }): ReactElement` rendering `<span className="thumb">` (an `<img src={/api/images/${thumbnailId}/thumb} alt="">` when `thumbnailId` is set, else the monogram with `monogramColors`) followed by `<span className="meta"><span className="title">…</span><span className="sub">…</span></span>`.
- Produces: `export function subtitle(r: RecipeSummary): string` — moved verbatim from `Library.tsx:47`, joining `originLabel(r)`, `r.tags[0]?.name` and `formatMinutes(r.totalMinutes)` with ` · `.

- [ ] **Step 1: Write the failing tests** in `RecipeFace.test.tsx`

```tsx
it('shows the recipe photo when it has one', () => { /* thumbnailId: 'img1' -> img with src /api/images/img1/thumb and alt '' */ });
it('falls back to the monogram when it has none', () => { /* thumbnailId: null, title 'Cottage pie' -> text 'C' (monogram()) */ });
it('reads origin, first tag and total time into the subtitle', () => {
  expect(subtitle({ ...recipe, origin: 'mine', tags: [{ group: 'course', name: 'Dinner' }], totalMinutes: 70 })).toBe('Mine · Dinner · 1 h 10 min');
});
```

Take the exact expected subtitle string from `originLabel` and `formatMinutes` in `web/src/lib/text.ts` rather than guessing it.

- [ ] **Step 2: Run them and watch them fail** — `npx vitest run web/src/components/RecipeFace.test.tsx`, expected FAIL: module not found.
- [ ] **Step 3: Write `RecipeFace.tsx`**, lifting the markup from `Library.tsx:240-250` unchanged so the library's appearance cannot shift.
- [ ] **Step 4: Point `Library.tsx` at it** — import `RecipeFace` and `subtitle`, render `<RecipeFace recipe={r} />` inside the row's `<Link>` before `<ChevronIcon />`, and delete the moved code. `Library.tsx` keeps exporting `subtitle` (re-export) only if a test still imports it; otherwise drop it.
- [ ] **Step 5: Run `npx vitest run web/src/pages/Library.test.tsx web/src/pages/Library.favourites.test.tsx web/src/components/RecipeFace.test.tsx`** — expected PASS, with no edits to the library's own tests.
- [ ] **Step 6: Commit** `refactor: lift the library's recipe row face into its own component`

---

### Task 2: `RecipeBrowser`

**Files:**
- Create: `web/src/components/RecipeBrowser.tsx`
- Create: `web/src/components/RecipeBrowser.test.tsx`

**Interfaces:**
- Consumes: `FilterSheet`, `type Filters` from `./FilterSheet`; `listRecipes`, `getFacets`, `type RecipeSummary`, `type Facets` from `../api`; `tagKey` from `../../../server/src/recipes/categories`.
- Produces:

```ts
export type RowPatch = (next: Partial<RecipeSummary>) => void;

export function RecipeBrowser(props: {
  renderRow: (recipe: RecipeSummary, patch: RowPatch) => ReactNode;
  /** Where filters survive a page change, in sessionStorage. Omitted: this browser's filters are its own and start clean. */
  storageKey?: string;
  /** Rendered between the filter bar and the results — the picker's "Already picked" block. */
  beforeList?: ReactNode;
  onResults?: (rows: RecipeSummary[]) => void;
}): ReactElement;

export function loadFilters(storageKey: string): Filters;
```

- The fetch effect runs on `[search, filters]` and sends `{ search: search || undefined, brands, tags, favouritedBy }` with each list omitted when empty, as `Library.tsx:79-92` does today.
- `patch` updates that row in the component's own `rows` state by id. It never refetches.

- [ ] **Step 1: Write the failing tests** in `RecipeBrowser.test.tsx`, with `listRecipes` and `getFacets` mocked

```tsx
it('asks the server for the search text and the active filters', async () => { /* type 'mince', tick a brand in the sheet -> last listRecipes call { search: 'mince', brands: ['Mine'] } */ });
it('removes a filter from the bar when its chip is clicked', async () => { /* chip aria-label `Remove filter Mine` -> listRecipes called without brands */ });
it('keeps filters under its storage key and reads them back', async () => { /* storageKey 'k' -> sessionStorage 'k' holds the filters */ });
it('keeps its filters to itself when it has no storage key', async () => { /* no storageKey -> sessionStorage untouched, nothing read */ });
it('ignores filters saved in a shape it does not understand', () => {
  sessionStorage.setItem('k', '{"brands":"nope","tags":[{"group":1}],"people":null}');
  expect(loadFilters('k')).toEqual({ brands: [], tags: [], people: [] });
});
it('patches one row without asking the server again', async () => { /* renderRow calls patch({ favouritedBy: ['a@x'] }) -> row text changes, listRecipes call count unchanged */ });
it('tells the two empty lists apart', async () => { /* [] -> 'No recipes yet.'; with a search -> 'No recipes match that.' */ });
it('says so when the recipes could not be loaded', async () => { /* rejects -> alert 'Could not load recipes' */ });
it('renders no button that would submit a form it sits in', async () => { /* render inside <form onSubmit>, click Filters and a sheet chip -> onSubmit never called */ });
```

Reuse `loadFilters`'s malformed-input guards from `Library.tsx:32-45`: a non-array `brands`, tag entries failing `isTag`, and an absent `people` all fall back to empty.

- [ ] **Step 2: Run them and watch them fail** — `npx vitest run web/src/components/RecipeBrowser.test.tsx`.
- [ ] **Step 3: Write `RecipeBrowser.tsx`**, moving `loadFilters`, `isTag`, the facets effect, the list effect, the filter bar with its three chip lists, `personName`, `activeCount`, `closeSheet` and the results `<ul className="rows">` out of `Library.tsx`. The search box is `<label className="search-field">` with `aria-label="Search recipes"`, unchanged.
- [ ] **Step 4: Run the tests** — expected PASS.
- [ ] **Step 5: Commit** `feat: add a recipe browser both the library and the picker can render`

---

### Task 3: The library renders it

**Files:**
- Modify: `web/src/pages/Library.tsx`
- Modify: `web/src/pages/Library.favourites.test.tsx` (the `loadFilters` import only)
- Modify: `web/src/pages/Library.test.tsx` only if a selector genuinely moved

**Interfaces:**
- Consumes: `RecipeBrowser`, `RowPatch`, `loadFilters` from Task 2; `RecipeFace` from Task 1.
- Produces: `export const LIBRARY_FILTERS_KEY = 'recipes.libraryFilters'` — the key the library has always used, now named so a test can ask for it.

- [ ] **Step 1: Add the failing test** to `Library.test.tsx`

```tsx
it('stars a recipe without asking the server for the list again', async () => {
  // click the star -> setFavourite called, listRecipes NOT called a second time, the row keeps its place
});
```

- [ ] **Step 2: Run it** — `npx vitest run web/src/pages/Library.test.tsx` — expected FAIL only if the star path regressed; if it passes against today's code, say so and keep it as the guard for this task.
- [ ] **Step 3: Rewrite `Library`'s body** to render `<RecipeBrowser storageKey={LIBRARY_FILTERS_KEY} renderRow={…} />` in place of its search box, filter bar, sheet, list and the state behind them. `star(id, on, patch)` calls `patch({ favouritedBy: withStar(…) })`, awaits `setFavourite`, and patches back on failure. The header, `MoreSheet`, `BackupBanner`, the CTA row and the drafts section stay where they are, above the browser.
- [ ] **Step 4: Update `Library.favourites.test.tsx`** to `import { Library, LIBRARY_FILTERS_KEY } from './Library'` and `import { loadFilters } from '../components/RecipeBrowser'`, calling `loadFilters(LIBRARY_FILTERS_KEY)`.
- [ ] **Step 5: Run `npx vitest run web/src/pages/Library.test.tsx web/src/pages/Library.favourites.test.tsx web/src/pages/Editor.drafts.test.tsx`** — expected PASS.
- [ ] **Step 6: Commit** `refactor: the library browses through the shared recipe browser`

---

### Task 4: The picker renders it

**Files:**
- Modify: `web/src/components/RecipeCourses.tsx`
- Modify: `web/src/components/RecipeCourses.test.tsx`
- Modify: `web/src/styles.css:124` and the planner block around `:446`

**Interfaces:**
- Consumes: `RecipeBrowser` (no `storageKey`), `RecipeFace`.
- The props `RecipeCourses` takes do not change, so `Meals.tsx:93` and `Meal.tsx:167` are untouched.

- [ ] **Step 1: Write the failing tests** in `RecipeCourses.test.tsx`

```tsx
it('pins a picked recipe a filter hides, as it does for a search', async () => { /* tick Roast chicken, apply a tag filter returning only Gravy -> 'Already picked' shows the ticked chicken */ });
it('does not create the meal when the filters are opened', async () => { /* render inside <form onSubmit>, click 'Filters' -> onSubmit never called */ });
it('shows what a recipe is, not only its title', async () => { /* a recipe with tags and totalMinutes -> its subtitle text is on the row */ });
```

Keep the four existing tests. Update the error-copy assertion to `Could not load recipes`.

- [ ] **Step 2: Run them and watch them fail** — `npx vitest run web/src/components/RecipeCourses.test.tsx`.
- [ ] **Step 3: Rewrite `RecipeCourses`** around `RecipeBrowser`: `onResults` feeds the `seen` map, `beforeList` holds the "Already picked" block, and `renderRow` is today's `row` with `<RecipeFace recipe={r} />` in place of the bare `<span>{r.title}</span>`. The checkbox keeps `aria-label` behaviour — the row's accessible name must stay the recipe title, so the label wraps the face as it wrapped the span. Delete the search box, the fetch effect and the error state it no longer owns.
- [ ] **Step 4: Fix the two CSS rules.** `styles.css:124` becomes `.page > label, .page > form > label:not(.search-field)`, so a search box keeps its row layout inside a form. Add `.planner-pick .thumb { width: 44px; height: 44px; border-radius: 12px; }` so a picker row with a photo stays close to its present height.
- [ ] **Step 5: Run `npx vitest run web/src/components/RecipeCourses.test.tsx web/src/pages/Meals.test.tsx web/src/pages/Meal.plan.test.tsx web/src/pages/Meal.now.test.tsx`** — expected PASS.
- [ ] **Step 6: Run the whole suite and both typechecks** — `npm test`, `npx tsc -p . --noEmit`, `npx tsc -p web --noEmit`.
- [ ] **Step 7: Look at it.** Start the app, open Meals, and check the search box lays out as one row, the Filters button opens the sheet, a chip removes its filter, and a picked recipe survives a filter that hides it.
- [ ] **Step 8: Commit** `feat: the meal recipe picker browses like the library`
