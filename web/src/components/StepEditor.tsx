import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { uploadImage } from '../api';
import type { Ingredient, Step } from '../../../server/src/recipes/schema';
import { formatIngredientLine } from '../lib/text';

export type StepEditorProps = {
  steps: Step[];
  ingredients: Ingredient[];
  onChange(steps: Step[]): void;
  onBusyChange(busy: boolean): void;
};

let nextKey = 0;
const newKey = () => `s${nextKey++}`;

export function StepEditor({ steps, ingredients, onChange, onBusyChange }: StepEditorProps) {
  // Stable identity per step so uploads, focus and reordering follow the step rather than its index.
  const keysRef = useRef<string[]>([]);
  while (keysRef.current.length < steps.length) keysRef.current.push(newKey());
  if (keysRef.current.length > steps.length) keysRef.current.length = steps.length;
  const keys = keysRef.current;

  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const [inflight, setInflight] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const busy = Object.values(inflight).some((n) => n > 0);
  const onBusyRef = useRef(onBusyChange);
  onBusyRef.current = onBusyChange;
  const lastBusy = useRef(false);
  useEffect(() => {
    if (lastBusy.current !== busy) {
      lastBusy.current = busy;
      onBusyRef.current(busy);
    }
  }, [busy]);
  useEffect(
    () => () => {
      if (lastBusy.current) onBusyRef.current(false);
    },
    [],
  );

  const bump = (key: string, d: number) => setInflight((m) => ({ ...m, [key]: (m[key] ?? 0) + d }));

  function patch(i: number, p: Partial<Step>) {
    onChange(steps.map((s, idx) => (idx === i ? { ...s, ...p } : s)));
  }

  async function pick(key: string, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErrors((m) => ({ ...m, [key]: '' }));
    bump(key, 1);
    try {
      const id = await uploadImage(file);
      if (!mounted.current) return;
      const idx = keysRef.current.indexOf(key);
      if (idx >= 0) {
        onChange(stepsRef.current.map((s, n) => (n === idx ? { ...s, imageId: id } : s)));
      }
    } catch (err) {
      if (mounted.current) {
        setErrors((m) => ({
          ...m,
          [key]: `Could not upload photo: ${err instanceof Error ? err.message : 'unknown error'}`,
        }));
      }
    } finally {
      if (mounted.current) bump(key, -1);
    }
  }

  function toggle(i: number, n: number) {
    const has = steps[i].ingredients.includes(n);
    const next = has ? steps[i].ingredients.filter((x) => x !== n) : [...steps[i].ingredients, n].sort((a, b) => a - b);
    patch(i, { ingredients: next });
  }

  function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    const nextSteps = steps.slice();
    [nextSteps[i], nextSteps[j]] = [nextSteps[j], nextSteps[i]];
    [keysRef.current[i], keysRef.current[j]] = [keysRef.current[j], keysRef.current[i]];
    onChange(nextSteps);
  }

  function remove(i: number) {
    keysRef.current.splice(i, 1);
    onChange(steps.filter((_, idx) => idx !== i));
  }

  function add() {
    keysRef.current.push(newKey());
    onChange([...steps, { text: '', imageId: null, ingredients: [] }]);
  }

  return (
    <div className="step-editor">
      {steps.map((step, i) => {
        const key = keys[i];
        const pending = (inflight[key] ?? 0) > 0;
        const n = i + 1;
        return (
          <div className="step-card" key={key}>
            <div className="step-head">
              <label htmlFor={`step-${key}`} className="step-num">
                Step {n}
              </label>
              <span className="step-tools">
                <button type="button" className="icon-btn" aria-label={`Move step ${n} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button type="button" className="icon-btn" aria-label={`Move step ${n} down`} disabled={i === steps.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button type="button" className="icon-btn step-delete" aria-label={`Delete step ${n}`} onClick={() => remove(i)}>
                  ✕
                </button>
              </span>
            </div>
            <textarea id={`step-${key}`} rows={3} value={step.text} onChange={(e) => patch(i, { text: e.target.value })} />
            <div className="step-photo">
              {step.imageId ? (
                <img src={`/api/images/${step.imageId}/thumb`} alt={`Photo for step ${n}`} />
              ) : (
                <div className="step-photo-empty" aria-hidden="true" />
              )}
              <div className="step-photo-actions">
                <label className="btn step-photo-btn">
                  <span>{step.imageId ? 'Replace photo' : 'Add photo'}</span>
                  <input type="file" accept="image/*" className="visually-hidden" onChange={(e) => void pick(key, e)} />
                </label>
                {step.imageId && (
                  <button type="button" className="linklike danger-text" onClick={() => patch(i, { imageId: null })}>
                    Remove photo
                  </button>
                )}
                {pending && <small role="status">Uploading…</small>}
                {errors[key] && (
                  <p className="field-error" role="alert">
                    {errors[key]}
                  </p>
                )}
              </div>
            </div>
            {ingredients.length > 0 && (
              <fieldset className="step-ingredients">
                <legend>Ingredients used in this step</legend>
                <div className="step-chips">
                  {ingredients.map((ing, n2) => {
                    const on = step.ingredients.includes(n2);
                    return (
                      <button
                        type="button"
                        key={n2}
                        className={`step-chip${on ? ' on' : ''}`}
                        aria-pressed={on}
                        onClick={() => toggle(i, n2)}
                      >
                        {formatIngredientLine(ing)}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )}
          </div>
        );
      })}
      <button type="button" className="add-step" onClick={add}>
        + Add a step
      </button>
    </div>
  );
}
