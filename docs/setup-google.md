# Setting up Google Drive backups

Nightly backups go to your own Google Drive, and the same Google OAuth client is what people sign in with. You create the client once; the app never sees your password.

1. **Create a project.** Go to <https://console.cloud.google.com/>, create a project (e.g. "Recipes").
2. **Enable the Drive API.** APIs & Services > Library > "Google Drive API" > Enable.
3. **OAuth consent screen.** APIs & Services > OAuth consent screen (Google Auth platform). Choose user type **External**, fill in the app name and your email.
4. **Publish the app: set the publishing status to "In production".** In the current Console this is Google Auth platform > Audience > **Publish app**. Do not leave it on "Testing". Google expires refresh tokens for apps in Testing after **7 days**, so backups would work for a week and then silently stop. In production the token lasts until you revoke it. (Verification is not required for personal use; see step 7.)
5. **Create the client.** APIs & Services > Credentials > Create credentials > OAuth client ID > **Web application**. Under *Authorised redirect URIs* add exactly:

   ```
   https://recipes.matchapman.dev/api/backup/google/callback
   ```

   On the same client, under *Authorised JavaScript origins*, add both of these (this is what Google sign-in needs):

   ```
   https://recipes.matchapman.dev
   http://localhost:3000
   ```

   The first is the live site; the second is for running the app locally with `npm run dev`. Google only allows plain `http` for `localhost`, so sign-in cannot work on the site until it has its https certificate. No new client, no new scope and no new redirect URI are needed: the sign-in token already carries the email address, and the redirect URI above is only for Drive backups. If you already have a client from before sign-in existed, just add the two origins to it.
6. **Configure the server.** Copy the client ID and secret into `.env`, and set `ALLOWED_EMAILS` to your own Google address:

   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   PUBLIC_BASE_URL=https://recipes.matchapman.dev
   ALLOWED_EMAILS=you@gmail.com
   ```

   `ALLOWED_EMAILS` is required: the server will not start with it empty unless the allowlist already has someone in it.

   Restart the app so it picks them up.
7. **Connect.** Open `/settings` and click **Connect Google account**. Google may show a "Google hasn't verified this app" screen: if so, click **Advanced**, then **Go to ... (unsafe)**, and allow access. This is expected for a personal app.

## What it can see

The app asks for the `drive.file` scope, so it can only see files it created itself. It cannot read anything else in your Drive. Backups go into a "Recipes backup" folder (`snapshots/` and `images/`).

## When the nightly backup uploads

The nightly backup only uploads when something has changed: it fingerprints your recipes and image files, and if nothing differs from the last upload (and Drive still holds the snapshot and all images) it records "already up to date" and uploads nothing, so unchanged copies don't push older snapshots out of the 14-snapshot retention. **Back up now** in Settings always does a full upload. A Drive problem (revoked token, no connection) is still checked every night and still shows as a failed backup.

## Notes

- The Google token is stored in `<DATA_DIR>/google-token.json` (mode 0600). It is not inside the database, so it is never uploaded to Drive.
- If a backup reports "authorisation failed - reconnect Drive", the token was revoked or expired: click Disconnect, then Connect again in Settings.
- If Google returns no refresh token on connect, remove the app at <https://myaccount.google.com/permissions> and connect again.

## Who can sign in

Only Google accounts on the allowlist can use the site; everyone else is turned away at the sign-in screen and every `/api` route answers 401 without a session.

- `ALLOWED_EMAILS` in `.env` is your break-glass address: it is added to the allowlist at every start, and cannot be removed in Settings. Keep it to your own address.
- Everyone else (your wife, say) is added in Settings > "Who can get in" by typing their Google address. Removing someone ends their access immediately. The last address, and your own, cannot be removed.
- Everyone on the list can do everything, including Settings, Drive and the AI providers. There are no roles.
- Sessions last 90 days from sign-in and then expire. They are stored hashed, so the database copy in Drive holds no usable credentials.
- Drive backups still connect and disconnect from Settings, but only a signed-in, allowed person can do it. Connecting is still refused while an account is already connected (switching needs an explicit Disconnect), and the OAuth `state` is still bound to the browser that started the flow.
- The allowlist is part of the backup. After a restore the list is whatever it was at that snapshot, plus `ALLOWED_EMAILS`.

## What's new in this release

Release: public hosting, with Google sign-in. Everyone must now sign in. Add the two Authorised JavaScript origins above to the existing client before the first sign-in; nothing else in Google Cloud changes. See `docs/deploy.md` for the move itself, the rollback and the first-backup note.
