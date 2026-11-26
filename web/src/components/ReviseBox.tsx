import { useState } from 'react';

export type ReviseBoxProps = {
  busy: boolean;
  error: string | null;
  /** null until a revision has been applied; [] for one that changed nothing. */
  summary: string[] | null;
  onApply(instruction: string): void;
  onUndo(): void;
};

export function ReviseBox({ busy, error, summary, onApply, onUndo }: ReviseBoxProps) {
  // Kept after an apply, so a near-miss instruction can be reworded and sent again.
  const [text, setText] = useState('');

  return (
    <section className="revise-box">
      <label>
        Tell me what to change
        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. let it cool for 20 minutes before continuing"
        />
      </label>
      <p className="hint">Tip: tap the microphone on your keyboard to dictate. Nothing is saved until you press Save.</p>
      <button type="button" className="primary" onClick={() => onApply(text)} disabled={busy || !text.trim()}>
        {busy ? (<><span className="spinner" aria-hidden="true" /> Revising…</>) : 'Revise'}
      </button>
      {error && <p className="field-error" role="alert">{error}</p>}
      {summary && (
        <div className="revise-summary">
          {summary.length === 0 ? (
            <p>No changes were made. Try rewording the instruction.</p>
          ) : (
            <ul>{summary.map((line, i) => <li key={i}>{line}</li>)}</ul>
          )}
          {/* An undo mid-apply would be overwritten by the revision that is on its way back, and the Undo would
              then vanish with nothing to show for it. */}
          <button type="button" className="btn small" onClick={onUndo} disabled={busy}>Undo</button>
        </div>
      )}
    </section>
  );
}
