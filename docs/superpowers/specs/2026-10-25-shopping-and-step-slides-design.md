# Shopping list, step slides and step photos: design

Extends `2026-10-25-recipes-design.md` (the base recipe book, already built and deployed to `/opt/recipes`). Everything in that document still holds unless this one says otherwise. This reverses one of its non-goals ("shopping lists").

## Intent

Mat and their wife order their weekly food shop online. They want to look at a recipe, say "I already have these", and send the rest as a plain list to whoever is doing the online order. Separately, cooking should feel like a slideshow: one step at a time with a photo and only the ingredients used in that step.

## Goals

1. **"What do we already have?" checklist** on each recipe: every ingredient has a tick box meaning *we already have this*. One button turns the **unticked** ingredients into shopping-list items.
2. **One shared shopping list** (a page): items from any recipes, stored on the server so Mat and their wife see the same list. Items can be deleted individually, and the whole list cleared after the order is placed. Duplicates merge.
3. **Share** the list as plain text: the phone's native share sheet when available, clipboard copy otherwise. No login, no accounts, no store integration.
4. **Cook mode as a slideshow**: each step is a full slide with its photo (if any) and a strip of the ingredients used in that step only. Back / Next buttons, swipe left/right, step progress, Keep screen on toggle unchanged.
5. **Photos per step**: add, replace and remove a photo on any step in the editor (camera or gallery).
6. **Ingredient-to-step links** are editable in the editor, and are suggested automatically when a recipe is created by Describe or Import (see AI rules below).

## Non-goals

Supermarket or basket integration, prices, aisles/categories, pantry tracking across shops, scaling quantities, multiple lists, per-person lists, push notifications when the list changes, offline editing of the list, a "meal plan" calendar.

## Anti-goals (a failure even if it technically works)

- The AI links an ingredient to a step that never mentions it, or invents steps/ingredients to make links. Links come only from what the step text actually names; unknown stays unlinked.
- The shopping list silently does arithmetic on vague quantities ("a splash", "to taste") or on different units (g plus tins).
- A ticked ("have it") ingredient ends up on the list, or an unticked one is dropped.
- Existing recipes or backups break: steps stored as plain strings keep working, restore of an older backup keeps working, nothing is lost on upgrade.
- Adding a recipe to the list twice by accident doubles everything without the user knowing.
- Step photos missing from backups (they must ride in the existing images backup) or deleted from disk when a recipe is edited.

## Data model changes

- **Step** becomes `{ text: string; imageId: string | null; ingredients: number[] }`, where `ingredients` are zero-based indexes into the recipe's `ingredients` array (the editor must keep them valid when ingredients are reordered, inserted or deleted; stable per-ingredient ids are an acceptable alternative; the builder chooses). Group headings are not linkable.
- **Compatibility**: the server and the stored JSON must still accept steps as plain strings (older recipes, older backups, JSON-LD import) and normalise them to `{text, imageId: null, ingredients: []}` on read. A one-time migration may rewrite stored rows. Restoring an older snapshot must work. The backup fingerprint covers the new step shape; one extra backup after upgrade is expected and fine.
- **Shopping list item**: `{ id, item (normalised name), displayText, quantity: number | null, unit: string | null, note: string | null, recipeIds: string[], recipeTitles: string[], addedAt }`. New table via a new migration. Lives in the same SQLite file. It is **not** part of the backup fingerprint (it is transient); it is still inside every snapshot that is taken for other reasons.
- Step photos use the existing image store and ids (`<sha256>.jpg`, thumbs), so the existing images backup, restore and `isBackupImageName` rules apply unchanged. Removing a photo from a step only removes the reference; files are never deleted by the app.

## Behaviour

### Routes and screens (decided after the builder check)
- `/recipe/:id` becomes a new **recipe overview** page holding the "What do we have?" checklist and a "Start cooking" button. The library row links here.
- The step slideshow moves to `/recipe/:id/cook` (reached from "Start cooking"). Back/close from cook mode returns to the overview. The tablet cook layout shows photo left, step and "Uses" right; it does not repeat the full ingredient list (an Ingredients button/sheet opens it).
- Existing `Cook`/`Library` tests are rewritten to match; wake lock behaviour moves with the cook route.
- The mockups for all of this are on the design canvas, second row (checklist/overview, shopping list, phone and tablet step slides, editor step row).

