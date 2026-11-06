import { cachedFetch } from './net';

/**
 * Bundles npm packages from the npm registry, bypassing CDN transform services like esm.sh.
 *
 * esm.sh and jsdelivr's +esm endpoint route every import through a package's "exports" map. That
 * breaks drizzle-orm: its "./pg-core/utils" exports entry points at the array-only
 * pg-core/utils/index.js, while the file its query builders import file-relative
 * (pg-core/utils.js, which exports extractUsedTable) is a different file entirely. Node resolves
 * the file-relative import to the file, so this module reproduces Node's ESM semantics:
 *
 *   - the "exports" map is consulted ONLY for the public entry specifier (drizzle-orm/pg-core…);
 *   - every import INSIDE the package is resolved file-relative against the extracted tarball;
 *   - the package's own files are served exactly as published, so resolution is always consistent.
 *
 * npm tarballs are gzip'd TAR, read here with DecompressionStream plus a small ustar/pax parser.
 * The tarball is immutable, so Cache Storage keeps it for offline previews.
 */

export interface NpmPackage {
  name: string;
  version: string;
  /** Extracted files, keyed by path relative to the tarball root ("package/" is stripped). */
  files: Map<string, string>;
  dependencies: Record<string, string>;
  exportsField: unknown;
  module: string | undefined;
  main: string | undefined;
}

const MAX_FILES = 6000;
const MAX_BYTES = 24 * 1024 * 1024;
const TEXT_FILE = /\.(m?js|cjs|json)$/;
const decoder = new TextDecoder('utf-8');

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

/** Parses a TAR archive into its regular files. Handles ustar prefixes, GNU long names and PAX paths. */
export function parseTar(bytes: Uint8Array): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const text = (start: number, length: number) => {
    let end = start;
    while (end < start + length && bytes[end] !== 0) end++;
    return decoder.decode(bytes.subarray(start, end));
  };
  const octal = (start: number, length: number) => {
    const raw = text(start, length).trim();
    if (!raw) return 0;
    const parsed = parseInt(raw, 8);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const parsePaxPath = (data: Uint8Array): string | null => {
    // PAX extended header records: "<length> <key>=<value>\n"
    let cursor = 0;
    while (cursor < data.length) {
      const space = data.indexOf(0x20, cursor);
      if (space === -1) break;
      const length = parseInt(decoder.decode(data.subarray(cursor, space)), 10);
      if (!Number.isFinite(length) || length <= 0) break;
      const record = decoder.decode(data.subarray(space + 1, cursor + length));
      const equals = record.indexOf('=');
      const newline = record.indexOf('\n');
      if (equals !== -1 && newline === record.length - 1 && record.slice(0, equals) === 'path') return record.slice(equals + 1, newline);
      cursor += length;
    }
    return null;
  };
  let offset = 0;
  let pendingLongName: string | null = null;
  let pendingPaxPath: string | null = null;
  while (offset + 512 <= bytes.length) {
    const header = offset;
    let allZero = true;
    for (let index = 0; index < 512; index++) {
      if (bytes[header + index] !== 0) {
        allZero = false;
        break;
      }
    }
    if (allZero) {
      offset += 512;
      continue;
    }
    const name = text(header, 100);
    const size = octal(header + 124, 12);
    const typeflag = bytes[header + 156];
    const magic = text(header + 257, 6);
    const prefix = magic.startsWith('ustar') ? text(header + 345, 155) : '';
    const fullName = prefix ? `${prefix}/${name}` : name;
    const dataStart = offset + 512;
    const dataEnd = Math.min(dataStart + size, bytes.length);
    const padded = dataStart + Math.ceil(size / 512) * 512;
    if (typeflag === 76) {
      // GNU long name: the payload is the name of the next entry.
      pendingLongName = decoder.decode(bytes.subarray(dataStart, dataEnd)).replace(/\0[\s\S]*$/, '');
    } else if (typeflag === 120 || typeflag === 103) {
      // PAX extended header ('x') or global header ('g'): look for a path override.
      pendingPaxPath = parsePaxPath(bytes.subarray(dataStart, dataEnd)) ?? pendingPaxPath;
    } else if (typeflag === 0 || typeflag === 48 || typeflag === 55) {
      const fileName = pendingPaxPath ?? pendingLongName ?? fullName;
      pendingPaxPath = null;
      pendingLongName = null;
      files.set(normalizeNpmPath(fileName), bytes.subarray(dataStart, dataEnd));
    } else {
      pendingPaxPath = null;
      pendingLongName = null;
    }
    if (files.size > MAX_FILES || dataEnd > MAX_BYTES) break;
    offset = padded;
  }
  return files;
}

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

/** Probes the extracted files for an entry: exact path, extension probing, directory index. */
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

/** Fetches, decompresses and extracts a package tarball, or null when it cannot be bundled. */
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
  if (typeof DecompressionStream === 'undefined') return null;
  const tarballResponse = await cachedFetch(tarballUrl);
  if (!tarballResponse) return null;
  const blob = await tarballResponse.blob();
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  const extracted = parseTar(new Uint8Array(buffer));
  const files = new Map<string, string>();
  let total = 0;
  for (const [path, data] of extracted) {
    const clean = stripTarballRoot(path);
    if (!TEXT_FILE.test(clean)) continue;
    if (/\.d\.(m?ts|cts)$/.test(clean)) continue;
    total += data.byteLength;
    if (files.size >= MAX_FILES || total > MAX_BYTES) break;
    files.set(clean, decoder.decode(data));
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
