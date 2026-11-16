# Recipe categories and recipes from card photos — design

Date: 2026-11-16 · Branch: `feat/recipe-categories-and-card-photos` (from `07eeb64`)

## Why

Mat is about to add a stack of meal-kit recipe cards (HelloFresh, Gousto, Simply Cook). Finding a recipe in the
library is already "too much of a faff"; better categorisation is the main fix. Typing cards in by hand is the other
pain: photographing both sides on a phone and reviewing an AI draft should be enough.

Success: on a phone, open the library, tap Filters, pick "Gousto" + "Thai", see just those. And: photograph a card's
front and back, get a draft with the right brand, ingredients, steps and the dish photo, fix anything flagged, save.

## Goals

1. Every recipe has a **brand** (one) and **grouped tags** (any number per group), and the library can filter by any
   combination of them.
2. **From photos**: one or more photos of a recipe card become a draft in the existing draft/review flow, with brand
   and tags taken from what is printed, the dish photo cropped out of the card, and the card photos kept.
3. Works from the installed PWA on a phone (camera and photo library).

## Non-goals

- No editable list of tag groups in Settings; groups are fixed in code.
- No renaming/merging a tag across all recipes.
- No change to the meal planner, shopping list or backup format beyond what the new fields need.
- No deploy to the Ubuntu box (upgrade notes only).

## Anti-goals (would be a failure even if it "works")

- The AI inventing categories. **Tags and brand come only from what is written** on the card, page or description.
  Nothing inferred from what such a dish usually is. This keeps the existing rule: never add anything the input does
  not state. What counts as written, per group (Mat, 2026-11-16):
  - **Brand**: a printed name/logo (card) or the page's creator/site name (link). Never guessed.
  - **Cuisine**: a printed label/badge, or a cuisine word in the title ("Thai Green Chicken Curry" → Thai).
  - **Main ingredient**: the main protein or veg named in the title *and* present in the ingredients (→ Chicken).
  - **Meal** (dinner, lunch, quick…): only when printed or said (a "Quick" badge counts). Never from the dish.
  - **Other**: other printed labels/badges ("Calorie Smart", "Family"), JSON-LD keywords.
- The AI guessing unreadable text. Smudged or cut-off quantities are null and listed in gaps ("Check these").
- A cluttered library screen. Filters live in a sheet, not on the page.
- Re-uploading photos over mobile data because an AI call failed.

## Approaches considered

**Tag storage**
1. *Chosen:* keep `tags_json` on `recipes`, each entry becomes `{ group, name }`. Small change, same backup shape,
   filtering via `json_each` as today.
2. Normalised `tags` + `recipe_tags` tables: easier global rename, but more code and a format change; renaming was not
   asked for.
3. Encode the group in the string (`"Cuisine: Thai"`): no migration, but fragile.

**Sending photos**
- *Chosen:* upload each photo with the existing `POST /api/images` (stored, returns id), then
  `POST /api/ai/photos { imageIds }`. Retries don't re-upload; a resumed draft keeps its photos; the photos are kept
  anyway.
- One multipart request that uploads and drafts at once: a failed AI call means uploading again.

**Dish photo**
- *Chosen (C):* the AI returns where the dish photo is; the server crops it; the form shows the crop with
  "Adjust" (a crop box over the source photo), "Use whole photo" and "Remove".
- AI crop only (A): box is sometimes off with no fix but the whole photo. Manual crop only (B): a step on every card.

**Library filters**
- *Chosen (B):* a "Filters · N" button opening a bottom sheet with grouped chips; picked filters show as removable
  pills under search. Rejected: chip rows always on the page (too much on screen); brand tabs + sheet (two places).

## Data model

Migration `server/src/migrations/007_brand_and_tag_groups.sql`:

- `ALTER TABLE recipes ADD COLUMN brand TEXT` (nullable; null = not known).
- Backfill brand:
  - `origin = 'mine'` → `'Mine'`.
  - `origin = 'other'` and `source_name` matches a known meal-kit brand case-insensitively, ignoring spaces
    (`hellofresh`, `gousto`, `simplycook`) → the canonical name (`HelloFresh`, `Gousto`, `Simply Cook`).
  - otherwise `origin = 'other'` → `source_name` (today the host, e.g. `bbcgoodfood.com`), or null if none.
- Rewrite `tags_json`: every string `t` becomes `{"group":"other","name":t}` (SQL with `json_each`/`json_group_array`
  so it runs inside the migration; keep order).
