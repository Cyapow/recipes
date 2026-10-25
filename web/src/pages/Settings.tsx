import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { disconnectGoogle, getAiStatus, getBackupStatus, runBackupNow, type AiStatus, type BackupRunResult, type BackupStatus } from '../api';

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'Never');

export function Settings() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [result, setResult] = useState<BackupRunResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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
        <nav className="actions"><Link className="btn small" to="/">Recipes</Link></nav>
      </header>
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
