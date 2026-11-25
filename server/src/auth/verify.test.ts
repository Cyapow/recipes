import { OAuth2Client, type LoginTicket } from 'google-auth-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGoogleIdTokenVerifier } from './verify.js';

// The only test that touches google-auth-library for real: everywhere else the verifier is a fake, so a
// wrong call shape would first show up at a live sign-in.
const ticket = (payload: unknown) => ({ getPayload: () => payload }) as LoginTicket;

afterEach(() => vi.restoreAllMocks());

describe('createGoogleIdTokenVerifier', () => {
  it('passes the client id as the audience and returns the verified identity', async () => {
    const stub = vi
      .spyOn(OAuth2Client.prototype, 'verifyIdToken')
      .mockResolvedValue(ticket({ email: 'cook@example.com', email_verified: true }));

    const verify = createGoogleIdTokenVerifier('client-123');
    expect(await verify('a-token')).toEqual({ email: 'cook@example.com', emailVerified: true, name: null });
    // audience is what rejects a token minted for another OAuth client.
    expect(stub).toHaveBeenCalledWith({ idToken: 'a-token', audience: 'client-123' });
  });

  it('reports an unverified email as unverified rather than dropping it', async () => {
    vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue(ticket({ email: 'cook@example.com' }));
    expect(await createGoogleIdTokenVerifier('client-123')('a-token')).toEqual({
      email: 'cook@example.com',
      emailVerified: false,
      name: null,
    });
  });

  it('returns the name claim when Google sends one', async () => {
    vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue(
      ticket({ email: 'cook@example.com', email_verified: true, name: 'Elisa Beckett' }),
    );
    expect(await createGoogleIdTokenVerifier('client-123')('a-token')).toEqual({
      email: 'cook@example.com',
      emailVerified: true,
      name: 'Elisa Beckett',
    });
  });

  it('returns null for the name when the claim is absent', async () => {
    vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue(
      ticket({ email: 'cook@example.com', email_verified: true }),
    );
    expect((await createGoogleIdTokenVerifier('client-123')('a-token'))?.name).toBeNull();
  });

  it('is null for a payload without an email', async () => {
    vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue(ticket({ email_verified: true }));
    expect(await createGoogleIdTokenVerifier('client-123')('a-token')).toBeNull();
  });

  it('turns a throw into null instead of letting it escape', async () => {
    vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockRejectedValue(new Error('Wrong recipient'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(createGoogleIdTokenVerifier('client-123')('a-token')).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});
