# Per-Person Favourites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each signed-in person can star recipes, and the Library can be narrowed to one person's stars or several, with people shown by their Google name.

**Architecture:** A `favourites` table keyed by email and recipe id. Writes and per-person counts live in a new `server/src/favourites/repo.ts`; the query side (filtering the list, attaching `favouritedBy`) lives in the existing recipes repo, because it owns the list SQL. Names come from the `name` claim on the Google ID token and are written to a new column on `allowed_emails` at every sign-in.

**Tech Stack:** Fastify 5, better-sqlite3, React 19 + react-router 7, vitest, `google-auth-library` (already present).

**Spec:** `docs/superpowers/specs/2026-11-25-favourites-design.md`

## Global Constraints

- Favourites key on email, matching the allowlist. Emails are stored and compared lowercased and trimmed (`normaliseEmail`).
- A star must never modify the recipe row: no `updatedAt` bump, no write to `recipes`.
- You may only star for yourself. Both write routes act on `req.email` and take no email from the caller.
- Both write routes are idempotent: starring twice is still one star, unstarring something unstarred is a success.
- `display_name` is nullable. Everywhere a name is shown falls back to the part of the address before the `@`, capitalised. Google documents the `name` claim as never guaranteed.
- Favourites join the backup fingerprint as sorted `email + recipe_id` pairs. `display_name` stays out of it.
- Removing an address from the allowlist deletes that person's favourites, as it already deletes their sessions.
- Next migration number is `009`.
- Node >= 22, ESM with `.js` extensions on local imports, 2-space indent, single quotes, named exports.

## Review Focus

Five things the spec implies that no obvious task test covers, most likely first:

1. **Starring a recipe that no longer exists** (deleted in another tab) must be a clean 404, not a foreign-key 500. Test in Task 4.
2. **Double-tapping the heart** must not raise a primary-key violation. Test in Task 4.
3. **A person on the allowlist who has never signed in** has no name and no stars: their chip still renders from the email fallback with a count of 0. Test in Tasks 2 and 3.
4. **Filters already in `localStorage`** predate the `people` key; loading them must not crash the Library. Test in Task 7.
5. **Deleting a recipe** must take its stars with it, so it cannot haunt a person's filtered list or their count. Test in Task 1.

---

### Task 1: Schema and the favourites store

**Files:**
- Create: `server/src/migrations/009_favourites.sql`
- Create: `server/src/favourites/repo.ts`
- Test: `server/src/favourites/repo.test.ts`
- Modify: `server/scripts/restore.test.ts` (the fixture that fabricates an old snapshot drops post-001 tables; add the new one)

**Interfaces:**
- Consumes: `openDb` from `server/src/db.ts`; `normaliseEmail` from `server/src/auth/repo.ts`.
- Produces:
```ts
export type FavouritesRepo = {
  add(email: string, recipeId: string, now: Date): void;      // idempotent
  remove(email: string, recipeId: string): void;              // idempotent
  countsByEmail(): Map<string, number>;                       // email -> how many starred
  forRecipes(ids: string[]): Map<string, string[]>;           // recipe id -> sorted emails
  removeAllFor(email: string): void;
  allPairs(): { email: string; recipeId: string }[];          // sorted, for the fingerprint
};
export function createFavouritesRepo(db: Database): FavouritesRepo;
```

- [ ] **Step 1: Write the failing tests** in `server/src/favourites/repo.test.ts`

```ts
it('add is idempotent and remove is forgiving', () => {
  repo.add('a@x.com', r1, now); repo.add('a@x.com', r1, now);
  expect(repo.forRecipes([r1]).get(r1)).toEqual(['a@x.com']);
  repo.remove('a@x.com', r1); repo.remove('a@x.com', r1);
  expect(repo.forRecipes([r1]).get(r1)).toBeUndefined();
});
it('normalises the email on the way in', () => { /* add ' A@X.com ' -> stored a@x.com */ });
it('forRecipes returns sorted emails per recipe and omits unstarred ones', () => {});
it('countsByEmail counts per person', () => { /* two people, three stars */ });
it('removeAllFor drops one person and leaves the other', () => {});
it('allPairs is sorted by email then recipe id', () => {});
it('deleting a recipe deletes its favourites', () => {
  db.prepare('DELETE FROM recipes WHERE id = ?').run(r1);
  expect(repo.countsByEmail().get('a@x.com') ?? 0).toBe(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/src/favourites/repo.test.ts`
