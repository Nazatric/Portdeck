import { init, parse } from 'es-module-lexer/minimal';

/**
 * Downloads remote modules, stylesheets, scripts, and fonts once, then serves them from Cache Storage.
 * Versioned CDN URLs never change, so cache-first is safe and makes those projects work offline later.
 */
const CACHE_NAME = 'portdeck-net-v1';
const MAX_MODULES = 3000;
const REACT_BARE = /^(react|react-dom)(\/|$)/;

export interface NetContext {
  /** Remote module code keyed by absolute URL; imports inside are rewritten to absolute URLs. */
  modules: Map<string, string>;
  /** Remote binary or script files keyed by "@net/<url>". */
  assets: Map<string, Blob>;
  /** Hosts or packages that could not be stored for offline use. */
  missing: Set<string>;
  /** Hosts served from the local cache or freshly stored. */
  stored: Set<string>;
  inflight: Map<string, Promise<boolean>>;
}

export function createNetContext(): NetContext {
  return { modules: new Map(), assets: new Map(), missing: new Set(), stored: new Set(), inflight: new Map() };
}

let cachePromise: Promise<Cache | null> | null = null;
function openCache(): Promise<Cache | null> {
  cachePromise ??= (typeof caches === 'undefined' ? Promise.resolve(null) : caches.open(CACHE_NAME).catch(() => null));
  return cachePromise;
}

const host = (url: string) => { try { return new URL(url).host; } catch { return url; } };
export const netKey = (url: string) => `@net/${url}`;

/** Cache first, network second. Returns null when neither has it (offline and never seen, or no CORS). */
export async function cachedFetch(url: string): Promise<Response | null> {
  const cache = await openCache();
  const hit = await cache?.match(url).catch(() => undefined);
  if (hit) return hit;
  try {
    const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!response.ok) return null;
    if (cache) await cache.put(url, response.clone()).catch(() => undefined);
    return response;
  } catch { return null; }
}

/** Loads a remote ES module and everything it imports. Returns false if it could not be stored. */
export function loadNetModule(url: string, ctx: NetContext): Promise<boolean> {
  if (ctx.modules.has(url)) return Promise.resolve(true);
  const running = ctx.inflight.get(url);
  if (running) return running;
  const task = (async () => {
    if (ctx.modules.size >= MAX_MODULES) return false;
    const response = await cachedFetch(url);
    if (!response) { ctx.missing.add(host(url)); return false; }
    const base = response.url || url;
    const code = await response.text();
    await init;
    let imports;
    try { [imports] = parse(code); } catch { ctx.modules.set(url, code); return true; }
    const children: Promise<boolean>[] = [];
    const pieces: string[] = [];
    let cursor = 0;
    for (const item of imports) {
      if (item.d === -2 || !item.n) continue;
      const spec = item.n;
      if (REACT_BARE.test(spec)) continue;
      let absolute: string;
      try { absolute = new URL(spec, base).href; } catch { continue; }
      if (!/^https?:/.test(absolute)) continue;
      pieces.push(code.slice(cursor, item.s), item.d > -1 ? JSON.stringify(absolute) : absolute);
      cursor = item.e;
      children.push(loadNetModule(absolute, ctx));
    }
    pieces.push(code.slice(cursor));
    ctx.modules.set(url, pieces.join(''));
    ctx.stored.add(host(url));
    await Promise.all(children);
    return true;
  })();
  ctx.inflight.set(url, task);
  return task;
}

/** Stores a remote file (classic script, font, image) and returns its asset key, or null if unavailable. */
export async function loadNetAsset(url: string, ctx: NetContext): Promise<string | null> {
  const key = netKey(url);
  if (ctx.assets.has(key)) return key;
  const response = await cachedFetch(url);
  if (!response) { ctx.missing.add(host(url)); return null; }
  ctx.assets.set(key, await response.blob());
  ctx.stored.add(host(url));
  return key;
}

/** Loads a remote stylesheet, inlining its @imports and storing every font and image it references. */
export async function loadNetCss(url: string, ctx: NetContext, token: (key: string) => string, depth = 0): Promise<string | null> {
  const response = await cachedFetch(url);
  if (!response) { ctx.missing.add(host(url)); return null; }
  const base = response.url || url;
  let css = await response.text();
  ctx.stored.add(host(url));
  const imports = [...css.matchAll(/@import\s+(?:url\()?\s*['"]?([^'")\s;]+)['"]?\s*\)?[^;]*;/g)];
  for (const match of imports) {
    if (depth > 4) break;
    let absolute: string;
    try { absolute = new URL(match[1], base).href; } catch { continue; }
    const inner = await loadNetCss(absolute, ctx, token, depth + 1);
    css = css.replace(match[0], inner ?? `@import url("${absolute}");`);
  }
  const urls = [...new Set([...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((match) => match[2]).filter((value) => !/^(data:|#)/.test(value)))];
  const resolved = await Promise.all(urls.map(async (value) => {
    let absolute: string;
    try { absolute = new URL(value, base).href; } catch { return [value, null] as const; }
    const key = await loadNetAsset(absolute, ctx);
    return [value, key ? token(key) : absolute] as const;
  }));
  for (const [value, replacement] of resolved) if (replacement) css = css.split(value).join(replacement);
  return css;
}
