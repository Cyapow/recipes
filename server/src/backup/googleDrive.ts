import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { DriveClient } from './drive.js';

/** The slice of OAuth2Client.request() we use; injectable so tests need no network. */
export type DriveRequest = (opts: {
  url: string;
  method?: string;
  params?: Record<string, string | number | boolean>;
  data?: unknown;
  headers?: Record<string, string>;
  /** Streams cannot be replayed, so uploads turn gaxios' automatic retry off. */
  retry?: boolean;
  /** Milliseconds; without it gaxios never times out. */
  timeout?: number;
}) => Promise<{ data: any; headers?: any }>;

export type DriveTimeouts = { apiMs: number; uploadMinMs: number; uploadMaxMs: number; uploadBytesPerSec: number };
export const DEFAULT_DRIVE_TIMEOUTS: DriveTimeouts = {
  apiMs: 60_000,
  uploadMinMs: 2 * 60_000,
  uploadMaxMs: 30 * 60_000,
  uploadBytesPerSec: 200 * 1024,
};

/** Upload deadline scales with size (assumes at least ~200 KB/s), between the min and max. */
export function uploadTimeoutMs(size: number, t: DriveTimeouts): number {
  return Math.min(t.uploadMaxMs, Math.max(t.uploadMinMs, Math.ceil((size / t.uploadBytesPerSec) * 1000)));
}

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Escape a literal for use inside a single-quoted Drive `q` string. */
export function escapeQ(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function header(h: any, name: string): string | undefined {
  if (!h) return undefined;
  if (typeof h.get === 'function') return h.get(name) ?? undefined;
  const k = Object.keys(h).find((x) => x.toLowerCase() === name.toLowerCase());
  return k ? String(h[k]) : undefined;
}

/**
 * Real DriveClient over Drive v3 REST. Scope drive.file means we only ever see files this app created.
 * Errors from `request` propagate untouched (they carry status/code, which describeError inspects).
 */
export function createGoogleDriveClient(request: DriveRequest, timeouts: Partial<DriveTimeouts> = {}): DriveClient {
  const t: DriveTimeouts = { ...DEFAULT_DRIVE_TIMEOUTS, ...timeouts };
  return {
    async ensureFolder(name, parentId) {
      const q = `name = '${escapeQ(name)}' and mimeType = '${FOLDER_MIME}' and '${escapeQ(parentId ?? 'root')}' in parents and trashed = false`;
      const found = await request({ url: FILES, method: 'GET', params: { q, fields: 'files(id)', pageSize: 10, spaces: 'drive' }, timeout: t.apiMs });
      const id = found.data?.files?.[0]?.id as string | undefined;
      if (id) return id;
      const created = await request({
        url: FILES,
        method: 'POST',
        params: { fields: 'id' },
        data: { name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) },
        timeout: t.apiMs,
      });
      return created.data.id as string;
    },

    async list(folderId) {
      const out: { id: string; name: string; createdTime: string }[] = [];
      let pageToken: string | undefined;
      do {
        const res = await request({
          url: FILES,
          method: 'GET',
          params: {
            q: `'${escapeQ(folderId)}' in parents and trashed = false`,
            fields: 'nextPageToken, files(id, name, createdTime)',
            pageSize: 1000,
            spaces: 'drive',
            ...(pageToken ? { pageToken } : {}),
          },
          timeout: t.apiMs,
        });
        out.push(...(res.data?.files ?? []));
        pageToken = res.data?.nextPageToken || undefined;
      } while (pageToken);
      return out;
    },

    async upload({ folderId, name, filePath }) {
      // Resumable upload: metadata first, then stream the bytes from disk (never buffered whole).
      const size = (await stat(filePath)).size;
      const init = await request({
        url: UPLOAD,
        method: 'POST',
        params: { uploadType: 'resumable', fields: 'id' },
        data: { name, parents: [folderId] },
        headers: { 'X-Upload-Content-Length': String(size) },
        retry: false,
        timeout: t.apiMs,
      });
      const location = header(init.headers, 'location');
      if (!location) throw new Error('Drive did not return an upload session URL');
      const done = await request({
        url: location,
        method: 'PUT',
        data: createReadStream(filePath),
        headers: { 'Content-Length': String(size), 'Content-Type': 'application/octet-stream' },
        retry: false,
        timeout: uploadTimeoutMs(size, t),
      });
      return done.data.id as string;
    },

    async remove(id) {
      await request({ url: `${FILES}/${encodeURIComponent(id)}`, method: 'DELETE', timeout: t.apiMs });
    },
  };
}
