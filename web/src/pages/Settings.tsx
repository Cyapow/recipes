import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  addAllowed, ApiError, disconnectGoogle, getAiStatus, getBackupStatus, getMe, listAllowed, removeAllowed, runBackupNow, signOut,
  type AiStatus, type AllowedEmailRow, type BackupRunResult, type BackupStatus,
} from '../api';
import { forgetSignedIn, notifyUnauthorized } from '../lib/session';
import { getTheme, setTheme, type Theme } from '../lib/theme';

// The server words its own refusals ("That's you...", "...only address left"); show them as sent.
const refusal = (e: unknown, fallback: string) => {
  const msg = e instanceof ApiError && (e.body as { error?: unknown } | undefined)?.error;
  return typeof msg === 'string' ? msg : fallback;
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'Never');

export function Settings() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [result, setResult] = useState<BackupRunResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [allowed, setAllowed] = useState<AllowedEmailRow[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [allowedLoadError, setAllowedLoadError] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [allowError, setAllowError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getBackupStatus());
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    getAiStatus().then(setAi, () => setAi(null)); // the AI section is informational; the page works without it
  }, []);

  const refreshAllowed = useCallback(async () => {
    try {
      setAllowed(await listAllowed());
      setAllowedLoadError(false);
    } catch {
      setAllowedLoadError(true);
    }
  }, []);
  useEffect(() => {
    void refreshAllowed();
  }, [refreshAllowed]);
  useEffect(() => {
    getMe().then((m) => setMe(m.email), () => setMe(null)); // only used to mark "(you)"
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    setAllowError(null);
    try {
      await addAllowed(newEmail.trim());
      setNewEmail('');
    } catch (err) {
      setAllowError(refusal(err, 'Could not add that address. Try again.'));
    }
    void refreshAllowed();
  }

  async function remove(email: string) {
    if (!window.confirm(`Remove ${email}? They will be signed out and can't get back in.`)) return;
    setAllowError(null);
    try {
      await removeAllowed(email);
    } catch (err) {
      setAllowError(refusal(err, 'Could not remove that address. Try again.'));
    }
    void refreshAllowed();
  }

  async function leave() {
    try {
      await signOut();
    } catch {
      setAllowError('Could not sign out. Try again.');
      return;
    }
    forgetSignedIn();
    notifyUnauthorized(); // the auth gate listens for this and shows the sign-in screen
  }

  async function runNow() {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setResult(null);
    try {
      setResult(await runBackupNow());
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : 'Backup failed' });
    } finally {
      runningRef.current = false;
      setRunning(false);
      void refresh();
    }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect Google Drive? Nightly backups will stop.')) return;
    setActionError(null);
    try {
      await disconnectGoogle();
      setResult(null);
    } catch {
      setActionError('Could not disconnect. Try again.');
    }
    void refresh();
  }

  const g = params.get('google');
  return (
    <main className="page">
      <header className="bar">
        <h1>Settings</h1>
        <nav className="actions"><Link className="btn small" to="/">Recipes</Link>
          <button type="button" className="small" onClick={leave}>Sign out</button>
        </nav>
      </header>
      <h2>Appearance</h2>
      <div className="segmented" role="group" aria-label="Colour theme">
        {(['system', 'light', 'dark'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={theme === t ? 'active' : undefined}
            aria-pressed={theme === t}
            onClick={() => {
              setTheme(t);
              setThemeState(t);
            }}
          >
            {t === 'system' ? 'Match device' : t === 'light' ? 'Light' : 'Dark'}
          </button>
        ))}
      </div>
      <p className="hint">Remembered on this browser only.</p>
      <h2>Who can get in</h2>
      <p className="hint">Anyone listed here can sign in with that Google account and can do everything you can.</p>
      {allowedLoadError && <p className="field-error" role="alert">Couldn't load the list.</p>}
      {!allowed && !allowedLoadError && <p className="hint">Loading...</p>}
      {allowed && (
        <ul className="allowed-list" aria-label="Who can get in">
          {allowed.map((a) => (
            <li key={a.email}>
              <span>{a.email}</span>
              {a.email === me && <> <span className="hint">(you)</span></>}
              {!a.fromEnv && <> <button type="button" className="small" onClick={() => remove(a.email)} aria-label={`Remove ${a.email}`}>Remove</button></>}
            </li>
          ))}
        </ul>
      )}
      <form className="actions" onSubmit={add} noValidate>
        <label>
          Email address
          <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} autoComplete="off" />
        </label>
        <button type="submit" disabled={!newEmail.trim()}>Add</button>
      </form>
      {allowError && <p className="field-error" role="alert">{allowError}</p>}
      <p className="hint">Addresses set in the server's configuration are always allowed and can't be removed here.</p>
      <h2>Google Drive backup</h2>
      {g === 'denied' && <p className="field-error" role="alert">Google access was not granted.</p>}
      {g === 'failed' && (
        <p className="field-error" role="alert">
          Connecting to Google failed. Try again and allow offline access (remove this app at myaccount.google.com/permissions first if it keeps happening).
        </p>
      )}
      {loadError && <p className="field-error" role="alert">Couldn't load backup status.</p>}
      {!status && !loadError && <p className="hint">Loading...</p>}
      {status && (
        <>
          <p>{status.connected ? <>Connected as <strong>{status.account}</strong></> : 'Not connected'}</p>
          {!status.configured && (
            <p className="hint">Google client isn't set up yet. Follow docs/setup-google.md, then restart the server.</p>
          )}
          <div className="actions">
            {status.configured && !status.connected && <a className="btn primary" href="/api/backup/google/start">Connect Google account</a>}
            {status.connected && <button type="button" onClick={disconnect}>Disconnect</button>}
          </div>
          {actionError && <p className="field-error" role="alert">{actionError}</p>}
          <dl className="status-list">
            <dt>Last run</dt><dd>{fmt(status.lastRunAt)}</dd>
            <dt>Last success</dt><dd>{fmt(status.lastSuccessAt)}</dd>
            <dt>Last upload</dt><dd>{fmt(status.lastUploadAt)}</dd>
            <dt>Last error</dt><dd>{status.lastError ?? 'None'}</dd>
          </dl>
          <p className="hint">The nightly backup only uploads when something has changed; Back up now always uploads.</p>
          <button type="button" className="primary" onClick={runNow} disabled={running || !status.connected}>
            {running ? 'Backing up...' : 'Back up now'}
          </button>
          {result && (
            result.ok
              ? result.skipped
                ? <p role="status">Already up to date — nothing to upload.</p>
                : <p role="status">Backup complete. {result.uploadedImages} new {result.uploadedImages === 1 ? 'image' : 'images'} uploaded.</p>
              : <p className="field-error" role="alert">Backup failed: {result.error}</p>
          )}
        </>
      )}
      {ai && (
        <>
          <h2>AI</h2>
          <ul className="ai-list" aria-label="AI providers">
            {ai.providers.map((p) => (
              <li key={p.name} data-testid="ai-provider">
                {p.label}: {p.configured ? <strong className="ok">key set</strong> : <span className="hint">not set</span>}
                {p.name === ai.active && <> (in use)</>}
              </li>
            ))}
          </ul>
          {ai.active === null && <p className="hint">No AI key is set, so Describe and the page-reading fallback are off.</p>}
          <p className="hint">
            To add or change a key, set ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY in the server's .env file and restart.
            If the one in use fails, the next one with a key is tried.
          </p>
        </>
      )}
    </main>
  );
}
