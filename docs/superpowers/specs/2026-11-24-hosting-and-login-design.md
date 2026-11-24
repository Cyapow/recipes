# Recipes: public hosting on Hetzner, with Google sign-in

Date: 2026-11-24

## Intent

Today Recipes runs on the LAN box (`ubuntu`, 10.0.0.22) in the Studio OS Docker stack,
behind a Caddy block that answers `403 Forbidden — LAN access only` to anything outside
10.0.0.0/24. It has no login, because it does not need one: reaching it at all is the
access control.

Mat wants to use it away from home — on a phone, in a shop, at someone else's house. That
means the site has to answer requests from the open internet, which removes the only thing
currently protecting it. So the site gets a real front door at the same time: sign in with
Google, and only addresses on an allowlist get in.

He also wants to let his wife in, and possibly others later. They share one recipe box:
the same recipes, the same shopping list, the same photos. Not a copy each.

## Goals

- Recipes reachable from anywhere at `https://recipes.matchapman.dev`, over TLS.
- Nobody who is not on the allowlist can read or change anything.
- Mat can add and remove addresses himself, in the app, without a deploy.
- Everyone who is let in can do everything Mat can do — including Settings, Drive and the
  AI providers. One list, no roles. (Mat's explicit choice; option 2 below offered an
  owner-only Settings and he declined it.)
- The existing recipes, photos, shopping list and Drive connection survive the move intact.
- The PWA keeps working: installed to the home screen, offline shell, cached photos.

## Non-goals

- Roles, permissions or an owner concept beyond the seed address.
- Per-user recipe collections, private recipes, "who added this".
- Email invitations. Adding someone means typing their Google address into Settings; they
  then sign in themselves.
- Passwords, magic links, or any identity provider other than Google.
- Keeping the LAN box as a second live instance.
- Rate limiting, brute-force lockouts, audit logs, 2FA.

## Anti-goals

These make the work a failure even if the feature works:

- **A window where the site is public with no login.** The allowlist must be in force on
  the first boot that faces the internet, before DNS points anywhere near Hetzner.
- **Losing recipes or photos in the move.** The LAN data volume must still exist,
  untouched, after Hetzner is live.
- **Two instances backing up to the same Drive folder.** SQLite has one writer, and the
  nightly backup overwrites a shared snapshot set. The LAN container stops before the
  Hetzner one takes over.
- **Being locked out of our own site.** Every path that could empty the allowlist must be
  refused.

## Constraints found on the box

- `hetzner` is 46.224.82.225, Ubuntu 24.04.5, and already runs the docwright beta stack
  (`beta-*` containers: web, api, admin, pdf-renderer, postgres, redis) via
  `/home/deploy/docwright/docker-compose.dev.yml`.
- **nginx owns ports 80 and 443 on the host**, not Caddy (`systemctl is-active caddy` →
  inactive). `sites-enabled` holds `default`, `dwbeta.conf`, `regex-builder.com`. Every
  docwright container binds to `127.0.0.1:300x` and nginx proxies to it. Recipes follows
  that pattern. `deploy/recipes.caddy` does not transfer.
- There is no `studioos-lan-edge` network on Hetzner, and no reason to create one.
- **Disk is 86% full** (75G total, 11G free) — but 52.24G of that is Docker build cache
  with 44G reclaimable. Prune before building, or the image build will fail on space.
- 7.5G RAM, 6.4G available. Fine for one Node process plus SQLite.
- The domain does not change, so `PUBLIC_BASE_URL` stays
  `https://recipes.matchapman.dev` and the Google OAuth **redirect URI for Drive backups
  stays valid**. No Google Cloud change is needed for backups.
- The LAN box still holds the live data in Docker volume `recipes_recipes_data`.

## Approaches considered

### A. nginx vhost + Google sign-in inside the app — chosen

Recipes runs as its own compose project on Hetzner, bound to `127.0.0.1`, fronted by a new
nginx vhost with a certbot certificate, exactly like `regex-builder.com`. Authentication is
part of the application: a sign-in screen, a Google Identity Services button, an ID token
verified server-side with `google-auth-library` (already a dependency for Drive), a session
cookie the app issues itself, and an allowlist table in the SQLite file edited from
Settings.

Trade-off: the only approach where we write authentication code. In exchange the app knows
who is signed in, the allowlist sits in Settings beside the Drive controls, it rides along
in the nightly backup, and nothing third-party sits between the browser and the app — which
matters for an installed PWA with a service worker.

