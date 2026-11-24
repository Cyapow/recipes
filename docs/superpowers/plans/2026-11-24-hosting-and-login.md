# Hosting on Hetzner with Google Sign-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Recipes on the public internet at `https://recipes.matchapman.dev` behind a Google sign-in with an email allowlist, so it can be used away from home and shared with one or two other people.

**Architecture:** Authentication lives in the app, not at the edge. A new `server/src/auth/` module holds the schema, an allowlist/session repository, an injectable Google ID-token verifier, the auth routes and a global `onRequest` guard registered right after the existing same-origin guard. The browser gets a sign-in screen using Google Identity Services; the server mints its own opaque session cookie. Hosting changes are a compose port binding, an nginx vhost, and a data copy — no Caddy.

**Tech Stack:** Node 22, Fastify 5, better-sqlite3, `google-auth-library` (already a dependency), React 19 + react-router 7, vitest, Docker Compose, nginx + certbot on Ubuntu 24.04.

**Spec:** `docs/superpowers/specs/2026-11-24-hosting-and-login-design.md`

## Global Constraints

- Session cookie name `recipes_session`; attributes `HttpOnly; SameSite=Lax; Path=/; Max-Age=7776000` plus `; Secure` when `PUBLIC_BASE_URL` starts with `https://` (reuse the existing `secureCookie` convention from `registerBackupRoutes`).
- Session expiry is **absolute, 90 days from `created_at`**, enforced server-side. Never sliding.
- Session tokens: 32 random bytes, hex; **only the sha256 hex digest is stored**.
- Emails are stored and compared lowercased and trimmed.
- `ALLOWED_EMAILS` is break-glass only. Addresses present in it **cannot be removed through the API**.
- **No bypass of the guard in any environment.** No env switch, no test-only flag on the app.
- The allowlist is part of the backup fingerprint. Sessions are not.
- One OAuth client, reused from Drive. No new scopes, no new redirect URI.
- Node >= 22, ESM, `.js` extensions on local imports, 2-space indent, single quotes — match surrounding files.

## Review Focus

Five things the spec implies, that no obvious task test covers, most likely to bite first:

1. **Google returns a differently-cased email** (`Foo@Gmail.com`) than the one typed into the allowlist — sign-in must still match. Test in Task 1.
2. **An ID token minted for a different OAuth client** must be rejected, not trusted because it is a valid Google JWT. Test in Task 3.
3. **A cookie holding an unknown or expired token** (an old device, or a session row from a restored backup) must give a clean 401, never a 500 or a crash. Test in Task 1 and Task 4.
4. **Removing someone who is signed in right now** must end their access on the next request, not when their cookie expires. Test in Task 5.
5. **The PWA's own files must stay open to a signed-out browser** — `/sw.js`, `/manifest.webmanifest`, the icons and `/assets/*`. Guard them and the installed app cannot even render its sign-in screen. Test in Task 4.

---

### Task 1: Schema, allowlist and session store

**Files:**
- Create: `server/src/migrations/008_auth.sql`
- Create: `server/src/auth/repo.ts`
- Test: `server/src/auth/repo.test.ts`

**Interfaces:**
- Consumes: `openDb` from `server/src/db.ts` (migrations run automatically; `latestSchemaVersion` becomes 3).
- Produces:
```ts
export const SESSION_TTL_MS: number;              // 90 * 24 * 3600 * 1000
export function normaliseEmail(email: string): string;
export type AllowedEmail = { email: string; addedAt: string };
export type AuthRepo = {
  listAllowed(): AllowedEmail[];                  // ordered by email
  isAllowed(email: string): boolean;
  addAllowed(email: string, now: Date): void;     // idempotent; keeps the original addedAt
  removeAllowed(email: string): void;             // also deletes that email's sessions
  createSession(email: string, now: Date): string;// returns the RAW token
  sessionEmail(token: string, now: Date): string | null;
  deleteSession(token: string): void;
  pruneSessions(now: Date): number;               // returns rows deleted
};
export function createAuthRepo(db: Database): AuthRepo;
```

- [ ] **Step 1: Write the failing tests** in `server/src/auth/repo.test.ts`, against `createAuthRepo(openDb(':memory:'))`

