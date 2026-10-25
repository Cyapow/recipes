import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig({});
    expect(c.port).toBe(3000);
    expect(c.anthropicModel).toBe('claude-sonnet-5-5');
    expect(c.backupHour).toBe(3);
    expect(c.dataDir).toBe('/data');
  });
});

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const app = buildApp({ config: loadConfig({}), db: new Database(':memory:') });
    const res = await app.inject({ url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