Expected: FAIL — cannot resolve `./repo.js`

- [ ] **Step 3: Write `server/src/migrations/009_favourites.sql`**

`favourites(email TEXT NOT NULL, recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE, added_at TEXT NOT NULL, PRIMARY KEY (email, recipe_id))`, plus `CREATE INDEX favourites_recipe ON favourites (recipe_id)`. Same statement style as `001_init.sql`. In the same file, `ALTER TABLE allowed_emails ADD COLUMN display_name TEXT` — Task 2 uses it, but the schema change belongs in one migration.

- [ ] **Step 4: Implement `createFavouritesRepo` in `server/src/favourites/repo.ts`**

Prepared statements in the closure, as `server/src/shopping/repo.ts` does. `add` uses `INSERT ... ON CONFLICT DO NOTHING`. `forRecipes` must handle an empty list without building `IN ()`.

- [ ] **Step 5: Extend the restore fixture**

`server/scripts/restore.test.ts` fabricates a version-1 snapshot by dropping later tables; add `favourites` to that list in the file's existing style.

- [ ] **Step 6: Run the suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/src/migrations/009_favourites.sql server/src/favourites server/scripts/restore.test.ts
git commit -m "feat: a favourites table, one star per person per recipe"
```

---

### Task 2: Names from the sign-in token

**Files:**
- Modify: `server/src/auth/verify.ts`, `server/src/auth/repo.ts`, `server/src/auth/routes.ts`
- Test: `server/src/auth/verify.test.ts`, `server/src/auth/routes.test.ts`, `server/src/auth/allowlist.test.ts`

**Interfaces:**
- Consumes: the `display_name` column from Task 1.
- Produces:
```ts
// verify.ts — name is added to the existing shape
export type VerifiedIdentity = { email: string; emailVerified: boolean; name: string | null };
// repo.ts
export function displayNameFor(email: string, storedName: string | null): string; // fallback: local part, capitalised
// AuthRepo gains:
setDisplayName(email: string, name: string | null): void;  // no-op when name is null
// AllowedEmail gains: name: string | null
```
`GET /api/auth/allowed` entries gain `name: string | null`; `GET /api/auth/me` returns `{ email, name }` where `name` is already the resolved display name.

- [ ] **Step 1: Write the failing tests**

```ts
// verify.test.ts — extend the existing stub of OAuth2Client.prototype.verifyIdToken
it('returns the name claim when Google sends one', async () => { /* payload with name: 'Elisa Beckett' */ });
it('returns null for the name when the claim is absent', async () => {});
// routes.test.ts
it('stores the name on sign-in and returns it from /api/auth/me', async () => {});
it('refreshes a changed name on the next sign-in', async () => {});
it('leaves a stored name alone when the token has no name', async () => {});
// allowlist.test.ts
it('lists a person who has never signed in with a null name', async () => {});
it('falls back to the capitalised local part', () =>
  expect(displayNameFor('wife@example.com', null)).toBe('Wife'));
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/src/auth`
Expected: FAIL — `name` missing from the verifier's result

- [ ] **Step 3: Implement**

`verify.ts`: read `payload.name` and return `name: payload.name ?? null`. `repo.ts`: `setDisplayName` writes only when `name` is non-null, so a token without the claim never blanks a stored name; `listAllowed` selects `display_name AS name`. `routes.ts`: the sign-in handler calls `setDisplayName` after a successful verify, and `/api/auth/me` resolves through `displayNameFor`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/src/auth`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/auth
git commit -m "feat: remember each person's Google name for display"
```

---

### Task 3: Filtering and reading favourites in the recipe list

**Files:**
- Modify: `server/src/recipes/repo.ts`, `server/src/recipes/schema.ts`, `server/src/recipes/routes.ts`
- Test: `server/src/recipes/repo.test.ts`, `server/src/recipes/routes.test.ts`

**Interfaces:**
- Consumes: `FavouritesRepo` (Task 1), `displayNameFor` and `AuthRepo.listAllowed` (Task 2).
- Produces:
```ts
// schema.ts
// RecipeSummary and Recipe both gain: favouritedBy: string[]   (sorted addresses)
// repo.ts
export type ListQuery = { /* …existing… */ favouritedBy?: string[] };
export type Facets = { /* …existing… */ people: { email: string; name: string; count: number }[] };
createRecipeRepo(db: Database, favourites: FavouritesRepo)   // second argument is new
```
`GET /api/recipes` accepts a repeated `favourite=<email>` parameter (matching `brand` and `tag`) meaning starred by **any** of them. `GET /api/tags` returns the facets including `people`.

- [ ] **Step 1: Write the failing tests**

```ts
it('filters to one person\'s favourites', () => { /* two recipes, one starred by a@ */ });
it('several addresses mean any of them, not all', () => {});
it('an address nobody matches returns nothing rather than everything', () => {});
it('attaches favouritedBy, sorted, to every summary', () => {});
it('attaches favouritedBy to a single fetched recipe too', async () => {
  // GET /api/recipes/:id, not just the list
});
it('a star does not change the recipe\'s updatedAt', async () => {
  // read updatedAt, star, re-read: unchanged
});
it('people facets list everyone on the allowlist, including a never-signed-in person at 0', () => {});
it('GET /api/recipes?favourite=a@x.com narrows the list', async () => { /* through the real app */ });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/src/recipes`
Expected: FAIL — `favouritedBy` undefined

- [ ] **Step 3: Implement**

In `list()`, add a `WHERE EXISTS (SELECT 1 FROM favourites f WHERE f.recipe_id = recipes.id AND f.email IN (…))` clause built the same way the brand clause is, then attach `favouritedBy` with one `forRecipes` call over the returned ids rather than a query per row. `toSummary` cannot see favourites, so attach after mapping; `get(id)` needs the same attachment, or a recipe opened directly would always look unstarred. Adding the second constructor argument breaks every existing `createRecipeRepo(db)` call — `server/src/app.ts` and the repo's own tests — so update those in this task. `facets()` takes the allowlist and the counts and emits `people` sorted by count then name, resolving each name through `displayNameFor`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/src/recipes`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/recipes
git commit -m "feat: filter the library by whose favourites they are"
```

---

### Task 4: Starring and unstarring

**Files:**
- Modify: `server/src/recipes/routes.ts`, `server/src/auth/routes.ts`, `server/src/app.ts`
- Test: `server/src/favourites/routes.test.ts`

**Interfaces:**
- Consumes: `FavouritesRepo` (Task 1), `req.email` from the guard.
- Produces: `PUT /api/recipes/:id/favourite` and `DELETE /api/recipes/:id/favourite`, both `{ ok: true }`; `404 { error: 'Not found' }` when the recipe does not exist.

- [ ] **Step 1: Write the failing tests**

```ts
it('stars a recipe for the signed-in person only', async () => { /* favouritedBy === [that email] */ });
it('starring twice is still one star and still 200', async () => {});
it('unstarring something unstarred is 200', async () => {});
it('404s for a recipe that does not exist, with no row written', async () => {});
it('signed out, both routes are 401', async () => { /* injectAnon */ });
it('one person starring does not star for the other', async () => {});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/src/favourites/routes.test.ts`
Expected: FAIL — 404 from the unregistered routes

- [ ] **Step 3: Implement the two routes**

Check the recipe exists first and return the 404 before touching the favourites table, so the foreign key never raises. Wire `createFavouritesRepo` once in `app.ts` and pass it to both `createRecipeRepo` and the routes.

- [ ] **Step 4: Delete a person's favourites when they are removed**

In the allowlist `DELETE` handler in `server/src/auth/routes.ts`, call `removeAllFor` in the same transaction as the existing removal. Add to `server/src/auth/allowlist.test.ts`: after removing someone, a recipe only they had starred no longer appears under their filter, and their facet entry is gone.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/favourites server/src/recipes/routes.ts server/src/auth/routes.ts server/src/app.ts server/src/auth/allowlist.test.ts
git commit -m "feat: star and unstar a recipe for yourself"
```

