import { describe, expect, it } from 'vitest';
import { RecipeDraftSchema, RecipeInputSchema, normaliseSteps } from './schema.js';

describe('normaliseSteps', () => {
  it('converts strings, dedupes/sorts links and drops invalid ones', () => {
    expect(
      normaliseSteps(['a', { text: 'b', imageId: null, ingredients: [2, 0, 2, 9, -1, 1.5] }], 3),
    ).toEqual([
      { text: 'a', imageId: null, ingredients: [] },
      { text: 'b', imageId: null, ingredients: [0, 2] },
    ]);
    expect(normaliseSteps('nope', 3)).toEqual([]);
  });
});

describe('(g) RecipeDraftSchema', () => {
  it('still exists, takes Step objects and converts to JSON schema', async () => {
    const { z } = await import('zod');
    const draft = {
      title: 't', description: null, origin: 'mine', sourceName: null, sourceUrl: null, servings: null,
      prepMinutes: null, cookMinutes: null, ingredients: [], steps: [{ text: 's', imageId: null, ingredients: [] }],
      notes: null, tags: [], imageIds: [], gaps: [],
    };
    expect(RecipeDraftSchema.safeParse(draft).success).toBe(true);
    expect(() => z.toJSONSchema(RecipeDraftSchema)).not.toThrow();
    expect(RecipeInputSchema.safeParse({ ...draft, steps: ['s'] }).success).toBe(true);
  });
});
