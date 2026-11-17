# Recipe categories and recipes from card photos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recipes get a brand and grouped tags with a Filters sheet in the library, and a recipe can be drafted from photos of a recipe card (dish photo cropped, card photos kept).

**Architecture:** One `brand` column plus `tags_json` entries becoming `{group,name}` (migration 007). Shared category helpers live in `server/src/recipes/categories.ts` and are imported by the web app (as `schema.ts` already is). Photos are uploaded through the existing `/api/images`; `/api/ai/photos` sends the stored JPEGs as image parts through the existing provider fallback and crops the dish photo with sharp.

**Tech Stack:** Node 22, Fastify 5, better-sqlite3, zod 4, sharp, React 19 + react-router 7, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-16-categories-and-card-photos-design.md`

## Global Constraints

- Work in the worktree `/Users/mat/Code/claude/recipes-cards`, branch `feat/recipe-categories-and-card-photos`. Never touch `/Users/mat/Code/claude/recipes`. No deploy.
- Run tests with `npx vitest run <path>`; whole suite `npx vitest run`; types `npx tsc --noEmit && npx tsc -p web --noEmit`.
- Tag groups (stored id → label): `cuisine` Cuisine, `meal` Meal, `main` Main ingredient, `other` Other. Fixed in code.
- Known brands: `Mine`, `HelloFresh`, `Gousto`, `Simply Cook`. Canonicalised case-insensitively ignoring spaces/hyphens.
- Brand `Mine` ⇔ origin `mine`; any other brand or blank ⇒ origin `other`.
- AI tags/brand only from what is written (spec "Anti-goals" per-group rules, copied into the prompt).
- Dish box: `{ image, x0, y0, x1, y1 }` in 0–1000 of that image.
- `/api/ai/photos`: 1–6 image ids. Client shrink: longest side 2000 px, JPEG.
- Error mapping for new AI routes identical to `/api/ai/describe`.
- Copy: library button "From photos"; sheet button "Filters" / "Filters · N"; sheet footer "Clear all" and "Show N recipes"; crop actions "Adjust", "Use whole photo", "Remove".
- Commit after each task; messages `feat: …` / `test: …` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- An old kept draft in localStorage (string tags, no `brand`) is resumed and saved → loads into the form with tags under Other and saves without a 400. (Task 1 schema test, Task 7 form test.)
- A photo from an iPhone that the canvas can't decode (HEIC on some browsers) → the original file is uploaded unchanged rather than failing. (Task 9 test.)
- The AI returns a dish box that is inverted, out of 0–1000, tiny (<5% either side) or for an image index that doesn't exist → no crop, card photos still returned, no 500. (Task 6 test.)
- A tag with a colon or comma in its name ("Middle Eastern: spicy") filters correctly → query value split on the first colon only; form splits on commas so a comma can't be in a name. (Task 2 test.)
- The same photo picked twice → one image id (content hash), shown once. (Task 9 test.)

---

### Task 1: Category model, migration 007, repo read/write

**Files:**
- Create: `server/src/recipes/categories.ts`, `server/src/migrations/007_brand_and_tag_groups.sql`, `server/src/recipes/categories.test.ts`, `server/src/migrations/007.test.ts`
- Modify: `server/src/recipes/schema.ts`, `server/src/recipes/repo.ts`, `server/src/recipes/repo.test.ts`, `server/src/recipes/schema.test.ts`, fixtures in existing tests that build `RecipeInput`/`RecipeSummary` (`tags: []` stays valid; add `brand` where `toEqual` on full objects)

**Interfaces — Produces:**
- `categories.ts`: `type TagGroup = 'cuisine'|'meal'|'main'|'other'`; `TAG_GROUPS: readonly {id: TagGroup; label: string}[]` (order above); `type Tag = {group: TagGroup; name: string}`; `KNOWN_BRANDS = ['Mine','HelloFresh','Gousto','Simply Cook'] as const`; `canonicalBrand(s: string|null|undefined): string|null` (trim; blank → null; known match → canonical spelling; else trimmed input); `originForBrand(b: string|null): 'mine'|'other'`; `normaliseTags(raw: unknown): Tag[]` (strings → `other`; objects with valid group + non-blank name; trims; dedupes by group + lowercase name, first wins; never throws); `tagKey(t: Tag): string` = `` `${group}:${name}` ``; `parseTagKey(s: string): Tag|null` (split on FIRST colon; unknown group → null).
- `schema.ts`: `TagSchema`; `RecipeCoreSchema` gains `brand: z.string().nullable()` and `tags: z.array(TagSchema)`. `RecipeInputSchema` accepts `tags: (string|Tag)[]` and optional `brand`; transform: `tags = normaliseTags(tags)`, `brand = 'brand' in input ? canonicalBrand(brand) : (origin==='mine' ? 'Mine' : null)`, `origin = 'brand' in input ? originForBrand(brand) : origin`. `RecipeSummary` gains `brand: string|null`; `tags: Tag[]`.

- [ ] **Step 1: Write failing tests**
  - `categories.test.ts`: `canonicalBrand(' hello fresh ')==='HelloFresh'`, `canonicalBrand('simplycook')==='Simply Cook'`, `canonicalBrand('Jamie Oliver')==='Jamie Oliver'`, `canonicalBrand('  ')===null`; `normaliseTags(['Pasta',{group:'cuisine',name:' Thai '},{group:'cuisine',name:'thai'},{group:'bogus',name:'x'},{group:'meal',name:''}])` → `[{group:'other',name:'Pasta'},{group:'cuisine',name:'Thai'}]`; `parseTagKey('other:Middle Eastern: spicy')` → `{group:'other',name:'Middle Eastern: spicy'}`; `parseTagKey('nope:x')===null`.
  - `schema.test.ts`: input with `tags:['pasta']` and no `brand`, `origin:'mine'` → parses to `brand:'Mine'`, `tags:[{group:'other',name:'pasta'}]`; input `brand:'gousto', origin:'mine'` → `brand:'Gousto', origin:'other'`; `brand:null` → `origin:'other'`.
  - `007.test.ts`: open a DB migrated to 006 (copy `server/src/migrations` 001–006 into a temp dir, `openDb(file, tmpDir)`), insert rows: mine/no source; other/`source_name:'Hello Fresh'`; other/`'bbcgoodfood.com'`; other/null; tags `["pasta","dinner"]`. Then `openDb(file)` (shipped dir). Assert brands `Mine`, `HelloFresh`, `bbcgoodfood.com`, `null`, and `tags_json` = `[{"group":"other","name":"pasta"},{"group":"other","name":"dinner"}]` in order.
  - `repo.test.ts`: round-trip includes `brand` and object tags; a row whose `tags_json` is a legacy string array (insert via raw SQL) reads back as group `other`.
- [ ] **Step 2: Run** `npx vitest run server/src/recipes server/src/migrations` — expect FAIL.
- [ ] **Step 3: Implement** categories.ts, schema changes, migration (`ALTER TABLE recipes ADD COLUMN brand TEXT`; `UPDATE` with `CASE` on `lower(replace(replace(source_name,' ',''),'-',''))`; tags rewrite: `UPDATE recipes SET tags_json = (SELECT COALESCE(json_group_array(json_object('group','other','name',value)), '[]') FROM (SELECT value FROM json_each(recipes.tags_json) ORDER BY key))`), repo `brand` column in insert/update/toRecipe/toSummary, tags through `normaliseTags(parseJson(...))`.
- [ ] **Step 4: Run** `npx vitest run server` — PASS (fix fixtures that compare full recipes).
- [ ] **Step 5: Commit** `feat: recipes have a brand and grouped tags (migration 007)`

### Task 2: Library query and facets API

**Files:** Modify `server/src/recipes/repo.ts`, `server/src/recipes/routes.ts`, `server/src/recipes/routes.test.ts`, `server/src/recipes/repo.test.ts`

**Interfaces:**
- Consumes: `parseTagKey`, `Tag` (Task 1).
- Produces: `ListQuery = { search?: string; origin?: 'mine'|'other'; brands?: string[]; tags?: Tag[] }`; `repo.facets(): { brands: {name: string; count: number}[]; tags: {group: TagGroup; name: string; count: number}[] }` sorted count desc then name; `repo.brandForHost(host: string): string|null` (newest recipe whose `source_url` host equals `host`, `www.` stripped, with non-null brand). Route `GET /api/recipes` accepts repeatable `brand` and `tag` (`group:name`; invalid tag keys → 400). `GET /api/tags` returns the facets object.

- [ ] **Step 1: Failing tests** (repo): fixtures Gousto/Thai, HelloFresh/Thai, Gousto/Italian, Mine/no tags. `list({brands:['Gousto','HelloFresh'], tags:[{group:'cuisine',name:'thai'}]})` → 2 titles; `list({brands:['Gousto'], tags:[cuisine Thai, cuisine Italian]})` → 2 (OR within group); `list({tags:[cuisine Thai, meal Dinner]})` → only the one with both; `list({search:'other'})` → none (tag group ids not searched); `list({search:'gousto'})` → both Gousto; a tag named `Middle Eastern: spicy` is found via route `?tag=other:Middle%20Eastern%3A%20spicy`. `facets()` counts. `brandForHost('bbcgoodfood.com')` returns newest brand. Route: `?tag=bogus` → 400; `?brand=a&brand=b` passes both.
- [ ] **Step 2: Run** `npx vitest run server/src/recipes` — FAIL.
- [ ] **Step 3: Implement.** Brand filter `brand IN (...)` (case-insensitive via `lower()`); per tag group an `EXISTS (SELECT 1 FROM json_each(recipes.tags_json) t WHERE json_extract(t.value,'$.group')=@g AND lower(json_extract(t.value,'$.name')) IN (...))`, groups ANDed. Search: title, ingredients_json, brand, and `EXISTS` over tag names. zod query: `z.union([z.string(), z.array(z.string())])` normalised to arrays (Fastify gives a string for one value).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: filter recipes by several brands and grouped tags`

