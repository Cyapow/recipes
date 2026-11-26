# Questions the AI can ask back

Date: 2026-11-26
Size: a project (it changes a type shared by four code paths, both AI system prompts, and the form that
every AI draft lands in).

## Intent

When the AI drafts a recipe from a description, photos of a card, or a page, it is forbidden from inventing
anything. What it does instead is list what the input did not say, in `gaps`, which the form shows as a
"Check these" panel: terse phrases like `quantity for red wine`, `cooking time`, `servings`.

That panel tells you something is missing. It does not let you do anything about it. You read
`quantity for red wine`, find the ingredient row, work out which field, and type into it. The AI already
knows what it needs and knows how to ask — it just has no way to ask, and no way to receive the answer.

So: let it ask. Each gap becomes a direct question, and each question gets somewhere to answer it. Answer
one, or all of them, or none, and the draft comes back filled in with exactly what you said.

Mat asked for this as forward planning, not off the back of a bad draft: nothing has gone wrong yet. That
changes the design. A feature built to fix a failure can afford to make everyone pay a little; a feature
built in anticipation of one must cost the good path nothing. So the draft still arrives first, every time,
exactly as it does today. The questions ride along with it.

Pressed for a case that worries him, Mat gave one: *"say I forget to add an ingredient to a step so it
never looks used"*. That turned out to be a gap of a kind the current rule cannot see at all, and it is
treated as a first-class part of this design — see "Ingredients nothing uses".

## Goals

- Every gap the model reports carries a plain question, written to the person, about what they said:
  `How much red wine did you add?` rather than `quantity for red wine`.
- The "Check these" panel becomes answerable: each question has a box beside it.
- Answer any subset and apply them in one go. The draft comes back with those answers in it, and nothing
  else changed.
- Answers obey the same rule everything else obeys: an answer may fill or correct only the thing its
  question asked about. Nothing else may change unless the answer itself states it.
- An answer that does not actually answer (`dunno`, `a splash` where a number was asked for) leaves the
  field empty and the question on the list, reworded if the model can sharpen it.
- Questions that were not answered stay on the list after an apply.
- Work typed into the form before answering survives the apply.
- An ingredient the recipe lists but no step ever uses is asked about, and that question is produced by
  code as well as by the model, so it cannot be missed.
- The same panel works wherever a draft lands: describe, photos, import, and the editor.
- A draft kept on the device from before this change still opens.

## Non-goals

- **A conversation.** One round of questions, answered or ignored. The model may reword a question that was
  answered unusably, but there is no transcript and no second persona. Same decision, same reason, as
  "Describe your edits".
- **Blocking the draft behind the questions.** The draft arrives first, always. Nothing waits for an answer.
- **Field-targeted answers.** A question does not carry a pointer to the form field it would fill, and an
  answer does not write into a field directly. The model receives the answer and decides where it belongs,
  which is the one thing it is reliably better at than a mapping table.
- **Questions about things the input did state.** The model does not get to ask you to confirm what you
  already said, or to second-guess a quantity it read correctly.
- **Re-reading the source.** Answering does not re-fetch the page or re-send the photos. The answers act on
  the draft that came back.
- **Marking the unused ingredient on its own row in the form.** The question names the ingredient, which is
  enough to find it. A second indicator inside the ingredient editor is a separate piece of UI and can come
  later if the question alone proves not to be enough.
- **Voice.** The keyboard's own microphone dictates into the answer boxes as it does everywhere else.

## Anti-goals

Things that would make this worse than the panel it replaces:

- **A question that invents its own premise.** `What temperature did you roast the lamb at?` for a recipe
  that never mentioned an oven teaches the person to distrust every question on the list.
- **An answer that leaks.** Answering `How much red wine?` with `150ml` must not also add a cooking time,
  tidy an unrelated step, or rename the brand. The existing revise rule already forbids this; the answers
  path must not be the hole in it.