### Ingredient checklist (recipe overview page)
- A "What do we have?" section on the recipe overview page: each ingredient row has a tick box labelled "We have this". Ticks are transient per visit (they reset; they are not stored on the recipe). A "Tick all" / "Untick all" control.
- Primary button "Add N to shopping list" (N = unticked count); disabled-looking states are avoided: with N = 0 it says "Nothing to add" and does nothing.
- Added items carry the recipe's title as their source. Group headings are skipped.

### Merging rules (shopping list)
- Normalise `item` (lowercase, trim, collapse spaces, strip a trailing plural "s"/"es" conservatively) and compare with the unit (normalised, e.g. "g"/"gram(s)").
- Same item AND same unit AND both quantities numeric: sum quantities; keep both recipe titles as sources.
- Anything else (different unit, a missing quantity, a vague quantity, different item) stays a separate line. Quantities are never converted between units.
- Adding a recipe that already contributed to the list: the app tells the user "Our spag bol is already on the list" and does not add it again unless the user chooses "Add again".

### Shopping list page
- Lists items (quantity unit item, with the source recipe titles in smaller text), delete per item, "Clear list" (with confirm), "Share list". Empty state invites the user to add from a recipe.
- Share text format: one item per line, e.g. `2 tins chopped tomatoes`, `500g beef mince`; vague ones as written (`splash of red wine`). Uses `navigator.share({ text })`; falls back to `navigator.clipboard.writeText` with a confirmation message; if neither works, shows the text in a selectable box.
- The list is shared by everyone who opens the site (no login). Last write wins; the page refreshes its items when it regains focus.

### Cook mode slideshow
- One slide per step. Slide shows: step number / total with progress segments, the photo (if any) above or beside the text (layout differs phone vs tablet, see mockups), the step text in large type, a strip "Uses:" with only the linked ingredients (quantity + name), Back/Next (Done on the last), swipe left/right, keyboard arrows.
- An "Ingredients" overview is reachable from every slide (a sheet or the first slide) with the full list; steps with no links show no strip.
- Keep screen on toggle and its wake-lock behaviour are unchanged.
- Photos are lazy-loaded and constrained so text stays on screen on a phone.

### Editor
- Each step row gets: add/replace/remove photo (file input `accept="image/*"` so phones offer the camera, upload progress and error like the recipe photo picker), and a way to choose which ingredients the step uses (multi-select list of the recipe's ingredients).
- Saving is blocked with a visible message while a step photo upload is in flight (same rule as recipe photos).

### AI and import rules
- Describe and URL-import AI extraction may suggest, per step, which ingredients the step text **names** (by index). It must not link by inference about what is typical for a dish. The "no invention" rules and the `gaps` mechanism still apply. Suggested links appear in the editor draft for the user to confirm before saving, like everything else from the AI.
- Structured-data (JSON-LD) imports produce steps as plain text; links are created by a deterministic text match of ingredient names against the step text (suggestions only, editable), not by the AI.
- The AI tool schema change must keep working with `strict: true` and the sanitiser. The opt-in live test must be extended and re-run by the user with a key; it has never been run against the real API.

## Constraints

- Phone and tablet first; tap targets at least 44px; works with the existing "Keep screen on". HTTPS only (already true), required for Web Share and clipboard APIs.
- Visual design follows the approved redesign on the Claude Design canvas (https://claude.ai/artifact/85wHvnKxqrFaXaR7iZaHTT), including the new artboards for these screens.
- Deployed by `git pull && docker compose up -d --build` in `/opt/recipes` on the box. Migrations must be forward-only and run on start.
- Same-origin CSRF guard applies to every new state-changing route.

## Left to the builder

Ingredient id/index strategy and editor remapping; exact merging/normalisation code (within the rules above); route and table names; how the "Uses" selector is presented; swipe implementation; share-text fine details; test approach; how the redesign's styling lands in `web/src/styles.css` (this design implies the redesign is applied as part of the work, or first).
