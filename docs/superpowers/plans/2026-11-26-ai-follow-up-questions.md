# Questions the AI can ask back — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn every gap the AI reports into a question the person can answer in the "Check these" panel, apply the answers through the existing revise endpoint, and detect an ingredient no step uses in code as well as in the prompt.

**Architecture:** `gaps: string[]` becomes `gaps: Gap[]` where `Gap = { about, question }`, end to end through four AI paths and the device-draft store. Answers are built client-side into one revise instruction and sent to `POST /api/ai/revise`, which already guarantees that the instruction is the only new content; the unanswered questions are carried across the apply by the caller. The gap count, blank questions and unused ingredients are enforced in server code, not only asked for in the prompt.

**Tech Stack:** TypeScript ESM, zod, Fastify 5, React 19 + react-router 7, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-11-26-ai-follow-up-questions-design.md`

## Global Constraints

- `Gap = { about: string; question: string | null }` — a flat object of two strings, nothing more (strict tool schemas across four providers).
- `question: null` renders as a plain bullet with no answer box, exactly as the panel renders today.
- At most **8** gaps, keeping the first eight ("most important first"), truncated *after* the photos route appends its own gap.
- `question` at most **140** characters; a blank, whitespace-only or over-long question becomes `null` rather than being truncated.
- Answer inputs: `maxLength` **200**; at most **8** pairs per apply.
- `MAX_REVISE_CHARS` rises from `2_000` to `4_000`.
- The AI never invents. A question may only ask about something the input did not state, must not ask the person to confirm what they did state, and must not imply a detail the input never mentioned.
- An answer may fill or correct only the thing its question asked about, including contradicting the draft; it may not cause a change it does not state.
- No new route, no new environment variable, no database migration.
- Device drafts holding `string[]` must keep opening: a string normalises to `{ about: it, question: null }` on read.
- UK spelling in all user-facing copy.

## Review Focus

Five things the spec implies that no task's happy path exercises. Each has its test pinned to the task that owns the code.

1. **A gap list longer than eight arrives from the model** — the person sees eight, not a wall, and the photos route's appended `brand` gap counts towards the eight rather than making nine (Task 2).
2. **An ingredient whose item is entirely stop words** (`optional extra`) can never link to a step, so it must never be reported as unused, on any number of applies (Task 2).
3. **An apply whose revise call fails** — every answer box keeps what was typed in it and an error shows in the panel; nothing typed is lost to a failed call (Task 5).
4. **A device draft written before this change** (`gaps: ['servings']`) resumes as bullets instead of throwing on read (Task 1).
5. **A free-text revise in the editor still replaces the gap list**, so answering and instructing do not quietly swap behaviour (Task 6).

---

## File Structure

**Server**

- `server/src/recipes/schema.ts` — `GapSchema` and the `gaps` field on `RecipeDraftSchema`. The one definition everything else imports.
- `server/src/ai/gaps.ts` *(new)* — the server-side gap rules that are code, not prompt: `normaliseGaps`, `unusedIngredientGaps`. Separate file because both `draft.ts` and `revise.ts` need them and neither owns them.
- `server/src/ai/draft.ts` — `SYSTEM_PROMPT` question rules; `toRecipeDraft` calls the two helpers.
- `server/src/ai/revise.ts` — `REVISE_SYSTEM_PROMPT` question + answer rules; `applyRevision` calls the two helpers.
- `server/src/ai/routes.ts` — `MAX_REVISE_CHARS`; the photos route's `brand` gap gains a question and re-normalises; the describe route filters on `about`.

**Web**

- `web/src/lib/gaps.ts` *(new)* — `answerInstruction`, `mergeGaps`, `MAX_ANSWERS`, `MAX_ANSWER_CHARS`. Pure functions only.
- `web/src/lib/useGapAnswers.ts` *(new)* — the hook the three create pages share: holds the applying state and the error, calls `reviseRecipe`, merges.
- `web/src/components/GapsPanel.tsx` *(new)* — the amber panel, lifted out of `RecipeForm` and given answer mode. `RecipeForm` is already long; the panel is not form state and does not belong in it.
- `web/src/components/RecipeForm.tsx` — renders `GapsPanel`, passes `onAnswer` through.
- `web/src/pages/{Describe,Photos,Import}.tsx` — use the hook, pass `inputRef`, write the merged gaps to the device draft after the remount.
- `web/src/pages/Editor.tsx` — `onRevise(instruction, asked?)`, answer handler.
- `web/src/lib/drafts.ts` — normalise `gaps` on read.
- `web/src/styles.css` — the inputs inside `.gaps`.
- `docs/deploy.md` — release note.

---

### Task 1: The Gap shape, end to end

Mechanical type change with no new behaviour: every producer and consumer moves to `Gap`, the panel still renders bullets, nothing asks a question yet. One task because the web imports the server's types directly, so the change is atomic across both.

**Files:**
- Modify: `server/src/recipes/schema.ts:125-128`
- Modify: `server/src/ai/draft.ts` (`AiDraftSchema` inherits; no prompt change yet), `server/src/ai/revise.ts` (`AiRevisionSchema`), `server/src/ai/routes.ts:47` (describe route's brand filter), `server/src/ai/routes.ts:88` (photos route's appended gap)
- Modify: `web/src/api.ts:124`, `web/src/lib/drafts.ts:17`, `web/src/components/RecipeForm.tsx:205-215`
- Modify (tests to the new shape): `server/src/ai/draft.test.ts`, `server/src/ai/client.test.ts`, `server/src/ai/routes.test.ts`, `server/src/ai/revise.test.ts`, `server/src/ai/draft.live.test.ts`, `server/src/import/importUrl.test.ts`, `web/src/components/RecipeForm.test.tsx`, `web/src/pages/{Describe,Photos,Import}.test.tsx`, `web/src/pages/Editor.revise.test.tsx`
- Test: `server/src/recipes/schema.test.ts`, `web/src/lib/drafts.test.ts` *(new if absent)*

**Interfaces:**
- Produces: `GapSchema` and `export type Gap = { about: string; question: string | null }` from `server/src/recipes/schema.ts`. `RecipeDraftSchema.gaps: z.array(GapSchema)`.

- [ ] **Step 1: Write the failing tests**

In `server/src/recipes/schema.test.ts`:

```ts
it('accepts a gap with a question and one without', () => {
  const r = RecipeDraftSchema.safeParse({ ...validDraft, gaps: [
    { about: 'servings', question: 'How many does this serve?' },
    { about: 'brand', question: null },
  ] });
  expect(r.success).toBe(true);
});