- `origin` stays (other code and the source link use it); the edit form's Brand field is the new user-facing control.
- Brand ↔ origin rules: brand `Mine` ⇔ origin `mine`; any other brand or blank ⇒ `other` (labelled "From
  elsewhere" when blank). A new hand-typed recipe starts with brand `Mine`. A request with no `brand` field (old
  client, kept draft) gets it from origin on the server: mine → `Mine`, other → null. A photos draft with no
  readable brand is blank, origin `other`, and "brand" is listed in gaps.

Tag groups (fixed, in shared code on server and web): `cuisine` (Cuisine), `meal` (Meal), `main` (Main ingredient),
`other` (Other). Labels are display text; stored keys are the lowercase ids.

Known brands (suggested in the picker, used for backfill and canonicalising AI output): Mine, HelloFresh, Gousto,
Simply Cook. Brand is otherwise free text; the picker suggests every brand already used.

Schema (`server/src/recipes/schema.ts`):

- `TagSchema = { group: enum(cuisine|meal|main|other), name: string(min 1, trimmed) }`.
- `RecipeCoreSchema.tags: TagSchema[]`, plus `brand: string | null`.
- Input accepts legacy string tags too (→ group `other`) so an old client or a kept draft in localStorage still saves;
  dedupe by group + case-insensitive name.
- `RecipeSummary` gains `brand` and `tags: Tag[]`.

## Server

**Repo/routes** (`server/src/recipes/`):

- Read/write `brand`; stored tags parsed defensively (a legacy string reads as group `other`).
- `GET /api/recipes?search=&brand=Gousto&brand=HelloFresh&tag=cuisine:Thai&tag=meal:Dinner`: repeatable params.
  Within a group OR, across groups AND; brand counts as its own group. Tag match case-insensitive. `origin` param
  kept working for compatibility but the web app stops using it.
- Search also matches brand, and matches tag *names* only (via `json_each`), not the raw `tags_json` text, or
  "other"/"main" would match every recipe.
- `GET /api/tags` returns `{ brands: { name, count }[], tags: { group, name, count }[] }` (counts across all recipes,
  sorted by count desc then name). The sheet uses counts to order brands and show the top ~8 with "More".

**Link import** (`server/src/import/`): brand for video hosts (the `VIDEO_HOSTS` list in `web/src/lib/source.ts`:
Facebook, Instagram, TikTok, YouTube) = the creator's account name when the page gives one (JSON-LD `author`, og
metadata), else the platform's name ("Facebook"). For other sites = `og:site_name` (e.g. "BBC Good Food"), else
JSON-LD `author` only when it is an Organization, else the host — never an individual writer. Before using that,
if an existing recipe from the same source host (non-video) already has a brand, reuse it, so backfilled
`bbcgoodfood.com` and new "BBC Good Food" don't split into two chips (Mat can rename via the form; the reuse then
follows the newest).
JSON-LD `recipeCuisine` → `cuisine`, `recipeCategory` → `meal`, `keywords` → `other` (existing 8-tag cap stays,
applied per recipe). For the AI page path, the model may set brand/tags only from what the page text states.

**AI**

- `AiDraftSchema` gains `brand` and grouped `tags`. Prompt: brand and tags only when written in the input (a printed
  logo/name counts); unknown → null / empty; never infer cuisine, meal or main ingredient from the dish. A brand that
  is a guess from partial evidence goes in gaps. AI brand output is canonicalised to the known spellings.
- Describe: brand is forced to `Mine` by the route as origin is today.
- `ProviderMessage` user turns gain optional images: `{ role: 'user', text, images?: { mediaType, base64 }[] }`. Each
  provider translates them (Anthropic `image` content blocks, OpenAI `input_image` data URLs, Gemini `inline_data`).
  Text-only requests are unchanged.
- `AiClient.extractRecipe` accepts `{ kind: 'photos', images, text? }`. Same provider order, fallback, retry and
  deadline as today. A provider that rejects images is treated like any other provider failure and the next one is
  tried.
