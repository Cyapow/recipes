import type { useWakeLock } from '../hooks/useWakeLock';
import { SunIcon } from './Icons';

export function KeepOn({ wake }: { wake: ReturnType<typeof useWakeLock> }) {
  if (!wake.supported) return <p className="keep-on unsupported">Your browser can't keep the screen on</p>;
  return (
    <label className="keep-on">
      <SunIcon />
      <span>Keep screen on</span>
      <input
        type="checkbox"
        aria-label="Keep screen on"
        checked={wake.enabled}
        onChange={(e) => wake.setEnabled(e.target.checked)}
      />
    </label>
  );
}
