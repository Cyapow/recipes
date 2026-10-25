import { Link } from 'react-router-dom';
import type { Banner } from '../api';

export function BackupBanner({ banner, lastError }: { banner: Banner; lastError?: string | null }) {
  if (banner === 'none') return null;
  const text =
    banner === 'not_connected'
      ? 'Not backed up yet. Connect Google Drive in Settings.'
      : banner === 'failed'
        ? `Last backup failed: ${lastError || 'unknown error'}`
        : 'No successful backup in over 36 hours.';
  return (
    <p className={`banner ${banner}`} role={banner === 'failed' ? 'alert' : 'status'}>
      {text} <Link to="/settings">Settings</Link>
    </p>
  );
}