```ts
it('normalises case and whitespace on add and lookup', () => {
  repo.addAllowed('  Foo@Gmail.com ', now);
  expect(repo.isAllowed('foo@gmail.com')).toBe(true);
  expect(repo.isAllowed('FOO@GMAIL.COM')).toBe(true);
  expect(repo.listAllowed()).toEqual([{ email: 'foo@gmail.com', addedAt: now.toISOString() }]);
});
it('add is idempotent and keeps the first addedAt', () => { /* add twice with two dates, expect length 1 and the first date */ });
it('a fresh session resolves to its email', () => {
  const token = repo.createSession('foo@gmail.com', now);
  expect(repo.sessionEmail(token, now)).toBe('foo@gmail.com');
});
it('stores only the hash of the token', () => {
  const token = repo.createSession('foo@gmail.com', now);
  const rows = db.prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[];
  expect(rows[0]!.token_hash).not.toBe(token);
  expect(rows[0]!.token_hash).toBe(createHash('sha256').update(token).digest('hex'));
});
it('returns null for an unknown token', () => expect(repo.sessionEmail('deadbeef', now)).toBeNull());
it('returns null one millisecond past the absolute TTL, even when last seen recently', () => {
  const token = repo.createSession('foo@gmail.com', now);
  const later = new Date(now.getTime() + SESSION_TTL_MS - 1000);
  expect(repo.sessionEmail(token, later)).toBe('foo@gmail.com');           // bumps last_seen_at
  const past = new Date(now.getTime() + SESSION_TTL_MS + 1);
  expect(repo.sessionEmail(token, past)).toBeNull();
});
it('writes last_seen_at at most once a day', () => { /* two calls an hour apart -> last_seen_at unchanged; one 25h later -> updated */ });
it('removing an address deletes its sessions and leaves other people signed in', () => { /* two emails, two sessions */ });
it('pruneSessions deletes only expired rows and reports the count', () => { /* expect 1 */ });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/src/auth/repo.test.ts`
Expected: FAIL — cannot resolve `./repo.js`

- [ ] **Step 3: Write `server/src/migrations/008_auth.sql`**

Two tables, following `001_init.sql`'s style:
- `allowed_emails(email TEXT PRIMARY KEY, added_at TEXT NOT NULL)`
- `sessions(token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)` plus `CREATE INDEX sessions_email ON sessions (email)` for the revoke-on-remove delete.

No foreign key from `sessions.email` to `allowed_emails`: removal deletes sessions explicitly, and a session must not block a removal.

- [ ] **Step 4: Implement `createAuthRepo(db: Database): AuthRepo` in `server/src/auth/repo.ts`**

Prepared statements in the closure, as `server/src/shopping/repo.ts` does. `createSession` uses `randomBytes(32).toString('hex')` and stores `createHash('sha256').update(token).digest('hex')`. `sessionEmail` selects by hash, rejects when `now - created_at >= SESSION_TTL_MS`, and updates `last_seen_at` only when the stored value is more than 24 hours old. `removeAllowed` runs both deletes in one `db.transaction`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run server/src/auth/repo.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/migrations/008_auth.sql server/src/auth/repo.ts server/src/auth/repo.test.ts
git commit -m "feat: allowlist and session tables with a repo to match"
```

---

### Task 2: Config, env seed and fail-closed boot

**Files:**
- Modify: `server/src/config.ts`
- Create: `server/src/auth/seed.ts`
- Modify: `server/src/index.ts`
- Test: `server/src/auth/seed.test.ts`, `server/src/app.test.ts` (add to the existing `loadConfig` describes)

**Interfaces:**
- Consumes: `AuthRepo`, `normaliseEmail` (Task 1).
- Produces:
```ts
// config.ts: added to Config
allowedEmails: string[];   // normalised, de-duplicated, empty array when unset
// seed.ts
export function seedAllowedEmails(repo: AuthRepo, emails: string[], now: Date): void;
export class AllowlistEmptyError extends Error {}
export function assertAllowlistUsable(repo: AuthRepo, envEmails: string[]): void; // throws AllowlistEmptyError
```

- [ ] **Step 1: Write the failing tests**

In `server/src/app.test.ts`, beside the existing `BACKUP_HOUR` table:

```ts
describe('ALLOWED_EMAILS', () => {
  it.each([
    ['', []],
    ['me@example.com', ['me@example.com']],
    [' Me@Example.com , you@example.com ', ['me@example.com', 'you@example.com']],
    ['me@example.com,me@example.com', ['me@example.com']],
    [',,', []],
  ])('%j -> %j', (v, want) => expect(loadConfig({ ALLOWED_EMAILS: v }).allowedEmails).toEqual(want));
  it('defaults to an empty list', () => expect(loadConfig({}).allowedEmails).toEqual([]));
});
```

In `server/src/auth/seed.test.ts`:

```ts
it('inserts env addresses that are missing', () => { /* seed twice, expect one row each */ });
it('never removes an address added in the app', () => { /* addAllowed('wife@…'), seed with only mat@… , expect both */ });
it('throws when the env list and the table are both empty', () =>
  expect(() => assertAllowlistUsable(repo, [])).toThrow(AllowlistEmptyError));
