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
   - Images already present are skipped; recipes referencing images missing from the backup are counted in a warning.
   - Outside Docker: `npm run restore -- <backupDir> [--data-dir <dir>] [--force]` (`--data-dir` defaults to `$DATA_DIR`, else `/data`).

4. Start the app again:

   ```sh
   docker compose start recipes
   ```

5. Google Drive is not restored (the token is deliberately not part of a backup): open Settings and connect Drive again.

## Installing as an app

The site is an installable PWA (manifest plus a small service worker that only caches the page shell, built assets and recipe photos, never other API calls). On a phone open the site and use "Add to Home Screen" / "Install app". Icons are generated from `web/public/icon.svg` by `npm run icons`.
