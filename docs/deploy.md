# Deploying Recipes

1. Copy the repo to the box.
2. `cp .env.example .env` and fill in the values.
3. Make sure the `studioos-lan-edge` Docker network exists (created by the Studio OS stack), then `docker compose up -d --build`.
4. Copy `deploy/recipes.caddy` into the fronting Caddy's `sites/` directory and reload Caddy.
5. Add a DNS A record for `recipes.matchapman.dev` pointing at the box's LAN IP.

## Restoring from a Drive backup

Backups live in the "Recipes backup" folder in Google Drive (`snapshots/` holds `recipes-<YYYYMMDD-HHmmss>.sqlite` plus a readable `.json`; `images/` holds the photos).

1. In Drive, open "Recipes backup", download it (Drive gives a zip) and unzip it. The zip keeps the folder names, so you get `snapshots/` and `images/`. Alternatively use a plain folder holding the `.sqlite` plus an `images/` folder.
2. Stop the app. The database file is replaced, so nothing may have it open:

   ```sh
   docker compose stop recipes
   ```

3. Run the restore, mounting the downloaded folder read-only at `/restore` (the data volume is mounted automatically):

   ```sh
   docker compose run --rm --no-deps -v /path/to/downloaded/backup:/restore:ro recipes npm run restore -- /restore --force
   ```

   - By default it restores the NEWEST snapshot in the folder. If that file is damaged or from a newer app version it stops with a message and changes nothing; it will not silently use an older one. Pick one explicitly with `--snapshot recipes-20260101-030000.sqlite` (add it after `/restore`). When you need a specific older state, such as the rollback below, always pass `--snapshot`: the default would pick a newer one.
   - `--force` is needed when a database already exists. The old one is moved to `recipes.sqlite.pre-restore-<timestamp>` in the data volume (never deleted). Without `--force` the restore refuses to touch an existing database.
   - Images already present are skipped. Recipes referencing images missing from the backup are counted in a warning.
   - Distinct step photos that are missing are counted in a second warning. They are counted against the images on the volume after the restore (the backup's images plus any already there), so a photo missing in both places shows in both counts.
   - Outside Docker: `npm run restore -- <backupDir> [--data-dir <dir>] [--force]` (`--data-dir` defaults to `$DATA_DIR`, else `/data`).

4. Start the app again:

   ```sh
   docker compose start recipes
   ```

5. Google Drive is not restored (the token is deliberately not part of a backup): open Settings and connect Drive again.

## What's new in this release

Release: shopping list and step slides

Before upgrading:

- In the running app open Settings, press "Back up now" and confirm it reports success.
- In Drive open "Recipes backup/snapshots" and note the exact file name of that backup (`recipes-<stamp>.sqlite`, the newest one). Download it and keep a copy somewhere safe, with the name written down. The rollback below needs exactly this file, and Drive retention keeps only the newest 14 snapshots, so Drive will eventually delete it.

What changed:

- New pages: `/recipe/:id` is an overview with a "what do we already have?" ingredient checklist, `/recipe/:id/cook` is a step-by-step slideshow, and `/shopping` is the shopping list.
- The shopping list lives in the SQLite file, so every snapshot includes it. The backup fingerprint ignores it, so a shopping-only change does not trigger a nightly upload; "Back up now" always uploads.
- Step photos are stored with the other photos and ride in the existing images backup.
- Step data changed shape, so the first nightly backup after upgrading uploads once even if nothing else changed. That and your post-upgrade "Back up now" check create NEWER snapshots, which is why a rollback must name the pre-upgrade file explicitly.
- Old recipes keep working: their steps just have no photos or ingredient links until you edit them. Old backups restore fine and migrate on next start.

After deploying:

- Fully close and reopen the app on every phone and tablet, including any open browser tabs and the installed PWA. A tab still running the previous version must not be used to edit recipes: it cannot handle the new step format. (The server rejects the corrupted step text such a tab would send, but the old screens will still misbehave.)

Rolling back:

- Rebuilding the old commit is NOT enough once any recipe has been edited under the new version, because the old version cannot read the new step format.
- Roll back by checking out the old commit AND restoring the pre-upgrade snapshot you noted and downloaded before upgrading. Recipe edits made after the upgrade are lost.
- NEVER roll back with the restore command's default. It restores the NEWEST snapshot, which after the upgrade is a new-format one; the old version's editor would then corrupt its steps into `[object Object]`.

Steps:

1. Put the downloaded pre-upgrade `recipes-<stamp>.sqlite` in a folder (for example `/path/to/downloaded/backup`) together with the `images/` folder from Drive. Ideally the folder holds only that one snapshot.
2. Check out the old commit and stop the app: `docker compose stop recipes`.
3. Restore that exact file, with `--snapshot` and `--force`:

   ```sh
   docker compose run --rm --no-deps -v /path/to/downloaded/backup:/restore:ro recipes npm run restore -- /restore --snapshot recipes-<stamp>.sqlite --force
   ```

4. Rebuild and start the old version: `docker compose up -d --build`.

Checks after deploying:

1. Open a recipe's slideshow on a phone and a tablet.
2. Add recipe ingredients to the list and share the list from a phone.
3. Press "Back up now" and confirm step photos appear in the Drive images folder.
4. Do a restore drill (see above). Note it restores the newest snapshot by default and replaces the live database, so only do it when you are happy to go back to that backup.
5. Run the live AI test once per provider key you have (see AI providers below): `LIVE_AI=1 npx vitest run server/src/ai/draft.live.test.ts`. It has never been run against the real APIs, and the AI step-link schema changed.

## AI providers

"Describe a recipe" and the page-reading fallback in import can use Claude, ChatGPT (OpenAI) or Gemini. Set any one or more of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `GEMINI_API_KEY` in `.env` (models are `ANTHROPIC_MODEL`, `OPENAI_MODEL`, `GEMINI_MODEL`; the defaults in `.env.example` are cheap ones and can be changed), then restart.

- The first provider with a key is used, in the order Claude, ChatGPT, Gemini. Set `AI_PROVIDER=anthropic|openai|gemini` to try a different one first. An unknown value is ignored with a warning in the log.
- Fallback: if the provider fails because of the provider (key rejected, no credit, rate limit, overloaded or down, timeout) the next provider with a key is tried. A refusal, a recipe that is still invalid after the one retry, or a request error of our own is shown rather than passed on.
- Settings shows which providers have a key and which is in use (never the keys). Drafts say "Drafted by ..." above the form; that is never saved with the recipe.
- If every provider fails, the page shows a plain message: "The AI account is out of credit. Add credit or switch provider." (no credit), "The AI key was rejected. Check the key in .env." (bad key), "The AI is busy right now. Try again in a minute." (rate limit), or "The AI didn't respond. Try again.". The message follows the first provider tried.
- Quality and the no-invention behaviour can differ by provider, so run the live test for each one you set a key for (it runs once per key present and skips the rest): `LIVE_AI=1 npx vitest run server/src/ai/draft.live.test.ts`.

## Installing as an app

The site is an installable PWA (manifest plus a small service worker that only caches the page shell, built assets and recipe photos, never other API calls). On a phone open the site and use "Add to Home Screen" / "Install app". Icons are generated from `web/public/icon.svg` by `npm run icons`.
