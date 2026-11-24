import { OAuth2Client } from 'google-auth-library';

export type VerifiedIdentity = { email: string; emailVerified: boolean };
/** null means the token is not a valid one for this app. */
export type IdTokenVerifier = (idToken: string) => Promise<VerifiedIdentity | null>;

export function createGoogleIdTokenVerifier(clientId: string): IdTokenVerifier {
  const client = new OAuth2Client(clientId);
  return async (idToken) => {
    try {
      // `audience` is what rejects a token minted for a different OAuth client.
      const ticket = await client.verifyIdToken({ idToken, audience: clientId });
      const payload = ticket.getPayload();
      if (!payload?.email) return null;
      return { email: payload.email, emailVerified: payload.email_verified === true };
    } catch (err) {
      // Never the token itself; this is the only trace of a wrong client ID, clock skew or a cert fetch failure.
      console.warn('id token verification failed:', err instanceof Error ? err.message : err);
      return null;
    }
  };
}