- **Twenty questions.** A rough two-line description has a dozen things missing, and listing all twelve as
  sentences turns a scannable panel into a wall.
- **A panel that is half answerable.** A list where some questions have boxes and the rest are mute bullets
  invites you to answer the one thing you cannot. The common gaps all get questions, including the two that
  are made outside the model.
- **Losing the draft to a bad answer.** An apply that produced nonsense and took the form's contents with it
  would be worse than having no answer box at all.
- **Interrogating a complete recipe.** A described recipe with every amount, both times and the servings in
  it gets no questions, because it has no gaps, and the panel does not appear. That is true today and must
  stay true.

## Constraints

- The AI never invents. This is the rule the whole AI pipeline is built on (`SYSTEM_PROMPT`, "A
  half-remembered recipe must stay half-remembered") and questions do not weaken it: a question is the model
  saying what it would have had to invent.
- Everything arriving from the model or the person is untrusted data. Answers need no new prompt tag: the
  client builds them into the instruction text, so they arrive inside the `<instruction>` block that
  `buildReviseMessage` already defangs. Both halves of a pair are untrusted — the question is the model's
  words and the answer is the person's.
- Four providers share these prompts and both tool schemas (`server/src/ai/providers/`). The gap shape is a
  flat object of two strings; objects nested inside arrays already pass every provider's strict schema
  (`AiStepSchema`, `TagSchema`), so this adds no new schema risk.
- `gaps` is persisted in device drafts (`localStorage`, `recipes.drafts`). Drafts written before this change
  hold `string[]` and must keep opening.
- Nothing is saved to the database until the person presses Save. `gaps` is never stored in the database, so
  there is no migration.
- No new route and no new environment variable.

## Approaches

Three ways to let the model ask, considered before anything was written:

**A — Gate the draft behind the questions.** The model judges the input first; if it is too thin it returns
questions and no draft. Answer them, then get a draft. Rejected: it taxes the path that already works.
Today you can throw in rough notes, get a draft, and fix it in the form; this would stop and interrogate you
first. With no actual failure to point at, slowing down the good path to protect against a hypothetical bad
one is the wrong trade.

**C — Make describing a conversation.** The model asks, you answer, repeat, draft at the end. Rejected for
now, and it is the honest best answer for genuinely vague input. It is also the biggest build by a wide
margin — a transcript, a new persisted draft shape, a new page layout — and it would be the only non-form
flow in an app that is otherwise one-shot forms everywhere. If one round of questions turns out not to be
enough in practice, this is the thing to build next, and this design is a step towards it rather than away.

**B — Draft plus answerable questions (chosen).** The draft arrives as it does today. `gaps` grows from a
phrase into a phrase plus a question, the "Check these" panel grows answer boxes, and answering applies
through the revise endpoint that already exists. A complete description still produces no questions and no
panel, so the good path costs nothing. The expensive half of the feature — "apply a change to this recipe
and change nothing else" — was built, reviewed and shipped last week as "Describe your edits".

## The design

### The gap, as a shape

`RecipeDraftSchema.gaps` changes from `z.array(z.string())` to `z.array(GapSchema)`:

```
Gap = { about: string; question: string | null }
```

- `about` is exactly today's phrase: `quantity for red wine`, `servings`, `brand`. It stays because it is
  the terse scannable form, because gaps made in server code rather than by the model use it, and because
  it is the stable identity a gap is matched by when the unanswered ones are carried across an apply.
- `question` is the same gap written to the person, in the second person, referring to what they said, and
  answerable in a few words.
- `question: null` renders as a plain bullet with no box, exactly as today. Its one producer is the
  migration of a device draft written before this change (see "Device drafts"), plus the code guard that
  nulls a blank or over-long question. Every gap this feature newly produces has a question.

Both the draft tool (`AiDraftSchema`) and the revise tool (`AiRevisionSchema`) take the new shape, since
both already carry `gaps`.

### Gaps that are not missing facts

Two of the most frequent gaps in practice are not "the input did not state X", and under a naive reading of
the question rule both would come out as mute bullets — on the typical described recipe and the typical card
photo respectively. Both get questions:

- **`title chosen from your description`** (`draft.ts`, added by the model whenever the person named no
  dish) asks something like `I called this "Beef mince and tomato spaghetti" — what would you call it?`
- **`brand`** (appended in code by the photos route when the card showed no printed brand) asks
  `Whose recipe card is this?` The route writes this question itself; it is not the model's to produce.

An answer to either may set the title or the brand. `REVISE_SYSTEM_PROMPT` already allows an instruction to
change the brand ("comes back exactly as given unless the instruction changes it"), so no new permission is
needed — only the prompt note that an answer is such an instruction.

### Ingredients nothing uses

This is the case Mat raised, and it is a different class from every gap the current rule covers. Today's
rule enumerates **missing fields**. An ingredient that is listed, with its amount, that no step ever touches
is an **internal inconsistency**: nothing is missing, so nothing is reported. The prompt tells the model
*"Include an ingredient only if the step text itself names it"*, so it correctly links nothing and
correctly says nothing. No rewording of the questions would have found it.

It is caught twice, because the two mechanisms fail in opposite directions.

**The model**, in `SYSTEM_PROMPT`: every ingredient should be named by at least one step. If one is not,
add a gap asking which step uses it — unless the input shows it is a seasoning or something served
alongside rather than cooked. Also the reverse: if a step names something that is not in the ingredients
list, add a gap asking for it. The reverse direction is the model's alone; recognising that "garlic" in a
step is an ingredient is language judgment code does not have.

**Code**, as a net that cannot be talked out of it. `toRecipeDraft` already finalises every step's
ingredient links through `mentionsAnySignificantWord`, and `applyRevision` does the same, so the ingredients
no step links are a set difference — deterministic, no model judgment involved. For each one, append a gap
`about: "<item> is not used in any step"` with the question `Which step uses the <item>?`, subject to three
conditions:

- **Only ingredients with a stated quantity.** This is the noise filter. `salt` with no amount that no step
  mentions is almost always "season to taste"; `150ml red wine` that nothing uses is the bug. The model's
  own check, which has the judgment the code lacks, still covers the unquantified ones.
- **Skip an ingredient with no significant words.** An item that is entirely stop words (`optional extra`)
  can never link to any step by construction, so it would be flagged forever.
- **Skip one the model already asked about**, tested with the same `mentionsAnySignificantWord` that is
  already imported in both files: if any existing gap's `about` or `question` names a significant word of
  the ingredient, the code adds nothing.

Answering `Which step uses the red wine?` with `add it with the tomatoes` goes through the revise path like
any other answer, and revise is already able to edit a step.

### Applying answers

Answers go through `POST /api/ai/revise`, unchanged in shape. There is no new endpoint and no new model
call. The instruction is built client-side by `answerInstruction(pairs)` in a new `web/src/lib/gaps.ts`:

```
Here are answers to the questions you asked.
1. Q: How much red wine did you add? A: about 150ml
2. Q: How many does this serve? A: 4
```

This was the pivotal choice, and it beats the obvious alternative of re-running the original draft call with
the answers appended to the input:

- It does not re-send six card photos, or re-fetch a page, to answer one question about an amount.
- It preserves what is already in the form. The revise path takes the recipe *as it now stands* and returns
  it with only the asked-for change; re-drafting would throw away anything typed since the draft arrived.
- The rule it needs is the rule it already has. `REVISE_SYSTEM_PROMPT`'s "the instruction is the only new
  content" is precisely the guarantee an answer needs, and it has a week of tests behind it.
- It is one mechanism for all four surfaces, the editor included.

### What an answer may do

An answer may fill, or correct, the thing its question asked about — including contradicting the draft.
`How much red wine? → "I didn't use wine, I used stock"` swaps the ingredient; `How many does this serve?
→ "it's a double batch, so 8, and I doubled the mince too"` changes both, because the answer states both.

What an answer may not do is cause any change it does not state. That is the line the "answer that leaks"
anti-goal draws, and it is the same line the revise prompt already draws: the person's words are licensed
new content, the model's inferences are not. Refusing to let someone correct their own recipe because the
question was narrower than the answer would be perverse.

*This is a judgment call made while writing this up, not something Mat asked for — worth a look.*

An answer that answers nothing — `dunno`, `not sure`, or a vague amount where a number was asked for —
fills nothing: the field stays as it was and the gap comes back, with a question reworded to ask more
precisely if that is possible.

### Carrying the unanswered questions across

A revise call's own `gaps` describe only the instruction, by design ("It never lists the original recipe's
own omissions"), so the unanswered questions must be carried by the caller. `mergeGaps(before, asked,
returned)`, also in `web/src/lib/gaps.ts`: keep every gap from `before` whose `about` was not among those
just asked, then append everything in `returned`, deduped by `about`. A question that was asked and came
back (because the answer was unusable) returns through `returned`, with the model's sharper wording.

**Merging happens only when answering.** A free-text revise in the editor keeps today's behaviour of
replacing the gap list wholesale, because that is what shipped last week and because `REVISE_SYSTEM_PROMPT`
is written for it. So the editor's revise handler takes the asked gaps as a second argument:
`onRevise(instruction, asked?)` — with `asked`, it merges; without, it replaces. The editor's answer
handler is therefore not quite the one-liner it first looked like: it holds the panel's answer state and
passes the gaps it asked about. Undo restores the gap list from before the apply either way, which is what
`beforeGaps` already does.

### Length

`MAX_REVISE_CHARS` rises from 2,000 to 4,000. Eight question-and-answer pairs do not fit in 2,000 once
either side is wordy, and the failure mode is a 413 "instruction is too long" on exactly the path this
feature exists for. The constant also bounds a typed instruction, so this loosens that too; a bounded
4,000-character instruction is a small token cost next to `MAX_REVISE_RECIPE_CHARS` of 20,000, and the test
that asserts the 413 is written against the constant.

With that, the pieces are bounded so the worst case fits: at most 8 pairs per apply, `question` at most 140
characters (asked for in the prompt, enforced in code), and the answer inputs at `maxLength` 200.

### Enforced in code, not only asked for

The repo's habit is to back a prompt rule with code where only code can guarantee it — `repairAmount`
("the prompt now asks for this, but only code can guarantee it"), the ingredient-link filter, the brand gap.
The same applies here:

- **At most eight gaps**, truncated keeping the first eight, since the prompt asks for the most important
  first. The truncation runs *after* the photos route appends its `brand` gap, so that one counts.
- **A blank or whitespace `question` becomes `null`**, so it degrades to a bullet rather than an empty box.
- **An over-long `question` becomes `null`** for the same reason, rather than being truncated mid-sentence.
- **The unused-ingredient check**, above, which is the strongest case of all: the model may reason its way
  out of mentioning it, and the set difference cannot.

### What it looks like

The "Check these" panel, in `RecipeForm`, keeps its amber card and its heading and gains an optional answer
mode, used when the page passes `onAnswer`:

```
┌─ Check these ─────────────────────────────────┐
│                                               │
│  How much red wine did you add?               │
│  ┌─────────────────────────────────────────┐  │
│  │                                         │  │
│  └─────────────────────────────────────────┘  │
│                                               │
│  Which step uses the parmesan?                │
│  ┌─────────────────────────────────────────┐  │
│  │ grate over at the end                   │  │
│  └─────────────────────────────────────────┘  │
│                                               │
│         ┌──────────────────────────────────┐  │
│         │  Answer 1 question               │  │
│         └──────────────────────────────────┘  │
└───────────────────────────────────────────────┘
```

- One labelled text input per gap that has a question. A gap with no question stays a bullet.
- The button is disabled until something is typed, and counts what will be sent: `Answer 1 question`,
  `Answer 3 questions`. In flight it shows a spinner and `Answering…`, matching every other AI button.
- Answered questions leave the list. Unanswered ones stay, with whatever was typed into them still there.
- An apply that fails leaves every box as it was with an error in the panel, so nothing typed is lost to a
  failed call.
- Without `onAnswer` the panel is exactly today's bullet list.

### Where it is wired

| Page | Gaps from | Answers |
|---|---|---|
| Describe | `/api/ai/describe` | yes |
| Photos | `/api/ai/photos` | yes |
| Import | `/api/ai/describe` via page text (JSON-LD produces no gaps) | yes |
| Editor | `/api/ai/revise` | yes, through `onRevise(instruction, asked)` |

All four, because the mechanism is page-agnostic once answers go through revise.

Describe, Photos and Import get a small shared hook rather than a copy of the editor's revise machinery.
They do **not** get step marks, a change summary or an undo: those exist in the editor because an
instruction there can rewrite a recipe you have had for months, whereas these three pages hold a draft that
is seconds old and unsaved, and an answer to a question the model asked is a narrower act than a free-text
instruction. They each gain the `inputRef` prop `RecipeForm` already supports, so answers apply to what is
on screen rather than to the draft as it first arrived, and they copy the editor's post-remount effect that
writes the revision to the device draft.

Because the question-writing rules decide what the editor's panel shows after its first revise, the whole
rule — second person, no invented premise, most important first, the eight cap, the length — is duplicated
into `REVISE_SYSTEM_PROMPT`, not only summarised there. Without it the editor's panel would stop being
answerable after one revise.

### Device drafts

`Draft.gaps` becomes `Gap[]`. Drafts written before this change hold `string[]`, so the read path in
`web/src/lib/drafts.ts` normalises each entry: a string becomes `{ about: it, question: null }`. An old
draft therefore resumes with its bullets, which is what it had when it was saved. The service worker is
network-first for navigations with nothing precached, so a read-path-only migration is enough and no
forward compatibility is needed.

## Verification

The structural half is ordinary unit testing: the shape, `mergeGaps`, `answerInstruction`, the code guards,
the unused-ingredient check, the draft migration, the panel's behaviour, and the existing tests that assert
on gap strings (`draft.test.ts`, `client.test.ts`, `routes.test.ts`, `importUrl.test.ts`) updated to the new
shape.

The half that only a real provider exercises is question *quality*: invented premises, asking about
something already stated, the ordering, and the reworded-unusable-answer path. The repo's only tool for
that is `server/src/ai/draft.live.test.ts`, gated behind `LIVE_AI=1` and a key per provider.

**Mat's call: unit tests plus one manual pass.** No new live assertions on question quality. The structural
half is covered by unit tests over stubbed model output; the quality half is checked by trying the feature
on a handful of real descriptions before it is deployed, which is the bar "Describe your edits" shipped on
last week. This keeps the prompt wording cheap to adjust once it has been used in anger — the live suite
would pin wording that nobody has lived with yet.

## What is left to the builder

- The shape of the shared hook the three create pages use, and whether the panel's answer state lives in it
  or in the panel. Where `answerInstruction` and `mergeGaps` sit within `web/src/lib/gaps.ts`.
- The exact prompt wording, within the rules above.
- The exact question-length limit (140 characters is the figure the bound was calculated from) and the
  answer input's `maxLength`.
- Whether the unused-ingredient gap's `about` reads as a sentence or a phrase, given it is matched on.
- The CSS for the inputs inside the amber card, following `.gaps` and the existing form fields.
- Test placement, following the file-per-module convention already in the repo.
