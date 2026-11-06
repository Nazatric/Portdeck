import type { DeckProject, FileEntry, FileSource, InlineFile } from './types';
import { mimeFor } from './mime';

/**
 * Projects are stored as a small manifest record plus one Blob per file. Blobs are written by the browser
 * straight to disk, so there is no size limit beyond the device's free storage.
 */
const DB_NAME = 'portdeck';
const DB_VERSION = 1;
const LEGACY_DB = 'portdeck-projects';
const fileKey = (projectId: string, path: string) => `${projectId}\u0000${path}`;

let dbPromise: Promise<IDBDatabase> | null = null;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Storage transaction aborted'));
  });
}

export function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  return dbPromise;
}

/** Asks the browser not to evict PortDeck's storage under pressure. Harmless if refused. */
export async function requestPersistence(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* optional */
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const estimate = await navigator.storage?.estimate();
    return estimate ? { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 } : null;
  } catch {
    return null;
  }
}

/** Writes files in batches so huge projects never hold one enormous transaction open. */
export class ProjectWriter {
  private pending: [string, Blob][] = [];
  private flushing: Promise<void> = Promise.resolve();
  constructor(readonly projectId: string) {}

  async add(path: string, blob: Blob): Promise<void> {
    this.pending.push([path, blob]);
    if (this.pending.length >= 200) await this.flush();
  }

  async flush(): Promise<void> {
    const batch = this.pending;
    this.pending = [];
    if (!batch.length) return this.flushing;
    this.flushing = this.flushing.then(async () => {
      const db = await openDb();
      const tx = db.transaction('files', 'readwrite');
      const files = tx.objectStore('files');
      for (const [path, blob] of batch) files.put(blob, fileKey(this.projectId, path));
      await done(tx);
    });
    return this.flushing;
  }

  async abort(): Promise<void> {
    this.pending = [];
    await this.flushing.catch(() => undefined);
    await deleteFiles(this.projectId);
  }
}

async function deleteFiles(projectId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('files', 'readwrite');
  tx.objectStore('files').delete(IDBKeyRange.bound(`${projectId}\u0000`, `${projectId}\u0001`, false, true));
  await done(tx);
}

export async function saveProject(project: DeckProject): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('projects', 'readwrite');
  tx.objectStore('projects').put(project);
  await done(tx);
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['projects', 'files'], 'readwrite');
  tx.objectStore('projects').delete(id);
  tx.objectStore('files').delete(IDBKeyRange.bound(`${id}\u0000`, `${id}\u0001`, false, true));
  await done(tx);
}

export async function getSavedProjects(): Promise<DeckProject[]> {
  await migrateLegacy();
  const db = await openDb();
  const projects = await request(db.transaction('projects', 'readonly').objectStore('projects').getAll() as IDBRequest<DeckProject[]>);
  return projects.sort((a, b) => b.createdAt - a.createdAt);
}

/** Every file Blob of a project, keyed by path. Blobs are disk-backed handles, so this is cheap even for gigabytes. */
export async function getProjectBlobs(projectId: string): Promise<Map<string, Blob>> {
  const db = await openDb();
  const range = IDBKeyRange.bound(`${projectId}\u0000`, `${projectId}\u0001`, false, true);
  const store = db.transaction('files', 'readonly').objectStore('files');
  const [keys, values] = await Promise.all([request(store.getAllKeys(range)), request(store.getAll(range) as IDBRequest<Blob[]>)]);
  const map = new Map<string, Blob>();
  keys.forEach((key, index) => map.set(String(key).slice(projectId.length + 1), values[index]));
  return map;
}

export function blobSource(blobs: Map<string, Blob>): FileSource {
  return {
    has: (path) => blobs.has(path),
    text: async (path) => {
      const blob = blobs.get(path);
      if (!blob) throw new Error(`File not found: ${path}`);
      return blob.text();
    },
    blob: async (path) => {
      const blob = blobs.get(path);
      if (!blob) throw new Error(`File not found: ${path}`);
      return blob;
    },
  };
}

/** Demo projects keep their few small files inline. */
export function inlineBlobs(files: InlineFile[]): Map<string, Blob> {
  return new Map(files.map((file) => [file.path, new Blob([file.content], { type: mimeFor(file.path) })]));
}

/** Copies projects saved by the previous single-record format (base64 contents) into the per-file store, once. */
async function migrateLegacy(): Promise<void> {
  try {
    if (typeof indexedDB.databases === 'function' && !(await indexedDB.databases()).some((db) => db.name === LEGACY_DB)) return;
    const legacy = await new Promise<IDBDatabase | null>((resolve) => {
      const open = indexedDB.open(LEGACY_DB);
      open.onupgradeneeded = () => {
        open.transaction?.abort();
        resolve(null);
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => resolve(null);
    });
    if (!legacy) return;
    if (!legacy.objectStoreNames.contains('projects')) {
      legacy.close();
      indexedDB.deleteDatabase(LEGACY_DB);
      return;
    }
    type LegacyFile = { path: string; content: string; encoding: 'text' | 'base64'; size: number; mime?: string };
    type LegacyProject = Omit<DeckProject, 'files' | 'totalSize'> & { files: LegacyFile[] };
    const old = await request(legacy.transaction('projects', 'readonly').objectStore('projects').getAll() as IDBRequest<LegacyProject[]>);
    legacy.close();
    for (const project of old) {
      const writer = new ProjectWriter(project.id);
      const files: FileEntry[] = [];
      for (const file of project.files) {
        const type = file.mime || mimeFor(file.path);
        const blob =
          file.encoding === 'base64'
            ? new Blob([Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0))], { type })
            : new Blob([file.content], { type });
        await writer.add(file.path, blob);
        files.push({ path: file.path, size: blob.size, type });
      }
      await writer.flush();
      await saveProject({ ...project, files, totalSize: files.reduce((sum, file) => sum + file.size, 0) });
    }
    indexedDB.deleteDatabase(LEGACY_DB);
  } catch {
    /* Migration is best effort; a failure leaves the old database in place. */
  }
}
