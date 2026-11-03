export type Framework = 'React' | 'Next.js' | 'HTML' | 'JavaScript';

/** One file in a project manifest. Contents live separately (IndexedDB Blob, disk, or inline for demos). */
export interface FileEntry {
  path: string;
  size: number;
  type: string;
}

export interface DeckProject {
  id: string;
  name: string;
  framework: Framework;
  /** File the preview starts from: an HTML page or a JS/TS entry module. */
  entry: string;
  files: FileEntry[];
  totalSize: number;
  createdAt: number;
  demo?: boolean;
}

/** Inline file used by the built-in demos. */
export interface InlineFile {
  path: string;
  content: string;
}

/** Read access to a project's file contents, independent of where they are stored. */
export interface FileSource {
  has(path: string): boolean;
  text(path: string): Promise<string>;
  blob(path: string): Promise<Blob>;
}

export interface DemoCatalogItem {
  id: string;
  name: string;
  framework: string;
  sortOrder: number;
}

export interface ImportProgress {
  phase: 'reading' | 'copying' | 'saving';
  done: number;
  total: number;
  bytes: number;
}
