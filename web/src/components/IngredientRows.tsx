import { useState } from 'react';
import type { Ingredient, Step } from '../../../server/src/recipes/schema';
import { canonicalUnit, UNIT_CHOICES } from '../../../server/src/recipes/amount';
import { moveIngredient, removeIngredient } from '../lib/ingredientEdits';
import {
  ingredientIndexes, newHeadingRow, newIngredientRow, toIngredients, toRows, type Row,
} from '../lib/ingredientRows';
import { formatIngredientQuantity } from '../lib/text';

export type IngredientRowsProps = {
  ingredients: Ingredient[];
  steps: Step[];
  onChange(next: { ingredients: Ingredient[]; steps: Step[] }): void;
};

/** The quantity box holds what you typed while you type it: "1." is not a number yet, but you are mid-way to one. */
const asQuantity = (text: string): number | null => {
  const n = Number(text);
  return text.trim() === '' || Number.isNaN(n) ? null : n;
};

/**
 * One row per ingredient: an amount, a unit and the name, with headings as rows of their own between them.
 *
 * Rows are this component's own state, because a heading you have just added has nothing under it yet and a
 * recipe cannot hold one. Every change emits the ingredients the rows describe, along with steps whose links
 * have followed the rows they point at.
 */
export function IngredientRows({ ingredients, steps, onChange }: IngredientRowsProps) {
  const [rows, setRows] = useState<Row[]>(() => toRows(ingredients));
  // What was typed in each quantity box, while it differs from the number stored ("1." or "" on the way to 1.5).
  const [typing, setTyping] = useState<Record<string, string>>({});

  const emit = (next: Row[], nextSteps: Step[] = steps) => {
    setRows(next);
    onChange({ ingredients: toIngredients(next), steps: nextSteps });
  };

  const patch = (i: number, changes: Partial<Ingredient>) => {
    const row = rows[i];
    if (row?.kind !== 'ingredient') return;
    emit(rows.map((r, n) => (n === i && r.kind === 'ingredient' ? { ...r, value: { ...r.value, ...changes } } : r)));
  };

  const setHeading = (i: number, text: string) =>
    emit(rows.map((r, n) => (n === i && r.kind === 'heading' ? { ...r, text } : r)));

  /** A row move or delete is also a move or delete of the ingredient under it, so the steps follow. */
  const remove = (i: number) => {
    const at = ingredientIndexes(rows)[i];
    const next = rows.filter((_, n) => n !== i);
    emit(next, at == null ? steps : removeIngredient(ingredients, steps, at).steps);
  };

  const move = (i: number, delta: number) => {
    const to = i + delta;
    if (to < 0 || to >= rows.length) return;
    const indexes = ingredientIndexes(rows);
    const next = rows.slice();
    next.splice(to, 0, next.splice(i, 1)[0]!);
    const from = indexes[i];
    const onto = ingredientIndexes(next).at(to);
    emit(next, from == null || onto == null ? steps : moveIngredient(ingredients, steps, from, onto).steps);
  };

  return (
    <div className="ing-rows">
      {rows.map((row, i) => {
        const n = i + 1;
        const tools = (
          <span className="ing-tools">
            <button type="button" className="icon-btn" aria-label={`Move row ${n} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
            <button type="button" className="icon-btn" aria-label={`Move row ${n} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓</button>
            <button type="button" className="icon-btn step-delete" aria-label={`Delete row ${n}`} onClick={() => remove(i)}>✕</button>
          </span>
        );
        if (row.kind === 'heading') {
          return (
            <div className="ing-head" key={row.id}>
              <span className="ing-head-tag">Heading</span>
              <div className="ing-line">
                <input aria-label={`Heading ${n}`} value={row.text} placeholder="For the sauce" onChange={(e) => setHeading(i, e.target.value)} />
                {tools}
              </div>
            </div>
          );
        }
        const { quantity, unit, item, note } = row.value;
        // An imported unit we do not list is offered as itself, so choosing from the list never loses it.
        const shown = canonicalUnit(unit);
        const choices = shown && !UNIT_CHOICES.includes(shown) ? [...UNIT_CHOICES, shown] : UNIT_CHOICES;
        return (
          <div className="ing-row" key={row.id}>
            <div className="ing-line">
              <input
                className="ing-qty" inputMode="decimal" aria-label={`Quantity for row ${n}`} placeholder="–"
                value={typing[row.id] ?? (quantity != null ? formatIngredientQuantity(quantity, unit) : '')}
                onChange={(e) => {
                  setTyping((t) => ({ ...t, [row.id]: e.target.value }));
                  patch(i, { quantity: asQuantity(e.target.value) });
                }}
                onBlur={() => setTyping(({ [row.id]: _drop, ...rest }) => rest)}
              />
              <select
                className="ing-unit" aria-label={`Unit for row ${n}`} value={shown ?? ''}
                onChange={(e) => patch(i, { unit: e.target.value || null })}
              >
                <option value="">—</option>
                {choices.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
              <input
                className="ing-item" aria-label={`Ingredient ${n}`} placeholder="ground beef"
                value={note ? `${item} (${note})` : item}
                onChange={(e) => {
                  // The note stays part of the name, as it is written: "ground beef (thinly sliced)".
                  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(e.target.value);
                  patch(i, m ? { item: m[1]!, note: m[2]!.trim() || null } : { item: e.target.value, note: null });
                }}
              />
              {tools}
            </div>
          </div>
        );
      })}

      <div className="ing-adds">
        <button type="button" className="ing-add" onClick={() => emit([...rows, newIngredientRow()])}>+ Ingredient</button>
        <button type="button" className="ing-add" onClick={() => emit([...rows, newHeadingRow()])}>+ Heading</button>
      </div>
    </div>
  );
}
