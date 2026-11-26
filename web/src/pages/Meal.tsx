import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ApiError, getMeal, scheduleMeal, updateMeal,
  type MealIngredientLine, type MealWithIngredients, type StageWithWhen,
} from '../api';
import { BackIcon } from '../components/Icons';
import { useWakeLock } from '../hooks/useWakeLock';
import { describeAiError } from '../lib/aiError';
import { KeepOn } from './Cook';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function durationText(minutes: number, estimated: boolean): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const words = h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
  return estimated ? `about ${words}` : words;
}

/** The fields a PUT takes for a stage: everything the server computed (id, at, dayGroup, position) is left out. */
function stageInputs(stages: StageWithWhen[]) {
  return stages.map((s) => ({
    recipeId: s.recipeId, offsetMinutes: s.offsetMinutes, durationMinutes: s.durationMinutes,
    estimated: s.estimated, text: s.text, stepIndices: s.stepIndices, doneAt: s.doneAt,
  }));
}

/** Stages under their day headings, in the order the server gave them; a heading appears once, where first seen. */
function byDay(stages: StageWithWhen[]): { group: string; stages: StageWithWhen[] }[] {
  const days: { group: string; stages: StageWithWhen[] }[] = [];
  for (const s of stages) {
    const day = days.find((d) => d.group === s.dayGroup);
    if (day) day.stages.push(s);
    else days.push({ group: s.dayGroup, stages: [s] });
  }
  return days;
}

