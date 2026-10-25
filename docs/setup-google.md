# Setting up Google Drive backups

Nightly backups go to your own Google Drive. You create the Google OAuth client once; the app never sees your password.

1. **Create a project.** Go to <https://console.cloud.google.com/>, create a project (e.g. "Recipes").
2. **Enable the Drive API.** APIs & Services > Library > "Google Drive API" > Enable.
3. **OAuth consent screen.** APIs & Services > OAuth consent screen (Google Auth platform). Choose user type **External**, fill in the app name and your email.
4. **Publish the app: set the publishing status to "In production".** In the current Console this is Google Auth platform > Audience > **Publish app**. Do not leave it on "Testing". Google expires refresh tokens for apps in Testing after **7 days**, so backups would work for a week and then silently stop. In production the token lasts until you revoke it. (Verification is not required for personal use; see step 7.)
5. **Create the client.** APIs & Services > Credentials > Create credentials > OAuth client ID > **Web application**. Under *Authorised redirect URIs* add exactly:

   ```
   https://recipes.matchapman.dev/api/backup/google/callback
   ```
6. **Configure the server.** Copy the client ID and secret into `.env`:

   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   PUBLIC_BASE_URL=https://recipes.matchapman.dev
   ```

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

## Security note

The app has no login. Anyone who can reach the site can open Settings, disconnect Drive, or (once disconnected) connect a different Google account, which would send future backups to that account's Drive. Mitigations in place are modest: connecting is refused while an account is already connected (switching needs an explicit Disconnect), and the OAuth `state` is bound to the browser that started the flow by a short-lived cookie. The server also rejects cross-site browser requests to state-changing endpoints, so a web page elsewhere cannot trigger them from a browser on your LAN; but anyone who can use the site directly can still disconnect or reconnect Drive. These do not replace access control. Keep the Caddy LAN-only guard in place and keep guest wifi on a separate network from the one that can reach this site.
