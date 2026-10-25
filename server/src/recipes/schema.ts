import { z } from 'zod';
import { IMAGE_ID_RE } from '../images/ids.js';

export const IngredientSchema = z.object({
  group: z.string().nullable(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  item: z.string(),
  note: z.string().nullable(),
});
export type Ingredient = z.infer<typeof IngredientSchema>;

export const StepSchema = z.object({
  text: z.string(),
  imageId: z.string().regex(IMAGE_ID_RE).nullable(),
  ingredients: z.array(z.number().int().min(0)),
});
export type Step = z.infer<typeof StepSchema>;

/**
 * Normalise stored or submitted steps into a valid Step[]: legacy strings become Steps, unreadable entries
 * are dropped, links are deduped, sorted, and dropped when not an integer in [0, ingredientCount).
 * Never throws.
 */
export function normaliseSteps(raw: unknown, ingredientCount: number): Step[] {
  if (!Array.isArray(raw)) return [];
  const out: Step[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      out.push({ text: entry, imageId: null, ingredients: [] });
    } else if (entry && typeof entry === 'object') {
      const e = entry as Record<string, unknown>;
      if (typeof e.text !== 'string') continue;
      const imageId =
        typeof e.imageId === 'string' && IMAGE_ID_RE.test(e.imageId) ? e.imageId : null;
      const links = Array.isArray(e.ingredients) ? e.ingredients : [];
      const ingredients = [
        ...new Set(
          links.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < ingredientCount),
        ),
      ].sort((x, y) => x - y);
      out.push({ text: e.text, imageId, ingredients });
    }
  }
  return out;
}

export const RecipeCoreSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable(),
  origin: z.enum(['mine', 'other']),
  sourceName: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  servings: z.number().nullable(),
  prepMinutes: z.number().nullable(),
  cookMinutes: z.number().nullable(),
  ingredients: z.array(IngredientSchema),
  steps: z.array(StepSchema),
  notes: z.string().nullable(),
  tags: z.array(z.string()),
  imageIds: z.array(z.string()),
});

// Input-only limits; stored data is never re-checked against them.
const MAX_STEPS = 200;
const MAX_STEP_CHARS = 5000;

/** Request body: steps may be legacy strings or Steps; output always has Step[]. */
export const RecipeInputSchema = RecipeCoreSchema.extend({
  steps: z.array(z.union([z.string(), StepSchema])).max(MAX_STEPS),
})
  .superRefine((r, ctx) => {
    r.steps.forEach((s, i) => {
      const text = typeof s === 'string' ? s : s.text;
      const path = typeof s === 'string' ? ['steps', i] : ['steps', i, 'text'];
      if (text.includes('[object Object]')) {
        ctx.addIssue({ code: 'custom', path, message: 'Step text looks corrupted ([object Object])' });
      }
      if (text.length > MAX_STEP_CHARS) {
        ctx.addIssue({ code: 'custom', path, message: `Step text is too long (max ${MAX_STEP_CHARS} characters)` });
      }
      if (typeof s === 'string') return;
      s.ingredients.forEach((n, j) => {
        if (n >= r.ingredients.length) {
          ctx.addIssue({
            code: 'custom',
            path: ['steps', i, 'ingredients', j],
            message: 'Ingredient link out of range',
          });
        }
      });
    });
  })
  .transform((r) => ({ ...r, steps: normaliseSteps(r.steps, r.ingredients.length) }));
export type RecipeInput = z.infer<typeof RecipeInputSchema>;

export const RecipeSchema = RecipeCoreSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Recipe = z.infer<typeof RecipeSchema>;

// No transforms here: keep it representable. The AI tool uses its own schema (AiDraftSchema in ai/draft.ts).
export const RecipeDraftSchema = RecipeCoreSchema.extend({
  gaps: z.array(z.string()),
});
export type RecipeDraft = z.infer<typeof RecipeDraftSchema>;

export type RecipeSummary = {
  id: string;
  title: string;
  origin: 'mine' | 'other';
  sourceName: string | null;
  tags: string[];
  thumbnailId: string | null;
  totalMinutes: number | null;
};
