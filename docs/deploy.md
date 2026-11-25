# Deploying Recipes

Recipes runs on the Hetzner box (`hetzner`, 46.224.82.225) as its own compose project in `/home/deploy/recipes`. The container listens on `127.0.0.1:3006` only. The host's nginx owns ports 80 and 443 and proxies `recipes.matchapman.dev` to it, with a Let's Encrypt certificate from certbot, exactly as it does for the other sites on that box. Everything is behind Google sign-in: only addresses on the allowlist get in.

The box also runs the unrelated "docwright beta" containers. Nothing here touches them: do not run `docker system prune`, `docker compose down` or anything else outside `/home/deploy/recipes`. The one prune below is `docker builder prune`, which only clears build cache.

## What's new

This release moves Recipes from the LAN box to the public Hetzner server behind nginx, with Google sign-in. Because this branch was rebased onto the LAN box's deployed branch, it also carries that branch's features (brands, grouped tags, prices, shops, ingredient packs, recipe-card photos, a planner and library filters; see "Previous release" below). The LAN data is migrated on first start.

Before upgrading:

- In the running app (on the LAN box, still the old version) open Settings, press "Back up now" and confirm it reports success.
- In Drive open "Recipes backup/snapshots" and note the exact file name of that backup (`recipes-<stamp>.sqlite`, the newest one). Download it, together with the `images/` folder, and keep a copy somewhere safe, with the name written down. The rollback below needs exactly this file, and Drive retention keeps only the newest 14 snapshots, so Drive will eventually delete it.
- Have your own Google address ready for `ALLOWED_EMAILS`, and add the Authorized JavaScript origins in [setup-google.md](setup-google.md).

What changed:

