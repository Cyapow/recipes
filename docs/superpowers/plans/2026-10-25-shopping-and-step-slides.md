# Shopping list, step slides and step photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "what do we already have?" ingredient checklist that builds a shared, shareable shopping list; turn cook mode into a per-step slideshow with step photos and per-step ingredient strips; and apply the approved redesign.

**Architecture:** Steps change from `string[]` to `Step[]` (`{text, imageId, ingredients: number[]}`), normalised on read so old rows, old backups and JSON-LD imports keep working. A new `shopping_items` table and `/api/shopping/*` routes hold one shared list with conservative merge rules. The web app gains a recipe overview page (checklist), a shopping page and a rewritten cook slideshow route; the editor gets a structured step editor.

**Tech Stack:** unchanged (Node 22, TypeScript, Fastify, better-sqlite3, zod v4, React 19, Vite, vitest) plus `@fontsource/fraunces` and `@fontsource/dm-sans` (self-hosted fonts, no external requests).

**Spec:** `docs/superpowers/specs/2026-10-25-shopping-and-step-slides-design.md` (extends `2026-10-25-recipes-design.md`). Mockups: https://claude.ai/artifact/85wHvnKxqrFaXaR7iZaHTT (row 1 = redesign of existing screens, row 2 = the new screens). The mockup HTML is a visual reference only; copy colours, type scale, spacing and layout, not markup.

## Global Constraints

- Design tokens (from the mockups): bg `#FBF7F1`, ink `#2A211B`, muted `#6B5E54`, card `#FFFFFF`, line `#E6DACB`, chip `#F1E7DA`, border-strong `#DCCDBB`, accent `#B4492A`, accent-fg `#FFFFFF`, herb green `#2F5A2A` (tint `#E3EFDD`), amber banner `#FCEFD9`/`#EBCB93`/`#4A3512`. Fonts: Fraunces 500/600 for headings and step text, DM Sans 400/500/700 for body. Dark mode must keep working (`prefers-color-scheme`) with equivalent tokens.
- Tap targets at least 44px; step text at least 26px on phone and 40px on tablet; Back/Next buttons at least 60px tall. No emoji, inline SVG icons only.
- Existing behaviour that must not regress: Keep screen on (wake lock released on leaving cook mode), same-origin CSRF guard on every new state-changing route, atomic image uploads, backup skip-unchanged rules, restore safety.
- Step photos use the existing image store (ids matching `^[a-f0-9]{64}\.jpg$`); the app never deletes image files.
- Steps given as plain strings (old rows, old API clients, JSON-LD) must still be accepted and are normalised to `{text, imageId: null, ingredients: []}`.
- Shopping merge rules (spec): sum quantities only when item (normalised) AND unit (normalised) are equal AND both quantities are numbers; never convert units; vague or missing quantities stay separate lines.
- AI rules (spec): step links only for ingredients the step text actually names; the AI can never set `imageId`; `strict: true` tool schema must stay closed (`additionalProperties:false`, all keys required).
- Share: `navigator.share({text})`, falling back to clipboard, falling back to a selectable text box. A user cancelling the share sheet is not an error.
- Deployment: `git pull && docker compose up -d --build` in `/opt/recipes` on the box; migrations forward-only, run on start.

## Review Focus

1. A legacy recipe (steps stored as strings) loads, edits, saves, appears in the backup JSON and restores from an old snapshot. (Task 2)
2. Merge edge cases: `2 tins chopped tomatoes` + `1 tin chopped tomatoes` merge; `500g` + `1 tin` of the same item do not; `splash of red wine` stays separate; conservative plural folding does not mangle `hummus`, `couscous`, `asparagus`, `molasses`. (Task 4)
3. Editing ingredients (reorder, delete, insert, edit text) never leaves a step linked to the wrong ingredient; unmatched links are dropped. (Task 5)
4. AI step links with out-of-range, negative, duplicate or non-integer indexes are dropped/deduped and the draft still validates; the AI schema has no `imageId`. (Task 3)
5. Checklist: ticked ingredients never reach the list, unticked always do; "Nothing to add" does nothing; double-tap on Add does not add twice; re-adding a recipe already on the list asks first; cancelling the share sheet shows no error. (Tasks 6, 7)

