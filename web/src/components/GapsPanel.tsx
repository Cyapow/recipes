import { useState } from 'react';
import type { Gap } from '../../../server/src/recipes/schema';
import { MAX_ANSWERS, MAX_ANSWER_CHARS, type Answer } from '../lib/gaps';

export type GapsPanelProps = {
  gaps: Gap[];
  /** Without it the panel is a read-only list. Resolving clears the boxes that were sent; rejecting leaves every box as typed. */
  onAnswer?: (answers: Answer[]) => Promise<unknown>;
  applying?: boolean;
  error?: string | null;
};

export function GapsPanel({ gaps, onAnswer, applying = false, error = null }: GapsPanelProps) {
  // Typed text, keyed by `about`. Kept across a failed apply, and for the gaps left unanswered.
  const [typed, setTyped] = useState<Record<string, string>>({});

  // The one list that is both sent and counted: non-blank answers to real questions, capped.
  // The parent derives `asked` from these same gaps, so a blank answer cannot reach it.
  const answers: Answer[] = [];
  for (const gap of gaps) {
    const answer = (typed[gap.about] ?? '').trim().slice(0, MAX_ANSWER_CHARS);
    if (gap.question !== null && answer !== '') answers.push({ gap, answer });
  }
  const toSend = answers.slice(0, MAX_ANSWERS);
  const full = toSend.length >= MAX_ANSWERS;

  if (gaps.length === 0) return null;

  const send = async () => {
    if (!onAnswer) return;
    const about = toSend.map((a) => a.gap.about);
    try {
      await onAnswer(toSend);
    } catch {
      return; // the parent shows the error; every box keeps what was typed
    }
    setTyped((t) => Object.fromEntries(Object.entries(t).filter(([k]) => !about.includes(k))));
  };

  return (
    <section className="gaps" aria-label="Check these">
      <h2>Check these</h2>
      <ul>
        {gaps.map((g) =>
          onAnswer && g.question !== null ? (
            <li key={g.about}>
              <label>
                {g.question}
                <input
                  value={typed[g.about] ?? ''}
                  maxLength={MAX_ANSWER_CHARS}
                  disabled={applying || (full && (typed[g.about] ?? '').trim() === '')}
                  onChange={(e) => setTyped((t) => ({ ...t, [g.about]: e.target.value }))}
                />
              </label>
            </li>
          ) : (
            <li key={g.about}>{g.question ?? g.about}</li>
          ),
        )}
      </ul>
      {onAnswer && (
        <button type="button" className="primary" onClick={() => void send()} disabled={applying || toSend.length === 0}>
          {applying ? (
            <>
              <span className="spinner" aria-hidden="true" /> Answering…
            </>
          ) : (
            `Answer ${toSend.length} ${toSend.length === 1 ? 'question' : 'questions'}`
          )}
        </button>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
