import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DriveClient } from './drive.js';

type Folder = { id: string; name: string; parentId: string | undefined };
type File = { id: string; folderId: string; name: string; bytes: Buffer; createdTime: string };

/** In-memory Drive that keeps uploaded bytes and can inject failures. */
export class FakeDrive implements DriveClient {
  uploadCount = 0;
  /** Optional delay per upload, to exercise concurrency. */
  uploadDelayMs = 0;
  inFlight = 0;
  maxInFlight = 0;
  /** Called at the start of every upload (after counting), e.g. to mutate the DB mid-run. */
  onUpload: (() => void) | undefined;
  private seq = 0;
  private folders = new Map<string, Folder>();
  private fileMap = new Map<string, File>();
  private failAt: number | undefined;
  private failure: unknown;

  /** Throw on the nth upload (1-based, counting attempts since construction). */
  failOnUpload(n: number, error: unknown = new Error('upload failed')): void {
    this.failAt = n;
    this.failure = error;
  }
  /** Throw this on every call until cleared with failWith(undefined). */
  failWith(error: unknown): void {
    this.failure = error;
    this.failAt = undefined;
    this.always = error !== undefined;
  }
  private always = false;
  private check(): void {
    if (this.always) throw this.failure;
  }

  async ensureFolder(name: string, parentId?: string): Promise<string> {
    this.check();
    for (const f of this.folders.values()) if (f.name === name && f.parentId === parentId) return f.id;
    const id = `folder-${++this.seq}`;
    this.folders.set(id, { id, name, parentId });
    return id;
  }
  async list(folderId: string) {
    this.check();
    return [...this.fileMap.values()]
      .filter((f) => f.folderId === folderId)
      .map((f) => ({ id: f.id, name: f.name, createdTime: f.createdTime }));
  }
  async upload(a: { folderId: string; name: string; filePath: string }): Promise<string> {
    this.check();
    this.uploadCount++;
    this.onUpload?.();
    if (this.failAt === this.uploadCount) throw this.failure;
    const bytes = readFileSync(a.filePath); // read now: caller may delete the file afterwards
    this.maxInFlight = Math.max(this.maxInFlight, ++this.inFlight);
    try {
      if (this.uploadDelayMs) await new Promise((r) => setTimeout(r, this.uploadDelayMs));
    } finally {
      this.inFlight--;
    }
    const id = `file-${++this.seq}`;
    this.fileMap.set(id, {
      id,
      folderId: a.folderId,
      name: a.name,
      bytes,
      createdTime: new Date(1_700_000_000_000 + this.seq * 1000).toISOString(),
    });
    return id;
  }
  async remove(id: string): Promise<void> {
    this.check();
    this.fileMap.delete(id);
  }

  read(id: string): Buffer {
    const f = this.fileMap.get(id);
    if (!f) throw new Error(`no such file ${id}`);
    return f.bytes;
  }
  files(folderId: string): { id: string; name: string }[] {
    return [...this.fileMap.values()].filter((f) => f.folderId === folderId).map((f) => ({ id: f.id, name: f.name }));
  }
  folderId(name: string, parentId?: string): string | undefined {
    return [...this.folders.values()].find((f) => f.name === name && f.parentId === parentId)?.id;
  }
  folderCount(): number {
    return this.folders.size;
  }
  /** Write a folder tree (subfolders as directories) to a real directory. */
  dumpTo(dir: string, folderId?: string): void {
    mkdirSync(dir, { recursive: true });
    for (const f of this.fileMap.values()) if (f.folderId === folderId) writeFileSync(path.join(dir, f.name), f.bytes);
    for (const sub of this.folders.values()) if (sub.parentId === folderId) this.dumpTo(path.join(dir, sub.name), sub.id);
  }
}
