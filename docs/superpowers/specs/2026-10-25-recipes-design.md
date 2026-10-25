# Recipes: design and plan

Size: a project with a written design. Plan mode is on, so this lives in the plan file instead of `docs/superpowers/specs/`. After approval, copy the Design section to `docs/superpowers/specs/2026-10-25-recipes-design.md` in the repo.

## Context

Mat cooked a spag bol the night before that the whole household liked, and wants to keep exactly how it was made. Nowhere good to store recipes today. Wants a personal recipe book that runs at home, takes recipes in the easiest way possible (say it out loud to an AI, or paste a link), and is pleasant to cook from on a phone or tablet propped on the counter.

## Design

### Intent
A private household recipe book. Capture "what I actually did" with almost no effort, keep other people's recipes alongside, and cook from it without the screen locking.

### Goals
- Add a recipe by describing it in plain words; the AI turns it into a structured recipe the user reviews and saves.
- Add a recipe from a URL; it is parsed and stored (with source link and image), editable afterwards.
- Add or edit by hand.
- Library: search, filter All / Mine / From elsewhere, free-form tags, image thumbnails.
- Cooking view with a "Keep screen on" toggle (Screen Wake Lock). Ingredients visible, steps large and one at a time.
- Phone and tablet first; works on desktop.
- Nightly automatic backup of the database and all images to the user's personal Google Drive; the Google account is chosen in the app, not hardcoded.
- Runs on the Ubuntu box at `https://recipes.matchapman.dev`, home wifi only, no login.

### Non-goals
Login or multi-user, public or remote access, meal planning, shopping lists, nutrition data, scaling quantities, sharing or export UI, restore UI, "tweak with AI" on saved recipes (all fine later, not v1).

### Anti-goals (a failure even if it technically works)
- AI saves without the user seeing it first.
- AI invents quantities, ingredients, or steps the user never said. Gaps are flagged ("quantity not given"), not filled.
- Backups that silently stop working. Last-run status must be visible and a failure must be obvious.
- Screen stays awake after leaving the cooking view or closing the tab.
- Any data only existing in one place with no backup path.

### Recipe shape
Title, short description, origin (`mine` | `other`), source name (e.g. "bbcgoodfood.com", "Mum"), source URL, servings, prep and cook minutes, ingredients (ordered, optional group headings, each: quantity, unit, item, note), steps (ordered text), notes, tags, one or more images, created/updated. Metric/UK units by default (my call).

### Adding recipes
1. Describe: a big text box (phone dictation works through the keyboard). Server sends the text to Claude with a structured-output schema; result opens in the normal editor pre-filled, nothing saved until the user taps Save. Origin defaults to `mine`.
2. URL import: server fetches the page, first tries schema.org `Recipe` JSON-LD (free, accurate), falls back to Claude extraction from the page text. Downloads the main image into local storage. Origin defaults to `other`, source URL and site name filled. Server-side fetch blocks private/loopback addresses.
3. Manual: the same editor, empty.

### Cooking view
Mockups were reviewed and approved: library (search, Import and Describe buttons, All/Mine/From elsewhere chips, tag chips, rows with thumbnail) and cooking screen (back/edit header, green "Keep screen on" toggle row, ingredients block, "Step n of N" card, Back / Next step buttons). Toggle state is remembered per device (my call). Wake lock is re-acquired when the tab becomes visible again and released on leaving the view. If the browser lacks the API, show a short note instead of a dead toggle.

### Backup
- Settings page: "Connect Google account" (OAuth, scope `drive.file`), shows connected account, folder, last run, last result, and a "Back up now" button.
- Nightly job (time configurable, default 03:00): consistent SQLite snapshot plus a JSON dump to a "Recipes backup" folder; images uploaded incrementally (by content hash, only new ones); keep the last 14 snapshots.
- Why OAuth and not a service account: service accounts have no storage quota on personal Drive.
- Gotcha for the builder and the setup doc: a Google Cloud OAuth app left in "Testing" issues refresh tokens that expire after 7 days. The app must be set to "In production" (unverified is fine for one user) or backups die silently after a week. Redirect URI: `https://recipes.matchapman.dev/api/backup/google/callback`.
- Restore is a documented script/CLI, not UI.

### Constraints
- Single household, LAN only, no auth. Protect with the same LAN-only Caddy guard Studio OS uses.
- Deploy mirrors Studio OS co-location: Docker Compose service on the shared `edge` network, no published host ports, a `recipes.caddy` site block for `recipes.matchapman.dev` in the fronting Caddy's `sites/` dir (Cloudflare DNS-01 wildcard cert via `CF_API_TOKEN`, LAN-only `remote_ip` matcher), DNS record pointing at the box's LAN IP. Reference: `/Users/mat/Code/claude/studio-os/deploy/lan/shared-caddy/studioos.caddy` and `deploy/lan/docker-compose.yml`. HTTPS is required, since Wake Lock only works in a secure context.
- All persistent data in one mounted volume (`/data`): SQLite file and images.
- Secrets (Anthropic key, Google client id/secret, tokens) via env/`.env`, never committed.

### Decided by Mat after the builder check
- Deploy: build on the box. Repo is copied or git-pulled to the box and run with `docker compose up -d --build`. No registry or CI.
- The shared Caddy with the Cloudflare token is already running on the box, so this project only adds a `recipes.caddy` site block and a DNS record.
- No Google Cloud OAuth client exists yet. The plan includes a short setup guide for creating one (in "Production" publishing status, see Backup). Until it exists, the backup slice is tested against a fake Drive.

### More of my calls from the builder check (change if wrong)
- The "don't invent anything, flag gaps" rule applies to URL-import AI extraction too.
- If a URL isn't a usable recipe (JS-only, paywalled, blocked, no recipe), show a clear message and open an empty editor with the source URL and site name filled in.
- The app works fine with Google unconnected. A persistent "Not backed up" banner shows on the library page until it's connected.
- A banner also shows on the library page if the last backup failed, or if there's been no successful backup in over 36 hours (covers the job not running at all or a revoked token). No email or push alerts in v1.

### My calls (not yet confirmed by Mat)
- Stack: Node + TypeScript, Fastify API, SQLite (better-sqlite3), React + Vite PWA served by the same process, one container.
- AI: Claude API with `ANTHROPIC_API_KEY`; model name configurable via env, default `claude-sonnet-5-5`.
- Metric units; toggle remembered per device; keep 14 snapshots; backup at 03:00.
- PWA installable on phone home screen.

### Left to the builder
Exact libraries, schema/migrations, editor UX details, image resizing, tag UI, setup doc wording, test approach, container layout.

## Plan (after approval)
1. Copy Design to the repo spec path; invoke superpowers:writing-plans to produce the step plan.
2. Build order (vertical slices): scaffold + Docker + Caddy block serving "hello" over HTTPS on the box (build on the box via compose); recipe CRUD + library UI; cooking view + wake lock; describe-with-AI; URL import; images; backup to Drive; setup docs.

## Verification
- Unit tests: JSON-LD parser on saved real recipe pages, AI draft schema validation, backup incremental-upload logic with a fake Drive.
- Manual on phone and tablet over `https://recipes.matchapman.dev`: toggle keeps screen awake (leave idle past lock timeout), releases on leaving; describe the spag bol and confirm no invented items; import a BBC Good Food URL; add photo from camera.
- Backup: connect Google, "Back up now", confirm folder contents in Drive; simulate failure and confirm status shows it; confirm restore script rebuilds a working DB from a snapshot.