---

## File Structure

```
server/src/recipes/{schema,repo,links}.ts        Step model, normalisation, ingredient-link matcher
server/src/migrations/002_shopping.sql
server/src/shopping/{normalise,repo,routes}.ts
server/src/ai/{draft,client}.ts                  AI step schema + prompt
server/src/import/{jsonld,importUrl}.ts          steps as Step with deterministic links
server/scripts/restore.ts                        count missing step photos
web/src/styles.css, web/index.html, web/src/fonts.ts   redesign tokens + self-hosted fonts
web/src/api.ts, web/src/lib/{text,share,stepLinks}.ts
web/src/hooks/useSwipe.ts
web/src/components/{RecipeForm,StepEditor,StepList}.tsx
web/src/pages/{Library,RecipeOverview,Shopping,Cook,Settings,Describe,Import,Editor}.tsx
web/src/main.tsx                                 routes
docs/{deploy,setup-google}.md                    notes
```

Tests sit beside the code.

---

### Task 1: Redesign foundation (tokens, fonts, existing screens)

**Files:** Modify `web/src/styles.css`, `web/index.html`, `web/src/main.tsx` (font imports), `web/src/pages/{Library,Settings,Describe,Import,Editor}.tsx`, `web/src/components/{RecipeForm,BackupBanner}.tsx` (class names/markup only); Create `web/src/lib/monogram.ts`; Test `web/src/lib/monogram.test.ts`, existing page tests.

**Interfaces:** Produces `monogram(title: string): string` (up to two uppercase initials, e.g. `Our spag bol`→`OS`, `Thai green curry`→`TG`, one word→first two letters, empty→`?`) and `monogramColors(title: string): {bg: string; fg: string}` (stable palette pick from the title; same title→same colours; at least 5 palette entries taken from the mockup tiles).

- [ ] **Step 1: Write failing tests** `monogram.test.ts`: the examples above; `monogramColors('Our spag bol')` equals itself on repeat calls and differs for at least two of five distinct titles.
- [ ] **Step 2:** Run `npx vitest run web/src/lib/monogram.test.ts`; expect FAIL.
- [ ] **Step 3:** Implement `monogram` and `monogramColors`. Install `@fontsource/fraunces` and `@fontsource/dm-sans`; import the needed weights (Fraunces 500/600, DM Sans 400/500/700, latin subset) in `main.tsx`; no `<link>` to Google Fonts.
- [ ] **Step 4:** Rewrite `styles.css` to the Global Constraints tokens (light + dark) and restyle, per the row-1 mockups: Library (header with New and Settings round buttons, search with icon, primary "Describe it" + outline "From a link" buttons, segmented All/Mine/From elsewhere control, tag chips row, recipe cards with monogram tile or thumbnail, amber backup banner), forms and editor fields, Describe/Import pages, Settings. Keep every existing accessible name and test id so current tests keep passing; update tests only where visible text changed (list each change in the report).
- [ ] **Step 5:** Run `npm test` and `npm run build`; expect PASS. Check `dist/web` has no request to `fonts.googleapis.com`.
- [ ] **Step 6:** Commit `feat: apply redesign foundation (tokens, fonts, library, forms)`.

### Task 2: Step model on the server

**Files:** Modify `server/src/recipes/schema.ts`, `server/src/recipes/repo.ts`, `server/src/recipes/routes.ts` (error shape only if needed); Test `server/src/recipes/schema.test.ts`, `repo.test.ts`, `routes.test.ts`, `server/src/backup/fingerprint.test.ts`.

