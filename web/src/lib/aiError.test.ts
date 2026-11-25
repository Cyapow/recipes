import { describe, expect, it } from 'vitest';
import { ApiError } from '../api';
import { describeAiError } from './aiError';

describe('describeAiError', () => {
  it('names the missing configuration plainly', () => {
    expect(describeAiError(new Error('AI not configured'), 'fallback')).toContain('AI is not configured on this server');
  });
  it('passes a server sentence through when the code is specific', () => {
    const sentence = 'The AI account is out of credit. Add credit or switch provider.';
    expect(describeAiError(new ApiError(sentence, 502, { code: 'no_credit' }), 'fallback')).toBe(sentence);
  });
  it('falls back for an unspecific failure', () => {
    expect(describeAiError(new Error('boom'), 'Could not revise')).toBe('Could not revise: boom');
  });
  it('treats the "other" code as unspecific', () => {
    expect(describeAiError(new ApiError('raw', 502, { code: 'other' }), 'Could not revise')).toBe('Could not revise: raw');
  });
  it('gives just the fallback when there is no message', () => {
    expect(describeAiError('weird', 'Could not revise')).toBe('Could not revise');
  });
});