it('rejects a bare string gap', () => {
  expect(RecipeDraftSchema.safeParse({ ...validDraft, gaps: ['servings'] }).success).toBe(false);
});
```

In `web/src/lib/drafts.test.ts` — Review Focus 4:

```ts
it('reads a draft saved before gaps had questions', () => {
  localStorage.setItem('recipes.drafts', JSON.stringify([
    { id: 'd1', kind: 'describe', savedAt: 1, gaps: ['servings', 'quantity for flour'] },
  ]));
  expect(listDrafts()[0]!.gaps).toEqual([
    { about: 'servings', question: null },
    { about: 'quantity for flour', question: null },
  ]);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run server/src/recipes/schema.test.ts web/src/lib/drafts.test.ts`
Expected: FAIL — the string gap is accepted, and `listDrafts` returns strings.

- [ ] **Step 3: Define the shape and migrate every site**

Add `GapSchema` and `type Gap` to `server/src/recipes/schema.ts` and point `RecipeDraftSchema.gaps` at it. Then follow the type errors: `AiRevisionSchema.gaps`, `web/src/api.ts`'s `Revision`, `Draft.gaps`, and `RecipeForm`'s panel (`key={g.about}`, renders `g.question ?? g.about`). In `drafts.ts`, normalise inside the existing `read()` guard. In `routes.ts`, the describe route filters on `g.about` and the photos route appends `{ about: 'brand', question: null }` — the question comes in Task 2.

- [ ] **Step 4: Run them to verify they pass, then the whole suite and both typechecks**

Run: `npm test`, then `npx tsc -p tsconfig.json --noEmit` and `npx tsc -p web/tsconfig.json --noEmit`
Expected: PASS, with every gap assertion in the listed test files updated to objects. No `as any` on a gap anywhere.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: give every AI gap a shape of its own"
```

---

### Task 2: The rules that are code, not prompt

**Files:**
- Create: `server/src/ai/gaps.ts`, `server/src/ai/gaps.test.ts`
- Modify: `server/src/ai/draft.ts` (`toRecipeDraft`), `server/src/ai/revise.ts` (`applyRevision`), `server/src/ai/routes.ts:11` (`MAX_REVISE_CHARS`), `server/src/ai/routes.ts:88` (brand question, re-normalise)

**Interfaces:**
- Consumes: `Gap` from `server/src/recipes/schema.ts` (Task 1); `mentionsAnySignificantWord` from `server/src/recipes/links.js`.
- Produces:
  - `normaliseGaps(gaps: Gap[]): Gap[]` — nulls a blank, whitespace-only or over-140-character question; caps the list at `MAX_GAPS`; idempotent.
  - `unusedIngredientGaps(recipe: { ingredients: Ingredient[]; steps: { ingredients: number[] }[] }, existing: Gap[]): Gap[]`
  - `export const MAX_GAPS = 8`, `export const MAX_QUESTION_CHARS = 140`

- [ ] **Step 1: Write the failing tests**

In `server/src/ai/gaps.test.ts`:

```ts
describe('normaliseGaps', () => {
  it('nulls a blank question', () => { /* { about: 'servings', question: '  ' } -> question null */ });
  it('nulls an over-long question rather than truncating it', () => { /* 141 chars -> null, about unchanged */ });
  it('keeps the first eight and drops the rest', () => { /* 12 in -> 8 out, in input order */ });
  it('is idempotent', () => { /* normaliseGaps(normaliseGaps(x)) === normaliseGaps(x) */ });
});

describe('unusedIngredientGaps', () => {
  it('asks which step uses a quantified ingredient no step links', () => {
    // ingredients: [{ item: 'red wine', quantity: 150, unit: 'ml' }], steps: [{ ingredients: [] }]
    // -> [{ about: 'red wine is not used in any step', question: 'Which step uses the red wine?' }]
  });
  it('says nothing about an unquantified ingredient', () => { /* salt, quantity null -> [] */ });
  it('says nothing about an ingredient whose item is all stop words', () => {
    // item 'optional extra', quantity 1 -> [] (Review Focus 2)
  });
  it('says nothing when the model already asked about it', () => {
    // existing: [{ about: 'quantity for red wine', question: '…' }] -> []
  });
  it('says nothing about an ingredient a step does link', () => { /* steps: [{ ingredients: [0] }] -> [] */ });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run server/src/ai/gaps.test.ts`
Expected: FAIL with "does not provide an export named 'normaliseGaps'".

- [ ] **Step 3: Implement both helpers in `server/src/ai/gaps.ts`**

`unusedIngredientGaps` takes the ingredient indices no step lists, keeps those with a non-null `quantity`, drops any with no significant words (reuse the significant-word test by checking `mentionsAnySignificantWord(ingredient.item, ingredient)` — an item with no significant words cannot match itself), and drops any that an existing gap's `about` or `question` already names via `mentionsAnySignificantWord`.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run server/src/ai/gaps.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing wiring tests**

In `server/src/ai/draft.test.ts`, and the mirror in `server/src/ai/revise.test.ts`:

```ts
it('reports an ingredient the method never uses', () => {
  // toRecipeDraft with a quantified ingredient and a step that does not name it
  // -> gaps includes { about: 'red wine is not used in any step', question: 'Which step uses the red wine?' }
});
it('caps the gaps it returns at eight', () => { /* 12 model gaps -> 8 */ });
```

In `server/src/ai/routes.test.ts` — Review Focus 1:

```ts
it('gives the brand gap a question and keeps the total at eight', () => {
  // photos route, model returns 8 gaps and brand null
  // -> gaps.length === 8, and the last entry is the brand gap with a question
});
it('allows a 4000-character instruction and refuses 4001', () => { /* MAX_REVISE_CHARS */ });
```

- [ ] **Step 6: Run them to verify they fail, then wire the helpers in**

Call both helpers at the end of `toRecipeDraft` and `applyRevision` (after step links are final — the unused check depends on them). In `routes.ts`: `MAX_REVISE_CHARS = 4_000`; the photos route's appended gap becomes `{ about: 'brand', question: 'Whose recipe card is this?' }` and the result goes back through `normaliseGaps` so the append cannot push the list to nine.

- [ ] **Step 7: Run the suite and both typechecks**

Run: `npm test`, `npx tsc -p tsconfig.json --noEmit`, `npx tsc -p web/tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: catch the gaps only code can see"
```

---

### Task 3: What the prompts ask for

Prompt-text assertions are this repo's convention for prompt rules — see `describe('REVISE_SYSTEM_PROMPT')` in `server/src/ai/revise.test.ts:32-41`. The quality of what comes back is verified by the manual pass before deploy, per the spec.

**Files:**
- Modify: `server/src/ai/draft.ts` (`SYSTEM_PROMPT`), `server/src/ai/revise.ts` (`REVISE_SYSTEM_PROMPT`)
- Test: `server/src/ai/draft.test.ts` (`describe('SYSTEM_PROMPT')`), `server/src/ai/revise.test.ts` (`describe('REVISE_SYSTEM_PROMPT')`)

- [ ] **Step 1: Write the failing tests**

Add to each prompt's existing describe block, matching the style already there:

```ts
expect(SYSTEM_PROMPT).toMatch(/"question"/);
expect(SYSTEM_PROMPT).toMatch(/at most eight/i);
expect(SYSTEM_PROMPT).toMatch(/most important .* first/i);
expect(SYSTEM_PROMPT).toMatch(/named by at least one step/i);
expect(SYSTEM_PROMPT).toMatch(/never mentions an oven|imply a detail/i);
```

and for the revise prompt, the same five plus:

```ts
expect(REVISE_SYSTEM_PROMPT).toMatch(/answers to the questions/i);
expect(REVISE_SYSTEM_PROMPT).toMatch(/only what its own question asked about/i);
expect(REVISE_SYSTEM_PROMPT).toMatch(/fills nothing/i);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run server/src/ai/draft.test.ts server/src/ai/revise.test.ts`
Expected: FAIL on the new matchers.

- [ ] **Step 3: Write the rules into `SYSTEM_PROMPT`**

Replace the existing single gaps bullet with the gap object (`about` as now, plus `question`), and add: the question is asked directly of the person, in the second person, naming what they said, answerable in a few words, at most about 140 characters; it may only ask about something the input did not state, must not ask them to confirm what they did state, and must not imply a detail the input never mentioned (no oven temperature for a recipe that never mentions an oven); most important first; at most eight. Then the two consistency rules: every ingredient should be named by at least one step, and if one is not, ask which step uses it unless the input shows it is a seasoning or served alongside; and if a step names something absent from the ingredients, ask for it.

Worked examples to carry in the prompt: `How much red wine did you add?`, `How many does this serve?`, `The card's cooking time is smudged — what does it say?`, and for the title gap `I called this "Beef mince and tomato spaghetti" — what would you call it?`

- [ ] **Step 4: Write the rules into `REVISE_SYSTEM_PROMPT`**

The whole question-writing rule, duplicated rather than summarised (the editor's gaps come only from revise, so without it the panel stops being answerable after one revise). Then the answers rules: the instruction may be numbered `Q:`/`A:` pairs; each answer may fill or correct only what its own question asked about, including contradicting the recipe, and may not cause a change it does not state; an answer that answers nothing (`dunno`, or a vague amount where a number was asked for) fills nothing — leave the field as it was and return the gap with a sharper question if one is possible.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: ask the model to write its gaps as questions"
```

---

### Task 4: Building and merging, as pure functions

**Files:**
- Create: `web/src/lib/gaps.ts`, `web/src/lib/gaps.test.ts`

**Interfaces:**
- Consumes: `Gap` from `../../../server/src/recipes/schema`.
- Produces:
  - `type Answer = { gap: Gap; answer: string }`
  - `answerInstruction(answers: Answer[]): string`
  - `mergeGaps(before: Gap[], asked: Gap[], returned: Gap[]): Gap[]`
  - `export const MAX_ANSWERS = 8`, `export const MAX_ANSWER_CHARS = 200`

- [ ] **Step 1: Write the failing tests**

```ts
describe('answerInstruction', () => {
  it('numbers each question and answer', () => {
    expect(answerInstruction([
      { gap: { about: 'quantity for red wine', question: 'How much red wine did you add?' }, answer: 'about 150ml' },
      { gap: { about: 'servings', question: 'How many does this serve?' }, answer: '4' },
    ])).toBe(
      'Here are answers to the questions you asked.\n' +
      '1. Q: How much red wine did you add? A: about 150ml\n' +
      '2. Q: How many does this serve? A: 4',
    );
  });
  it('falls back to the about text for a gap with no question', () => { /* uses g.about after 'Q:' */ });
  it('fits inside MAX_REVISE_CHARS at the worst case', () => {
    // 8 answers, 140-char questions, 200-char answers -> length < 4000
  });
});

describe('mergeGaps', () => {
  it('keeps the gaps that were not asked about', () => { /* before minus asked, by about */ });
  it('appends what came back', () => { /* returned after the kept ones */ });
  it('dedupes a returned gap against a kept one with the same about', () => { /* returned wins */ });
  it('drops an answered gap that did not come back', () => { /* asked and absent from returned -> gone */ });
  it('keeps a re-asked gap with the new wording', () => { /* same about, sharper question -> new question */ });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run web/src/lib/gaps.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement both in `web/src/lib/gaps.ts`**

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run web/src/lib/gaps.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/gaps.ts web/src/lib/gaps.test.ts
git commit -m "feat: turn answers into one revise instruction"
```

---

### Task 5: The panel that takes answers

**Files:**
- Create: `web/src/components/GapsPanel.tsx`, `web/src/components/GapsPanel.test.tsx`
- Modify: `web/src/components/RecipeForm.tsx:205-215` (render the panel), `web/src/components/RecipeForm.tsx:13-31` (`onAnswer` prop), `web/src/styles.css` (after the `.gaps` rules at 114-116)

**Interfaces:**
- Consumes: `Gap` from the server schema; `Answer`, `MAX_ANSWER_CHARS`, `MAX_ANSWERS` from `../lib/gaps` (Task 4).
- Produces:
  - `GapsPanel({ gaps, onAnswer, applying, error }: { gaps: Gap[]; onAnswer?: (answers: Answer[]) => void; applying?: boolean; error?: string | null })`
  - `RecipeFormProps` gains `onAnswer?`, `answering?: boolean`, `answerError?: string | null`, passed straight through.

- [ ] **Step 1: Write the failing tests**

```tsx
it('renders nothing when there are no gaps', () => { /* container empty */ });
it('renders a bullet and no box for a gap with no question', () => {
  // { about: 'brand', question: null } -> text 'brand', no textbox
});
it('renders a labelled box for each question', () => {
  // getByLabelText('How much red wine did you add?')
});
it('is a read-only list without onAnswer', () => { /* queryAllByRole('textbox') is empty */ });
it('disables the button until something is typed', () => { /* then enabled */ });
it('counts what will be sent', () => {
  // one answer -> 'Answer 1 question'; two -> 'Answer 2 questions'
});
it('sends only the answered gaps', () => {
  // onAnswer called with [{ gap: <the one typed in>, answer: 'about 150ml' }]
});
it('bounds an answer at 200 characters', () => { /* input maxLength attribute */ });
it('keeps what was typed when the apply fails', () => {
  // Review Focus 3: rerender with error set -> the textbox still holds its text, error shown with role="alert"
});
it('shows a spinner and Answering… while applying', () => { /* applying -> disabled button, /Answering/ */ });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run web/src/components/GapsPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `GapsPanel` and render it from `RecipeForm`**

Move the existing `<section className="gaps" aria-label="Check these">` out of `RecipeForm` into the new component unchanged, then add the answer mode. One controlled input per gap with a question, keyed by `about`; the button's label comes from the count of non-empty answers. Without `onAnswer`, render the bullets and no form controls. `RecipeForm` keeps its `gaps` prop and forwards the three new ones.

- [ ] **Step 4: Style the inputs inside the amber card**

Add rules after `.gaps ul` in `web/src/styles.css`, following the existing form fields; the panel's own button follows `.btn.primary`.

- [ ] **Step 5: Run the component tests and the form's**

Run: `npx vitest run web/src/components/GapsPanel.test.tsx web/src/components/RecipeForm.test.tsx`
Expected: PASS — including the existing "Check these" assertions in `RecipeForm.test.tsx`, which must still pass through the moved markup.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: let the Check these panel take answers"
```

---

### Task 6: Answering, on all four pages

**Files:**
- Create: `web/src/lib/useGapAnswers.ts`
- Modify: `web/src/pages/Describe.tsx`, `web/src/pages/Photos.tsx`, `web/src/pages/Import.tsx`, `web/src/pages/Editor.tsx:72-113`
- Test: `web/src/pages/Describe.answers.test.tsx` *(new)*, `web/src/pages/Editor.revise.test.tsx`

**Interfaces:**
- Consumes: `answerInstruction`, `mergeGaps` (Task 4); `GapsPanel`'s props on `RecipeForm` (Task 5); `reviseRecipe` from `../api`; `RecipeForm`'s existing `inputRef`.
- Produces: `useGapAnswers({ gaps, setGaps, current, onRevised })` returning `{ answering, answerError, onAnswer }`, where `current: () => RecipeInput` and `onRevised(input: RecipeInput)` remounts the form.

- [ ] **Step 1: Write the failing tests**

In `web/src/pages/Describe.answers.test.tsx`:

```tsx
it('sends the answered questions as one revise instruction', () => {
  // draft with two gaps, answer one, press the button
  // -> POST /api/ai/revise once, instruction contains 'Q: How much red wine did you add? A: about 150ml'
});
it('answers what is on screen, not the draft as it arrived', () => {
  // edit the title in the form first -> the recipe sent carries the edited title
});
it('keeps the question that was not answered', () => {
  // revise returns gaps: [] -> the unanswered gap is still on screen, the answered one is gone
});
it('shows the error and keeps the typed answer when revise fails', () => {
  // 502 -> role="alert" in the panel, textbox still holds its text
});
it('writes the merged gaps to the device draft', () => {
  // localStorage draft's gaps match what is on screen after the apply
});
```

In `web/src/pages/Editor.revise.test.tsx` — Review Focus 5:

```tsx
it('replaces the gap list on a free-text revise', () => {
  // two gaps before, revise returns one -> only the returned one remains
});
it('merges the gap list when answering', () => {
  // two gaps, answer one, revise returns none -> the unanswered one remains
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run web/src/pages/Describe.answers.test.tsx web/src/pages/Editor.revise.test.tsx`
Expected: FAIL — no answer control is rendered.

- [ ] **Step 3: Implement the hook and wire the three create pages**

Each of Describe, Photos and Import: hold `gaps` in state rather than destructuring it from the draft, pass `inputRef` to `RecipeForm`, use the hook, and bump the form's `key` on a revision. Copy the post-remount effect from `Editor.tsx:40-44` so the merged gaps reach `localStorage` after the remount rather than being overwritten by the old form's unmount flush. No step marks, no change summary, no undo on these three.

- [ ] **Step 4: Wire the editor**

`onRevise(instruction: string, asked?: Gap[])`: with `asked`, `setGaps(mergeGaps(gaps, asked, newGaps))`; without it, `setGaps(newGaps)` as today. The answer handler passes the gaps it asked about. `beforeGaps` keeps recording the list from before the apply, so Undo is unchanged.

- [ ] **Step 5: Run the suite and both typechecks**

Run: `npm test`, `npx tsc -p tsconfig.json --noEmit`, `npx tsc -p web/tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: answer the AI's questions from any draft"
```

---

### Task 7: Release note and the manual pass

**Files:**
- Modify: `docs/deploy.md`

- [ ] **Step 1: Write the release note**

A paragraph in the same voice as the existing feature notes: what the panel does now, that answers apply through the revise endpoint, that an ingredient no step uses is now reported, and that there is no new route, migration or environment variable.

- [ ] **Step 2: Run the whole suite and both typechecks one last time**

Run: `npm test`, `npx tsc -p tsconfig.json --noEmit`, `npx tsc -p web/tsconfig.json --noEmit`
Expected: PASS, no skipped files.

- [ ] **Step 3: Commit**

```bash
git add docs/deploy.md
git commit -m "docs: note the AI's follow-up questions"
```

- [ ] **Step 4: Hand back for the manual pass**

The spec's verification bar is unit tests plus one manual pass: report that the branch is ready and that the questions themselves have not been seen against a real provider yet. Do not deploy from this plan.

---

## Self-Review

**Spec coverage.** Gap shape → Task 1. Gaps that are not missing facts (title, brand) → Task 2 (brand question) and Task 3 (title example in the prompt). Ingredients nothing uses → Task 2 (code) and Task 3 (prompt, both directions). Applying answers → Task 4. What an answer may do → Task 3. Carrying the unanswered questions, merge-only-when-answering → Tasks 4 and 6. Length → Tasks 2 and 4. Enforced in code → Task 2. What it looks like → Task 5. Where it is wired → Task 6. Device drafts → Task 1. Verification → Task 7. No gaps found.

**Type consistency.** `Gap` is defined once in `server/src/recipes/schema.ts` and imported everywhere, server and web. `normaliseGaps`/`unusedIngredientGaps` are named identically in Task 2's Interfaces and in Tasks 2 and 3's wiring. `Answer` is defined in Task 4 and consumed under that name in Tasks 5 and 6. `onAnswer` is the prop name in Tasks 5 and 6 alike. `MAX_GAPS`/`MAX_QUESTION_CHARS` are server-side; `MAX_ANSWERS`/`MAX_ANSWER_CHARS` are web-side — deliberately separate, since the server cannot see the client's inputs.

**Proportion.** Seven tasks against a spec of similar length; no function bodies, only signatures, test names and the assertions the spec pins. Task 1 is the longest because it touches eleven test files, and all eleven are mechanical.
