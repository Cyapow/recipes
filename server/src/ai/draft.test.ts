import { describe, expect, it, vi } from 'vitest';
import { AiInvalidOutputError, AiRequestError, createAnthropicClient } from './client.js';
import { SYSTEM_PROMPT } from './draft.js';

const draft = {
  title: 'Spag bol', description: null, origin: 'mine', sourceName: null, sourceUrl: null,
  servings: null, prepMinutes: null, cookMinutes: null,
  ingredients: [{ group: null, quantity: null, unit: null, item: 'red wine', note: null }],
  steps: ['Brown the mince'], notes: null, tags: [], imageIds: [], gaps: ['quantity for red wine'],
};
const toolUse = (input: unknown) => ({ content: [{ type: 'tool_use', id: 't1', name: 'record_recipe', input }] });
const config = { anthropicApiKey: 'sk-secret', anthropicModel: 'test-model' } as never;

function fake(...replies: Array<unknown | Error>) {
  const create = vi.fn();
  for (const r of replies) r instanceof Error ? create.mockRejectedValueOnce(r) : create.mockResolvedValueOnce(r);
  return { sdk: { messages: { create } } as never, create };
}

describe('SYSTEM_PROMPT', () => {
  it('states the no-invention rule', () => {
    expect(SYSTEM_PROMPT).toContain('never add');
    expect(SYSTEM_PROMPT).toContain('gaps');
    expect(SYSTEM_PROMPT).toMatch(/untrusted/i);
  });
});

describe('createAnthropicClient', () => {
  it('forces the record_recipe tool, delimits user text and returns the validated draft', async () => {
    const { sdk, create } = fake(toolUse(draft));
    const out = await createAnthropicClient(config, sdk).extractRecipe({ kind: 'description', text: 'my spag bol' });
    expect(out).toEqual(draft);
    const [params, opts] = create.mock.calls[0]!;
    expect(params.model).toBe('test-model');
    expect(params.system).toBe(SYSTEM_PROMPT);
    expect(params.tool_choice).toEqual({ type: 'tool', name: 'record_recipe' });
    expect(params.tools[0].name).toBe('record_recipe');
    expect(params.tools[0].input_schema.type).toBe('object');
    expect(params.tools[0].input_schema.$schema).toBeUndefined();
    expect(params.messages[0].content).toContain('<user_description>\nmy spag bol\n</user_description>');
    expect(opts.timeout).toBeGreaterThan(0);
  });

  it('wraps page text with its source url', async () => {
    const { sdk, create } = fake(toolUse(draft));
    await createAnthropicClient(config, sdk).extractRecipe({ kind: 'page', text: 'PAGE', sourceUrl: 'https://x.test/r' });
    const content = create.mock.calls[0]![0].messages[0].content as string;
    expect(content).toContain('<page_text source_url="https://x.test/r">\nPAGE\n</page_text>');
  });

  it('retries once on invalid output, feeding the error back', async () => {
    const { sdk, create } = fake(toolUse({ title: 'x' }), toolUse(draft));
    const out = await createAnthropicClient(config, sdk).extractRecipe({ kind: 'description', text: 't' });
    expect(out).toEqual(draft);
    expect(create).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(create.mock.calls[1]![0].messages)).toContain('tool_result');
  });

  it('throws AiInvalidOutputError after a second invalid output', async () => {
    const { sdk, create } = fake(toolUse({}), { content: [{ type: 'text', text: 'hi' }] });
    await expect(createAnthropicClient(config, sdk).extractRecipe({ kind: 'description', text: 't' })).rejects.toBeInstanceOf(
      AiInvalidOutputError,
    );
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('maps SDK errors to AiRequestError without leaking details', async () => {
    const { sdk } = fake(new Error('401 invalid x-api-key sk-secret'));
    const err = await createAnthropicClient(config, sdk)
      .extractRecipe({ kind: 'description', text: 't' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AiRequestError);
    expect(err.message).not.toContain('sk-secret');
  });

  it('never accepts a max_tokens-truncated result; retries with a larger budget', async () => {
    const { sdk, create } = fake({ ...toolUse(draft), stop_reason: 'max_tokens' }, { ...toolUse(draft), stop_reason: 'tool_use' });
    const out = await createAnthropicClient(config, sdk).extractRecipe({ kind: 'description', text: 't' });
    expect(out).toEqual(draft);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]![0].max_tokens).toBeGreaterThan(create.mock.calls[0]![0].max_tokens);
    expect(create.mock.calls[1]![0].messages).toHaveLength(1);
  });

  it('throws AiInvalidOutputError when truncated twice', async () => {
    const t = { ...toolUse(draft), stop_reason: 'max_tokens' };
    const { sdk, create } = fake(t, t);
    await expect(createAnthropicClient(config, sdk).extractRecipe({ kind: 'description', text: 't' })).rejects.toBeInstanceOf(
      AiInvalidOutputError,
    );
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('leaves normal stop reasons unaffected', async () => {
    for (const stop_reason of ['end_turn', 'tool_use']) {
      const { sdk, create } = fake({ ...toolUse(draft), stop_reason });
      expect(await createAnthropicClient(config, sdk).extractRecipe({ kind: 'description', text: 't' })).toEqual(draft);
      expect(create).toHaveBeenCalledTimes(1);
    }
  });
});
