export interface DriveClient {
  ensureFolder(name: string, parentId?: string): Promise<string>;
  list(folderId: string): Promise<{ id: string; name: string; createdTime: string }[]>;
  upload(a: { folderId: string; name: string; filePath: string }): Promise<string>;
  remove(id: string): Promise<void>;
}