**Interfaces:**
- Produces from `schema.ts`: `StepSchema = z.object({ text: z.string(), imageId: z.string().regex(/^[a-f0-9]{64}\.jpg$/).nullable(), ingredients: z.array(z.number().int().min(0)) })`, `type Step`; `RecipeCoreSchema` (the current input shape with `steps: z.array(StepSchema)`); `RecipeInputSchema` = core with `steps` accepting `string | Step` (strings normalised) and a refinement that every link index is `< ingredients.length` (violation→400 via existing zod issues path); `normaliseSteps(raw: unknown, ingredientCount: number): Step[]` (strings→Step; links deduped, sorted, out-of-range and non-integers dropped); `RecipeSchema` and `Recipe.steps: Step[]`; `type RecipeInput = z.infer<typeof RecipeInputSchema>` (output type: `Step[]`).
- Consumes: nothing new. Produces for Tasks 3–9: `Recipe.steps: Step[]` everywhere.

- [ ] **Step 1: Write failing tests:** (a) POST with string steps stores and returns `Step[]` with `imageId:null, ingredients:[]`; (b) POST with Step objects round-trips including `imageId` and links; (c) link index equal to `ingredients.length` → 400; negative or `1.5` → 400; (d) bad `imageId` (`../x.jpg`) → 400; (e) a row inserted directly with `steps_json='["Brown the mince"]'` (legacy) is returned by `repo.get`/`GET /api/recipes/:id` as one normalised Step, and saving it back writes the Step shape; (f) `computeFingerprint` is identical for a legacy row and the same recipe saved in Step shape (so an upgrade alone causes at most one extra backup, never a loop); (g) `RecipeDraftSchema` still exists for the AI (steps as Step[] but see Task 3).
- [ ] **Step 2:** Run `npx vitest run server/src/recipes server/src/backup/fingerprint.test.ts`; expect FAIL.
- [ ] **Step 3:** Implement the schema and `repo` normalisation (normalise in `toRecipe`, never throw on malformed stored JSON: unreadable step entries become empty-text steps and are dropped). Update every other server compile error caused by the type change with minimal edits (import, AI and JSON-LD code keep working via string→Step normalisation until Tasks 3).
- [ ] **Step 4:** Run `npm test` and `npm run build`; expect PASS.
- [ ] **Step 5:** Commit `feat: recipe steps become objects with photo and ingredient links`.

### Task 3: Ingredient-link matcher, import steps, AI step schema

**Files:** Create `server/src/recipes/links.ts`; Modify `server/src/import/jsonld.ts`, `server/src/import/importUrl.ts`, `server/src/ai/draft.ts`, `server/src/ai/client.ts`; Test `server/src/recipes/links.test.ts`, `server/src/import/jsonld.test.ts`, `server/src/ai/draft.test.ts`, `server/src/ai/routes.test.ts`.