function Ingredients({ lines }: { lines: MealIngredientLine[] }) {
  return (
    <section aria-label="Ingredients">
      <h2>Ingredients</h2>
      {lines.length === 0 && <p className="empty">Nothing listed yet.</p>}
      <ul className="rows meal-ingredients">
        {lines.map((l) => (
          <li key={`${l.key}|${l.unit}`}>
            <span className="meal-ingredient">{l.text}</span>
            <ul className="meal-uses sub">
              {l.uses.map((u, i) => (
                <li key={i}>
                  {u.recipeTitle}: {[u.group, u.note].filter(Boolean).join(', ') || 'as listed'}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Notes({ meal }: { meal: MealWithIngredients }) {
  const notes = [
    ...(meal.scheduleStale ? ['The recipes have changed since this schedule was drafted, so it may have fallen behind them.'] : []),
    ...meal.watchOut,
  ];
  if (notes.length === 0) return null;
  return (
    <section className="gaps" aria-label="Check these">
      <h2>Check these</h2>
      <ul>{notes.map((n) => <li key={n}>{n}</li>)}</ul>
    </section>
  );
}

function StageEditor({ stage, onSave, onCancel }: { stage: StageWithWhen; onSave: (offset: number, text: string) => void; onCancel: () => void }) {
  const [offset, setOffset] = useState(String(stage.offsetMinutes));
  const [text, setText] = useState(stage.text);
  const minutes = Number(offset);
  const valid = offset.trim() !== '' && Number.isInteger(minutes) && minutes >= 0 && text.trim() !== '';
  return (
    <form className="meal-edit" onSubmit={(e) => { e.preventDefault(); if (valid) onSave(minutes, text.trim()); }}>
      <label className="budget-field">
        What to do
        <input value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} />
      </label>
      <label className="budget-field">
        Minutes before serving
        <input type="number" min={0} step={1} inputMode="numeric" value={offset} onChange={(e) => setOffset(e.target.value)} />
      </label>
      <div className="meal-actions">
        <button type="submit" className="primary" disabled={!valid}>Save</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function StageRow({ stage, recipeTitle, editing, busy, onEdit, onSave, onCancel, onDrop }: {
  stage: StageWithWhen;
  recipeTitle: string | null;
  editing: boolean;
  busy: boolean;
  onEdit: () => void;
  onSave: (offset: number, text: string) => void;
  onCancel: () => void;
  onDrop: () => void;
}) {
  if (editing) return <li className="meal-stage"><StageEditor stage={stage} onSave={onSave} onCancel={onCancel} /></li>;
  const link = stage.recipeId !== null && recipeTitle !== null;
  return (
    <li className="meal-stage">
      <span className="meal-time">{stage.clock}</span>
      <span className="meal-stage-body">
        <span className="meal-stage-text">{stage.text}</span>
        <span className="sub">
          {stage.durationMinutes !== null && durationText(stage.durationMinutes, stage.estimated)}
          {stage.durationMinutes !== null && link && ' · '}
          {link && <Link to={`/recipe/${encodeURIComponent(stage.recipeId!)}`}>{recipeTitle}</Link>}
        </span>
      </span>
      <span className="meal-stage-actions">
        <button type="button" disabled={busy} onClick={onEdit} aria-label={`Change ${stage.text}`}>Change</button>
        <button type="button" disabled={busy} onClick={onDrop} aria-label={`Drop ${stage.text}`}>Drop</button>
      </span>
    </li>
  );
}

function AddStage({ disabled, onAdd }: { disabled: boolean; onAdd: (offset: number, text: string) => Promise<boolean> }) {
  const [text, setText] = useState('');
  const [offset, setOffset] = useState('0');
  const minutes = Number(offset);
  const valid = text.trim() !== '' && offset.trim() !== '' && Number.isInteger(minutes) && minutes >= 0;
  return (
    <form
      className="meal-edit"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        // The text stays until the save is known to have worked, so a failure loses nothing.
        void onAdd(minutes, text.trim()).then((saved) => saved && setText(''));
      }}
    >
      <h3 className="planner-sub">Add a step of your own</h3>
      <label className="budget-field">
        New step
        <input value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} />
      </label>
      <label className="budget-field">
        Minutes before serving (new step)
        <input type="number" min={0} step={1} inputMode="numeric" value={offset} onChange={(e) => setOffset(e.target.value)} />
      </label>
      <div className="meal-actions">
        <button type="submit" disabled={disabled || !valid}>Add step</button>
      </div>
    </form>
  );
}

function PlanView({ meal, onMeal, onFollow }: { meal: MealWithIngredients; onMeal: (m: MealWithIngredients) => void; onFollow: () => void }) {
  const id = meal.id;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Set when drafting hit an existing schedule: what would be lost, awaiting a yes. */
  const [confirm, setConfirm] = useState<{ stages: number; done: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  async function draft(replace: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onMeal(await scheduleMeal(id, replace));
      setConfirm(null);
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { code?: string; stages?: number; done?: number } | undefined) : undefined;
      if (err instanceof ApiError && err.status === 409 && body?.code === 'has_stages') {
        setConfirm({ stages: body.stages ?? 0, done: body.done ?? 0 });
      } else {
        setError(describeAiError(err, 'Could not draft the schedule'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveStages(stages: StageWithWhen[]): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      onMeal(await updateMeal(id, { stages: stageInputs(stages) }));
      setEditing(null);
      return true;
    } catch {
      setError('Could not save your changes');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const titles = new Map(meal.recipes.map((r) => [r.recipeId, r.recipeTitle]));
  const liveRecipeIds = meal.recipes.flatMap((r) => (r.recipeId ? [r.recipeId] : []));
  const plannerHref = `/planner?${liveRecipeIds.map((r) => `recipe=${encodeURIComponent(r)}`).join('&')}`;
  const retime = (stage: StageWithWhen, offsetMinutes: number, text: string) =>
    saveStages(meal.stages.map((s) => (s === stage ? { ...s, offsetMinutes, text } : s)));
  const addStage = (offsetMinutes: number, text: string) =>
    saveStages([
      ...meal.stages,
      { id: '', recipeId: null, offsetMinutes, durationMinutes: null, estimated: false, text, stepIndices: [], doneAt: null, position: meal.stages.length, at: '', dayGroup: '', clock: '' },
    ]);

  return (
    <main className="page meal">
      <header className="cook-bar">
        <Link className="btn round-btn" to="/meals" aria-label="Back to meals"><BackIcon /></Link>
        {liveRecipeIds.length > 0 && <Link className="btn" to={plannerHref}>Plan the shopping</Link>}
        {meal.stages.length > 0 && <button type="button" className="btn" onClick={onFollow}>Follow on the day</button>}
      </header>
      <h1>{meal.title}</h1>
      <p className="sub">Serving {meal.serveText}</p>
      {error && <p className="field-error" role="alert">{error}</p>}

      <Ingredients lines={meal.ingredients} />
      <Notes meal={meal} />

      <section aria-label="Schedule">
        <h2>Schedule</h2>
        {meal.stages.length === 0 && <p className="empty">No schedule yet.</p>}
        {byDay(meal.stages).map((day) => (
          <div key={day.group} className="meal-day">
            <h3 className="planner-sub">{day.group}</h3>
            <ul className="rows meal-stages">
              {day.stages.map((s) => (
                <StageRow
                  key={s.id}
                  stage={s}
                  recipeTitle={s.recipeId ? titles.get(s.recipeId) ?? null : null}
                  editing={editing === s.id}
                  busy={busy}
                  onEdit={() => setEditing(s.id)}
                  onSave={(offset, text) => void retime(s, offset, text)}
                  onCancel={() => setEditing(null)}
                  onDrop={() => void saveStages(meal.stages.filter((x) => x !== s))}
                />
              ))}
            </ul>
          </div>
        ))}

        {confirm ? (
          <section className="gaps meal-confirm" aria-label="Replace the schedule?" aria-live="polite">
            <p>
              Drafting again will replace {plural(confirm.stages, 'step', 'steps')}
              {confirm.done > 0 ? `, ${confirm.done} of them ticked off` : ''}, along with any changes you have made.
            </p>
            <div className="meal-actions">
              <button type="button" className="primary" disabled={busy} onClick={() => void draft(true)}>Replace the schedule</button>
              <button type="button" disabled={busy} onClick={() => setConfirm(null)}>Keep it</button>
            </div>
          </section>
        ) : (
          <div className="shopping-actions">
            <button type="button" className="primary share-btn" disabled={busy} onClick={() => void draft(false)}>
              {busy ? 'Working…' : meal.stages.length === 0 ? 'Draft a schedule' : 'Draft the schedule again'}
            </button>
          </div>
        )}

        {meal.stages.length > 0 && <AddStage disabled={busy} onAdd={addStage} />}
      </section>
    </main>
  );
}

/** How often the live view looks at the clock again; nothing is re-fetched. */
const CLOCK_MS = 30_000;

function LiveView({ meal, onMeal, onBack }: { meal: MealWithIngredients; onMeal: (m: MealWithIngredients) => void; onBack: () => void }) {
  const wake = useWakeLock();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);

  async function tick(stage: StageWithWhen) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const doneAt = stage.doneAt === null ? new Date().toISOString() : null;
    try {
      onMeal(await updateMeal(meal.id, { stages: stageInputs(meal.stages.map((s) => (s === stage ? { ...s, doneAt } : s))) }));
    } catch {
      setError('Could not save your changes');
    } finally {
      setBusy(false);
    }
  }

  const titles = new Map(meal.recipes.map((r) => [r.recipeId, r.recipeTitle]));
  // The only thing read from a stage's `at` is whether it has passed; everything shown comes from the server.
  const isDue = (s: StageWithWhen) => Date.parse(s.at) <= now;
  const sections = [
    { name: 'Due now', stages: meal.stages.filter((s) => s.doneAt === null && isDue(s)) },
    { name: 'Next', stages: meal.stages.filter((s) => s.doneAt === null && !isDue(s)) },
    { name: 'Done', stages: meal.stages.filter((s) => s.doneAt !== null) },
  ];
  const allDone = meal.stages.length > 0 && sections[2].stages.length === meal.stages.length;

  return (
    <main className="page meal">
      <header className="cook-bar">
        <button type="button" className="btn" onClick={onBack}>Back to the plan</button>
        <KeepOn wake={wake} />
      </header>
      <h1>{meal.title}</h1>
      <p className="sub">Serving {meal.serveText}</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      {allDone && <p className="meal-served" role="status">Everything is done. The meal is served.</p>}

      {sections.filter((sec) => sec.stages.length > 0).map((sec) => (
        <section key={sec.name} aria-label={sec.name}>
          <h2>{sec.name}</h2>
          <ul className="rows meal-stages">
            {sec.stages.map((s) => {
              const title = s.recipeId ? titles.get(s.recipeId) ?? null : null;
              return (
                <li key={s.id} className={`meal-stage${s.doneAt !== null ? ' done' : ''}`}>
                  <input
                    type="checkbox"
                    aria-label={`Done: ${s.text}`}
                    checked={s.doneAt !== null}
                    disabled={busy}
                    onChange={() => void tick(s)}
                  />
                  <span className="meal-time">{s.clock}</span>
                  <span className="meal-stage-body">
                    <span className="meal-stage-text">{s.text}</span>
                    <span className="sub">
                      {s.durationMinutes !== null && durationText(s.durationMinutes, s.estimated)}
                      {s.durationMinutes !== null && title && ' · '}
                      {title}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}

export function Meal() {
  const { id = '' } = useParams();
  const [meal, setMeal] = useState<MealWithIngredients | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);

  useEffect(() => {
    let current = true;
    setMeal(null);
    setLoadError(null);
    setFollowing(false);
    getMeal(id)
      .then((m) => current && setMeal(m))
      .catch(() => current && setLoadError('Could not load this meal'));
    return () => { current = false; };
  }, [id]);

  if (loadError) return <main className="page"><p className="field-error" role="alert">{loadError}</p></main>;
  if (!meal) return <main className="page"><p className="sub" role="status">Loading…</p></main>;
  return following
    ? <LiveView meal={meal} onMeal={setMeal} onBack={() => setFollowing(false)} />
    : <PlanView meal={meal} onMeal={setMeal} onFollow={() => setFollowing(true)} />;
}