---

### Task 5: Favourites in the backup fingerprint

**Files:**
- Modify: `server/src/backup/fingerprint.ts`, `server/src/backup/fingerprint.test.ts`

**Interfaces:** Consumes `FavouritesRepo.allPairs` (Task 1). `computeFingerprint(db, dataDir)` keeps its signature.

- [ ] **Step 1: Write the failing tests**

```ts
it('changes when a recipe is starred', async () => {});
it('returns to the original hash when the star is removed', async () => { /* toBe(before) */ });
it('does not change when a display name changes', async () => {});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/src/backup/fingerprint.test.ts`
Expected: FAIL — hashes equal

- [ ] **Step 3: Implement**

Add the sorted pairs to the hashed object as `favourites`, beside `recipes`, `images` and `allowed`. Update the comment above `computeFingerprint`: favourites are in, display names are deliberately out.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/src/backup`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/backup
git commit -m "feat: a new favourite triggers that night's backup"
```

---

### Task 6: The heart

**Files:**
- Modify: `web/src/api.ts`, `web/src/pages/Library.tsx`, `web/src/pages/RecipeOverview.tsx`, `web/src/components/Icons.tsx`, `web/src/styles.css`
- Test: `web/src/pages/Library.favourites.test.tsx`, `web/src/pages/RecipeOverview.test.tsx`