- **Everyone must sign in.** The app had no login before. Set `ALLOWED_EMAILS` in `.env` to your own Google address before the first start. The server refuses to start when that is empty and the allowlist is empty too, and prints `Refusing to start: nobody can sign in. Set ALLOWED_EMAILS in .env to your own Google address.`
- `ALLOWED_EMAILS` is break-glass only: your own address and nobody else. Addresses set there cannot be removed in Settings. Everyone else you want to let in (your wife, say) is added in Settings > "Who can get in", by typing their Google address; they then sign in themselves. The last address and your own address cannot be removed, so you cannot lock yourself out.
- Sessions last 90 days from sign-in and then expire, whatever you do in between. They are stored hashed, so a backup in Drive does not contain usable credentials. Removing someone in Settings ends their access immediately.
- The allowlist is part of the backup, and the backup fingerprint now includes it, so the first nightly backup after this deploy uploads once even if no recipe changed. That and your post-upgrade "Back up now" check create NEWER snapshots, which is why a rollback must name the pre-upgrade file explicitly.
- Signed-out requests to `/api` paths that do not exist now answer 401, not 404. This is deliberate: it stops a signed-out client from finding out which routes exist.
- The app moves from the LAN box to Hetzner behind nginx, replacing the LAN-only Caddy guard (`deploy/recipes.caddy` is gone). Sign-in is what protects it now. The domain, `PUBLIC_BASE_URL` and the Google redirect URI for Drive are unchanged.
- Migration `008_auth.sql` takes the database to schema version 8 (the allowlist and the sessions). It runs on first start, on top of the LAN box's schema version 7. Once it has run, a snapshot taken by the new build cannot be restored into an older build.
- Favourites are part of the backup too, and the backup fingerprint now includes them, so the first nightly backup after this deploy uploads once even if no recipe changed and nobody has starred anything yet. Like the allowlist change above, that and your post-upgrade "Back up now" check create NEWER snapshots, so a rollback must still name the pre-upgrade file explicitly.
- Migration `009_favourites.sql` takes the database to schema version 9 (each person's starred recipes). It runs on first start, on top of schema version 8. Once it has run, a snapshot taken by the new build cannot be restored into an older build; `server/scripts/restore.ts` refuses a snapshot with a newer schema version.
- **Describe your edits.** The recipe editor has a box at the top: type an instruction such as "let it cool for 20 minutes before continuing" and the form comes back revised, with new and reworded steps marked. Nothing is saved until you press Save. It adds one route, `POST /api/ai/revise`, and it needs an AI key set in `.env`: without one the server answers 503 and the editor says so in a plain sentence. There is no migration, no schema change and no new environment variable, so the rollback steps below are unchanged. Saving a revised recipe is an ordinary save, so it changes the backup fingerprint exactly as a manual edit does.

After deploying:

- Every phone and tablet, and the installed app, asks for a Google sign-in once. After that it stays signed in for 90 days. Offline, the installed app keeps working from its cache and does not ask you to sign in.
- Fully close and reopen the installed app so it picks up the new version.

Rolling back:

- Rebuilding the old commit on the data that is now on Hetzner is NOT enough. That database has been migrated to schema version 8, and `server/scripts/restore.ts` refuses a snapshot from a newer app version, so any snapshot taken after this deploy cannot be restored into the old build. The old build also has no login at all.
- The old build must never sit behind the public nginx vhost: it would be a site with no login. Take the Hetzner container down first, and roll back on the LAN box, where it is LAN-only again.
- Recipes added after the upgrade are lost either way.
- The shortest rollback: the LAN `recipes_recipes_data` volume was stopped before the copy, mounted read-only for it, and never migrated, so it is still the pre-upgrade database. Check out the old commit on the LAN box and start it on that volume (steps A below). No download and no restore.
- If that volume is gone, check out the old commit AND restore the pre-upgrade snapshot you noted and downloaded before upgrading (steps B below).
- In the snapshot path, NEVER use the restore command's default. It restores the NEWEST snapshot, which after this deploy is a version-8 one that the old build cannot take.

The quick rollback depends on the existing LAN install: the app's checkout in `/opt/recipes`, its `.env`, the `recipes-app` container and the `recipes_recipes_data` volume. That install was set up before this release and this release does not touch it: step 4 of the first-deploy sequence only stops the container and copies the volume out read-only. Leave all of it in place, untouched, until Hetzner has proven itself (see step 10). Deleting or rebuilding it turns a quick rollback into a restore from Drive.

Steps A (LAN volume intact):

1. Stop the new app so nothing else is writing to Drive: on Hetzner, `docker compose stop recipes` in `/home/deploy/recipes`.
2. Cloudflare (owner): point the `recipes` A record back at the LAN IP.
3. On the LAN box, in `/opt/recipes`, check out the old commit. The old `docker-compose.yml` declares the `studioos-lan-edge` network as external, so make sure it exists: `docker network ls | grep studioos-lan-edge`. If it is missing, bring the Studio OS stack up first (or recreate the network) or compose will refuse to start.
4. Rebuild and start the old version, recreating the container so it gets its normal restart policy back (it was set to `no` at the move): `docker compose up -d --build --force-recreate`.

Steps B (LAN volume gone, restore from the snapshot):

1. Do A1 and A2 above.
2. On the LAN box, put the downloaded pre-upgrade `recipes-<stamp>.sqlite` in a folder (for example `/path/to/downloaded/backup`) together with the `images/` folder from Drive. Ideally the folder holds only that one snapshot.
3. Check out the old commit in `/opt/recipes` and check the `studioos-lan-edge` network as in A3.
4. Restore that exact file, with `--snapshot` and `--force`:

   ```sh
   docker compose run --rm --no-deps -v /path/to/downloaded/backup:/restore:ro recipes npm run restore -- /restore --snapshot recipes-<stamp>.sqlite --force
   ```

5. Rebuild and start the old version: `docker compose up -d --build --force-recreate`.

Do not leave both boxes running. Two instances backing up to one Drive folder is the failure to avoid.

Checks after deploying:

1. Over the SSH tunnel, step 6 of the first-deploy sequence: every route in the list answers 401 except `/api/health`, `/api/auth/config` and `/api/auth/google`.
2. Sign in over https from off the home network. Add a second address in Settings, sign in as that person on another device, then remove them and confirm that device is signed out at its next request.
3. Press "Back up now" and confirm it succeeds without reconnecting Drive.
4. The next morning, confirm a nightly backup ran (Settings shows the last backup).
5. Do a restore drill (see above). Note it restores the newest snapshot by default and replaces the live database, so only do it when you are happy to go back to that backup.

## First deploy, or moving from the LAN box

Who runs what: the `docker` and data steps need only `deploy@hetzner` (and `mat@ubuntu` for the LAN box). The nginx and certbot commands need root, and `deploy` has to type a sudo password for them, so they are for the box's owner to run by hand. The Cloudflare record and the Google Cloud origins are the owner's too.

**The order matters.** The app starts on the loopback address with the sign-in guard already live and `ALLOWED_EMAILS` set, and is checked there. Only after that does DNS move and a certificate get issued. At no step is a Recipes without a login reachable from the internet.

Before you start: do the "Before upgrading" steps in "What's new" above (a "Back up now" and a downloaded copy of the snapshot), and add the Authorized JavaScript origins in [setup-google.md](setup-google.md).

### 1. Prepare the box (as `deploy`)

```sh
ssh deploy@hetzner
docker builder prune -f
df -h /
ss -ltn | grep ':3006 ' || echo "3006 is free"
```

The disk is about 86% full, and most of that is Docker build cache, so the prune is what makes room for the image build. After it, `df` should show well over 10G free. The `ss` line must print `3006 is free`; if something is listening there, stop and pick another host port in `docker-compose.yml` (and in `deploy/recipes.nginx.conf`).

### 2. Put the code and `.env` on the box

From your checkout of this repo (not on the box):

```sh
rsync -a --exclude node_modules --exclude dist --exclude .git --exclude .env ./ deploy@hetzner:/home/deploy/recipes/
```

Copy the `.env` from the LAN box (it holds the Google client and AI keys), then add the allowlist. The LAN project is in `/opt/recipes`:

```sh
ssh mat@ubuntu 'cat /opt/recipes/.env' | ssh deploy@hetzner 'cat > /home/deploy/recipes/.env && chmod 600 /home/deploy/recipes/.env'
ssh deploy@hetzner "printf '\nALLOWED_EMAILS=%s\n' you@gmail.com >> /home/deploy/recipes/.env"
```

Use your own Google address in place of `you@gmail.com`. The LAN `.env` currently has the unedited placeholder `AI_PROVIDER=anthropic|openai|gemini` (copied from the comment in `.env.example`). `server/src/config.ts` logs a warning and ignores an unknown value, so the app still works and uses the first provider that has a key (Claude, then ChatGPT, then Gemini), but do not carry the junk to the new box: edit `/home/deploy/recipes/.env` there and set `AI_PROVIDER` to one of `anthropic`, `openai`, `gemini`, or leave it empty. Then check, on the box, that the file has what it needs:

```sh
grep -E '^(ALLOWED_EMAILS|PUBLIC_BASE_URL|GOOGLE_CLIENT_ID|TZ)=' /home/deploy/recipes/.env
```

Each of the four names must show on its own line, and `GOOGLE_CLIENT_ID=` must have a value after the `=`. If it is empty, sign-in cannot work: the check at step 6 would still pass (`/api/auth/config` answers 200 with a null client ID) and the problem would only appear at step 9, after DNS and the certificate. Fix it now.

`ALLOWED_EMAILS` must appear exactly once and not be empty: with it empty (and an empty allowlist) the server refuses to start, printing `Refusing to start: nobody can sign in. Set ALLOWED_EMAILS in .env to your own Google address.` `PUBLIC_BASE_URL` stays `https://recipes.matchapman.dev`: the domain does not change, so the Google redirect URI for Drive backups stays valid.

### 3. Build, and create the volume without starting

```sh
cd /home/deploy/recipes
docker compose build
docker compose up --no-start
docker volume ls | grep recipes_recipes_data
```

`--no-start` creates the container and the empty `recipes_recipes_data` volume but does not run the app. That matters: if the app started now it would create a fresh empty database, which the data copy would then have to overwrite.

### 4. Copy the data across

The LAN box's volume is `recipes_recipes_data`; the new one on Hetzner has the same name. The copy carries the database, the photos in `images/` **and** `google-token.json`, so Drive stays connected and you do not reconnect it.

First, in the LAN app in your browser, note how many recipes the list shows and open one with a photo, so you can compare after step 9. Then on the LAN box (`ssh mat@ubuntu`), note the photo count:

```sh
docker exec recipes-app sh -c 'ls /data/images | wc -l'
```

Then stop the LAN app. The SQLite file must not be open while it is copied, so do not skip this:

```sh
docker stop recipes-app
docker update --restart=no recipes-app
cd ~
docker run --rm -v recipes_recipes_data:/from:ro -v "$PWD":/out alpine tar -czf /out/recipes-data.tgz -C /from .
ls -lh recipes-data.tgz
```

Now the LAN app is down. From your own machine, stream the tarball to the Hetzner box:

```sh
ssh mat@ubuntu 'cat recipes-data.tgz' | ssh deploy@hetzner 'cat > recipes-data.tgz'
```

On Hetzner (`ssh deploy@hetzner`), unpack it into the new volume and look at what arrived:

```sh
cd ~
docker run --rm -v recipes_recipes_data:/to -v "$PWD":/in:ro alpine tar -xzf /in/recipes-data.tgz -C /to
docker run --rm -v recipes_recipes_data:/to:ro alpine ls -la /to
```

You should see `recipes.sqlite` (plus `recipes.sqlite-wal` and `-shm` if they were present), the `images` directory, and `google-token.json`. Once you are happy, remove the tarballs from both boxes (`rm recipes-data.tgz`); the one on the LAN box is root-owned but sits in your own home directory, so `rm` works.

### 5. Start it, bound to loopback only

```sh
cd /home/deploy/recipes
docker compose start recipes
docker logs recipes-app
docker port recipes-app
ss -ltn | grep ':3006 '
```

The log must not say `Refusing to start`, and `docker port` and `ss` must both show `127.0.0.1:3006`, never `0.0.0.0:3006`. The first start migrates the copied database to schema version 8 (`008_auth.sql`), so this is also the point of no return for that copy; the LAN volume is untouched.

Check the photo files made it. This must match the count you noted on the LAN box (the recipes themselves are checked through the app at step 9):

```sh
docker exec recipes-app sh -c 'ls /data/images | wc -l'
```

And confirm nothing outside the box can reach the port. From your own machine this must fail (connection refused or a timeout), not answer:

```sh
curl -m 5 http://46.224.82.225:3006/api/health
```

### 6. Check the guard over an SSH tunnel

In one terminal on your own machine:

```sh
ssh -N -L 3006:127.0.0.1:3006 deploy@hetzner
```

In another:

Every route the app registers, each with its own method (a wrong method on a real path would reach no route at all, which only proves the catch-all). `:id`-style segments use a dummy value, and `curl` sends no `Origin`, so the same-origin guard lets the mutating calls through to the sign-in guard:

```sh
while read -r m p; do printf '%s %s ' "$m" "$p"; curl -s -o /dev/null -X "$m" -w '%{http_code}\n' "http://127.0.0.1:3006$p"; done <<'EOF'
GET /api/health
GET /api/auth/config
POST /api/auth/google
GET /api/auth/me
POST /api/auth/signout
GET /api/auth/allowed
POST /api/auth/allowed
DELETE /api/auth/allowed/x@example.com
GET /api/recipes
GET /api/recipes/1
POST /api/recipes
PUT /api/recipes/1
DELETE /api/recipes/1
PUT /api/recipes/1/favourite
DELETE /api/recipes/1/favourite
GET /api/tags
GET /api/shopping
POST /api/shopping/add
DELETE /api/shopping/1
DELETE /api/shopping
GET /api/planner/shops
POST /api/planner/shops
PUT /api/planner/shops/1
DELETE /api/planner/shops/1
GET /api/planner/ingredients
PUT /api/planner/ingredient
DELETE /api/planner/ingredient
GET /api/planner/budget
PUT /api/planner/budget
POST /api/planner/add-to-shopping
POST /api/planner/plan
POST /api/images
GET /api/images/1
GET /api/images/1/thumb
POST /api/images/1/crop
POST /api/import
GET /api/ai/status
POST /api/ai/describe
POST /api/ai/revise
POST /api/ai/photos
GET /api/backup/status
POST /api/backup/run
GET /api/backup/google/start
GET /api/backup/google/callback
POST /api/backup/google/disconnect
GET /api/no-such-route
EOF
```

Expected: `GET /api/health` and `GET /api/auth/config` answer `200`; `POST /api/auth/google` is deliberately open (it is the sign-in call) and answers a client error from its own validation, never `200`; **every other line answers `401`**, including `/api/no-such-route`. Any other line answering `200` (or `403`, `404` or `5xx`, which would mean the request never reached the guard) means stop: do not move DNS. The list comes from the route registrations in `server/src/app.ts` and the `register*Routes` functions it calls; when a route is added, add it here. Close the tunnel with Ctrl-C afterwards.

This check is deliberately narrow. The Google sign-in button cannot be used here: `http://127.0.0.1:3006` is not one of the Authorized JavaScript origins on the Google client, and Google only accepts plain http for `localhost` origins you have registered. The sign-in itself is checked at step 9, over https.

### 7. Point DNS at the box (owner, Cloudflare)

Change the `recipes` A record for `matchapman.dev` from the LAN IP to `46.224.82.225`, and set it to **DNS only (grey cloud)**. Grey keeps certificate issuance and renewal working (they use plain HTTP on port 80) and keeps photo uploads out of Cloudflare's request size limit.

Wait until it resolves, from any machine:

```sh
dig +short recipes.matchapman.dev @1.1.1.1
```

It must print `46.224.82.225`. Certbot's check fails if the name does not resolve to this box yet.

### 8. Install the nginx vhost and get the certificate (owner, needs sudo)

As `deploy` on the box (sudo asks for the password). The existing sites in `sites-enabled/` are symlinks into `sites-available/`, and the new one follows the same layout:

```sh
sudo cp /home/deploy/recipes/deploy/recipes.nginx.conf /etc/nginx/sites-available/recipes.matchapman.dev
sudo ln -s /etc/nginx/sites-available/recipes.matchapman.dev /etc/nginx/sites-enabled/recipes.matchapman.dev
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d recipes.matchapman.dev
```

`nginx -t` must say the test is successful before you reload. When certbot asks, choose to redirect HTTP to HTTPS. It adds the `listen 443 ssl` lines, the certificate paths and the redirect to the vhost, the same as it did for `regex-builder.com`. Afterwards `sudo certbot renew --dry-run` confirms renewal will work.

This is the first moment the site is public. The guard has been running and checked since step 6.

### 9. Sign in over https

From a phone off the home wifi, or any machine other than the LAN box: open `https://recipes.matchapman.dev`, sign in with the allowlisted Google account, and check:

1. The recipe list shows the same number of recipes you noted on the LAN app, and a recipe with a photo opens with its photo.
2. Brands and tags: open Filters, pick a Brand and a tag from another group, and confirm the list narrows. Open a recipe and check its brand and grouped tags match the LAN app.
3. Edit a recipe: change a price or tag, save, reload, and confirm it stuck. Then change it back.
4. From photos: add one or two photos of a recipe card from a phone. Confirm a draft appears with a brand, tags and a cropped dish photo, then discard it. This needs a working AI key on the new box.
5. Shopping list: add a recipe's ingredients and confirm they appear.
6. Planner: confirm your shops, ingredient packs and budget came across, plan a couple of recipes, and add the result to the shopping list.
7. Settings > Who can get in lists your address; add anyone else who should have access. To test removal, add a second address, sign in as that person on another device, remove them, and confirm that device is signed out at its next request.
8. Settings shows Drive still connected. Press "Back up now" and confirm success.

If the Google button never appears (a heading and nothing under it), the script or the client is being refused: check *Authorised JavaScript origins* on the OAuth client includes `https://recipes.matchapman.dev` exactly (see `docs/setup-google.md`), and open the browser console on the sign-in page — Google reports the mismatch there. The screen offers a **Try again** button once the load fails outright.

Done means the site is running on Hetzner and you have signed in over https from off the home network.

### 10. The LAN box stays off

**The LAN container stays stopped, and its `recipes_recipes_data` volume stays exactly where it is, as a cold copy.** Do not start it, do not delete it, and do not run `docker compose up` in the old project directory on the LAN box. Two live instances would both back up to the same Drive folder, and the nightly backup overwrites a shared snapshot set. SQLite also has a single writer, and two copies would drift apart. Delete the old volume only after Hetzner has run for a while and has produced a nightly backup.

## Everyday operations

Redeploy after a code change (as `deploy`, in `/home/deploy/recipes`, after syncing the code as in step 2): `docker compose up -d --build`. Logs: `docker logs -f recipes-app`. After an `.env` change: `docker compose up -d --force-recreate`.

## Restoring from a Drive backup

Backups live in the "Recipes backup" folder in Google Drive (`snapshots/` holds `recipes-<YYYYMMDD-HHmmss>.sqlite` plus a readable `.json`; `images/` holds the photos).

**A restore replaces who can get in.** The allowlist and the sessions live in the database, so both become the snapshot's: anyone added to "Who can get in" since that snapshot is gone and has to be added again, and the sessions table is replaced too, so every sign-in made since then is gone and that browser is signed out at its next request. `ALLOWED_EMAILS` from `.env` is re-added at the next start, so that address always comes back — which is why it must be yours.

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

## AI providers

"Describe a recipe" and the page-reading fallback in import can use Claude, ChatGPT (OpenAI) or Gemini. Set any one or more of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `GEMINI_API_KEY` in `.env` (models are `ANTHROPIC_MODEL`, `OPENAI_MODEL`, `GEMINI_MODEL`; the defaults in `.env.example` are cheap ones and can be changed), then restart.

- The first provider with a key is used, in the order Claude, ChatGPT, Gemini. Set `AI_PROVIDER=anthropic|openai|gemini` to try a different one first. An unknown value is ignored with a warning in the log.
- Fallback: if the provider fails because of the provider (key rejected, no credit, rate limit, overloaded or down, timeout) the next provider with a key is tried. A refusal, a recipe that is still invalid after the one retry, or a request error of our own is shown rather than passed on.
- If a later provider fails with something that is not a provider failure (a refusal, invalid output after the retry, or a request error of our own), that is the error you see. Only when every provider fails with a provider failure is the first provider's code reported.
- One overall time limit (`AI_TOTAL_TIMEOUT_MS`, default 100000 ms, minimum 10000) covers the whole request across providers and retries, so a slow provider cannot run past nginx's `proxy_read_timeout` (set to 120s in `deploy/recipes.nginx.conf`; nginx's own default is 60s, which would cut the request off first). The two are a pair: raise one and raise the other. Once less than 15 seconds remain, no further provider or retry is started and the message is "The AI didn't respond. Try again.".
- `OPENAI_REASONING_EFFORT` (default `low`; none, minimal, low, medium, high, xhigh, max) and `GEMINI_THINKING_LEVEL` (default `low`; minimal, low, medium, high) keep reasoning cheap and fast. The values are model-specific and an unsupported one is a 400 error, shown as "AI request failed". If you change `OPENAI_MODEL` to a model without reasoning, set `OPENAI_REASONING_EFFORT=default`; for a Gemini model older than 3 set `GEMINI_THINKING_LEVEL=default` (empty or `default` means the field is not sent).
- A wrong model name (HTTP 404) is reported as "The AI model name isn't available. Check the model setting in .env." and the next provider is tried.
- Settings shows which providers have a key and which is in use (never the keys). Drafts say "Drafted by ..." above the form; that is never saved with the recipe.
- If every provider fails, the page shows a plain message: "The AI account is out of credit. Add credit or switch provider." (no credit), "The AI key was rejected. Check the key in .env." (bad key), "The AI is busy right now. Try again in a minute." (rate limit), or "The AI didn't respond. Try again.". The message follows the first provider tried.
- Quality and the no-invention behaviour can differ by provider, so run the live test for each one you set a key for (it runs once per key present and skips the rest): `LIVE_AI=1 npx vitest run server/src/ai/draft.live.test.ts`.