### B. Cloudflare Tunnel + Cloudflare Access — rejected

`cloudflared` container, no inbound port, no certificate, no DNS record to maintain. Access
handles the Google login and the email allowlist in Cloudflare's dashboard. No auth code at
all.

Rejected because household access would then be managed in a Cloudflare dashboard rather
than in the app, and because Access re-authentication is a redirect to a Cloudflare login
page. A service-worker PWA handles that badly: a session expiring mid-cook surfaces as an
opaque failure rather than a clean "sign in again". The app would also have no idea who is
using it, so "invite my wife" becomes a dashboard chore.

### C. oauth2-proxy container behind nginx — rejected

A middle ground: no app code, allowlist in environment variables. Rejected because it needs
a second Google OAuth client and another container to keep alive, and it shares B's problem
of an app that cannot tell who is using it, without B's no-open-port benefit.

## The design

### Hosting

- **New compose project on Hetzner**, at `/home/deploy/recipes` (matching docwright's
  layout). `docker-compose.yml` changes: drop the external `studioos-lan-edge` network, and
  publish `127.0.0.1:3006:3000`. The named volume `recipes_data` and the `TZ` handling stay
  as they are.
- **nginx vhost** `deploy/recipes.nginx.conf`, installed into
  `/etc/nginx/sites-available/recipes.matchapman.dev` and symlinked into `sites-enabled`:
  `server_name recipes.matchapman.dev`, `proxy_pass http://127.0.0.1:3006`, standard
  `X-Forwarded-*` headers, and `client_max_body_size 25m` so recipe photo uploads are not
  cut off by the proxy. TLS from certbot, the same way `regex-builder.com` gets it.
- **DNS**: the Cloudflare A record for `recipes.matchapman.dev` moves from the LAN IP to
  46.224.82.225, **DNS-only (grey cloud)**. Grey cloud keeps HTTP-01 certificate renewal
  working and keeps photo uploads out of Cloudflare's request size limit.
- `deploy/recipes.caddy` is deleted. Nothing will front this app with Caddy again.
- **Build space**: `docker builder prune -f` on the box before the first build.
- **Data move** (in this order):
  1. On the LAN box, open Settings and press "Back up now". Confirm success. This is the
     safety net, not the migration path.
  2. `docker compose stop recipes` on the LAN box. Nothing may hold the SQLite file open
     while it is copied.
  3. `tar` the `recipes_recipes_data` volume through a throwaway container, copy the
     tarball to Hetzner, and unpack it into the new project's `recipes_data` volume the
     same way. This copies the database, the WAL files, the photos **and**
     `google-token.json`, so Drive stays connected with no reconnect.
  4. Start on Hetzner, check the recipe count and a few photos, then flip DNS.
  5. Leave the LAN container stopped and its volume in place as a cold copy. Do not delete
     it until Hetzner has run for a while and produced a nightly backup.

### Sign-in

- **Migration `003_auth.sql`**:
  - `allowed_emails(email TEXT PRIMARY KEY, added_at TEXT NOT NULL)` — email stored
    lowercased.
  - `sessions(token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL)`.
- **Session tokens are stored hashed** (sha256 of a 32-byte random token). The SQLite file
  is uploaded to Drive every night; raw tokens in a backup would be live credentials to the
  site.