**Interfaces:**
- Consumes: the two routes from Task 4; `favouritedBy` on summaries and recipes (Task 3); `getMe()` returning `{ email, name }` (Task 2).
- Produces:
```ts
export function setFavourite(recipeId: string, on: boolean): Promise<void>;  // PUT or DELETE
```

- [ ] **Step 1: Write the failing tests**

```tsx
it('shows a filled heart on a recipe you have starred', async () => {});
it('shows an empty heart on one you have not', async () => {});
it('starring updates the heart without reloading the list', async () => {});
it('a failed star puts the heart back', async () => { /* reject, expect empty again */ });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run web/src/pages/Library.favourites.test.tsx`
Expected: FAIL — no heart in the output

- [ ] **Step 3: Implement**

Add a heart to `Icons.tsx` in the file's existing style (filled and outline). The heart toggles optimistically and reverts on failure. Styling follows the app's existing icon-button treatment; add no new design language.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run web/src`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "feat: star a recipe from the library and the recipe page"
```

---

### Task 7: The Favourites section in Filters

**Files:**
- Modify: `web/src/components/FilterSheet.tsx`, `web/src/pages/Library.tsx`, `web/src/api.ts`
- Test: `web/src/components/FilterSheet.test.tsx`, `web/src/pages/Library.favourites.test.tsx`

**Interfaces:**
- Consumes: `Facets.people` (Task 3).
- Produces: `Filters` gains `people: string[]` (addresses). `ListQuery` gains `favouritedBy?: string[]`, sent as repeated `favourite` parameters.

- [ ] **Step 1: Write the failing tests**

```tsx
it('lists each person by name with their count', async () => {});
it('ticking a person filters the list to their favourites', async () => {});
it('ticking two people shows either persons\' favourites', async () => {});
it('a stored filter from before this feature loads without crashing', () => {
  localStorage.setItem('recipes.libraryFilters', JSON.stringify({ brands: [], tags: [] }));
  expect(loadFilters().people).toEqual([]);
});
it('counts the people chips in the active filter count', async () => {});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run web/src/components/FilterSheet.test.tsx`
Expected: FAIL — no Favourites section

- [ ] **Step 3: Implement**

A Favourites section in `FilterSheet.tsx` alongside Brand and Tag, following their markup exactly. `loadFilters` in `Library.tsx` defaults `people` to `[]` when the stored object lacks it, and the active-filter count and the removable chips include people.

- [ ] **Step 4: Run the suite and the build**

Run: `npm run build && npm test`
Expected: both pass

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "feat: filter the library by whose favourites they are"
```
