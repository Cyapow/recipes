# Shared recipe browser — design

**Date:** 2026-11-26
**Size:** small change (one extraction, no server work)

## Why

Picking recipes for a meal is browsing your library with a tick box on each row, but it
does not look or work like the library. Today the picker offers a search box and nothing
else: no filters, and rows that carry a title and nothing to recognise a recipe by. The
library has had Filters, removable chips and rows with a photo and a subtitle for weeks.
The two drifted because each page built its own browsing UI.

A styling bug made the drift obvious. `.page > form > label` in `styles.css:124` lays
labels out in a column, and the picker's search box is a `<label class="search-field">`
inside the Meals form, so the rule beats `.search-field`'s own row layout and stacks the
magnifier above the input. The library's search box is not inside a form, so it escapes.

## Goals

- One definition of "browse the recipe library", rendered by both the library and the picker.
- The picker gains Filters, chips and the library's row, without the library changing.
- The search box lays out the same wherever it is put, inside a form or not.

## Non-goals

- No new filter kinds. Brands, tags and favourited-by are what the server already indexes.
- No change to `listRecipes`, `getFacets` or any route. Everything needed is already there.
- No change to the library's own page furniture: title bar, More sheet, backup banner,
  "Describe it / From a link / From photos" row, drafts.

## Anti-goals

- The library must not regress. It is the app's front door and the most-used page; an
  extraction that makes it even slightly worse has failed, however tidy the result reads.
- Ticking a recipe must never reorder or reload the list under the finger. Neither must
  starring one — the library's optimistic favourite is a behaviour to preserve, not an
  implementation detail to drop on the way through.

## Approaches

1. **Filters and richer rows in the picker.** Add the sheet and chips to `RecipeCourses`
   and copy the library's row markup across. Smallest diff, and it writes the drift into
   the codebase a second time.
2. **Extract a shared browser.** One component owns searching, filtering and listing; each
   caller says what a row looks like. Larger diff, touches a working page. **Chosen.**
3. **Fix the styling only.** Scope the CSS and leave the picker as it is. Rejected: it
   answers the symptom and not the ask.

## The shape

New `web/src/components/RecipeBrowser.tsx` owns everything both pages do identically:

- the `search-field` box,
- the filter bar: the `Filters · N` button and one removable chip per active filter,
- `FilterSheet`, and the facets fetch that feeds it,
- the `listRecipes` call for search plus filters, and the error and empty states,
- the `<ul className="rows">` the results sit in.

Props:

| Prop | Why it exists |
|---|---|
| `renderRow(recipe, patch)` | The one thing the two callers genuinely differ on. |
| `storageKey?: string` | The library passes `recipes.libraryFilters`, keeping today's key and today's behaviour. The picker passes nothing, so its filters start clean each visit. |
| `beforeList?: ReactNode` | The picker's "Already picked" block, which must sit above the results. |
| `onResults?(rows)` | The picker remembers every recipe it has shown, so a search cannot leave a ticked one unnamed. |
| `emptyText?: string` | "No recipes yet." by default; the browser says "No recipes match that." on its own whenever a search or a filter is active. |

`patch` is the second argument to `renderRow` because the library stars a recipe in place:
it updates that row's `favouritedBy` and reverts on failure, without a reload or a re-sort.
Owning the rows inside the browser would take that away, so the browser hands each row a
way to change itself.

## What each caller keeps

- **Library**: its header, More sheet, backup banner, CTA row, drafts, the star handler and
  its row markup (thumbnail or monogram, title, `origin · tag · time`, chevron, star).
- **Picker** (`RecipeCourses`, shared by Plan a meal and Change a meal's recipes): the
  picked-recipes state, the `Already picked` pinned block, the limit on how many a meal
  holds, and a row of checkbox + the library's own thumbnail and subtitle + course select.

## Calls I made

- **The picker's rows get the thumbnail and subtitle.** Filters beside a title-only list
  would look half-finished, and recognising a recipe by its photo is the reason the library
  has them. Say so if you would rather keep the picker plain.
- **The picker's filters do not persist.** The library's do, because you return to it all
  day; a meal is planned in one sitting.
- **The CSS fix is a scope, not a rewrite:** `.page > form > label` becomes
  `.page > form > label:not(.search-field)`, so the search box keeps its row layout wherever
  it is placed and no other form label changes.
- **Everything the browser renders is `type="button"`.** It now lives inside the Meals
  `<form>`, where an untyped button submits it. `FilterSheet`'s buttons are already typed;
  a test pins that opening Filters does not create a meal.

## Verification

Unit tests, at the level this repo already uses: the library's existing suites must pass
untouched, the picker gains tests for filtering, for the form-submit trap, and for a ticked
recipe surviving a filter that hides it.
