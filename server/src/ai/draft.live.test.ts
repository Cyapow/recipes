import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { linkIngredients } from '../recipes/links.js';
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

describe.each(PROVIDERS)('live: describe-to-recipe ($name)', ({ name, hasKey }) => {
  it.skipIf(!live || !hasKey)('flags the wine quantity and invents no ingredients', async () => {
    // Force this provider only: no fallback, so a failure is attributed to the right one.
    const only = {
      ...config,
      aiProvider: name,
      anthropicApiKey: name === 'anthropic' ? KEYS.anthropic : undefined,
      openaiApiKey: name === 'openai' ? KEYS.openai : undefined,
      geminiApiKey: name === 'gemini' ? KEYS.gemini : undefined,
    };
    const out = await createAiClient(only).extractRecipe({ kind: 'description', text: TEXT });
    expect(out.provider).toBe(name);
    const draft = out.draft;
    expect(draft.gaps.join(' ').toLowerCase()).toContain('wine');
    const wine = draft.ingredients.find((i) => /wine/i.test(i.item));
    expect(wine?.quantity ?? null).toBeNull();
    // Nothing stated about servings or times, and the text describes at most four actions.
    expect(draft.servings).toBeNull();
    expect(draft.prepMinutes).toBeNull();
    expect(draft.cookMinutes).toBeNull();
    expect(draft.steps.length).toBeLessThanOrEqual(4);
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
});
