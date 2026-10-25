import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db.js';
import { deriveBanner, getBackupStatus, recordBackup } from './status.js';

const now = new Date('2026-03-10T12:00:00Z');
const hAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
const base = { connected: true as const, connectedSince: null, lastRunAt: null, lastSuccessAt: null, lastError: null };

describe('status store', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); });
  it('starts empty, records failure then success (clearing the error)', () => {
    expect(getBackupStatus(db)).toEqual({ lastRunAt: null, lastSuccessAt: null, lastError: null });
    recordBackup(db, { ok: false, error: 'boom' }, new Date('2026-03-10T01:00:00Z'));
    expect(getBackupStatus(db)).toEqual({ lastRunAt: '2026-03-10T01:00:00.000Z', lastSuccessAt: null, lastError: 'boom' });
    recordBackup(db, { ok: true, uploadedImages: 0, snapshot: 's' }, new Date('2026-03-10T02:00:00Z'));
    expect(getBackupStatus(db)).toEqual({ lastRunAt: '2026-03-10T02:00:00.000Z', lastSuccessAt: '2026-03-10T02:00:00.000Z', lastError: null });
    recordBackup(db, { ok: false, error: 'again' }, new Date('2026-03-10T03:00:00Z'));
    expect(getBackupStatus(db).lastSuccessAt).toBe('2026-03-10T02:00:00.000Z');
  });
});

describe('deriveBanner', () => {
  it('not connected', () => expect(deriveBanner({ ...base, connected: false as const, lastError: 'x' }, now)).toBe('not_connected'));
  it('failed last run', () =>
    expect(deriveBanner({ ...base, lastRunAt: hAgo(1), lastSuccessAt: hAgo(25), lastError: 'x' }, now)).toBe('failed'));
  it('failed with no prior success', () =>
    expect(deriveBanner({ ...base, lastRunAt: hAgo(1), lastError: 'x' }, now)).toBe('failed'));
  it('success 37h ago is stale', () =>
    expect(deriveBanner({ ...base, lastRunAt: hAgo(37), lastSuccessAt: hAgo(37) }, now)).toBe('stale'));
  it('success 2h ago is none', () =>
    expect(deriveBanner({ ...base, lastRunAt: hAgo(2), lastSuccessAt: hAgo(2) }, now)).toBe('none'));
  it('failed outranks stale', () =>
    expect(deriveBanner({ ...base, lastRunAt: hAgo(1), lastSuccessAt: hAgo(50), lastError: 'x' }, now)).toBe('failed'));
  it('connected, never ran, connectedSince unknown -> stale (fail loud)', () =>
    expect(deriveBanner(base, now)).toBe('stale'));
  it('connected 1h ago, never ran -> none', () =>
    expect(deriveBanner({ ...base, connectedSince: new Date(hAgo(1)) }, now)).toBe('none'));
  it('connected 40h ago, never ran -> stale', () =>
    expect(deriveBanner({ ...base, connectedSince: new Date(hAgo(40)) }, now)).toBe('stale'));
});