- Photos kind asks for one extra field: `dishPhoto: { image: index, x0, y0, x1, y1 } | null`, in 0–1000
  normalised coordinates of that image (Gemini's trained scale; stated explicitly in the prompt for all).
- Images sent to the AI are the stored JPEGs (≤1600px wide). Confirm during implementation that card small print is
  legible at that size; if not, keep a larger copy for AI use (builder's call).
- Default models checked against current provider docs (2026-11-16), all take image input: `claude-sonnet-5-5`
  (base64 `image` blocks, jpeg/png/gif/webp, high-res tier up to 2576 px long edge), `gpt-6-luna` (text + image,
  `input_image` with a base64 data URL), `gemini-3.5-flash-lite` (text, image, video, audio, PDF; `inline_data`).
  No `.env.example` change needed. Gemini's native box order is `[ymin, xmin, ymax, xmax]` 0–1000; our schema uses
  named fields (`x0, y0, x1, y1`) so no provider has to remember an order.

**`POST /api/ai/photos`** (`server/src/ai/routes.ts`): body `{ imageIds: string[] }`, 1–6 ids, each must exist in the
image store (400 otherwise). Calls the AI, then if `dishPhoto` is valid, crops that image with sharp (clamped box,
minimum size, else ignored) and saves the crop as a new image. Response is a draft like `/describe`:
`origin: 'other'`, `brand` from the AI (canonicalised) or null, `sourceName` = brand, `sourceUrl` null,
`imageIds: [crop?, ...cardPhotos]`, plus `dishCrop: { sourceImageId, box } | null` so the form can offer Adjust, and
`provider`/`model`. Error mapping identical to `/describe`.

**`POST /api/images/:id/crop`** `{ box }` (0–1000 coords) → `{ id }` of a new cropped image. Used by Adjust.

Request body limit: photos are uploaded one at a time through the existing 15 MB endpoint, so no change.

## Web

**Library** (`web/src/pages/Library.tsx`): remove the All/Mine/From elsewhere switch and the tag chip row. Under
search: a `Filters · N` button followed by pills for each active filter (✕ removes). The button opens a bottom sheet
(accessible dialog, closes on backdrop/Escape) with sections Brand, Cuisine, Meal, Main ingredient, Other — only
sections with values. Chips toggle; Brand shows the top 8 by count then "More". Footer: "Clear all" and
"Show N recipes" (live count from re-querying). Third add button "From photos" beside "Describe it" and "From a link".
Recipe row subtitle: brand · first tag · time.

**Recipe form** (`web/src/components/RecipeForm.tsx`): Brand field (text input with a datalist of known + used
brands) replaces the origin select's visible role; origin is derived (`Mine` → mine, anything else → other). One
comma-separated input per tag group, each with suggestions from used values. Source name/URL stay. When the draft has
a `dishCrop`, the first photo shows "Adjust", "Use whole photo", "Remove".

**Adjust crop**: a modal with the source photo and a draggable/resizable box (small library, e.g. `react-easy-crop`
or `react-image-crop` — builder's call, must work with touch), saving through `/api/images/:id/crop` and replacing
the first image id.

**From photos page** (`web/src/pages/Photos.tsx`, route `/photos`): "Add photos" uses
`<input type="file" accept="image/*" multiple>` (phone offers camera or library). Each photo is shrunk client-side
(canvas, longest side ~2000px, JPEG) and uploaded immediately; thumbnails show progress and can be removed and
reordered (front first). "Create draft" calls `/api/ai/photos`. Then the same review form and save path as Describe,
kept as a draft (`useDraft('photos')`, stores image ids, not bytes) so it survives closing the app.

Overview/print card show brand where they show the origin label today; tags show grouped.

## Testing (vitest, existing style)

- Migration: backfill rules (mine, known brand spellings, host, null) and tag rewrite, on a DB at 006 with rows.
- Schema: legacy string tags accepted; dedupe; brand.
- Repo/routes: brand/tag filters (OR within, AND across), counts endpoint, search by brand.
- Import: JSON-LD author/site name → brand; cuisine/category/keywords → groups.
- Providers: image parts translated per provider; text-only requests byte-for-byte unchanged.
- AI client: photos kind, fallback when first provider fails.
- `/api/ai/photos`: validation, crop applied/ignored, response shape, error mapping. `/crop` endpoint.
- Draft: prompt rule for brand/tags; canonicalised brand.
- Web: Library sheet (open, toggle, pills, clear, count), RecipeForm brand + grouped tags, Photos page (add, remove,
  create draft, resume), Adjust crop save.

## Docs

`docs/deploy.md` gets a "What's new" section: brand + grouped tags (what the migration does to existing recipes,
that it runs automatically on start), From photos (needs an AI key whose model takes images; model notes), the
`AI_PROVIDER` reminder (an invalid value just falls back to the first provider with a key).

## Left to the builder

Crop library choice; exact prompt wording; whether a larger AI copy of photos is needed; sheet styling within the
existing CSS; reorder UI for photos (drag or up/down buttons).