- **Expiry is absolute: 90 days from `created_at`, enforced server-side**, matching the
  cookie's `Max-Age`. Not sliding — a sliding window would mean a SQLite write on every
  authenticated request, and it would let a token lifted from a device or an old snapshot
  live forever. `last_seen_at` is written at most once a day per session (it is for "is this
  device still in use", not accounting), so the guard's hot path stays read-only almost
  always. Expired rows are deleted on each sign-in and on the nightly backup tick, so the
  table cannot grow without bound.
- **Seed from the environment.** New `.env` value `ALLOWED_EMAILS` (comma-separated). At
  boot, every address in it is inserted into `allowed_emails` if missing. It never removes
  anything. This is the way back in if the table is ever emptied by hand.
- **`ALLOWED_EMAILS` is break-glass only: Mat's own address, nothing else.** Everyone else
  is added in Settings. Addresses that are in the environment **cannot be removed in the
  UI** — the remove button refuses them with "this address is set in the server's .env".
  Without that rule the seed would silently re-add a removed person on the next restart
  while their sessions stayed deleted: a UI that lies. The server knows its own environment
  at runtime, so this needs no marker column and no schema change.
- **Fail closed at boot.** If `ALLOWED_EMAILS` is empty *and* `allowed_emails` has no rows,
  the server logs what is wrong and exits rather than serving. A public instance with an
  empty allowlist is the one outcome we cannot risk.
- **Sign-in flow**: `/signin` in the SPA shows a Google Identity Services button. The
  returned ID token is POSTed to `/api/auth/google`. The server verifies it with
  `OAuth2Client.verifyIdToken` against `GOOGLE_CLIENT_ID`, requires `email_verified`, and
  looks the lowercased email up in `allowed_emails`. On a match it mints a session and sets
  cookie `recipes_session`: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=90 days`. On no
  match it answers 403 with "This Google account isn't on the list" — the same message
  whether or not the address exists, so the endpoint does not confirm who is allowed.
  `Secure` follows the existing `secureCookie` convention (on when `PUBLIC_BASE_URL` is
  https), so local http development still works.
- **Reusing the existing Google client.** Identity Services needs no new OAuth client and
  no new redirect URI — only `https://recipes.matchapman.dev` added as an **Authorized
  JavaScript origin** on the existing one. No new scopes: an ID token carries the email.
- **The client ID reaches the browser** from a new unauthenticated `GET /api/auth/config`
  returning `{ clientId }`, rather than being baked into the bundle at build time. One
  source of truth in `.env`, and the Docker image stays environment-independent. The client
  ID is public by design.
- **The guard** is an `onRequest` hook registered straight after the existing same-origin
  guard, so it covers every route including ones added later. Open without a session:
  `/api/health`, `/api/auth/config`, `/api/auth/google`, static assets, `sw.js`, the
  manifest and icons. Everything else under `/api` answers `401 {"error":"Sign in
  required"}`.
- **Page routes keep returning the SPA shell** — the server never 302s a navigation to
  `/signin`. The shell asks `GET /api/auth/me`; a 401 renders the sign-in screen. This keeps
  the service worker's offline shell and the installed PWA working, and it is why approach
  A was chosen over the edge-auth options.
- **`web/src/api.ts`**: `ApiError` already carries the status, so the app treats a 401 from
  any call as "signed out" and shows the sign-in screen rather than an error.
- **Offline is not signed out.** Offline, `GET /api/auth/me` fails with a network error, not
  a 401 — and the cached shell exists precisely for that case. Only a real 401 shows the
  sign-in screen. A network failure keeps the last-known signed-in UI (a plain flag in
  `localStorage`, written on successful sign-in and cleared on 401 or sign-out) and shows an
  offline notice. Anything needing the network fails as it does today. Without this rule the
  installed app would demand a sign-in it cannot perform every time the wifi drops, which
  breaks the offline-shell goal.
- **Other endpoints**: `GET /api/auth/me` → `{ email }` or 401. `POST /api/auth/signout`
  deletes the session row and clears the cookie.
- **Allowlist UI in Settings**, next to the Drive controls: the current addresses, an add
  field, a remove button per address. Removing an address also deletes that address's
  sessions, so access ends immediately rather than when a cookie expires.
- **Two removals are refused**: the last remaining address, and your own address. Both are
  lockouts, and the second is the easy accident. `ALLOWED_EMAILS` remains the way back from
  a hand-edited database.
- **The allowlist goes into the backup fingerprint; sessions do not.**
  `server/src/backup/fingerprint.ts` covers recipes and image names today, and its own
  comment states the rule: anything user-meaningful added later must be added to it. The
  allowlist qualifies. Leaving it out would mean an allowlist edit never triggers an upload,
  so on a quiet week it would never reach Drive at all — and a restore would then quietly
  resurrect the old list, including someone who had been removed. Sessions stay out: they
  change constantly and mean nothing after a restore. This changes `fingerprint.ts`, its
  tests, and the release note.
- **No bypass of the guard, in tests or in development.** An env switch that turns login
  off is exactly the thing the "no login-less window" anti-goal exists to forbid, and it
  would sit in the same `.env` that gets edited on a public box. Consequence, which is real
  work: around a hundred `inject` calls across eight server test files
  (`recipes/`, `shopping/`, `backup/`, `images/`, `ai/`, `import/routes.test.ts`,
  `app.test.ts`, `security.test.ts`) currently call `/api` with no session. They go through a
  shared test helper that seeds an allowed address plus a session row and returns the cookie.
  Local `npm run dev` needs its own `ALLOWED_EMAILS` and `http://localhost:3000` added as an
  Authorized JavaScript origin (see below).
- **Tests** follow the existing seam style (`deps.google`, `deps.driveFactory`): the token
  verifier is injected, so auth is tested with vitest and no live Google call. Cover a
  verified allowlisted email, a verified non-allowlisted one, an unverified email, a bad
  token, an expired/unknown session cookie, the guard's open and closed routes, both
  refused removals, and session revocation on removal.

### Who does what

SSH access as it stands: `deploy@hetzner`, in the `docker` group, **sudo needs a password**;
`mat@ubuntu` on the LAN box, docker usable. So the split is:

| Step | Who |
|------|-----|
| All code, tests, compose and config changes in the repo | Claude |
| `docker builder prune`, image build, container start/stop on both boxes | Claude, over SSH |
| Tar the LAN volume across into the Hetzner `recipes_data` volume | Claude, over SSH |
| Write `.env` on the box (incl. `ALLOWED_EMAILS`) | Claude, over SSH |
| Install the nginx vhost, reload nginx, run `certbot --nginx` | Mat — needs root; Claude supplies the exact commands to paste |
| Cloudflare A record → 46.224.82.225, DNS-only | Mat |
| Authorized JavaScript origins on the Google OAuth client | Mat |

Done means the site is running on Hetzner and Mat has signed into it over https from off
the home network.

### Changes Mat makes in Google Cloud

No new OAuth client, no new scopes, no change to the Drive redirect URI. On the existing
client, under **Authorized JavaScript origins**, add:

- `https://recipes.matchapman.dev` — the live site.
- `http://localhost:3000` — local development. Identity Services only permits http for
  `localhost`; a raw IP or a plain-http hostname is refused, which is why nothing can be
  signed into before the certificate exists.

### Order of work

Authentication is built and tested locally first, against a local run. Then:

1. Copy the data to Hetzner (see above) and start the container there. It binds
   `127.0.0.1:3006` only, so nothing outside the box can reach it yet, and its **first boot
   already has `ALLOWED_EMAILS` set and the guard in place**.
2. Check it through an SSH tunnel to `127.0.0.1:3006`. This check is deliberately narrow:
   every `/api` route answers 401 without a cookie, and the server did not fail closed at
   boot. The sign-in button itself cannot be exercised here — Identity Services refuses
   plain-http and raw-IP origins — so the full flow is tested locally beforehand and
   re-checked at step 4.
3. Move the DNS record to 46.224.82.225, add the nginx vhost, then issue the certificate
   with `certbot --nginx` (HTTP-01, so the record must already resolve — this is the same
   pattern `regex-builder.com` uses, no DNS-01 plugin and no Cloudflare token needed on this
   box).
4. Sign in over https and check it properly.

Public exposure begins at step 3, by which point the guard has already been running and
verified. There is no step in which a login-less Recipes answers on a public address.

### Documentation

`docs/deploy.md` gains a Hetzner section (nginx, not Caddy) and replaces the LAN-only
guard instructions. `docs/setup-google.md` loses its "The app has no login" security note,
which stops being true, and gains the Authorized JavaScript origin step and the
`ALLOWED_EMAILS` seed. Both get a "what's new in this release" entry in the existing style,
including the fact that everyone must sign in after this deploy.

## Left to the builder

- Host port: 3006 is free on the box today (nothing listening); confirm again at deploy
  time.
- Exact nginx server block, following `regex-builder.com` rather than inventing a second
  pattern: a plain `server` block plus `listen 443 ssl http2` and the certbot-managed
  `ssl_certificate` / `options-ssl-nginx.conf` / `ssl_dhparam` lines. certbot is the apt
  build at `/usr/bin/certbot` with the nginx plugin (`certbot --nginx -d
  recipes.matchapman.dev` writes those lines and the port-80 redirect), so the DNS record
  must point at the box before the certificate is issued — issue it, then verify, then tell
  people the address.
- Whether the sign-in screen needs any change to `sw.js`. It likely does not: navigations
  are network-first and `/api/auth/*` is not intercepted.
- Known and accepted: a signed-out browser with a warm cache can still show photos already
  in its own service-worker cache. They are that device's own cached images, and the data
  behind them is not reachable.
- Where the allowlist UI sits within the existing Settings page layout.
