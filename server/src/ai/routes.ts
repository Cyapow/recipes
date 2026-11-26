import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Config } from '../config.js';
import { AiInvalidOutputError, AiRefusedError, AiRequestError, type AiClient } from './client.js';
import { sourceFromText, type SourceDeps } from '../import/describedSource.js';
import { aiStatus } from './registry.js';
import { IMAGE_ID_RE, normaliseBox, type ImageStore } from '../images/store.js';
import { originForBrand } from '../recipes/categories.js';
import { RecipeInputSchema } from '../recipes/schema.js';

export const MAX_DESCRIBE_CHARS = 20_000;
export const MAX_REVISE_CHARS = 2_000;
/**
 * The recipe sent to be revised, measured as JSON so every field is bounded at once. Same order as
 * MAX_DESCRIBE_CHARS, which bounds a whole described recipe as text; a long real recipe is 1-3 kB. Without it the
 * only bound is Fastify's 1 MiB body limit, and a recipe that big burns the input tokens, truncates, retries at
 * doubled max_tokens and ends as "AI returned an invalid recipe" after two slow calls.
 */
export const MAX_REVISE_RECIPE_CHARS = 20_000;
export const MAX_PHOTOS = 6;

export function aiFailure(err: unknown, reply: FastifyReply) {
  if (err instanceof AiRefusedError) return reply.code(502).send({ error: 'The AI declined this request', code: 'other' });
  if (err instanceof AiInvalidOutputError) return reply.code(502).send({ error: 'AI returned an invalid recipe', code: 'other' });
  if (err instanceof AiRequestError) return reply.code(502).send({ error: err.message, code: err.code });
  return reply.code(502).send({ error: 'AI request failed', code: 'other' });
}

export function registerAiRoutes(app: FastifyInstance, ai: AiClient | undefined, config: Config, source?: SourceDeps) {
  app.get('/api/ai/status', async () => aiStatus(config));

  app.post('/api/ai/describe', async (req, reply) => {
    if (!ai) return reply.code(503).send({ error: 'AI not configured' });
    const text = (req.body as { text?: unknown } | null)?.text;
    if (typeof text !== 'string' || text.trim() === '') return reply.code(400).send({ error: 'text is required' });
    if (text.length > MAX_DESCRIBE_CHARS) return reply.code(413).send({ error: 'text is too long' });
    try {
      const described = text.trim();
      // The recipe is read from the text alone. A link in it only ever adds the page's photo and its name.
      const [{ draft, provider, model }, from] = await Promise.all([
        ai.extractRecipe({ kind: 'description', text: described }),
        source ? sourceFromText(described, source) : Promise.resolve(null),
      ]);
      const { dishPhoto: _dishPhoto, ...rest } = draft;
      return {
        ...rest,
        brand: 'Mine',
        gaps: rest.gaps.filter((g) => g.trim().toLowerCase() !== 'brand'),
        origin: 'mine',
        sourceName: from?.sourceName ?? null,
        sourceUrl: from?.sourceUrl ?? null,
        imageIds: from?.imageIds ?? draft.imageIds,
        provider,
        model,
      };
    } catch (err) {
      return aiFailure(err, reply);
    }
  });

  app.post('/api/ai/photos', async (req, reply) => {
    if (!ai) return reply.code(503).send({ error: 'AI not configured' });
    const store: ImageStore | undefined = source?.images;
    if (!store) return reply.code(503).send({ error: 'Image store not configured' });
    const ids = (req.body as { imageIds?: unknown } | null)?.imageIds;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_PHOTOS || !ids.every((i) => typeof i === 'string' && IMAGE_ID_RE.test(i))) {
      return reply.code(400).send({ error: `imageIds must be 1 to ${MAX_PHOTOS} image ids` });
    }
    const imageIds = [...new Set(ids as string[])];
    const files = await Promise.all(imageIds.map((id) => store.read(id)));
    if (files.some((f) => !f)) return reply.code(400).send({ error: 'An image was not found' });
    try {
      const { draft, provider, model } = await ai.extractRecipe({
        kind: 'photos',
        images: files.map((f) => ({ mediaType: 'image/jpeg' as const, base64: f!.toString('base64') })),
      });
      const { dishPhoto, ...rest } = draft;
      // A box for a photo that does not exist, or one too small to crop, just means no crop.
      const sourceImageId = dishPhoto ? imageIds[dishPhoto.image] : undefined;
      const cropId = dishPhoto && sourceImageId
        ? await store.crop(sourceImageId, { x0: dishPhoto.x0, y0: dishPhoto.y0, x1: dishPhoto.x1, y1: dishPhoto.y1 }).catch((e) => {
          req.log.warn({ err: (e as Error).message }, 'dish crop failed');
          return null;
        })
        : null;
      const brand = rest.brand;
      return {
        ...rest,
        gaps: brand === null && !rest.gaps.some((g) => g.trim().toLowerCase() === 'brand') ? [...rest.gaps, 'brand'] : rest.gaps,
        origin: originForBrand(brand),
        brand,
        sourceName: brand,
        sourceUrl: null,
        imageIds: cropId ? [...new Set([cropId, ...imageIds])] : imageIds,
        dishCrop: cropId && dishPhoto && sourceImageId ? { sourceImageId, ...normaliseBox(dishPhoto) } : null,
        provider,
        model,
      };
    } catch (err) {
      return aiFailure(err, reply);
    }
  });

  app.post('/api/ai/revise', async (req, reply) => {
    if (!ai) return reply.code(503).send({ error: 'AI not configured' });
    const body = req.body as { recipe?: unknown; instruction?: unknown } | null;
    const instruction = body?.instruction;
    if (typeof instruction !== 'string' || instruction.trim() === '') return reply.code(400).send({ error: 'instruction is required' });
    if (instruction.length > MAX_REVISE_CHARS) return reply.code(413).send({ error: 'instruction is too long' });
    // The same schema a save uses, so the AI sees the recipe exactly as it would be stored.
    const parsed = RecipeInputSchema.safeParse(body?.recipe);
    if (!parsed.success) return reply.code(400).send({ error: 'recipe is not a valid recipe' });
    if (JSON.stringify(parsed.data).length > MAX_REVISE_RECIPE_CHARS) return reply.code(413).send({ error: 'recipe is too long' });
    try {
      const { input, stepsFrom, gaps, provider, model } = await ai.reviseRecipe({ recipe: parsed.data, instruction: instruction.trim() });
      // Back through the schema a save uses, so a pathological revision (200+ steps, a 5,000-character step, an
      // "[object Object]") is one clean AI failure here instead of a form that renders and then refuses to save.
      const revised = RecipeInputSchema.safeParse(input);
      if (!revised.success) throw new AiInvalidOutputError();
      return { ...revised.data, gaps, stepsFrom, provider, model };
    } catch (err) {
      return aiFailure(err, reply);
    }
  });
}
