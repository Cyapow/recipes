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

   - It restores the NEWEST snapshot. If that file is damaged or from a newer app version it stops with a message and changes nothing; it will not silently use an older one. Pick one explicitly with `--snapshot recipes-20260101-030000.sqlite`.
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

- In the running app open Settings, press "Back up now" and confirm it reports success. This is your pre-upgrade snapshot, and the rollback below depends on it.

What changed:

- New pages: `/recipe/:id` is an overview with a "what do we already have?" ingredient checklist, `/recipe/:id/cook` is a step-by-step slideshow, and `/shopping` is the shopping list.
- The shopping list lives in the SQLite file, so every snapshot includes it. The backup fingerprint ignores it, so a shopping-only change does not trigger a nightly upload; "Back up now" always uploads.
- Step photos are stored with the other photos and ride in the existing images backup.
- Step data changed shape, so the first nightly backup after upgrading uploads once even if nothing else changed.
- Old recipes keep working: their steps just have no photos or ingredient links until you edit them. Old backups restore fine and migrate on next start.

After deploying:

- Fully close and reopen the app on every phone and tablet, including any open browser tabs and the installed PWA. A tab still running the previous version must not be used to edit recipes: it cannot handle the new step format. (The server rejects the corrupted step text such a tab would send, but the old screens will still misbehave.)

Rolling back:

- Rebuilding the old commit is NOT enough once any recipe has been edited under the new version, because the old version cannot read the new step format.
- Roll back by checking out the old commit AND restoring the pre-upgrade snapshot with the restore command above (stop the app, run the restore with `--force`, rebuild and start the old version). Recipe edits made after the upgrade are lost.

Checks after deploying:

1. Open a recipe's slideshow on a phone and a tablet.
2. Add recipe ingredients to the list and share the list from a phone.
3. Press "Back up now" and confirm step photos appear in the Drive images folder.
4. Do a restore drill (see above).
5. Run the live AI test once with a key: `LIVE_AI=1 npx vitest run server/src/ai/draft.live.test.ts`. It has never been run against the real API, and the AI step-link schema changed.

## Installing as an app

The site is an installable PWA (manifest plus a small service worker that only caches the page shell, built assets and recipe photos, never other API calls). On a phone open the site and use "Add to Home Screen" / "Install app". Icons are generated from `web/public/icon.svg` by `npm run icons`.
