import { createHash } from 'node:crypto';
import { beforeEach, describe, it, expect } from 'vitest';
import { openDb } from '../db.js';
import { createAuthRepo, SESSION_TTL_MS, type AuthRepo } from './repo.js';

const now = new Date('2026-01-01T12:00:00.000Z');
const HOUR = 3600 * 1000;
const at = (base: Date, ms: number) => new Date(base.getTime() + ms);

let db: ReturnType<typeof openDb>;
let repo: AuthRepo;
const lastSeen = () =>
  (db.prepare('SELECT last_seen_at FROM sessions').get() as { last_seen_at: string }).last_seen_at;

beforeEach(() => {
  db = openDb(':memory:');
  repo = createAuthRepo(db);
});

describe('allowlist', () => {
  it('normalises case and whitespace on add and lookup', () => {
    repo.addAllowed('  Foo@Gmail.com ', now);
    expect(repo.isAllowed('foo@gmail.com')).toBe(true);
    expect(repo.isAllowed('FOO@GMAIL.COM')).toBe(true);
    expect(repo.listAllowed()).toEqual([{ email: 'foo@gmail.com', addedAt: now.toISOString() }]);
  });

  it('add is idempotent and keeps the first addedAt', () => {
    repo.addAllowed('foo@gmail.com', now);
    repo.addAllowed('Foo@gmail.com', at(now, HOUR));
    expect(repo.listAllowed()).toEqual([{ email: 'foo@gmail.com', addedAt: now.toISOString() }]);
  });

  it('lists in email order', () => {
    repo.addAllowed('b@x.com', now);
    repo.addAllowed('a@x.com', now);
    expect(repo.listAllowed().map((a) => a.email)).toEqual(['a@x.com', 'b@x.com']);
  });

  it('is not allowed once removed', () => {
    repo.addAllowed('foo@gmail.com', now);
    repo.removeAllowed(' FOO@gmail.com');
    expect(repo.isAllowed('foo@gmail.com')).toBe(false);
  });
});

describe('sessions', () => {
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

  it('issues 64-character hex tokens that differ each time', () => {
    const a = repo.createSession('foo@gmail.com', now);
    const b = repo.createSession('foo@gmail.com', now);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it('returns null for an unknown token', () => expect(repo.sessionEmail('deadbeef', now)).toBeNull());

  it('returns null one millisecond past the absolute TTL, even when last seen recently', () => {
    const token = repo.createSession('foo@gmail.com', now);
    const later = at(now, SESSION_TTL_MS - 1000);
    expect(repo.sessionEmail(token, later)).toBe('foo@gmail.com');
    const past = at(now, SESSION_TTL_MS + 1);
    expect(repo.sessionEmail(token, past)).toBeNull();
  });

  it('is expired exactly at the TTL', () => {
    const token = repo.createSession('foo@gmail.com', now);
    expect(repo.sessionEmail(token, at(now, SESSION_TTL_MS))).toBeNull();
  });

  it('writes last_seen_at at most once a day', () => {
    const token = repo.createSession('foo@gmail.com', now);
    repo.sessionEmail(token, at(now, HOUR));
    expect(lastSeen()).toBe(now.toISOString());
    const later = at(now, 25 * HOUR);
    repo.sessionEmail(token, later);
    expect(lastSeen()).toBe(later.toISOString());
  });

  it('deleteSession signs that token out', () => {
    const token = repo.createSession('foo@gmail.com', now);
    repo.deleteSession(token);
    expect(repo.sessionEmail(token, now)).toBeNull();
  });

  it('removing an address deletes its sessions and leaves other people signed in', () => {
    repo.addAllowed('a@x.com', now);
    repo.addAllowed('b@x.com', now);
    const a = repo.createSession('a@x.com', now);
    const b = repo.createSession('b@x.com', now);
    repo.removeAllowed('a@x.com');
    expect(repo.sessionEmail(a, now)).toBeNull();
    expect(repo.sessionEmail(b, now)).toBe('b@x.com');
  });

  it('pruneSessions deletes only expired rows and reports the count', () => {
    const old = repo.createSession('a@x.com', now);
    const fresh = repo.createSession('a@x.com', at(now, SESSION_TTL_MS));
    expect(repo.pruneSessions(at(now, SESSION_TTL_MS + 1))).toBe(1);
    expect(repo.sessionEmail(old, at(now, 1))).toBeNull();
    expect(repo.sessionEmail(fresh, at(now, SESSION_TTL_MS + 1))).toBe('a@x.com');
  });
});