### Task 3: Link import brand and grouped tags

**Files:** Modify `server/src/import/importUrl.ts`, `server/src/import/jsonld.ts`, `server/src/import/describedSource.ts` (no brand change, only types), `server/src/app.ts`, tests `importUrl.test.ts`, `jsonld.test.ts`

**Interfaces:**
- Consumes: `repo.brandForHost` (Task 2), `canonicalBrand`.
- Produces: `ImportDeps.brandForHost?: (host: string) => string|null` (wired in `app.ts` from the recipe repo). `parseRecipeJsonLd` returns tags as `Tag[]` (`recipeCuisine`→cuisine, `recipeCategory`→meal, `keywords`→other; existing 8 cap) and `author: { name: string; organization: boolean } | null`. Export `VIDEO_HOSTS` from a server module (`server/src/import/videoHosts.ts`) and import it in `web/src/lib/source.ts` instead of its local copy.

Brand rule (`importBrand(html, finalUrl, ld, deps): string|null`): video host → author/og creator name (`og:site_name` is not used for video hosts; use JSON-LD `author.name`, else `meta[name="author"]`, else the platform label `Facebook|Instagram|TikTok|YouTube`); other host → `deps.brandForHost(host)` ?? `og:site_name` ?? (author if organization) ?? host. Then `canonicalBrand`. Draft `sourceName` = brand; `origin` `other`.

