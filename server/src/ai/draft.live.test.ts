import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { linkIngredients } from '../recipes/links.js';
import { foldPlural, tokenize } from '../recipes/words.js';
import { createAiClient, type ProviderName } from './client.js';

const config = loadConfig(process.env);
const live = process.env.LIVE_AI === '1';
const KEYS: Record<ProviderName, string | undefined> = { anthropic: config.anthropicApiKey, openai: config.openaiApiKey, gemini: config.geminiApiKey };
// One run per provider that has a key in the environment; the others are skipped. Keys are never printed.
const PROVIDERS = (['anthropic', 'openai', 'gemini'] as const).map((name) => ({ name, hasKey: Boolean(KEYS[name]) }));

const TEXT =
  'Spag bol: brown some beef mince with a chopped onion and two cloves of garlic, add a tin of chopped tomatoes ' +
  'and a good splash of red wine, simmer for a while, serve over spaghetti.';
// Words the text actually mentions (ingredient items must be traceable to these).
const MENTIONED = ['beef', 'mince', 'onion', 'garlic', 'tomato', 'wine', 'spaghetti'];

const NARRATIVE =
  'I browned 500g beef mince, added an onion, two tins of tomatoes and a splash of red wine, simmered for an hour then tossed it through spaghetti.';
const NAMED = `My spag bol: ${NARRATIVE.charAt(0).toLowerCase()}${NARRATIVE.slice(1)}`;

// Connecting and filler words a step or title may drop or add without inventing anything.
const FILLER = new Set(['then', 'and', 'i', 'a', 'an', 'the', 'of', 'it', 'with', 'in', 'to', 'for', 'my', 'some'].map(foldPlural));
const words = (t: string) => tokenize(t).map(foldPlural).filter((w) => !FILLER.has(w));

function only(name: ProviderName) {
  // Force this provider only: no fallback, so a failure is attributed to the right one.
  return {
    ...config,
    aiProvider: name,
    anthropicApiKey: name === 'anthropic' ? KEYS.anthropic : undefined,
    openaiApiKey: name === 'openai' ? KEYS.openai : undefined,
    geminiApiKey: name === 'gemini' ? KEYS.gemini : undefined,
  };
}

describe.each(PROVIDERS)('live: describe-to-recipe ($name)', ({ name, hasKey }) => {
  it.skipIf(!live || !hasKey)('flags the wine quantity and invents no ingredients', async () => {
    const out = await createAiClient(only(name)).extractRecipe({ kind: 'description', text: TEXT });
    expect(out.provider).toBe(name);
    const draft = out.draft;
    expect(draft.gaps.join(' ').toLowerCase()).toContain('wine');
    const wine = draft.ingredients.find((i) => /wine/i.test(i.item));
    expect(wine?.quantity ?? null).toBeNull();
    // Nothing stated about servings or times.
    expect(draft.servings).toBeNull();
    expect(draft.prepMinutes).toBeNull();
    expect(draft.cookMinutes).toBeNull();
    // Every link must point at an ingredient whose words the step text actually contains.
    for (const step of draft.steps) {
      const named = linkIngredients(step.text, draft.ingredients);
      for (const n of step.ingredients) {
        expect(named, `step "${step.text}" links ${draft.ingredients[n]?.item}`).toContain(n);
      }
    }
    for (const ing of draft.ingredients) {
      expect(MENTIONED.some((w) => ing.item.toLowerCase().includes(w)), `invented: ${ing.item}`).toBe(true);
    }
  }, 60_000);

  it.skipIf(!live || !hasKey)('splits a narrative into reworded recipe steps and titles it plainly', async () => {
    const out = await createAiClient(only(name)).extractRecipe({ kind: 'description', text: NARRATIVE });
    expect(out.provider).toBe(name);
    const draft = out.draft;
    const inputWords = new Set(words(NARRATIVE));

    expect(draft.steps.length).toBeGreaterThanOrEqual(3);
    for (const step of draft.steps) {
      expect(step.text, 'recipe style, not first person').not.toMatch(/^\s*i\s/i);
      // No number, time or temperature the user did not say.
      for (const n of step.text.match(/\d+/g) ?? []) expect(NARRATIVE, `step "${step.text}" has number ${n}`).toContain(n);
      for (const idx of step.ingredients) {
        expect(linkIngredients(step.text, draft.ingredients), `step "${step.text}" links ${draft.ingredients[idx]?.item}`).toContain(idx);
      }
    }

    const titleWords = words(draft.title);
    expect(titleWords.length, `title "${draft.title}"`).toBeGreaterThanOrEqual(2);
    expect(draft.title.trim().split(/\s+/).length).toBeLessThanOrEqual(8);
    for (const w of titleWords) expect(inputWords.has(w), `title "${draft.title}" invents "${w}"`).toBe(true);
    expect(draft.gaps).toContain('title chosen from your description');

    const wine = draft.ingredients.find((i) => /wine/i.test(i.item));
    expect(wine?.quantity ?? null).toBeNull();
    expect(draft.gaps.join(' ').toLowerCase()).toContain('wine');
    for (const ing of draft.ingredients) {
      expect(words(ing.item).every((w) => inputWords.has(w)), `invented: ${ing.item}`).toBe(true);
    }
  }, 60_000);

  it.skipIf(!live || !hasKey)('rewords casual wording into a proper step without adding detail', async () => {
    const text = 'omelette. i started with a cold pan and added olive oil. then cracked 3 eggs in and stired',
      out = await createAiClient(only(name)).extractRecipe({ kind: 'description', text });
    const steps = out.draft.steps.map((x) => x.text);
    const all = steps.join(' | ');
    expect(all).toMatch(/cold pan/i);
    expect(all).toMatch(/olive oil/i);
    expect(all).toMatch(/\bstir/i);
    expect(all, 'typo fixed').not.toMatch(/stired/i);
    expect(all, 'first person removed').not.toMatch(/\bI (started|added)\b/);
    for (const n of all.match(/\d+/g) ?? []) expect(text).toContain(n);
  }, 60_000);

  it.skipIf(!live || !hasKey)('uses a stated dish name as the title with no title gap', async () => {
    const out = await createAiClient(only(name)).extractRecipe({ kind: 'description', text: NAMED });
    expect(out.provider).toBe(name);
    expect(out.draft.title.toLowerCase()).toContain('spag bol');
    expect(out.draft.gaps).not.toContain('title chosen from your description');
  }, 60_000);
});
