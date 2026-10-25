import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { createAnthropicClient } from './client.js';

const config = loadConfig(process.env);
const live = process.env.LIVE_AI === '1' && !!config.anthropicApiKey;

const TEXT =
  'Spag bol: brown some beef mince with a chopped onion and two cloves of garlic, add a tin of chopped tomatoes ' +
  'and a good splash of red wine, simmer for a while, serve over spaghetti.';
// Words the text actually mentions (ingredient items must be traceable to these).
const MENTIONED = ['beef', 'mince', 'onion', 'garlic', 'tomato', 'wine', 'spaghetti'];

describe.skipIf(!live)('live: describe-to-recipe', () => {
  it('flags the wine quantity and invents no ingredients', async () => {
    const draft = await createAnthropicClient(config).extractRecipe({ kind: 'description', text: TEXT });
    expect(draft.gaps.join(' ').toLowerCase()).toContain('wine');
    const wine = draft.ingredients.find((i) => /wine/i.test(i.item));
    expect(wine?.quantity ?? null).toBeNull();
    // Nothing stated about servings or times, and the text describes at most four actions.
    expect(draft.servings).toBeNull();
    expect(draft.prepMinutes).toBeNull();
    expect(draft.cookMinutes).toBeNull();
    expect(draft.steps.length).toBeLessThanOrEqual(4);
    for (const ing of draft.ingredients) {
      expect(MENTIONED.some((w) => ing.item.toLowerCase().includes(w)), `invented: ${ing.item}`).toBe(true);
    }
  }, 60_000);
});