**Interfaces:**
- Produces `linkIngredients(stepText: string, ingredients: Ingredient[]): number[]` (whole-word, case-insensitive match of an ingredient's significant words after conservative plural folding; stop-words such as `chopped, diced, fresh, finely, large, small, of, and` ignored; an ingredient matches when ALL its significant words appear in the step; result sorted, deduped).
- Produces `AiStepSchema = z.object({ text: z.string(), ingredients: z.array(z.number().int()) })` and `AiDraftSchema` (like `RecipeDraftSchema` but `steps: z.array(AiStepSchema)`); `toRecipeDraft(ai: AiDraft): RecipeDraft` which maps to `Step` with `imageId: null` and sanitises links (drop out-of-range, negative, duplicate; sort).
- `AiClient.extractRecipe` still returns `RecipeDraft`.

- [ ] **Step 1: Write failing tests:** `linkIngredients`: `'Brown the mince hard'` links `500g beef mince`; `'Add the tomatoes and simmer'` links `2 tins chopped tomatoes`; `'Add the onions'` links `1 onion` (plural folding) but not `1 carrot`; `'Season the sauce'` links nothing; an ingredient `olive oil` needs both words (`'add oil'` does not link it). JSON-LD: steps come back as Steps whose `ingredients` come from `linkIngredients`; flattened `HowToSection` order preserved. AI: the strict-safe schema test now covers the nested step object (closed, all keys required, no `imageId` key anywhere); `toRecipeDraft` drops indexes `-1, 99, 1.5` and dedupes `[2,2,0]` to `[0,2]`; the system prompt contains a sentence saying step ingredients must be only ones the step text names, by index into the same ingredient list, empty if none, and never inferred from what is typical for the dish.
- [ ] **Step 2:** Run the three test files; expect FAIL.
- [ ] **Step 3:** Implement. In `client.ts` validate with `AiDraftSchema`, convert with `toRecipeDraft`. Extend `draft.live.test.ts` (opt-in, not run here) to assert every returned step link points at an ingredient whose words appear in that step's text.
- [ ] **Step 4:** Run `npm test` and `npm run build`; expect PASS.
- [ ] **Step 5:** Commit `feat: link ingredients to steps (deterministic for imports, named-only for AI)`.

### Task 4: Shopping list on the server

**Files:** Create `server/src/migrations/002_shopping.sql`, `server/src/shopping/{normalise,repo,routes}.ts`; Modify `server/src/app.ts` (register); Test `server/src/shopping/{normalise,repo,routes}.test.ts`.

**Interfaces:**
- Migration table `shopping_items(id TEXT PRIMARY KEY, merge_key TEXT NOT NULL, item TEXT NOT NULL, quantity REAL, unit TEXT, note TEXT, sources_json TEXT NOT NULL, added_at TEXT NOT NULL)`.
- `normaliseItemName(s: string): string` (lowercase, trim, collapse spaces, fold a trailing plural conservatively: `onions→onion`, `tomatoes→tomato`, `berries→berry`; never `hummus, couscous, asparagus, molasses, lentils?` — unknown cases are left unfolded; keep a short protected-words list), `normaliseUnit(u: string | null): string | null` (`g|gram|grams→g`, `kg`, `ml`, `l|litre|litres→l`, `tin|tins→tin`, `tbsp|tablespoon(s)→tbsp`, `tsp|teaspoon(s)→tsp`, `clove(s)→clove`, otherwise trimmed lowercase), `formatShoppingText(quantity: number | null, unit: string | null, item: string): string` (`500g beef mince`, `2 tins chopped tomatoes`, `splash of red wine` style: when quantity is null return the original item text), quantities rendered with at most 2 decimals.
- `ShoppingItem = { id: string; text: string; item: string; quantity: number | null; unit: string | null; sources: { recipeId: string; title: string }[] }`.
- `createShoppingRepo(db)`: `list(): ShoppingItem[]` (oldest first), `add(recipe: { id: string; title: string }, ingredients: Ingredient[], opts?: { force?: boolean }): { added: number } | { alreadyOnList: true }`, `remove(id: string): boolean`, `clear(): number`.
- Routes (`registerShoppingRoutes(app, { shopping, recipes })`): `GET /api/shopping` → `{ items }`; `POST /api/shopping/add` body `{ recipeId, indexes: number[], force?: boolean }` (indexes are into the recipe's ingredients; unknown recipe→404; empty or out-of-range→400; `alreadyOnList` and not `force`→409 `{ error: 'already_on_list', recipeTitle }`); `DELETE /api/shopping/:id`→204/404; `DELETE /api/shopping`→`{ removed }`.

- [ ] **Step 1: Write failing tests** (repo with `openDb(':memory:')`): merging `2 tins chopped tomatoes` + `1 tin chopped tomatoes` → one item quantity 3, sources of both recipes; `500g beef mince` + `1 tin beef mince` → two lines; `splash of red wine` twice → two lines (vague never merges); `3 onions` + `1 onion` → `4 onion`-style text `4 onions` (display keeps the first original wording); protected words stay intact; `add` for a recipe whose items remain returns `alreadyOnList` unless `force`; after `remove` of all that recipe's items it can be added again; `clear` empties; routes: 404/400/409 cases; the CSRF guard already blocks cross-site `POST /api/shopping/add` (one test); items survive reopening the db.
- [ ] **Step 2:** Run `npx vitest run server/src/shopping`; expect FAIL.
- [ ] **Step 3:** Implement. Merging happens inside a single transaction. Do not touch backup fingerprint code (spec: shopping is not part of it); add a test in `fingerprint.test.ts` proving shopping changes leave the fingerprint unchanged.
- [ ] **Step 4:** Run `npm test` and `npm run build`; expect PASS.
- [ ] **Step 5:** Commit `feat: shared shopping list with conservative merging`.

### Task 5: Web data layer and structured step editor

**Files:** Create `web/src/lib/stepLinks.ts`, `web/src/components/StepEditor.tsx`; Modify `web/src/api.ts`, `web/src/lib/text.ts`, `web/src/components/RecipeForm.tsx`, `web/src/pages/{Editor,Describe,Import}.tsx` (pass-through only); Test `web/src/lib/stepLinks.test.ts`, `web/src/components/StepEditor.test.tsx`, `RecipeForm.test.tsx`.

**Interfaces:**
- `api.ts`: re-export `Step`; add `listShopping(): Promise<ShoppingItem[]>`, `addToShopping(recipeId: string, indexes: number[], force?: boolean): Promise<{ added: number }>` (throws `ApiError` with `status` 409 and `body.recipeTitle` for already-on-list), `removeShoppingItem(id)`, `clearShopping()`; `uploadImage(file)` already exists.
- `stepLinks.ts`: `remapStepLinks(oldIngredients: Ingredient[], newIngredients: Ingredient[], steps: Step[]): Step[]` — a link is carried to the new index of the first not-yet-used ingredient with identical normalised text (`formatIngredientLine`), otherwise dropped. Pure and deterministic.
- `StepEditor` props `{ steps: Step[]; ingredients: Ingredient[]; onChange(steps: Step[]): void; onBusyChange(busy: boolean): void }`: per step a textarea, add/replace/remove photo (file input `accept="image/*"`, uses `uploadImage`, shows thumbnail and an inline error on failure), ingredient chips (`aria-pressed`), delete step, "+ Add a step", move up/down. Reports `busy` while a photo uploads.

- [ ] **Step 1: Write failing tests:** `remapStepLinks`: reorder keeps links on the right ingredient; deleting an ingredient drops only its links; inserting shifts indexes; editing an ingredient's text drops that link; duplicate identical lines keep distinct links in order. `StepEditor`: toggling a chip updates `ingredients`; photo upload sets `imageId` and shows a thumbnail; failed upload shows an error and leaves `imageId` unchanged; remove clears the id; busy is reported true during upload and false after; Save in `RecipeForm` is blocked with a visible message while busy (existing rule); `RecipeForm` calls `remapStepLinks` when the ingredients text changes; saved payload steps are `Step[]` with links valid for the saved ingredient list (indexes < length); legacy `initial.steps` of one string-derived Step renders.
- [ ] **Step 2:** Run `npx vitest run web/src`; expect FAIL on the new tests.
- [ ] **Step 3:** Implement per the mockup `Editor: photo and ingredients for a step` (large step card, thumbnail with Replace/Remove, chips). Replace the plain "steps" textarea in `RecipeForm`. Keep ingredients as the existing one-per-line textarea.
- [ ] **Step 4:** Run `npm test` and `npm run build`; expect PASS.
- [ ] **Step 5:** Commit `feat: structured step editor with photos and ingredient links`.

### Task 6: Recipe overview page with the "what do we have?" checklist

**Files:** Create `web/src/pages/RecipeOverview.tsx`; Modify `web/src/main.tsx` (routes: `/recipe/:id`→`RecipeOverview`, `/recipe/:id/cook`→`Cook`, `/shopping`→`Shopping`), `web/src/pages/Library.tsx` (row link unchanged; add shopping-cart button next to Settings), `web/src/styles.css`; Test `web/src/pages/RecipeOverview.test.tsx`.

**Interfaces:** Consumes `getRecipe`, `addToShopping`, `ApiError`. Page shows title, meta, hero image if any, "What do we already have?" list (one checkbox per ingredient, label "We have this: <line>", "Have it"/"Need" tag, ticked rows muted green), "Tick all"/"Untick all", ticks held in component state only (reset per visit), primary button "Add N to shopping list" (N = unticked count) / "Nothing to add" when N is 0 (clicking does nothing), secondary "Start cooking" link to `/recipe/:id/cook`, links to Edit and to `/shopping`.

- [ ] **Step 1: Write failing tests:** unticked indexes (and only those) are sent to `addToShopping`; with all ticked the button reads "Nothing to add" and no request is sent; two rapid clicks send one request; on success a status line "Added N items" with a link to the list; a 409 shows "<title> is already on the list" with "Add again" (sends `force: true`) and "Cancel"; failed request shows an error and the button works again; Tick all/Untick all; 404 recipe shows a message with a link back; the Library row links to `/recipe/:id`.
- [ ] **Step 2:** Run `npx vitest run web/src/pages/RecipeOverview.test.tsx`; expect FAIL.
- [ ] **Step 3:** Implement per the `What do we already have?` mockup.
- [ ] **Step 4:** Run `npm test` and `npm run build`; expect PASS.
- [ ] **Step 5:** Commit `feat: recipe overview with what-we-have checklist`.

### Task 7: Shopping list page and sharing

**Files:** Create `web/src/pages/Shopping.tsx`, `web/src/lib/share.ts`; Test `web/src/pages/Shopping.test.tsx`, `web/src/lib/share.test.ts`.

**Interfaces:**
- `shoppingShareText(items: ShoppingItem[]): string` (one `text` per line, no bullets).
- `shareText(text: string, nav?: Pick<Navigator, 'share' | 'clipboard'>): Promise<'shared' | 'copied' | 'cancelled' | 'manual'>`: `share` resolves→`shared`; rejects with `AbortError`→`cancelled` (no fallback, no error); other rejection or unsupported→try `clipboard.writeText`→`copied`; clipboard unavailable or rejects→`manual`.
- Page: heading, item count and number of recipes, rows (`text`, sources in small text, remove button `aria-label="Remove <text>"`), "Clear list" (confirm), "Share list", status line, `manual` outcome shows a selectable read-only textarea with the text, empty state with a link to the library, refresh of the list when the window regains focus.

- [ ] **Step 1: Write failing tests:** `shareText` four outcomes (including AbortError→`cancelled` without calling clipboard); `shoppingShareText`; page renders items and sources; remove calls `removeShoppingItem`; clear asks to confirm then calls `clearShopping`; share outcomes show the right status text (`shared` none/short, `copied` "Copied to the clipboard", `cancelled` nothing, `manual` textarea); empty list disables nothing but says "Nothing to share" on Share; refetch on focus.
- [ ] **Step 2:** Run the two test files; expect FAIL.
- [ ] **Step 3:** Implement per the `Shopping list: share it` mockup.
- [ ] **Step 4:** Run `npm test` and `npm run build`; expect PASS.
- [ ] **Step 5:** Commit `feat: shopping list page with share`.

### Task 8: Cook mode slideshow

**Files:** Create `web/src/hooks/useSwipe.ts`; Rewrite `web/src/pages/Cook.tsx`; Modify `web/src/styles.css`; Test `web/src/hooks/useSwipe.test.tsx`, `web/src/pages/Cook.test.tsx`.

**Interfaces:** `useSwipe(handlers: { onLeft(): void; onRight(): void }, opts?: { minDistance?: number }): { onTouchStart; onTouchEnd }` — fires only for mostly-horizontal gestures (|dx| ≥ 60 and |dx| > 1.5·|dy|) so vertical scrolling is unaffected. `Cook` at `/recipe/:id/cook`: one slide per step; header (close→`/recipe/:id`, "Step n of N", ingredients-sheet button), progress segments, step photo (`/api/images/<imageId>`, alt text "Photo for step n") or none, large step text (`aria-live="polite"`), "Uses" strip of only the linked ingredients (hidden when none), Back/Next ("Done"→`/recipe/:id`), swipe, ArrowLeft/ArrowRight keys, Keep screen on (existing `useWakeLock`, released on leaving), an Ingredients sheet listing all ingredients (dialog with a close button, focus handled), recipes with no steps show description/notes. Tablet layout (`min-width: 900px` and landscape): photo left, step + Uses + buttons right.

- [ ] **Step 1: Write failing tests:** slide shows only that step's linked ingredients (step 2 shows mince and oil, not onion); no-links step shows no Uses strip; photo rendered with the right `src` and alt; step without photo renders no image; Next/Back/Done navigation; ArrowRight/ArrowLeft; `useSwipe` fires onLeft for `dx=-80,dy=10`, ignores `dx=-80,dy=70` and `dx=-30`; Ingredients sheet opens/closes and lists all ingredients; Keep screen on toggle and unsupported note still work; wake lock released on unmount (reuse the existing hook tests' fake); out-of-range or missing linked index in stored data is ignored without crashing.
- [ ] **Step 2:** Run `npx vitest run web/src/hooks web/src/pages/Cook.test.tsx`; expect FAIL.
- [ ] **Step 3:** Implement per the `Cook mode: step slide` mockups (phone and tablet). Remove the old Cook markup and tests that no longer apply (list them in the report).
- [ ] **Step 4:** Run `npm test` and `npm run build`; expect PASS.
- [ ] **Step 5:** Commit `feat: cook mode slideshow with step photos and ingredient strips`.

### Task 9: Restore counts, docs, live-test hand-off, deploy checklist

**Files:** Modify `server/scripts/restore.ts` (+test), `docs/deploy.md`, `docs/setup-google.md` (only if wording changes), `README` if present; Test `server/scripts/restore.test.ts`.

**Interfaces:** `restoreFromDirectory` result gains `missingStepImages: number` (distinct step `imageId`s referenced by restored recipes and absent from the backup's images), reported next to the existing missing-image count in the CLI output.

- [ ] **Step 1: Write failing test:** a backup whose recipes reference one step image present and one missing reports `missingStepImages: 1`; an old snapshot with string steps restores and `openDb` + `repo.get` return normalised Steps.
- [ ] **Step 2:** Run `npx vitest run server/scripts`; expect FAIL.
- [ ] **Step 3:** Implement; document in `docs/deploy.md`: new routes, that shopping list items live in the SQLite file, that the first backup after this release uploads once because the fingerprint shape changed, and the post-deploy checks (see Verification).
- [ ] **Step 4:** Run `npm test` and `npm run build`; expect PASS.
- [ ] **Step 5:** Commit `feat: restore reports missing step photos; docs for shopping and step slides`.

## Verification

- `npm test` and `npm run build` green after every task.
- Manual on the box after deploy (user): create a recipe with Describe and confirm step links are shown for confirmation and nothing invented; add a photo to a step from a phone camera; open the overview, tick two ingredients, add the rest, open `/shopping`, share to another device via the share sheet; cook the recipe on phone and tablet and check the slide shows only that step's ingredients and the screen stays on; open an old recipe created before this release and edit it; press Back up now and confirm step photos appear in the Drive images folder; run the restore drill. The live AI test (`LIVE_AI=1`) must be run once with a key.
