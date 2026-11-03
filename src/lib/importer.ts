import { BlobReader, BlobWriter, ZipReader, ZipWriter, configure } from '@zip.js/zip.js';
import { inlineBlobs, ProjectWriter, requestPersistence, saveProject } from './store';
import { mimeFor } from './mime';
import type { DeckProject, FileEntry, Framework, ImportProgress, InlineFile } from './types';

configure({ useWebWorkers: false });

/** Folders that are never part of what a browser loads. Build output (dist, build, out) is kept on purpose. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '.next', '.nuxt', '.svelte-kit', '.turbo', '.vercel', '.netlify', '.cache', '.parcel-cache', '.angular', '__MACOSX']);
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const BUILT_DIRS = ['dist', 'build', 'out', 'docs', 'www', 'public', 'site', '_site', 'dist/browser', 'build/web'];
const UNSUPPORTED_SOURCES = ['vue', 'svelte', '@angular/core', 'solid-js', 'astro', 'nuxt', '@sveltejs/kit', 'preact', 'lit', '@remix-run/react', 'gatsby'];

type Progress = (progress: ImportProgress) => void;
interface Picked { path: string; read: () => Promise<Blob>; size: number }

export class ImportError extends Error {}

function cleanPath(value: string): string | null {
  const parts = value.replace(/\\/g, '/').split('/').filter((part) => part && part !== '.');
  if (!parts.length) return null;
  if (parts.includes('..')) throw new ImportError('This project contains an unsafe path ("..") and was not imported.');
  if (parts.some((part) => SKIP_DIRS.has(part)) || SKIP_FILES.has(parts[parts.length - 1])) return null;
  return parts.join('/');
}

/** Drops a single wrapping folder, e.g. "my-site/index.html" becomes "index.html". */
function commonPrefix(paths: string[]): string {
  if (!paths.length) return '';
  const first = paths[0].split('/')[0];
  return paths.every((path) => path.startsWith(`${first}/`)) ? `${first}/` : '';
}

function friendlyError(error: unknown): Error {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return new ImportError('There is not enough free storage on this device for this project.');
  if (error instanceof Error) return error;
  return new Error(String(error));
}

export async function detectProject(paths: Set<string>, readText: (path: string) => Promise<string>): Promise<{ framework: Framework; entry: string }> {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
  if (paths.has('package.json')) { try { pkg = JSON.parse(await readText('package.json')); } catch { /* optional */ } }
  const deps = { ...pkg.devDependencies, ...pkg.dependencies };
  const pick = (candidates: string[]) => candidates.find((path) => paths.has(path));
  const built = pick(BUILT_DIRS.map((dir) => `${dir}/index.html`));
  if (built && UNSUPPORTED_SOURCES.some((name) => deps[name])) return { framework: 'HTML', entry: built };
  const next = pick(['app/page.tsx', 'app/page.jsx', 'app/page.js', 'src/app/page.tsx', 'src/app/page.jsx', 'src/app/page.js', 'pages/index.tsx', 'pages/index.jsx', 'pages/index.js', 'src/pages/index.tsx', 'src/pages/index.jsx']);
  if (deps.next || next) {
    if (next) return { framework: 'Next.js', entry: next };
    if (built) return { framework: 'HTML', entry: built };
  }
  const reactEntry = pick(['src/main.tsx', 'src/main.jsx', 'src/main.ts', 'src/main.js', 'src/index.tsx', 'src/index.jsx', 'src/index.js', 'main.tsx', 'main.jsx', 'index.tsx', 'index.jsx']);
  if (paths.has('index.html')) return { framework: deps.react || reactEntry ? 'React' : 'HTML', entry: 'index.html' };
  if (reactEntry && (deps.react || /x$/.test(reactEntry))) return { framework: 'React', entry: reactEntry };
  if (built) return { framework: 'HTML', entry: built };
  const sorted = [...paths].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  const html = sorted.find((path) => /\.html?$/i.test(path) && /(^|\/)index\.html?$/i.test(path)) ?? sorted.find((path) => /\.html?$/i.test(path));
  if (html) return { framework: 'HTML', entry: html };
  const script = sorted.find((path) => /\.(m?[jt]sx?)$/i.test(path));
  if (script) return { framework: 'JavaScript', entry: script };
  throw new ImportError('No web page or script was found in this project.');
}

