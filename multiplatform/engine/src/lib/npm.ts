import { BlobReader, TextWriter, ZipReader, configure } from '@zip.js/zip.js';
import { cachedFetch } from './net';

/**
 * Bundles npm packages straight from the registry, bypassing CDN transform services.
 *
 * es-module-lexer and fetch alone cannot run a bundler, but they CAN reconstruct Node's module
 * semantics: fetch the tarball, extract it, then resolve imports file-relative (exactly what Node
 * does for ESM) and only resolve the public entry specifier through the package's "exports" map.
 * This matters because CDN services that route every import through "exports" can silently drop
 * things: drizzle-orm ships pg-core/utils.js (with extractUsedTable) AND a "./pg-core/utils"
 * exports entry that points at the array-only utils/ directory. jsdelivr/esm.sh builds map the
 * relative import to the exports entry, so the query builders fail to link with
 * "does not provide an export named 'extractUsedTable'". File-relative resolution serves the
 * file the package author actually wrote, which always works.
 */

configure({ useWebWorkers: false });

export interface NpmPackage {
  name: string;
  version: string;
  /** Extracted text files, keyed by path relative to the tarball root, forward slashes. */
  files: Map<string, string>;
  dependencies: Record<string, string>;
  exportsField: unknown;
  module: string | undefined;
  main: string | undefined;
}

const MAX_FILES = 6000;
const MAX_BYTES = 24 * 1024 * 1024;
const TEXT_FILE = /\.(m?js|cjs|json)$/;

export const normalizeNpmPath = (path: string): string => {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
};

const stripTarballRoot = (filename: string): string => {
  const slash = filename.indexOf('/');
  return slash === -1 ? normalizeNpmPath(filename) : normalizeNpmPath(filename.slice(slash + 1));
};

/** Walks a condition object ("import", "browser", "default"…) and returns the first matching leaf. */
export function resolveConditions(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const resolved = resolveConditions(entry);
      if (resolved) return resolved;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  for (const condition of ['browser', 'import', 'module', 'default']) {
    if (condition in obj) {
      const resolved = resolveConditions(obj[condition]);
      if (resolved) return resolved;
    }
  }
  return null;
}

const replaceStar = (value: unknown, inner: string): unknown => {
  if (typeof value === 'string') return value.split('*').join(inner);
  if (Array.isArray(value)) return value.map((entry) => replaceStar(entry, inner));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) out[key] = replaceStar(entry, inner);
    return out;
  }
  return value;
};

/** Resolves a subpath export ("." or "./pg-core") against the package's "exports" field. */
export function resolveExports(exportsField: unknown, subpath: string): string | null {
  const sub = !subpath || subpath === '.' ? '.' : subpath.startsWith('./') ? subpath : `./${subpath}`;
  if (exportsField == null) return null;
  if (typeof exportsField === 'string') return sub === '.' ? exportsField : null;
  if (Array.isArray(exportsField)) {
    for (const entry of exportsField) {
      const resolved = resolveExports(entry, sub);
      if (resolved) return resolved;
    }
    return null;
  }
  const map = exportsField as Record<string, unknown>;
  const keys = Object.keys(map);
  const isSubpathMap = keys.some((key) => key.startsWith('.'));
  if (!isSubpathMap) return sub === '.' ? resolveConditions(map) : null;
  if (Object.prototype.hasOwnProperty.call(map, sub)) return resolveConditions(map[sub]);
  // Wildcard patterns: longest static prefix wins.
  let best: { prefixLength: number; inner: string; target: unknown } | null = null;
  for (const [pattern, target] of Object.entries(map)) {
    const star = pattern.indexOf('*');
    if (star === -1) continue;
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (!sub.startsWith(prefix) || !sub.endsWith(suffix)) continue;
    if (sub.length < prefix.length + suffix.length) continue;
    const inner = sub.slice(prefix.length, sub.length - suffix.length);
    if (!best || prefix.length > best.prefixLength) best = { prefixLength: prefix.length, inner, target };
  }
  return best ? resolveConditions(replaceStar(best.target, best.inner)) : null;
}

/** Probes the extracted files for an entry point: exact path, extension probing, directory index. */
export function probeNpmFile(files: Map<string, string>, base: string): string | null {
  const clean = normalizeNpmPath(base);
  const candidates = [
    clean,
    `${clean}.js`,
    `${clean}.mjs`,
    `${clean}.cjs`,
    `${clean}.json`,
    `${clean}/index.js`,
    `${clean}/index.mjs`,
    `${clean}/index.cjs`,
    `${clean}/index.json`,
  ];
  for (const candidate of candidates) if (files.has(candidate)) return candidate;
  return null;
}

/** Resolves the specifier sub-path of a bare import to a file inside the extracted tarball. */
export function resolveEntrySubpath(pkg: NpmPackage, subpath: string): string | null {
  const sub = normalizeNpmPath(subpath);
  let target = resolveExports(pkg.exportsField, sub === '' ? '.' : `./${sub}`);
  if (!target && pkg.exportsField == null) target = sub === '' ? (pkg.module ?? pkg.main ?? 'index.js') : sub;
  // Lenient fallback: an unmatched subpath is probed on the filesystem anyway.
  if (!target) target = sub;
  return probeNpmFile(pkg.files, target);
}

const metaCache = new Map<string, Promise<NpmPackage | null>>();

/** Fetches, verifies and extracts a package tarball, or null when it cannot be bundled. */
export function loadNpmPackage(name: string, version: string): Promise<NpmPackage | null> {
  const key = `${name}@${version}`;
  let pending = metaCache.get(key);
  if (!pending) {
    pending = extractPackage(name, version).catch(() => null);
    metaCache.set(key, pending);
  }
  return pending;
}

async function extractPackage(name: string, version: string): Promise<NpmPackage | null> {
  const metaResponse = await cachedFetch(`https://registry.npmjs.org/${name}/${version}`);
  if (!metaResponse) return null;
  const meta = (await metaResponse.json()) as {
    dist?: { tarball?: string };
    dependencies?: Record<string, string>;
    exports?: unknown;
    module?: string;
    main?: string;
  };
  const tarballUrl = meta?.dist?.tarball;
  if (!tarballUrl) return null;
  const tarballResponse = await cachedFetch(tarballUrl);
  if (!tarballResponse) return null;
  const blob = await tarballResponse.blob();
  const reader = new ZipReader(new BlobReader(blob));
  const files = new Map<string, string>();
  let total = 0;
  try {
    for (const entry of await reader.getEntries()) {
      if (entry.directory || !entry.getData) continue;
      const path = stripTarballRoot(entry.filename);
      if (!TEXT_FILE.test(path)) continue;
      if (/\.d\.(m?ts|cts)$/.test(path)) continue;
      const text = await entry.getData(new TextWriter());
      total += text.length;
      if (files.size >= MAX_FILES || total > MAX_BYTES) break;
      files.set(path, text);
    }
  } finally {
    await reader.close().catch(() => undefined);
  }
  if (files.size === 0) return null;
  return {
    name,
    version,
    files,
    dependencies: meta?.dependencies ?? {},
    exportsField: meta?.exports,
    module: meta?.module,
    main: meta?.main,
  };
}