Describe splits a spoken narrative ("I browned the mince, added an onion, simmered for an hour...") into separate steps in your own words, without adding any detail you didn't say; steps you already list are kept exactly. If you give no dish name it picks a plain title from what you said and flags it in "Check these" ("title chosen from your description").

## Installing as an app

The site is an installable PWA (manifest plus a small service worker that only caches the page shell, built assets and recipe photos, never other API calls). On a phone open the site and use "Add to Home Screen" / "Install app". Icons are generated from `web/public/icon.svg` by `npm run icons`.

## Release history

### Previous release: brands, filters and recipes from photos

Before upgrading, take a backup: open Settings and press "Back up now". If anything goes wrong, "Restoring from a Drive backup" below explains how to roll back (pass `--snapshot` with the pre-upgrade file name so you don't get a newer one).

Upgrade the usual way: pull the branch, then in `/opt/recipes` run `docker compose up -d --build`.

- **Brand and grouped tags.** Migration 007 runs by itself when the container starts. Existing recipes are sorted like this:
  - Recipes you described or wrote yourself get the brand Mine.
  - Link recipes get a brand from the source name they stored. HelloFresh, Gousto and Simply Cook spellings are tidied up; any other site gets its host, for example `bbcgoodfood.com`. Rename it in the edit form; later imports from the same site reuse the new brand.
  - Every existing tag goes under Other.
- **Library filters.** The Filters button opens a sheet with Brand, Cuisine, Meal, Main ingredient and Other. Within one group a recipe matches any of your picks; across groups it must match all of them. Filters are kept while you browse in that tab.
- **From photos.** Add up to 6 photos of a recipe card (front, back, extra pages) from the installed app's camera or photo library. The phone shrinks each photo before upload. The AI suggests the brand and tags only from what is printed on the card, and anything it couldn't read is listed under "Check these". The dish photo is cropped from the card; use Adjust, Use whole photo or Remove. The card photos are kept on the recipe (about 300 KB each).
- **AI models must take images.** From photos needs an AI key whose model accepts images. The defaults in `.env.example` (`claude-sonnet-5-5`, `gpt-6-luna`, `gemini-3.5-flash-lite`) all do (checked against the provider docs on 2026-11-16). If you changed a model, make sure it accepts image input, or From photos moves on to the next provider.
- **Check `AI_PROVIDER` in `.env`.** An invalid value isn't an error: the app quietly uses the first provider with a key (order Claude, ChatGPT, Gemini). Set it to `anthropic`, `openai` or `gemini`, or leave it empty. The LAN box's `.env` has the unedited placeholder; the Hetzner deploy fixes it on the copy (step 2 of the first-deploy sequence).
- **Fully close and reopen the app on every phone after upgrading.** A tab or installed app that stayed open keeps running the old code and can send tags the new server doesn't expect. Swipe the app away completely, then open it again.
- **iPhone photos.** iOS normally gives the browser a JPEG. If a HEIC ever gets through and the phone can't shrink it, the upload may be refused as "not a supported image"; take the photo again with the camera button.

Rolling back:

- An older version can't read the new `{group, name}` tags, so rebuilding the old commit is not enough once the upgrade has run.
- Check out the old commit AND restore the pre-upgrade snapshot explicitly with `--snapshot <name>` (the file you noted before upgrading). Never use the restore default, which picks the newest snapshot, and that one has the new tag format. See "Restoring from a Drive backup" above.
- Edits made after the upgrade are lost.

### Previous release: shopping list and step slides (historical, rollback only)

Kept only because its rollback is the only record of how to get back past the step-format migration. Nothing else from that release applies now. If you roll back past it, do the rollbacks above first, newest first, each time with that release's own pre-upgrade snapshot (which had to be downloaded before that release). These commands run in the project directory on the box you are rolling back on, and the `studioos-lan-edge` network check above applies to them too.

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