/** Copies picked files into storage one at a time, so memory use stays flat no matter how big the project is. */
async function store(name: string, picked: Picked[], onProgress?: Progress, signal?: AbortSignal): Promise<DeckProject> {
  if (!picked.length) throw new ImportError('Nothing to import. Choose a folder, ZIP, or files.');
  await requestPersistence();
  const prefix = commonPrefix(picked.map((item) => item.path));
  const id = `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const writer = new ProjectWriter(id);
  const blobs = new Map<string, Blob>();
  const files: FileEntry[] = [];
  const totalBytes = picked.reduce((sum, item) => sum + item.size, 0);
  let bytes = 0;
  let lastReport = 0;
  try {
    for (let index = 0; index < picked.length; index++) {
      if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError');
      const item = picked[index];
      const path = item.path.slice(prefix.length);
      if (!path) continue;
      const type = mimeFor(path);
      const source = await item.read();
      const blob = source.type === type ? source : source.slice(0, source.size, type);
      await writer.add(path, blob);
      blobs.set(path, blob);
      files.push({ path, size: blob.size, type });
      bytes += blob.size;
      const now = performance.now();
      if (onProgress && (now - lastReport > 80 || index === picked.length - 1)) { lastReport = now; onProgress({ phase: 'copying', done: index + 1, total: picked.length, bytes: Math.min(bytes, totalBytes || bytes) }); }
    }
    onProgress?.({ phase: 'saving', done: picked.length, total: picked.length, bytes });
    await writer.flush();
    files.sort((a, b) => a.path.localeCompare(b.path));
    const { framework, entry } = await detectProject(new Set(blobs.keys()), (path) => blobs.get(path)!.text());
    const project: DeckProject = { id, name: name.replace(/\.zip$/i, '').trim() || 'Untitled project', framework, entry, files, totalSize: bytes, createdAt: Date.now() };
    await saveProject(project);
    return project;
  } catch (error) {
    await writer.abort().catch(() => undefined);
    throw friendlyError(error);
  }
}

export async function importFileList(list: FileList | File[], onProgress?: Progress, signal?: AbortSignal): Promise<DeckProject> {
  const input = Array.from(list);
  if (input.length === 1 && /\.zip$/i.test(input[0].name)) return importZip(input[0], onProgress, signal);
  const picked: Picked[] = [];
  for (const file of input) {
    const path = cleanPath(file.webkitRelativePath || file.name);
    if (path) picked.push({ path, size: file.size, read: async () => file });
  }
  const folder = input[0]?.webkitRelativePath?.split('/')[0];
  return store(folder || (input.length === 1 ? input[0].name.replace(/\.[^.]+$/, '') : 'Imported project'), picked, onProgress, signal);
}

export async function importZip(file: File, onProgress?: Progress, signal?: AbortSignal): Promise<DeckProject> {
  onProgress?.({ phase: 'reading', done: 0, total: 0, bytes: 0 });
  let reader: ZipReader<unknown>;
  let entries;
  try {
    reader = new ZipReader(new BlobReader(file));
    entries = await reader.getEntries();
  } catch { throw new ImportError('This ZIP could not be opened. It may be damaged or not a ZIP file.'); }
  const picked: Picked[] = [];
  for (const entry of entries) {
    if (entry.directory || !entry.getData) continue;
    if (entry.encrypted) throw new ImportError('Password-protected ZIP files are not supported.');
    const path = cleanPath(entry.filename);
    const getData = entry.getData.bind(entry);
    if (path) picked.push({ path, size: entry.uncompressedSize, read: () => getData(new BlobWriter(mimeFor(path))) });
  }
  try { return await store(file.name, picked, onProgress, signal); }
  finally { await reader.close().catch(() => undefined); }
}

function readEntryFile(entry: FileSystemFileEntry): Promise<File> { return new Promise((resolve, reject) => entry.file(resolve, reject)); }
function readDirectory(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> { return new Promise((resolve, reject) => reader.readEntries(resolve, reject)); }

async function walk(entry: FileSystemEntry, prefix: string, out: Picked[]): Promise<void> {
  const path = `${prefix}${entry.name}`;
  if (entry.isFile) {
    const clean = cleanPath(path);
    if (!clean) return;
    const file = await readEntryFile(entry as FileSystemFileEntry);
    out.push({ path: clean, size: file.size, read: async () => file });
    return;
  }
  if (!entry.isDirectory || SKIP_DIRS.has(entry.name)) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  for (let batch = await readDirectory(reader); batch.length; batch = await readDirectory(reader)) {
    for (const child of batch) await walk(child, `${path}/`, out);
  }
}

/** Imports a drop: folder, ZIP, or loose files. Must be called synchronously inside the drop handler. */
export function importDataTransfer(data: DataTransfer, onProgress?: Progress, signal?: AbortSignal): Promise<DeckProject> {
  const files = Array.from(data.files);
  const entries = Array.from(data.items ?? []).map((item) => (item.kind === 'file' ? item.webkitGetAsEntry() : null)).filter((entry): entry is FileSystemEntry => entry !== null);
  return (async () => {
    if (!entries.length) return importFileList(files, onProgress, signal);
    if (entries.length === 1 && entries[0].isFile && /\.zip$/i.test(entries[0].name)) return importZip(files[0] ?? await readEntryFile(entries[0] as FileSystemFileEntry), onProgress, signal);
    onProgress?.({ phase: 'reading', done: 0, total: 0, bytes: 0 });
    const picked: Picked[] = [];
    for (const entry of entries) await walk(entry, '', picked);
    const name = entries.length === 1 && entries[0].isDirectory ? entries[0].name : picked.length === 1 ? picked[0].path.replace(/\.[^.]+$/, '') : 'Dropped project';
    return store(name, picked, onProgress, signal);
  })();
}

/** Adds or replaces files. A demo becomes a saved copy so it can be edited. */
export async function addProjectFiles(project: DeckProject, blobs: Map<string, Blob>, input: FileList | File[]): Promise<DeckProject> {
  const target = project.demo ? `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` : project.id;
  const writer = new ProjectWriter(target);
  const files = new Map(project.files.map((file) => [file.path, file]));
  try {
    if (project.demo) for (const [path, blob] of blobs) await writer.add(path, blob);
    for (const file of Array.from(input)) {
      const name = cleanPath(file.name);
      if (!name) continue;
      const matches = [...files.keys()].filter((path) => path.split('/').pop()?.toLowerCase() === name.toLowerCase());
      const path = matches.length === 1 ? matches[0] : name;
      const type = mimeFor(path);
      await writer.add(path, file.slice(0, file.size, type));
      files.set(path, { path, size: file.size, type });
    }
    await writer.flush();
  } catch (error) { throw friendlyError(error); }
  const list = [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
  const updated: DeckProject = { ...project, id: target, demo: false, files: list, totalSize: list.reduce((sum, file) => sum + file.size, 0), createdAt: Date.now() };
  await saveProject(updated);
  return updated;
}

type SavePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{ createWritable: () => Promise<WritableStream> }>;

/** Streams the ZIP straight to disk where the browser allows choosing a location; otherwise downloads it. */
export async function exportProject(project: DeckProject, blobs: Map<string, Blob>): Promise<boolean> {
  const name = `${project.name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'project'}.zip`;
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (picker) {
    let stream: WritableStream;
    try { stream = await (await picker({ suggestedName: name, types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }] })).createWritable(); }
    catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return false; throw error; }
    const zip = new ZipWriter(stream);
    for (const file of project.files) { const blob = blobs.get(file.path); if (blob) await zip.add(file.path, new BlobReader(blob)); }
    await zip.close();
    return true;
  }
  const zip = new ZipWriter(new BlobWriter('application/zip'));
  for (const file of project.files) { const blob = blobs.get(file.path); if (blob) await zip.add(file.path, new BlobReader(blob)); }
  const url = URL.createObjectURL(await zip.close());
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

/** Builds an in-memory project (used for the built-in demos). */
export function inlineProject(meta: Pick<DeckProject, 'id' | 'name' | 'framework' | 'entry'>, files: InlineFile[]): { project: DeckProject; blobs: Map<string, Blob> } {
  const blobs = inlineBlobs(files);
  const entries = [...blobs].map(([path, blob]) => ({ path, size: blob.size, type: blob.type }));
  return { project: { ...meta, files: entries, totalSize: entries.reduce((sum, file) => sum + file.size, 0), createdAt: 0, demo: true }, blobs };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}
