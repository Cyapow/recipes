/**
 * Contract every implementation must honour, including the real Google client (Task 10).
 */
export interface DriveClient {
  /** Find-or-create a folder among NON-trashed folders only; must never create duplicates. */
  ensureFolder(name: string, parentId?: string): Promise<string>;
  /**
   * MUST return ALL non-trashed entries of the folder, following every page (Drive's default page
   * size is 100, max 1000). A truncated list makes every later image get re-uploaded nightly, and
   * Drive allows duplicate names.
   */
  list(folderId: string): Promise<{ id: string; name: string; createdTime: string }[]>;
  /** Upload the local file; returns the new file id. */
  upload(a: { folderId: string; name: string; filePath: string }): Promise<string>;
  /** Delete by id. */
  remove(id: string): Promise<void>;
}

export { createGoogleDriveClient } from './googleDrive.js';
