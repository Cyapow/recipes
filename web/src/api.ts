import type { Recipe, RecipeDraft, RecipeInput, RecipeSummary, Step } from '../../server/src/recipes/schema';
import type { ShoppingItem } from '../../server/src/shopping/repo';
import { tagKey, type Tag } from '../../server/src/recipes/categories';
import type { Box1000 } from '../../server/src/images/store';

import { forgetSignedIn, notifyUnauthorized } from './lib/session';

export type { Recipe, RecipeDraft, RecipeInput, RecipeSummary, Step, ShoppingItem };

export type { Box1000, Tag };

export type ListQuery = { search?: string; brands?: string[]; tags?: Tag[] };

/** What the library can be filtered by, with how many recipes each has. */
export type Facets = { brands: { name: string; count: number }[]; tags: (Tag & { count: number })[] };

/** An API failure that keeps the HTTP status so callers can branch without string matching. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Every call goes through here so a 401 anywhere means signed out. The auth endpoints are
 * excluded: the gate handles /me itself, and a 401 from sign-out must not loop back into it.
 */
async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status === 401 && !url.startsWith('/api/auth/')) {
    forgetSignedIn();
    notifyUnauthorized();
  }
  return res;
}

async function jsonBody(res: Response): Promise<unknown> {
  if (!(res.headers.get('content-type') ?? '').includes('json')) return undefined;
  return res.json().catch(() => undefined);
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, init);
  if (!res.ok) throw new ApiError(`Request failed (${res.status})`, res.status, await jsonBody(res));
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export function listRecipes(q: ListQuery = {}): Promise<RecipeSummary[]> {
  const p = new URLSearchParams();
  if (q.search) p.set('search', q.search);
  for (const b of q.brands ?? []) p.append('brand', b);
  for (const t of q.tags ?? []) p.append('tag', tagKey(t));
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

export const getFacets = (): Promise<Facets> => request('/api/tags');

export async function uploadImage(file: File): Promise<string> {
  const body = new FormData();
  body.append('file', file);
  const res = await apiFetch('/api/images', { method: 'POST', body });
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
  const res = await apiFetch('/api/ai/describe', {
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

/** A draft from photos of a recipe card; dishCrop is where the finished dish is in one of those photos. */
export type PhotosDraft = AiDraft & { dishCrop: ({ sourceImageId: string } & Box1000) | null };

export async function photosRecipe(imageIds: string[]): Promise<PhotosDraft> {
  const res = await fetch('/api/ai/photos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ imageIds }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status, body ?? undefined);
  }
  return (await res.json()) as PhotosDraft;
}

/** Cuts the box out of an image and returns the new image's id. */
export async function cropImage(id: string, box: Box1000): Promise<string> {
  const res = await request<{ id: string }>(`/api/images/${encodeURIComponent(id)}/crop`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(box),
  });
  return res.id;
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
  const res = await apiFetch('/api/import', {
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
  const res = await apiFetch('/api/backup/run', { method: 'POST' });
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

export type Shop = { id: string; name: string; position: number };
export type Pack = { id?: string; label: string; amount: number | null; pricePence: number; clubcardPence: number | null };
export type IngredientRow = {
  key: string; item: string; recipeCount: number;
  /** The unit recipes most often use for it ('' = whole items). */
  usualUnit: string;
  /** null = the default (first) shop. */
  shopId: string | null;
  /** What pack amounts are counted in. */
  unit: string;
  packs: Pack[];
};
export type IngredientInput = { item: string; shopId: string | null; unit: string; packs: Pack[] };

export const listIngredients = (): Promise<{ ingredients: IngredientRow[]; shops: Shop[] }> =>
  request('/api/planner/ingredients');

const putJson = (url: string, body: unknown, method = 'PUT'): Promise<unknown> =>
  request<unknown>(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const saveIngredient = (i: IngredientInput): Promise<void> =>
  putJson('/api/planner/ingredient', {
    ...i, packs: i.packs.map(({ label, amount, pricePence, clubcardPence }) => ({ label, amount, pricePence, clubcardPence })),
  }).then(() => undefined);

export const removeIngredient = (item: string): Promise<void> =>
  request<void>(`/api/planner/ingredient?item=${encodeURIComponent(item)}`, { method: 'DELETE' });

export const addShop = (name: string): Promise<void> => putJson('/api/planner/shops', { name }, 'POST').then(() => undefined);
export const renameShop = (id: string, name: string): Promise<void> =>
  putJson(`/api/planner/shops/${encodeURIComponent(id)}`, { name }).then(() => undefined);
export const deleteShop = (id: string): Promise<void> =>
  request<void>(`/api/planner/shops/${encodeURIComponent(id)}`, { method: 'DELETE' });

export type PackPick = { label: string; count: number; pence: number };
export type BasketItem = {
  key: string; item: string;
  /** null = the default shop. */
  shop: string | null;
  pricePence: number | null;
  picks: PackPick[];
  needed: number | null;
  unit: string;
  unclear: boolean;
  leftover: number | null;
  usedBy: string[];
};
export type PlannerSuggestion = {
  id: string; title: string; shared: string[];
  extra: { item: string; shop: string | null }[];
  extraPence: number; unpricedExtra: string[];
};
export type Plan = {
  selected: { id: string; title: string }[];
  basket: { items: BasketItem[]; totalPence: number; byShop: { shop: string | null; totalPence: number }[]; unpriced: string[] };
  suggestions: PlannerSuggestion[];
  budgetPence: number | null;
  defaultShop: string;
};

export const getPlan = (recipeIds: string[]): Promise<Plan> => putJson('/api/planner/plan', { recipeIds }, 'POST') as Promise<Plan>;

export const getBudget = (): Promise<number | null> =>
  request<{ pence: number | null }>('/api/planner/budget').then((r) => r.pence);

export const saveBudget = (pence: number | null): Promise<void> =>
  putJson('/api/planner/budget', { pence }).then(() => undefined);

export type AddPlanResult = { added: number; alreadyOnList: string[]; elsewhere: { item: string; shop: string }[] };

/** Puts the recipes on the shopping list, each ingredient in the section of its shop. */
export const addPlanToShopping = (recipeIds: string[]): Promise<AddPlanResult> =>
  putJson('/api/planner/add-to-shopping', { recipeIds }, 'POST') as Promise<AddPlanResult>;

export const getAuthConfig = (): Promise<{ clientId: string | null }> => request('/api/auth/config');

export const getMe = (): Promise<{ email: string }> => request('/api/auth/me');

export const signInWithGoogle = (credential: string): Promise<{ email: string }> =>
  request('/api/auth/google', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credential }),
  });

export const signOut = (): Promise<void> =>
  request<unknown>('/api/auth/signout', { method: 'POST' }).then(() => undefined);
