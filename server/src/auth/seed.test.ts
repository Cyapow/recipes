import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db.js';
import { createAuthRepo, type AuthRepo } from './repo.js';
import { AllowlistEmptyError, assertAllowlistUsable, seedAllowedEmails } from './seed.js';

const now = new Date('2026-01-01T12:00:00.000Z');
let repo: AuthRepo;

beforeEach(() => {
  repo = createAuthRepo(openDb(':memory:'));
});

describe('seedAllowedEmails', () => {
  it('inserts env addresses that are missing, once each however often it runs', () => {
    seedAllowedEmails(repo, ['mat@example.com', 'wife@example.com'], now);
    seedAllowedEmails(repo, ['mat@example.com', 'wife@example.com'], now);
    expect(repo.listAllowed().map((a) => a.email).sort()).toEqual(['mat@example.com', 'wife@example.com']);
  });

  it('never removes an address added in the app', () => {
    repo.addAllowed('wife@example.com', now);
    seedAllowedEmails(repo, ['mat@example.com'], now);
    expect(repo.isAllowed('mat@example.com')).toBe(true);
    expect(repo.isAllowed('wife@example.com')).toBe(true);
  });
});

describe('assertAllowlistUsable', () => {
  it('throws when the env list and the table are both empty', () =>
    expect(() => assertAllowlistUsable(repo, [])).toThrow(AllowlistEmptyError));

  it('passes when the table has a row but the env list is empty', () => {
    repo.addAllowed('wife@example.com', now);
    expect(() => assertAllowlistUsable(repo, [])).not.toThrow();
  });

  it('passes when the env list has an address', () =>
    expect(() => assertAllowlistUsable(repo, ['mat@example.com'])).not.toThrow());
});