it('passes when the table has a row but the env list is empty', () => { /* addAllowed, expect no throw */ });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/src/auth/seed.test.ts server/src/app.test.ts`
Expected: FAIL — `allowedEmails` undefined, `./seed.js` unresolved

- [ ] **Step 3: Implement**

`config.ts`: parse `ALLOWED_EMAILS` by splitting on `,`, normalising, dropping empties, de-duplicating while keeping order. `seed.ts`: `seedAllowedEmails` loops `repo.addAllowed`; `assertAllowlistUsable` throws `AllowlistEmptyError` when `envEmails.length === 0 && repo.listAllowed().length === 0`.

- [ ] **Step 4: Wire the boot in `server/src/index.ts`**

After `openDb`, before `buildApp`: build the repo, `seedAllowedEmails(repo, config.allowedEmails, new Date())`, then `assertAllowlistUsable`. Catch `AllowlistEmptyError`, `console.error` this exact message, and `process.exit(1)`:

```
Refusing to start: nobody can sign in. Set ALLOWED_EMAILS in .env to your own Google address.
```

- [ ] **Step 5: Prune expired sessions on the nightly tick**

In the `startBackupSchedule` callback in `server/src/index.ts`, call `repo.pruneSessions(new Date())` before `app.backup.runNow()`. This is the spec's second prune point, and it keeps the table from growing on an instance nobody signs in to often.

- [ ] **Step 6: Run the suite**

Run: `npx vitest run server/src/auth server/src/app.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/src/config.ts server/src/auth/seed.ts server/src/auth/seed.test.ts server/src/index.ts server/src/app.test.ts
git commit -m "feat: seed the allowlist from ALLOWED_EMAILS and refuse to start without one"
```

---

### Task 3: Google ID-token verifier and the sign-in routes

**Files:**
- Create: `server/src/auth/verify.ts`
- Create: `server/src/auth/routes.ts`
- Test: `server/src/auth/routes.test.ts`

**Interfaces:**
- Consumes: `AuthRepo`, `SESSION_TTL_MS` (Task 1); config `googleClientId`, `publicBaseUrl`.
- Produces:
```ts
// verify.ts
export type VerifiedIdentity = { email: string; emailVerified: boolean };
export type IdTokenVerifier = (idToken: string) => Promise<VerifiedIdentity | null>; // null = not a valid token for us
export function createGoogleIdTokenVerifier(clientId: string): IdTokenVerifier;
// routes.ts
export const SESSION_COOKIE = 'recipes_session';
export function sessionCookie(token: string | null, secure: boolean): string; // null = the clearing cookie
export function readSessionCookie(header: string | undefined): string | undefined;
export function registerAuthRoutes(app: FastifyInstance, deps: {
  repo: AuthRepo; verify?: IdTokenVerifier; clientId?: string;
  envEmails: string[]; secureCookie?: boolean; now?: () => number;
}): void;
```

Routes this task adds (the allowlist ones come in Task 5):
- `GET /api/auth/config` → `{ clientId: string | null }`, open.
- `POST /api/auth/google`, body `{ credential: string }`, open. 200 `{ email }` + `Set-Cookie` on success; 400 `{ error: 'Missing credential' }`; 403 `{ error: "This Google account isn't on the list" }` for an invalid token, an unverified email, and a non-allowlisted email alike; 503 `{ error: 'Google client not configured' }` when there is no client ID.
- `GET /api/auth/me` → `{ email }`, needs a session (the guard handles the 401).
- `POST /api/auth/signout` → `{ ok: true }`, deletes the row and clears the cookie.

- [ ] **Step 1: Write the failing tests** in `server/src/auth/routes.test.ts`, injecting a fake verifier

```ts
const fake: IdTokenVerifier = async (t) =>
  t === 'good' ? { email: 'Mat@Example.com', emailVerified: true }
  : t === 'unverified' ? { email: 'mat@example.com', emailVerified: false }
  : t === 'stranger' ? { email: 'stranger@example.com', emailVerified: true }
  : null;

