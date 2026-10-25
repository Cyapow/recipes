# Setting up Google Drive backups

Nightly backups go to your own Google Drive. You create the Google OAuth client once; the app never sees your password.

1. **Create a project.** Go to <https://console.cloud.google.com/>, create a project (e.g. "Recipes").
2. **Enable the Drive API.** APIs & Services > Library > "Google Drive API" > Enable.
3. **OAuth consent screen.** APIs & Services > OAuth consent screen (Google Auth platform). Choose user type **External**, fill in the app name and your email.
4. **Publish the app: set the publishing status to "In production".** Do not leave it on "Testing". Google expires refresh tokens for apps in Testing after **7 days**, so backups would work for a week and then silently stop. In production the token lasts until you revoke it. (Verification is not required for personal use; see step 7.)
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
7. **Connect.** Open `/settings` and click **Connect Google account**. Google will say "Google hasn't verified this app": click **Advanced**, then **Go to ... (unsafe)**, and allow access. This is expected for a personal app.

## What it can see

The app asks for the `drive.file` scope, so it can only see files it created itself. It cannot read anything else in your Drive. Backups go into a "Recipes backup" folder (`snapshots/` and `images/`).

## Notes

- The Google token is stored in `<DATA_DIR>/google-token.json` (mode 0600). It is not inside the database, so it is never uploaded to Drive.
- If a backup reports "authorisation failed - reconnect Drive", the token was revoked or expired: click Disconnect, then Connect again in Settings.
- If Google returns no refresh token on connect, remove the app at <https://myaccount.google.com/permissions> and connect again.