- [ ] **Step 1: Failing tests:** JSON-LD with `recipeCuisine:'Thai', recipeCategory:'Dinner', keywords:'easy, quick'` → tags cuisine Thai, meal Dinner, other easy, other quick. Page with `og:site_name="BBC Good Food"` and JSON-LD `author:{@type:'Person',name:'Jane Cook'}` → brand `BBC Good Food`; same but `brandForHost` returns `bbcgoodfood.com` → `bbcgoodfood.com`; instagram URL with `author.name:'Pasta Queen'` → `Pasta Queen`; instagram with nothing → `Instagram`; HelloFresh page whose site name is `HelloFresh UK`… → `HelloFresh UK` (only exact canonical matches change).
- [ ] **Step 2: Run** `npx vitest run server/src/import web/src/lib/source.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: link imports get a brand and grouped tags`

### Task 4: AI draft schema and prompt (brand, grouped tags, dish photo)

**Files:** Modify `server/src/ai/draft.ts`, `server/src/ai/routes.ts`, `server/src/ai/draft.test.ts`, `server/src/ai/routes.test.ts`, `server/src/recipes/schema.ts` (`RecipeDraftSchema`)

**Interfaces — Produces:**
- `AiDraftSchema` = core + `steps` (AI steps) + `gaps` + `dishPhoto: z.object({image:int, x0,y0,x1,y1: number}).nullable()`; tags as `TagSchema` (group enum). `toRecipeDraft(ai)` returns `RecipeDraft & { dishPhoto: DishBox|null }` with `brand = canonicalBrand(ai.brand)`, `tags = normaliseTags(ai.tags)`. `type DishBox = {image: number; x0: number; y0: number; x1: number; y1: number}` exported from `draft.ts`.
- `buildUserMessage` accepts `{ kind: 'photos'; text?: string; imageCount: number }` → text "Read the recipe from these N photos of a recipe card (front, back, extra pages, in order)…" + optional `<user_description>` note.
- `SYSTEM_PROMPT` additions: per-group "what counts as written" rules (copy the spec's list); "brand: only a printed name/logo or the page's creator/site name; otherwise null and add the gap \"brand\""; for photos: unreadable text → null + gap naming it ("quantity for soy sauce (unreadable)"); `dishPhoto` only for photos input: the finished-dish photo's box in 0–1000 of that image, else null. For description/page `dishPhoto` must be null.
- `/api/ai/describe` forces `brand: 'Mine'`, `tags` kept from AI (still only what was said), drops `dishPhoto` from the response.

- [ ] **Step 1: Failing tests:** `toRecipeDraft` canonicalises `'hello fresh'`→`HelloFresh`, normalises tags, passes `dishPhoto` through; schema JSON (`recipeToolSchema()`) contains `dishPhoto` and `brand` in `required` (strict); prompt contains `"Main ingredient"` rule text and `"dishPhoto"`; describe route returns `brand:'Mine'` and no `dishPhoto` key; `buildUserMessage({kind:'photos', imageCount:2})` mentions `2 photos`.
- [ ] **Step 2: Run** `npx vitest run server/src/ai` — FAIL.
- [ ] **Step 3: Implement.** Update test fixtures (`draft` objects) with `brand`/`dishPhoto`.
- [ ] **Step 4: Run** `npx vitest run server` — PASS.
- [ ] **Step 5: Commit** `feat: AI drafts carry brand, grouped tags and a dish photo box`

### Task 5: Image input in providers and client

**Files:** Modify `server/src/ai/providers/types.ts`, `anthropic.ts`, `openai.ts`, `gemini.ts`, `server/src/ai/client.ts`, tests `providers/providers.test.ts`, `client.test.ts`

**Interfaces:**
- Produces: `ProviderImage = { mediaType: 'image/jpeg'; base64: string }`; user message `{ role:'user'; text: string; images?: ProviderImage[] }`. `AiClient.extractRecipe(input: { kind:'description'|'page'; text: string; sourceUrl?: string } | { kind:'photos'; images: ProviderImage[]; text?: string })` → `AiExtraction` whose `draft` includes `dishPhoto`.
- Anthropic: content = images as `{type:'image', source:{type:'base64', media_type, data}}` then `{type:'text', text}`. OpenAI (chat completions): `content: [{type:'text', text}, ...images.map(i => ({type:'image_url', image_url:{url:`data:${mediaType};base64,${base64}`}}))]`. Gemini: `parts: [...images.map(i => ({inline_data:{mime_type, data}})), {text}]`. No images → requests identical to today (string content for Anthropic/OpenAI, single text part for Gemini).

- [ ] **Step 1: Failing tests:** per provider, a request with 2 images produces the shapes above (inspect fake SDK/fetch body); a text-only request's body equals a snapshot taken from the current code (assert `content` is a string / one part). Client: `extractRecipe({kind:'photos', images:[img]})` → first provider fails `auth` → second provider called with the images → returns its draft; the user message text comes from `buildUserMessage({kind:'photos', imageCount:1})`.
- [ ] **Step 2: Run** `npx vitest run server/src/ai` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: AI providers accept photos`

### Task 6: `/api/ai/photos` and `/api/images/:id/crop`

**Files:** Modify `server/src/images/store.ts`, `server/src/images/routes.ts`, `server/src/ai/routes.ts`, `server/src/app.ts` (pass `images` to AI routes), tests `images/store.test.ts`, `images/routes.test.ts`, `ai/routes.test.ts`

**Interfaces:**
- Produces: `ImageStore.crop(id: string, box: Box1000): Promise<string|null>` where `type Box1000 = {x0:number;y0:number;x1:number;y1:number}`; clamps to 0–1000, swaps inverted, returns null if width or height < 50 (5%) or id unknown; crops the stored full image (`sharp(file).extract(...)`) and saves via `save`. `ImageStore.read(id): Promise<Buffer|undefined>`.
- `POST /api/images/:id/crop` body `{x0,y0,x1,y1}` → `{id}`; 400 bad id/box, 404 unknown, 422 box too small.
- `POST /api/ai/photos` body `{imageIds: string[]}` → draft JSON: `{ ...draft (no dishPhoto), origin: originForBrand(brand), brand, sourceName: brand, sourceUrl: null, imageIds: [crop?, ...imageIds], dishCrop: {sourceImageId, x0,y0,x1,y1} | null, provider, model }`; gap `"brand"` added when brand null and not already listed. 400 if not 1–6 valid ids or any missing from the store; 503 without AI; errors as describe.

- [ ] **Step 1: Failing tests:** store: crop of a generated 1000×500 sharp image with box `{x0:0,y0:0,x1:500,y1:1000}` → new image 500 wide (from `sharp(...).metadata()` of the saved file — note the store's 1600 cap); inverted box works; `{x0:0,y0:0,x1:30,y1:30}` → null. Routes: photos happy path with mocked AI returning `dishPhoto:{image:1,...}` → `imageIds[0]` is a new id, followed by both originals, `dishCrop.sourceImageId` = second id; `dishPhoto` for `image:5` → no crop, `dishCrop:null`; 7 ids → 400; unknown id → 400; AI `brand:null` → `origin:'other'`, gaps include `brand`; `AiRequestError('no_credit')` → 502 with code.
- [ ] **Step 2: Run** `npx vitest run server/src/images server/src/ai/routes.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Images sent to the AI: `store.read(id)` (stored full JPEG ≤1600 px) base64. If legibility testing later shows that's too small, raise `MAX_WIDTH` for new uploads — not in this task.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: draft a recipe from photos of a recipe card`

### Task 7: Web API, recipe form (brand + grouped tags), labels

**Files:** Modify `web/src/api.ts`, `web/src/components/RecipeForm.tsx`, `web/src/lib/text.ts` (`originLabel`, `parseTags` stays for comma lists), `web/src/pages/RecipeOverview.tsx`, `web/src/pages/PrintCard.tsx`, `web/src/pages/Editor.tsx` (new recipe default `brand:'Mine'`, `tags:[]`), tests `RecipeForm.test.tsx`, `lib/text.test.ts`, affected page tests' fixtures

**Interfaces:**
- Consumes: Tasks 1, 2, 6.
- Produces (api.ts): `ListQuery = { search?: string; brands?: string[]; tags?: Tag[] }`; `listRecipes` appends repeated `brand`/`tag` (`tagKey`); `type Facets`; `getFacets(): Promise<Facets>` (`/api/tags`) replacing `listTags`; `photosRecipe(imageIds: string[]): Promise<PhotosDraft>` where `PhotosDraft = AiDraft & { dishCrop: ({sourceImageId: string} & Box1000) | null }` (same error handling as `describeRecipe`); `cropImage(id: string, box: Box1000): Promise<string>`.
- `originLabel(r: {brand: string|null; origin})` → brand ?? (origin mine ? 'Mine' : 'From elsewhere').
- RecipeForm: new optional prop `facets?: Facets` (callers pass it; suggestions via `<datalist>`); Brand input (`label "Brand"`, datalist = KNOWN_BRANDS ∪ facet brands); origin select removed, `origin` built with `originForBrand`; one input per group labelled by `TAG_GROUPS` label, comma-separated, each with its own datalist; `build()` emits `brand: str(brand)` and `tags` from the four inputs. Initial values from `normaliseTags(initial.tags)` so a legacy draft loads. New optional prop `dishCrop` + `onAdjustCrop` is added in Task 9, not here.

- [ ] **Step 1: Failing tests:** form with `initial.tags:['pasta']` (legacy, cast) shows `pasta` in the Other input and saves `tags:[{group:'other',name:'pasta'}]`; typing `Gousto` in Brand saves `brand:'Gousto', origin:'other'`; Cuisine `Thai, Indian` saves two cuisine tags; overview shows brand label.
- [ ] **Step 2: Run** `npx vitest run web` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run web && npx tsc -p web --noEmit` — PASS.
- [ ] **Step 5: Commit** `feat: edit a recipe's brand and grouped tags`

### Task 8: Library Filters sheet

**Files:** Create `web/src/components/FilterSheet.tsx`, `web/src/components/FilterSheet.test.tsx`; Modify `web/src/pages/Library.tsx`, `web/src/pages/Library.test.tsx`, `web/src/styles.css`

**Interfaces:**
- Consumes: `getFacets`, `listRecipes` (Task 7), `TAG_GROUPS`, `tagKey`.
- Produces: `type Filters = { brands: string[]; tags: Tag[] }`; `<FilterSheet open facets filters count onChange(f: Filters) onClose() />` — `role="dialog"` `aria-modal`, labelled "Filters"; sections "Brand" then each TAG_GROUP with values (skip empty); Brand shows top 8 by count then a "More" button revealing the rest; chips `aria-pressed`; "Clear all"; "Show N recipes" closes. Escape and backdrop click close.
- Library: removes the origin segmented control and tag chip row; adds "Filters" / "Filters · N" button under search and removable pills (`aria-label="Remove filter Gousto"`); "From photos" CTA linking `/photos`; subtitle `[originLabel(r), r.tags[0]?.name, formatMinutes]`. Filters kept in `sessionStorage` (`recipes.libraryFilters`, try/catch) so going into a recipe and back keeps them.

- [ ] **Step 1: Failing tests:** open sheet, press Gousto and Thai → `listRecipes` last called with `{brands:['Gousto'], tags:[{group:'cuisine',name:'Thai'}]}`; button reads `Filters · 2`; "Show N recipes" uses the current result count; pill ✕ removes one; "Clear all" empties; 10 brands → 8 visible + More; Escape closes; filters survive unmount/remount.
- [ ] **Step 2: Run** `npx vitest run web/src/pages/Library.test.tsx web/src/components/FilterSheet.test.tsx` — FAIL.
- [ ] **Step 3: Implement** (bottom sheet CSS: fixed bottom, max-height 80vh, scroll, respects `env(safe-area-inset-bottom)`).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: library Filters sheet with brand and grouped tags`

### Task 9: From photos page and Adjust crop

**Files:** Create `web/src/pages/Photos.tsx`, `web/src/pages/Photos.test.tsx`, `web/src/lib/shrinkImage.ts`, `web/src/lib/shrinkImage.test.ts`, `web/src/components/CropDialog.tsx`, `web/src/components/CropDialog.test.tsx`; Modify `web/src/App.tsx` (route `/photos`), `web/src/lib/drafts.ts` (kind `'photos'`, field `photoIds?: string[]`, `dishCrop?`, label "From photos", href `/photos?draft=`), `web/src/components/RecipeForm.tsx` (photo-1 actions), `package.json` (crop library), `web/src/styles.css`

**Interfaces:**
- Consumes: `uploadImage`, `photosRecipe`, `cropImage` (Task 7).
- Produces: `shrinkImage(file: File, maxSide = 2000): Promise<File>` — canvas resize to JPEG 0.9; returns the original file when it is already within `maxSide`, or when decoding fails. `<CropDialog imageId box onSave(box: Box1000) onCancel />` using `react-easy-crop` (touch-capable; convert its percent area ×10 to 0–1000). RecipeForm optional props `dishCrop?: {sourceImageId: string} & Box1000 | null`: when set and `imageIds[0]` is the crop, photo 1 shows buttons "Adjust" (opens CropDialog on `sourceImageId`, saves via `cropImage` and replaces `imageIds[0]`), "Use whole photo" (replaces `imageIds[0]` with `sourceImageId`, dropping duplicate), "Remove" (existing).
- Photos page: header "From photos" + Cancel; `<input type="file" accept="image/*" multiple>` behind a "Add photos" label button; each file → `shrinkImage` → `uploadImage`; thumbnails in order with Remove and up/down "Move earlier/later" buttons; duplicates (same id) ignored; "Create draft" disabled while uploading or with 0 photos, max 6 (hint shown); then RecipeForm as in Describe (`useDraft('photos')`, saves `photoIds`, `input`, `gaps`, `dishCrop`).

- [ ] **Step 1: Failing tests:** shrinkImage returns original when canvas decode throws (mock `createImageBitmap` rejecting); Photos: pick 2 files → `uploadImage` called twice, two thumbnails; same id twice → one thumbnail; Create draft calls `photosRecipe([id1,id2])` and renders the form with gaps; resume from `?draft=` restores thumbnails and form; Use whole photo swaps first image; CropDialog Save calls `onSave` with 0–1000 box.
- [ ] **Step 2: Run** `npx vitest run web` — FAIL.
- [ ] **Step 3: Implement;** `npm install react-easy-crop@<latest 5.x>` (record exact version).
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit && npx tsc -p web --noEmit` — PASS.
- [ ] **Step 5: Commit** `feat: add a recipe from photos of a recipe card`

### Task 10: Upgrade notes and full verification

**Files:** Modify `docs/deploy.md`

- [ ] **Step 1:** Add "## What's new" at the top of `docs/deploy.md` (below the title): Brand & grouped tags (migration 007 runs on start; what it does to existing recipes: Mine, meal-kit names, host for link recipes, existing tags → Other; take a backup first via Settings → Back up now); Library Filters; From photos (needs an AI key whose model takes images — the defaults all do; works from the installed app's camera; card photos are kept, ~300 KB each); note that an invalid `AI_PROVIDER` value just falls back to the first provider with a key (fix it to `anthropic`, `openai` or `gemini`, or leave empty); upgrade = the existing pull/build/up steps.
- [ ] **Step 2:** `npm run build` and `npx vitest run` — all PASS.
- [ ] **Step 3:** Run the app (`npm run dev` + `npm run dev:web`), check in the browser at phone width: filters sheet, edit form, From photos with a real card photo if an AI key is in `.env` (otherwise say not verified live).
- [ ] **Step 4: Commit** `docs: what's new — brands, filters and recipes from photos`