it('signs in an allowlisted address and sets a session cookie', async () => {
  // expect 200, json().email === 'mat@example.com' (lowercased), set-cookie has HttpOnly, SameSite=Lax, Max-Age=7776000
});
it('omits Secure on http and includes it on https', async () => { /* two apps, PUBLIC_BASE_URL http vs https */ });
it('refuses a bad token, an unverified email and a stranger with the same 403 and message', async () => {
  // all three: statusCode 403, json().error === "This Google account isn't on the list"
});
it('rejects a token minted for another OAuth client', async () => {
  // verifier returns null for audience mismatch; expect 403 and no set-cookie
});
it('answers 400 when credential is missing or not a string', async () => { /* {} and { credential: 7 } */ });
it('answers 503 when no client ID is configured', async () => { /* clientId undefined */ });
it('GET /api/auth/config returns the client ID, or null', async () => { /* both cases */ });
it('GET /api/auth/me returns the signed-in email', async () => { /* sign in, replay the cookie */ });
it('POST /api/auth/signout clears the cookie and the row, and the cookie then fails', async () => {
  // after signout: Max-Age=0 in set-cookie, and /api/auth/me with the old cookie is 401
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/src/auth/routes.test.ts`
Expected: FAIL — `./routes.js` unresolved

- [ ] **Step 3: Implement `createGoogleIdTokenVerifier` in `server/src/auth/verify.ts`**

One `OAuth2Client` built once outside the returned function. Call `verifyIdToken({ idToken, audience: clientId })` — passing `audience` is what makes a token for another client fail — then `getPayload()`. Return `null` when the call throws or the payload has no `email`; otherwise `{ email: payload.email, emailVerified: payload.email_verified === true }`. Do not log the token.

- [ ] **Step 4: Implement `registerAuthRoutes` in `server/src/auth/routes.ts`**

Cookie helpers mirror `backup/routes.ts` (`readCookie` there is the pattern, but `Path=/` here). `sessionCookie(null, secure)` returns the same attributes with `Max-Age=0`. The 403 branches must not say which condition failed. A successful sign-in calls `repo.pruneSessions(new Date(now()))` before minting the new one — one of the spec's two prune points, and the cheapest place to put it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run server/src/auth/routes.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/auth/verify.ts server/src/auth/routes.ts server/src/auth/routes.test.ts
git commit -m "feat: sign in with a verified Google ID token and an app session cookie"
```

---

### Task 4: The guard, and every existing test through it

**Files:**
- Create: `server/src/auth/guard.ts`
- Create: `server/src/auth/testing.ts`
- Modify: `server/src/app.ts`
- Test: `server/src/auth/guard.test.ts`
- Modify (test fallout): `server/src/app.test.ts`, `server/src/security.test.ts`, `server/src/recipes/routes.test.ts`, `server/src/shopping/routes.test.ts`, `server/src/images/routes.test.ts`, `server/src/ai/routes.test.ts`, `server/src/import/routes.test.ts`, `server/src/backup/routes.test.ts`

**Interfaces:**
- Consumes: `AuthRepo` (Task 1), `readSessionCookie`, `registerAuthRoutes` (Task 3).
- Produces:
```ts
// guard.ts
export function isOpenPath(pathname: string): boolean;
export function registerAuthGuard(app: FastifyInstance, deps: { repo: AuthRepo; now?: () => number }): void;
// request decoration, used by Task 5's routes
declare module 'fastify' { interface FastifyRequest { email?: string } }
// testing.ts
export function authHeaders(db: Database, email?: string): { cookie: string }; // seeds allowlist + session
```

Open paths: `/api/health`, `/api/auth/config`, `/api/auth/google`, `/sw.js`, `/manifest.webmanifest`, `/favicon.ico`, anything under `/assets/`, any `/icon*.png`, `/apple-touch-icon.png`, `/icon.svg`, and every non-`/api` page route (they return the SPA shell). Everything else needs a session.

- [ ] **Step 1: Write the failing tests** in `server/src/auth/guard.test.ts`

```ts
describe('isOpenPath', () => {
  it.each(['/api/health', '/api/auth/config', '/api/auth/google', '/sw.js', '/manifest.webmanifest',
           '/assets/index-abc123.js', '/icon-192.png', '/apple-touch-icon.png', '/icon.svg',
           '/', '/settings', '/recipe/abc/cook'])('%s is open', (p) => expect(isOpenPath(p)).toBe(true));
  it.each(['/api/recipes', '/api/shopping', '/api/images/upload', '/api/backup/status',
           '/api/auth/me', '/api/auth/allowed'])('%s is guarded', (p) => expect(isOpenPath(p)).toBe(false));
});
it('a guarded API route without a cookie is 401 JSON', async () => {
  // expect 401 and { error: 'Sign in required' }
});
it('a guarded API route with a seeded session passes', async () => { /* headers: authHeaders(db) */ });
it('an unknown or expired cookie is a clean 401, not a 500', async () => {
  // cookie 'recipes_session=deadbeef' -> 401; and a session created 91 days ago -> 401
});
it('a page route still returns the SPA shell when signed out', async () => {
  // webDir with index.html; GET /settings -> 200 containing the shell
});
it('a signed-out multipart upload is 401 before the body is read', async () => {
  // POST /api/images with a multipart payload and no cookie -> 401
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/src/auth/guard.test.ts`
Expected: FAIL — `./guard.js` unresolved

- [ ] **Step 3: Implement `registerAuthGuard`**

An `onRequest` hook, so it runs before body parsing and covers routes added later. Decode with `req.routeOptions.url ?? new URL(req.url, 'http://x').pathname` — the raw URL must be parsed, not prefix-matched, for the same reason `security.ts` avoids a raw-prefix test. On a guarded path with no valid session: `reply.code(401).send({ error: 'Sign in required' })`. On success set `req.email`.

- [ ] **Step 4: Register it in `server/src/app.ts`**

Build the repo once (`createAuthRepo(deps.db)`), then in order: `registerSameOriginGuard`, `registerAuthGuard`, `registerAuthRoutes`, then the existing route registrations. Add an optional `verify?: IdTokenVerifier` to `AppDeps` as a test seam, defaulting to `createGoogleIdTokenVerifier(config.googleClientId)` when a client ID is set.

- [ ] **Step 5: Implement `authHeaders` in `server/src/auth/testing.ts`**

`authHeaders(db, email = 'cook@example.com')` adds the address, creates a session, and returns `{ cookie: \`recipes_session=\${token}\` }`.

- [ ] **Step 6: Bring the eight existing test files through the guard**

Add `headers: authHeaders(db)` to every `app.inject` that calls a guarded route. Mechanical; the guard test above is what proves the rule, so do not add new assertions here. `security.test.ts` keeps testing the cross-site 403 — give those injects a session too, so a 403 can never be mistaken for a 401.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: PASS, no skips

- [ ] **Step 8: Commit**

```bash
git add server/src/auth/guard.ts server/src/auth/guard.test.ts server/src/auth/testing.ts server/src/app.ts server/src/*.test.ts server/src/*/routes.test.ts
git commit -m "feat: require a session for every API route but health and sign-in"
```

---

### Task 5: Managing the allowlist

**Files:**
- Modify: `server/src/auth/routes.ts`
- Test: `server/src/auth/allowlist.test.ts`

**Interfaces:**
- Consumes: `AuthRepo`, `req.email` (Task 4), `deps.envEmails` (Task 3).
- Produces three guarded routes:
  - `GET /api/auth/allowed` → `{ emails: { email: string; addedAt: string; fromEnv: boolean }[] }`
  - `POST /api/auth/allowed`, body `{ email: string }` → `{ ok: true }`; 400 `{ error: "That doesn't look like an email address" }`
  - `DELETE /api/auth/allowed/:email` → `{ ok: true }`; 409 on either refusal

- [ ] **Step 1: Write the failing tests** in `server/src/auth/allowlist.test.ts`

```ts
it('lists addresses with a fromEnv flag', async () => { /* envEmails ['mat@…'], added 'wife@…' */ });
it('adds an address, normalised', async () => { /* post ' Wife@Example.com ' -> list has wife@example.com */ });
it.each(['', 'nope', 'a@b', '@example.com', 'two@@example.com'])('rejects %j with 400', async (email) => {});
it('removing an address revokes its live session on the very next request', async () => {
  // sign wife in, delete her, then her cookie on /api/recipes -> 401
});
it('refuses to remove the last remaining address', async () => {
  // one address only -> 409 { error: 'That is the only address left. Add another first.' }
});
it('refuses to remove your own address', async () => {
  // 409 { error: "That's you. Someone else has to remove your access." }
});
it('refuses to remove an address set in .env', async () => {
  // 409 { error: "That address is set in the server's .env and can't be removed here." }
});
it('removing an unknown address is 404', async () => {});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/src/auth/allowlist.test.ts`
Expected: FAIL — 404 from the unregistered routes

- [ ] **Step 3: Implement the three routes in `server/src/auth/routes.ts`**

Validation is a single permissive check — one `@`, a dot in the domain, no whitespace — not an RFC parser; Google is the real check. Refusal order: env, then self, then last-one-left, so the most specific message wins. `fromEnv` is `deps.envEmails.includes(email)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/src/auth`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/auth/routes.ts server/src/auth/allowlist.test.ts
git commit -m "feat: add and remove allowlisted addresses, with the lockouts refused"
```

---

### Task 6: The allowlist belongs in the backup fingerprint

**Files:**
- Modify: `server/src/backup/fingerprint.ts`
- Modify: `server/src/backup/fingerprint.test.ts`

**Interfaces:**
- Consumes: `createAuthRepo` (Task 1). `computeFingerprint(db, dataDir)` keeps its signature.

- [ ] **Step 1: Write the failing tests**

```ts
it('changes when an address is added to the allowlist', async () => { /* before !== after */ });
it('changes when an address is removed', async () => {});
it('does not change when a session is created or deleted', async () => { /* sessions are not user-meaningful */ });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/src/backup/fingerprint.test.ts`
Expected: FAIL — the first two are equal

- [ ] **Step 3: Implement**

Add the sorted allowlisted emails to the hashed object as `allowed`, beside `recipes` and `images`. Update the comment above `computeFingerprint`: the allowlist is in, sessions are deliberately out.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/src/backup`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/backup/fingerprint.ts server/src/backup/fingerprint.test.ts
git commit -m "feat: include the allowlist in the backup fingerprint"
```

---

### Task 7: Sign-in screen and the auth gate in the browser

**Files:**
- Modify: `web/src/api.ts`
- Create: `web/src/lib/session.ts`
- Create: `web/src/pages/SignIn.tsx`
- Create: `web/src/components/AuthGate.tsx`
- Modify: `web/src/App.tsx`
- Test: `web/src/components/AuthGate.test.tsx`, `web/src/pages/SignIn.test.tsx`

**Interfaces:**
- Consumes: `GET /api/auth/config`, `POST /api/auth/google`, `GET /api/auth/me`, `POST /api/auth/signout` (Task 3); `ApiError.status` from `web/src/api.ts`.
- Produces:
```ts
// api.ts
export function getAuthConfig(): Promise<{ clientId: string | null }>;
export function getMe(): Promise<{ email: string }>;
export function signInWithGoogle(credential: string): Promise<{ email: string }>;
export function signOut(): Promise<void>;
// lib/session.ts
export function wasSignedIn(): boolean;        // localStorage flag 'recipes.signedIn'
export function rememberSignedIn(): void;
export function forgetSignedIn(): void;
// components/AuthGate.tsx
export function AuthGate({ children }: { children: ReactNode }): JSX.Element;
```

`AuthGate` states: `loading` (nothing but a quiet placeholder), `signedIn` (children), `signedOut` (the sign-in screen), `offline` (children plus an offline notice). The rule that matters: a rejected `getMe()` is `signedOut` **only** when it is an `ApiError` with status 401. Any other failure — a network error, the offline case — is `offline` when `wasSignedIn()`, and `signedOut` otherwise.

- [ ] **Step 1: Write the failing tests**

```tsx
// AuthGate.test.tsx
it('renders the app when /api/auth/me succeeds', async () => {});
it('renders the sign-in screen on a 401 and clears the remembered flag', async () => {});
it('keeps the app and shows an offline notice when the call fails with a network error and we were signed in', async () => {
  // getMe rejects with new TypeError('Failed to fetch'); expect the children and /offline/i
});
it('shows the sign-in screen on a network error when we were never signed in', async () => {});

// SignIn.test.tsx
it('posts the credential from the Google callback and remembers the session', async () => {
  // stub window.google.accounts.id, fire the captured callback with { credential: 'good' }
});
it('shows the 403 message from the server without dressing it up', async () => {
  // "This Google account isn't on the list"
});
it('explains it when the server has no client ID configured', async () => { /* clientId null -> no button, a message */ });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run web/src/components/AuthGate.test.tsx web/src/pages/SignIn.test.tsx`
Expected: FAIL — modules unresolved

- [ ] **Step 3: Implement the API functions and `lib/session.ts`**

Follow the existing `request<T>` helper in `api.ts`; it already throws `ApiError` with the status, which is the whole mechanism the gate depends on.

- [ ] **Step 4: Implement `SignIn.tsx`**

Fetch the client ID, inject `<script src="https://accounts.google.com/gsi/client" async>` once (guard against a second insert on re-render), then `google.accounts.id.initialize({ client_id, callback })` and `google.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large' })`. No One Tap — `prompt()` is not called; a deliberate button keeps the flow predictable on a shared kitchen tablet. The callback posts `response.credential` to `signInWithGoogle`, calls `rememberSignedIn()` and reloads the gate. Declare the `window.google` shape locally; do not add a dependency.

- [ ] **Step 5: Implement `AuthGate.tsx` and wrap the routes in `App.tsx`**

`AuthGate` goes inside `BrowserRouter`, around `<Routes>`, so the sign-in screen can use router hooks.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run web/src`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add web/src/api.ts web/src/lib/session.ts web/src/pages/SignIn.tsx web/src/components/AuthGate.tsx web/src/App.tsx web/src/components/AuthGate.test.tsx web/src/pages/SignIn.test.tsx
git commit -m "feat: sign-in screen, and an offline app that does not ask you to sign in"
```

---

### Task 8: Who can get in, in Settings

**Files:**
- Modify: `web/src/api.ts`
- Modify: `web/src/pages/Settings.tsx`
- Test: `web/src/pages/Settings.allowlist.test.tsx`

**Interfaces:**
- Consumes: the three allowlist routes (Task 5), `signOut` (Task 7).
- Produces:
```ts
export type AllowedEmailRow = { email: string; addedAt: string; fromEnv: boolean };
export function listAllowed(): Promise<AllowedEmailRow[]>;   // unwraps the route's { emails } envelope
export function addAllowed(email: string): Promise<void>;
export function removeAllowed(email: string): Promise<void>;
```

- [ ] **Step 1: Write the failing tests**

```tsx
it('lists who can get in, and who you are', async () => {});
it('adds an address and refreshes the list', async () => {});
it('shows the server refusal when a removal is rejected', async () => { /* 409 message rendered verbatim */ });
it('has no remove button for an address set in .env', async () => {});
it('confirms before removing, and does nothing when dismissed', async () => { /* window.confirm pattern, as disconnect() uses */ });
it('signs out', async () => {});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run web/src/pages/Settings.allowlist.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement a "Who can get in" section in `Settings.tsx`**

Place it above "Google Drive", since it now governs who can reach those controls. Reuse the page's existing `actionError` pattern for failures, and `window.confirm` for a removal, as `disconnect()` does. A "Sign out" button goes in the page header area.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run web/src`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/api.ts web/src/pages/Settings.tsx web/src/pages/Settings.allowlist.test.tsx
git commit -m "feat: manage who can get in from Settings"
```

---

### Task 9: Hosting on Hetzner

**Files:**
- Modify: `docker-compose.yml`
- Create: `deploy/recipes.nginx.conf`
- Delete: `deploy/recipes.caddy`
- Modify: `.env.example`
- Modify: `docs/deploy.md`, `docs/setup-google.md`

This task ships the repo changes and the runbook. The box steps themselves are executed afterwards, split as the spec's "Who does what" table sets out: Claude runs the docker and data steps over SSH as `deploy@hetzner`; Mat runs the nginx and certbot commands (root), the Cloudflare A record, and the Google Cloud origins.

- [ ] **Step 1: Change `docker-compose.yml`**

Drop the `networks` key on the service and the external `edge` network block. Add `ports: ['127.0.0.1:3006:3000']`. Keep the volume, `env_file`, `TZ`, `restart`, and the Watchtower label.

- [ ] **Step 2: Write `deploy/recipes.nginx.conf`**

A single `server` block for `recipes.matchapman.dev`: `proxy_pass http://127.0.0.1:3006`, `proxy_set_header Host $host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto $scheme`, and `client_max_body_size 25m` so photo uploads are not truncated. Leave TLS out of the file — `certbot --nginx` writes the `listen 443 ssl` lines, exactly as `/etc/nginx/sites-enabled/regex-builder.com` shows.

- [ ] **Step 3: Delete `deploy/recipes.caddy`**

Nothing fronts this app with Caddy again. The LAN-only guard it carried is replaced by sign-in.

- [ ] **Step 4: Update `.env.example`**

Add `ALLOWED_EMAILS=` with a comment: your own Google address, comma-separated if more; break-glass only, since addresses set here cannot be removed in Settings; the app refuses to start when this is empty and the allowlist is too.

- [ ] **Step 5: Rewrite the deployment sections**

`docs/deploy.md`: replace the LAN/Caddy steps with the Hetzner sequence from the spec in this order — prune build cache, build and start bound to `127.0.0.1:3006`, copy the data across, check over an SSH tunnel that every `/api` route 401s, then DNS, then the nginx vhost, then `certbot --nginx -d recipes.matchapman.dev`, then sign in over https. Give the exact `docker run --rm -v recipes_recipes_data:/from -v …` tar commands for both ends. State plainly that the LAN container stays stopped and its volume untouched: two instances backing up to one Drive folder is the failure to avoid.

`docs/setup-google.md`: delete the "Security note" section — the app has a login now — and add the Authorized JavaScript origins step (`https://recipes.matchapman.dev` and `http://localhost:3000`), noting no new client, scope or redirect URI is needed.

Both docs get a "What's new in this release" entry in the existing style: everyone must sign in; the first nightly backup after this deploy uploads once because the fingerprint now includes the allowlist; and anyone you want in must be added in Settings.

It also needs the rollback paragraph this repo writes every release. Migration `008_auth.sql` takes the schema to `user_version` 8, and `server/scripts/restore.ts` refuses a snapshot from a newer app version — so a snapshot taken after this deploy cannot be restored into the old build. Rolling back means checking out the old commit **and** restoring the pre-upgrade snapshot, which must be downloaded and its filename written down *before* deploying, exactly as the previous release's section instructs. Recipes added after the upgrade are lost in that case.

- [ ] **Step 6: Verify the build and the whole suite**

Run: `npm run build && npm test`
Expected: both pass

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml deploy/recipes.nginx.conf .env.example docs/deploy.md docs/setup-google.md
git rm deploy/recipes.caddy
git commit -m "feat: host on Hetzner behind nginx instead of the LAN-only Caddy"
```
