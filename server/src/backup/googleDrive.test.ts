import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGoogleDriveClient, escapeQ, uploadTimeoutMs, DEFAULT_DRIVE_TIMEOUTS, type DriveRequest } from './googleDrive.js';

type Call = Parameters<DriveRequest>[0];

describe('google drive client', () => {
  it('list follows nextPageToken across 3 pages, filters trashed, pageSize 1000', async () => {
    const calls: Call[] = [];
    const pages: Record<string, any> = {
      '': { files: [{ id: '1', name: 'a', createdTime: 't' }], nextPageToken: 'p2' },
      p2: { files: [{ id: '2', name: 'b', createdTime: 't' }], nextPageToken: 'p3' },
      p3: { files: [{ id: '3', name: 'c', createdTime: 't' }] },
    };
    const c = createGoogleDriveClient(async (o) => {
      calls.push(o);
      return { data: pages[String(o.params?.pageToken ?? '')] };
    });
    const files = await c.list('folder1');
    expect(files.map((f) => f.id)).toEqual(['1', '2', '3']);
    expect(calls).toHaveLength(3);
    expect(calls[0].params?.q).toBe("'folder1' in parents and trashed = false");
    expect(calls.every((x) => x.params?.pageSize === 1000)).toBe(true);
  });

  it('ensureFolder finds an existing non-trashed folder, escaping the name', async () => {
    const calls: Call[] = [];
    const c = createGoogleDriveClient(async (o) => {
      calls.push(o);
      return { data: { files: [{ id: 'f9' }] } };
    });
    expect(await c.ensureFolder("O'Brien\\", 'par')).toBe('f9');
    expect(calls).toHaveLength(1);
    const q = String(calls[0].params?.q);
    expect(q).toContain("name = 'O\\'Brien\\\\'");
    expect(q).toContain("mimeType = 'application/vnd.google-apps.folder'");
    expect(q).toContain("'par' in parents");
    expect(q).toContain('trashed = false');
    expect(escapeQ("a'b\\c")).toBe("a\\'b\\\\c");
  });

  it('ensureFolder creates under root/parent when missing', async () => {
    const calls: Call[] = [];
    const c = createGoogleDriveClient(async (o) => {
      calls.push(o);
      return { data: o.method === 'POST' ? { id: 'new' } : { files: [] } };
    });
    expect(await c.ensureFolder('Recipes backup')).toBe('new');
    expect(String(calls[0].params?.q)).toContain("'root' in parents");
    expect(calls[1].data).toEqual({ name: 'Recipes backup', mimeType: 'application/vnd.google-apps.folder' });
    await c.ensureFolder('snapshots', 'rootId');
    expect((calls[3].data as any).parents).toEqual(['rootId']);
  });

  it('upload sends metadata (name, parents), then streams the file to the session URL', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gd-'));
    const file = path.join(dir, 'x.bin');
    writeFileSync(file, 'hello');
    const calls: Call[] = [];
    const c = createGoogleDriveClient(async (o) => {
      calls.push(o);
      if (o.method === 'POST') return { data: {}, headers: { Location: 'https://upload/session1' } };
      return { data: { id: 'file42' } };
    });
    expect(await c.upload({ folderId: 'fold', name: 'x.bin', filePath: file })).toBe('file42');
    expect(calls[0].data).toEqual({ name: 'x.bin', parents: ['fold'] });
    expect(calls[0].params?.uploadType).toBe('resumable');
    expect(calls[1].url).toBe('https://upload/session1');
    expect(calls[1].method).toBe('PUT');
    expect(calls[1].headers?.['Content-Length']).toBe('5');
    expect(typeof (calls[1].data as any).pipe).toBe('function'); // a stream, not a Buffer
    (calls[1].data as any).destroy();
  });

  it('remove deletes by id', async () => {
    const calls: Call[] = [];
    const c = createGoogleDriveClient(async (o) => (calls.push(o), { data: undefined }));
    await c.remove('abc');
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toMatch(/\/files\/abc$/);
  });

  it('a 401 surfaces with its status', async () => {
    const c = createGoogleDriveClient(async () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401, code: 401 });
    });
    await expect(c.list('f')).rejects.toMatchObject({ status: 401, code: 401 });
  });

  it('every request kind carries a timeout; the PUT scales with size', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gd-'));
    const file = path.join(dir, 'x.bin');
    writeFileSync(file, 'hello');
    const calls: Call[] = [];
    const c = createGoogleDriveClient(async (o) => {
      calls.push(o);
      if (o.method === 'POST' && o.params?.uploadType) return { data: {}, headers: { location: 'https://u/s' } };
      if (o.method === 'PUT') return { data: { id: 'f' } };
      return { data: { files: [] , id: 'x' } };
    }, { apiMs: 111, uploadMinMs: 222 });
    await c.ensureFolder('a'); // GET + POST
    await c.list('f');
    await c.upload({ folderId: 'f', name: 'n', filePath: file });
    await c.remove('z');
    expect(calls).toHaveLength(6);
    expect(calls.map((x) => x.timeout)).toEqual([111, 111, 111, 111, 222, 111]);
    (calls[4].data as any).destroy();
    const t = DEFAULT_DRIVE_TIMEOUTS;
    expect(uploadTimeoutMs(1, t)).toBe(t.uploadMinMs);
    expect(uploadTimeoutMs(100 * 1024 * 1024, t)).toBe(Math.ceil((100 * 1024 * 1024) / t.uploadBytesPerSec) * 1000);
    expect(uploadTimeoutMs(10 * 1024 ** 3, t)).toBe(t.uploadMaxMs);
  });
});
