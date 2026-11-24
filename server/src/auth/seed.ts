import type { AuthRepo } from './repo.js';

export class AllowlistEmptyError extends Error {}

/** Adds missing addresses only; it never removes one, so addresses added in the app survive a restart. */
export function seedAllowedEmails(repo: AuthRepo, emails: string[], now: Date): void {
  for (const email of emails) repo.addAllowed(email, now);
}

/** Nobody could ever sign in with both empty, and there is deliberately no way to skip this check. */
export function assertAllowlistUsable(repo: AuthRepo, envEmails: string[]): void {
  if (envEmails.length === 0 && repo.listAllowed().length === 0) {
    throw new AllowlistEmptyError('no address is allowed to sign in');
  }
}
