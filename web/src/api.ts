import type { Recipe, RecipeDraft, RecipeInput, RecipeSummary, Step } from '../../server/src/recipes/schema';
import type { ShoppingItem } from '../../server/src/shopping/repo';

export type { Recipe, RecipeDraft, RecipeInput, RecipeSummary, Step, ShoppingItem };

export type ListQuery = { search?: string; origin?: 'mine' | 'other'; tag?: string };

/** An API failure that keeps the HTTP status so callers can branch without string matching. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

async function jsonBody(res: Response): Promise<unknown> {
  if (!(res.headers.get('content-type') ?? '').includes('json')) return undefined;
  return res.json().catch(() => undefined);
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new ApiError(`Request failed (${res.status})`, res.status, await jsonBody(res));
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export function listRecipes(q: ListQuery = {}): Promise<RecipeSummary[]> {
  const p = new URLSearchParams();
  if (q.search) p.set('search', q.search);
  if (q.origin) p.set('origin', q.origin);
  if (q.tag) p.set('tag', q.tag);
  const qs = p.toString();
  return request(`/api/recipes${qs ? `?${qs}` : ''}`);
}

export const getRecipe = (id: string): Promise<Recipe> => request(`/api/recipes/${encodeURIComponent(id)}`);

export function saveRecipe(id: string | null, input: RecipeInput): Promise<Recipe> {
  return request(id ? `/api/recipes/${encodeURIComponent(id)}` : '/api/recipes', {
    method: id ? 'PUT' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export const deleteRecipe = (id: string): Promise<void> =>
  request(`/api/recipes/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const listTags = (): Promise<string[]> => request('/api/tags');

export async function uploadImage(file: File): Promise<string> {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch('/api/images', { method: 'POST', body });
  if (res.status === 413) throw new Error('image is too large (15 MB max)');
  if (res.status === 415) throw new Error('not a supported image');
  if (!res.ok) throw new Error(`upload failed (${res.status})`);
  return ((await res.json()) as { id: string }).id;
}

export type AiProviderName = 'anthropic' | 'openai' | 'gemini';
export type AiErrorCode = 'no_credit' | 'auth' | 'rate_limit' | 'unavailable' | 'timeout' | 'model_unavailable' | 'other';
export type AiStatus = {
  providers: Array<{ name: AiProviderName; label: string; configured: boolean; model: string }>;
  active: AiProviderName | null;
};
export const getAiStatus = (): Promise<AiStatus> => request('/api/ai/status');

/** A draft from the AI, plus who answered. provider/model are display-only and must never be saved. */
export type AiDraft = RecipeDraft & { provider?: AiProviderName; model?: string };

export async function describeRecipe(text: string): Promise<AiDraft> {
  const res = await fetch('/api/ai/describe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status, body ?? undefined);
  }
  return (await res.json()) as AiDraft;
}

export type ImportResult = {
  draft: RecipeDraft;
  usedAi: boolean;
  usable: boolean;
  provider?: AiProviderName;
  model?: string;
  aiError?: { error: string; code: AiErrorCode };
};

export async function importRecipe(url: string): Promise<ImportResult> {
  const res = await fetch('/api/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status, body ?? undefined);
  }
  return (await res.json()) as ImportResult;
}

export type Banner = 'none' | 'not_connected' | 'failed' | 'stale';
export type BackupStatus = {
  configured: boolean;
  connected: boolean;
  account: string | null;
  banner: Banner;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastUploadAt: string | null;
  running: boolean;
};
export type BackupRunResult = { ok: true; uploadedImages: number; snapshot: string; skipped?: true } | { ok: false; error: string };

export const getBackupStatus = (): Promise<BackupStatus> => request('/api/backup/status');

export async function runBackupNow(): Promise<BackupRunResult> {
  const res = await fetch('/api/backup/run', { method: 'POST' });
  const body = (await res.json().catch(() => null)) as (BackupRunResult & { error?: string }) | null;
  if (res.ok && body) return body;
  return { ok: false, error: body?.error ?? `Request failed (${res.status})` };
}

export const disconnectGoogle = (): Promise<void> =>
  request<unknown>('/api/backup/google/disconnect', { method: 'POST' }).then(() => undefined);

export const listShopping = (): Promise<ShoppingItem[]> =>
  request<{ items: ShoppingItem[] }>('/api/shopping').then((r) => r.items);

/**
 * Rejects with ApiError 409 and body `{error:'already_on_list', recipeTitle}` unless `force` is set, or
 * `{error:'recipe_changed'}` when `expectedUpdatedAt` no longer matches the stored recipe.
 */
export const addToShopping = (
  recipeId: string,
  indexes: number[],
  force?: boolean,
  expectedUpdatedAt?: string,
): Promise<{ added: number }> =>
  request<{ added: number; items: ShoppingItem[] }>('/api/shopping/add', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      recipeId,
      indexes,
      ...(force ? { force: true } : {}),
      ...(expectedUpdatedAt !== undefined ? { expectedUpdatedAt } : {}),
    }),
  }).then((r) => ({ added: r.added }));

export const removeShoppingItem = (id: string): Promise<void> =>
  request<void>(`/api/shopping/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const clearShopping = (): Promise<void> =>
  request<unknown>('/api/shopping', { method: 'DELETE' }).then(() => undefined);
