import type { PreviewBundle } from './compiler';
import type { FileSource } from './types';
import { REACT_VENDORS } from './vendor/react.generated';

/**
 * Runs inside the sandboxed preview frame (opaque origin). The parent posts the bundle plus file Blobs;
 * this script turns them into blob URLs owned by the frame, writes the page in with document.write,
 * and patches the runtime so project-relative URLs keep working. Kept as plain ES2017 in a raw string
 * so it is self-contained and never touched by the app's bundler. It must not contain "${".
 */
const RUNTIME = String.raw`(function () {
  'use strict';
  var TOKEN = Math.random().toString(36).slice(2) + Date.now().toString(36);
  var host = window.parent;
  var MISSING = 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2264%22 height=%2264%22%3E%3Crect width=%2264%22 height=%2264%22 fill=%22%232b2b2b%22/%3E%3C/svg%3E';
  function send(type, extra) { try { host.postMessage(Object.assign({ __portdeck: true, token: TOKEN, type: type }, extra || {}), '*'); } catch (e) {} }
  function format(value) {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack ? String(value.stack).split('\n').slice(0, 4).join('\n') : String(value);
    try { return JSON.stringify(value); } catch (e) { return String(value); }
  }
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
    var original = console[level];
    console[level] = function () {
      var args = Array.prototype.slice.call(arguments);
      send('log', { level: level === 'debug' ? 'log' : level, text: args.map(format).join(' ').slice(0, 4000) });
      return original.apply(console, args);
    };
  });
  function norm(path) {
    var out = [];
    path.split('/').forEach(function (part) { if (!part || part === '.') return; if (part === '..') out.pop(); else out.push(part); });
    return out.join('/');
  }
  function dirOf(path) { var i = path.lastIndexOf('/'); return i >= 0 ? path.slice(0, i + 1) : ''; }
  function define(target, name, value) { try { Object.defineProperty(target, name, { configurable: true, get: function () { return value; } }); } catch (e) {} }

  function start(p) {
    var files = p.files || null;
    var assetBase = p.assetBase || '';
    var paths = new Set(p.paths);
    var root = p.root || '';
    var pageDir = dirOf(p.page || '');
    var urls = new Map();
    var moduleKeys = new Set(Object.keys(p.modules));
    // The payload carries the base path the preview is served from, when one is set.
    function stripBase(path) {
      var base = p.basePath || '';
      if (base && path.indexOf(base) === 0) { path = path.slice(base.length); if (path.charAt(0) !== '/') path = '/' + path; }
      return path || '/';
    }

    function objectUrl(key, blob) { var url = urls.get(key); if (!url) { url = URL.createObjectURL(blob); urls.set(key, url); } return url; }
    function encodePath(path) { return path.split('/').map(encodeURIComponent).join('/'); }
    function assetUrl(key) {
      if (key.indexOf('@vendor/') === 0) return p.vendorAssets[key] ? objectUrl(key, p.vendorAssets[key]) : null;
      if (key.indexOf('@net/') === 0) { var net = p.netAssets.get(key); return net ? objectUrl(key, net) : key.slice(5); }
      if (files) { var blob = files.get(key); return blob ? objectUrl(key, blob) : null; }
      return paths.has(key) ? assetBase + encodePath(key) : null;
    }
    var TOKEN_RE = /pd-(asset|module|style):\/\/+([A-Za-z0-9%._~-]+)/g;
    function tokens(text) {
      if (text.indexOf('pd-') === -1) return text;
      return text.replace(TOKEN_RE, function (match, kind, value) {
        var key = decodeURIComponent(value);
        if (kind === 'asset') return assetUrl(key) || MISSING;
        if (kind === 'module') return moduleUrl(key) || 'data:text/javascript,';
        return styleUrl(key) || 'data:text/css,';
      });
    }
    function moduleUrl(key) {
      var url = urls.get('m:' + key);
      if (url) return url;
      var code = p.modules[key];
      if (code === undefined) return null;
      url = URL.createObjectURL(new Blob([tokens(code)], { type: 'text/javascript' }));
      urls.set('m:' + key, url);
      return url;
    }
    function styleUrl(key) {
      var url = urls.get('s:' + key);
      if (url) return url;
      var css = p.styles[key];
      if (css === undefined) return null;
      url = URL.createObjectURL(new Blob([tokens(css)], { type: 'text/css' }));
      urls.set('s:' + key, url);
      return url;
    }

    /* ---- Project-relative URL resolution for anything the app requests at runtime ---- */
    function localPath(raw) {
      if (typeof raw !== 'string') { if (raw && typeof raw.href === 'string') raw = raw.href; else return null; }
      var value = raw.trim();
      if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)) return null;
      var cut = value.search(/[?#]/);
      var hash = cut >= 0 && value.charAt(cut) === '#' ? value.slice(cut) : (value.indexOf('#') > -1 ? value.slice(value.indexOf('#')) : '');
      var path = cut >= 0 ? value.slice(0, cut) : value;
      try { path = decodeURI(path); } catch (e) {}
      var candidates = path.charAt(0) === '/' ? [norm(root + path), norm(path), norm('public/' + path)] : [norm(pageDir + path), norm(root + path)];
      for (var i = 0; i < candidates.length; i++) if (paths.has(candidates[i])) return { key: candidates[i], hash: hash };
      return null;
    }
    function rewrite(value) {
      var hit = localPath(value);
      if (!hit) return value;
      var url = assetUrl(hit.key);
      return url ? url + hit.hash : value;
    }
    function rewriteSrcset(value) {
      return String(value).split(',').map(function (part) { var bits = part.trim().split(/\s+/); bits[0] = rewrite(bits[0]); return bits.join(' '); }).join(', ');
    }
    function rewriteCssUrls(text) {
      return text.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, function (match, quote, value) { var next = rewrite(value); return next === value ? match : 'url("' + next + '")'; });
    }
    function resourceAttr(el, name) {
      if (name === 'href' || name === 'xlink:href') { var tag = el.localName; return tag === 'link' || tag === 'use' || tag === 'image' || (tag === 'a' && el.hasAttribute('download')); }
      return name === 'src' || name === 'srcset' || name === 'poster' || name === 'data' || name === 'background';
    }

    var nativeFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      if (typeof input === 'string' || input instanceof URL) { var url = String(input); var next = rewrite(url); if (next !== url) return nativeFetch(next, init); }
      return nativeFetch(input, init);
    };
    var nativeOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) { var args = Array.prototype.slice.call(arguments); args[1] = rewrite(String(url)); return nativeOpen.apply(this, args); };
    var nativeSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      var lower = String(name).toLowerCase();
      if (typeof value === 'string' && resourceAttr(this, lower)) value = lower === 'srcset' ? rewriteSrcset(value) : rewrite(value);
      else if (lower === 'style' && typeof value === 'string' && value.indexOf('url(') > -1) value = rewriteCssUrls(value);
      return nativeSetAttribute.call(this, name, value);
    };
    var nativeSetAttributeNS = Element.prototype.setAttributeNS;
    Element.prototype.setAttributeNS = function (ns, name, value) {
      if (typeof value === 'string' && /(^|:)href$/i.test(name) && resourceAttr(this, 'href')) value = rewrite(value);
      return nativeSetAttributeNS.call(this, ns, name, value);
    };
    [['HTMLImageElement', 'src'], ['HTMLImageElement', 'srcset'], ['HTMLSourceElement', 'src'], ['HTMLSourceElement', 'srcset'], ['HTMLMediaElement', 'src'],
      ['HTMLVideoElement', 'poster'], ['HTMLScriptElement', 'src'], ['HTMLLinkElement', 'href'], ['HTMLIFrameElement', 'src'], ['HTMLEmbedElement', 'src'],
      ['HTMLObjectElement', 'data'], ['HTMLTrackElement', 'src'], ['HTMLInputElement', 'src']].forEach(function (pair) {
      var proto = window[pair[0]] && window[pair[0]].prototype;
      var descriptor = proto && Object.getOwnPropertyDescriptor(proto, pair[1]);
      if (!descriptor || !descriptor.set) return;
      Object.defineProperty(proto, pair[1], { configurable: true, enumerable: descriptor.enumerable, get: descriptor.get, set: function (value) { descriptor.set.call(this, pair[1] === 'srcset' ? rewriteSrcset(value) : rewrite(value)); } });
    });
    var NativeAudio = window.Audio;
    window.Audio = function (src) { return src === undefined ? new NativeAudio() : new NativeAudio(rewrite(src)); };
    window.Audio.prototype = NativeAudio.prototype;
    ['Worker', 'SharedWorker'].forEach(function (name) {
      var Native = window[name];
      if (!Native) return;
      var Wrapped = function (url, options) { return new Native(rewrite(url), options); };
      Wrapped.prototype = Native.prototype;
      window[name] = Wrapped;
    });
    /* Opaque-origin frames cannot push real history states; never let one throw. */
    ['pushState', 'replaceState'].forEach(function (name) {
      var original = history[name];
      history[name] = function (state, title, url) { try { return original.call(history, state, title, url); } catch (e) { return original.call(history, state, title); } };
    });
    /* Computed dynamic imports land here; resolve the module keys the compiler precompiled. */
    window.__pdImport = function (importer, spec) {
      if (typeof spec === 'string' && (spec.charAt(0) === '.' || spec.charAt(0) === '/')) {
        var base = norm(spec.charAt(0) === '/' ? root + spec.slice(1) : dirOf(importer) + spec);
        var options = [base, base + '.js', base + '.mjs', base + '.cjs', base + '.ts', base + '.tsx', base + '.jsx', base + '.json', base + '.css', base + '/index.js', base + '/index.mjs', base + '/index.ts', base + '/index.tsx', base + '/index.jsx'];
        for (var i = 0; i < options.length; i++) if (moduleKeys.has('@pd/' + options[i])) return import('@pd/' + options[i]);
        return Promise.reject(new Error('Cannot find module "' + spec + '" from ' + importer));
      }
      return import(spec);
    };

    /* ---- Browser features the sandbox blocks, replaced with in-memory versions ---- */
    var stored = p.storage || {};
    function memoryStorage(data, persist) {
      var api = {
        getItem: function (key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
        setItem: function (key, value) { data[String(key)] = String(value); if (persist) send('storage', { data: data }); },
        removeItem: function (key) { delete data[key]; if (persist) send('storage', { data: data }); },
        clear: function () { Object.keys(data).forEach(function (key) { delete data[key]; }); if (persist) send('storage', { data: data }); },
        key: function (index) { return Object.keys(data)[index] || null; },
      };
      Object.defineProperty(api, 'length', { get: function () { return Object.keys(data).length; } });
      return api;
    }
    try { window.localStorage.setItem('__pd', '1'); window.localStorage.removeItem('__pd'); } catch (e) { define(window, 'localStorage', memoryStorage(stored, true)); }
    try { window.sessionStorage.getItem('__pd'); } catch (e) { define(window, 'sessionStorage', memoryStorage({}, false)); }
    try { void document.cookie; } catch (e) {
      var jar = {};
      Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: function () { return Object.keys(jar).map(function (key) { return key + '=' + jar[key]; }).join('; '); },
        set: function (value) {
          var pair = String(value).split(';')[0];
          var index = pair.indexOf('=');
          if (index < 1) return;
          var key = pair.slice(0, index).trim();
          if (/max-age=0|expires=thu, 01 jan 1970/i.test(value)) delete jar[key]; else jar[key] = pair.slice(index + 1).trim();
        },
      });
    }
    var registration = { scope: '/', active: null, installing: null, waiting: null, update: function () { return Promise.resolve(); }, unregister: function () { return Promise.resolve(true); }, addEventListener: function () {}, removeEventListener: function () {} };
    var serviceWorker = {
      controller: null, ready: new Promise(function () {}),
      register: function () { send('log', { level: 'info', text: 'Service worker registration is skipped in the preview.' }); return Promise.resolve(registration); },
      getRegistration: function () { return Promise.resolve(undefined); }, getRegistrations: function () { return Promise.resolve([]); },
      addEventListener: function () {}, removeEventListener: function () {}, startMessages: function () {},
    };
    try { Object.defineProperty(Navigator.prototype, 'serviceWorker', { configurable: true, get: function () { return serviceWorker; } }); } catch (e) {}
    var idbBlocked = false;
    try { if (!window.indexedDB) idbBlocked = true; else window.indexedDB.open('__pd_probe').onsuccess = function (event) { try { event.target.result.close(); } catch (x) {} }; } catch (e) { idbBlocked = true; }
    window.__pdInstallIDB = function () {
      var fake = window.__pdFakeIDB;
      if (!fake) return;
      Object.keys(fake).forEach(function (name) { if (name !== 'default' && /^(indexedDB|IDB)/.test(name)) define(window, name, fake[name]); });
    };

    /* ---- Import map and page ---- */
    var imports = {};
    if (p.vendor && p.vendor.bundle) imports['@portdeck/react'] = objectUrl('v:bundle', p.vendor.bundle);
    if (p.vendor && p.vendor.modules) Object.keys(p.vendor.modules).forEach(function (spec) { var url = objectUrl('v:' + spec, p.vendor.modules[spec]); imports[spec] = url; imports['@portdeck/vendor/' + spec] = url; });
    var userImports = p.userImports || {};
    Object.keys(userImports).forEach(function (spec) { var target = userImports[spec]; imports[spec] = p.modules[target] !== undefined ? moduleUrl(target) : target; });
    Object.keys(p.modules).forEach(function (key) { imports[key] = moduleUrl(key); });
    var head = '<script type="importmap">' + JSON.stringify({ imports: imports }).replace(/</g, '\\u003c') + '<\/script>';
    if (idbBlocked && p.vendorAssets && p.vendorAssets['@vendor/idb']) head += '<script src="' + assetUrl('@vendor/idb') + '"><\/script><script>window.__pdInstallIDB()<\/script>';
    var html = tokens(p.html || '');
    if (html.indexOf('<!--PD_HEAD-->') !== -1) html = html.replace('<!--PD_HEAD-->', head);
    else if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, function (tag) { return tag + head; });
    else html = head + html;

    window.addEventListener('popstate', function () { send('history', { path: stripBase(location.pathname + location.search), pop: true }); });
    function findPage(href) {
      var cut = href.search(/[?#]/);
      var path = cut >= 0 ? href.slice(0, cut) : href;
      try { path = decodeURI(path); } catch (e) {}
      var bases = path.charAt(0) === '/' ? [norm(root + path), norm(path)] : [norm(pageDir + path)];
      for (var i = 0; i < bases.length; i++) {
        var base = bases[i];
        var options = /\.html?$/i.test(base) ? [base] : [base + '.html', (base ? base + '/' : '') + 'index.html'];
        for (var j = 0; j < options.length; j++) if (paths.has(options[j])) return options[j];
      }
      return null;
    }
    function fixAttribute(el, name) {
      if (!el.getAttribute) return;
      if (name === 'style') { var style = el.getAttribute('style'); if (style && style.indexOf('url(') > -1) { var fixed = rewriteCssUrls(style); if (fixed !== style) nativeSetAttribute.call(el, 'style', fixed); } return; }
      var value = el.getAttribute(name);
      if (value === null || !resourceAttr(el, name)) return;
      var next = name === 'srcset' ? rewriteSrcset(value) : rewrite(value);
      if (next !== value) nativeSetAttribute.call(el, name, next);
    }
    function fixStyleElement(el) {
      if (el.type === 'text/tailwindcss') return;
      var text = el.textContent;
      if (text && text.indexOf('url(') > -1) { var fixed = rewriteCssUrls(text); if (fixed !== text) el.textContent = fixed; }
    }
    function fixTree(node) {
      if (node.nodeType === 3) { if (node.parentNode && node.parentNode.localName === 'style') fixStyleElement(node.parentNode); return; }
      if (node.nodeType !== 1) return;
      var list = [node];
      if (node.querySelectorAll) list = list.concat(Array.prototype.slice.call(node.querySelectorAll('[src],[srcset],[poster],[href],[data],[style],style')));
      list.forEach(function (el) {
        ['src', 'srcset', 'poster', 'href', 'data', 'style'].forEach(function (name) { if (el.hasAttribute && el.hasAttribute(name)) fixAttribute(el, name); });
        if (el.localName === 'style') fixStyleElement(el);
      });
    }
    var observer = new MutationObserver(function (records) {
      records.forEach(function (record) {
        if (record.type === 'attributes') fixAttribute(record.target, record.attributeName);
        else Array.prototype.forEach.call(record.addedNodes, fixTree);
      });
    });

    document.open();
    window.addEventListener('error', function (event) {
      var target = event.target;
      if (target && target !== window && (target.src || target.href)) send('log', { level: 'error', text: 'Failed to load ' + (target.src || target.href) });
      else send('log', { level: 'error', text: event.error ? format(event.error) : (event.message || 'Script error') });
    }, true);
    window.addEventListener('unhandledrejection', function (event) { send('log', { level: 'error', text: 'Unhandled rejection: ' + format(event.reason) }); });
    document.addEventListener('DOMContentLoaded', function () { send('ready'); });
    function realHref(href) {
      try { return new URL(href, p.pageUrl || location.href).pathname + new URL(href, p.pageUrl || location.href).search; } catch (e) { return href; }
    }
    document.addEventListener('click', function (event) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      if (!link || link.hasAttribute('download')) return;
      var href = link.getAttribute('href');
      if (!href || href.charAt(0) === '#' || /^(javascript|mailto|tel|blob|data|sms):/i.test(href)) return;
      if (/^(https?:)?\/\//i.test(href)) { if (!link.target || link.target === '_self') { event.preventDefault(); window.open(link.href || href, '_blank', 'noopener'); } return; }
      var page = findPage(href);
      if (page) { event.preventDefault(); send('navigate', { path: page, url: realHref(href) }); }
    });
    observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'poster', 'href', 'data', 'style'] });
    document.write(html);
    document.close();
  }

  window.addEventListener('message', function boot(event) {
    if (event.source !== host || !event.data || event.data.__portdeckLoad !== TOKEN) return;
    window.removeEventListener('message', boot);
    try { start(event.data.payload); } catch (error) { send('log', { level: 'error', text: 'The preview could not start: ' + format(error) }); }
  });
  var bootPath = '/'; try { bootPath = location.pathname + location.search; } catch (e) {}
  send('boot', { path: bootPath, token: TOKEN });
})();`;

/** The tiny document the preview frame starts with; the project page is written in once the payload arrives. */
export function previewDocument(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><script>${RUNTIME}</script></head><body></body></html>`;
}

export interface PreviewPayload {
  html: string;
  modules: Record<string, string>;
  styles: Record<string, string>;
  userImports: Record<string, string>;
  netAssets: Map<string, Blob>;
  vendor: { bundle: Blob; modules: Record<string, Blob> };
  vendorAssets: Record<string, Blob>;
  files: Map<string, Blob> | null;
  assetBase: string | null;
  paths: string[];
  root: string;
  page: string;
  storage: Record<string, string>;
  /** Real path the preview document is served from, so the app sees its own routes. */
  pageUrl: string;
  basePath: string;
  env: Record<string, string | boolean>;
  needsBuffer: boolean;
  vendorModules: Record<string, string>;
}

const vendorCache = new Map<string, { bundle: Blob; modules: Record<string, Blob> }>();
function vendorBlobs(line: '18' | '19') {
  let cached = vendorCache.get(line);
  if (!cached) {
    const vendor = REACT_VENDORS[line];
    cached = {
      bundle: new Blob([vendor.bundle], { type: 'text/javascript' }),
      modules: Object.fromEntries(
        Object.entries(vendor.modules).map(([spec, code]) => [spec, new Blob([code], { type: 'text/javascript' })]),
      ),
    };
    vendorCache.set(line, cached);
  }
  return cached;
}

let tailwindBlob: Promise<Blob> | null = null;
let idbBlob: Promise<Blob> | null = null;

export async function createPayload(
  bundle: PreviewBundle,
  files: { blobs: Map<string, Blob> } | { assetBase: string; paths: string[] },
  storage: Record<string, string>,
  context: { pageUrl?: string; basePath?: string } = {},
): Promise<PreviewPayload> {
  idbBlob ??= import('./vendor/indexeddb.generated').then((module) => new Blob([module.FAKE_INDEXEDDB], { type: 'text/javascript' }));
  const vendorAssets: Record<string, Blob> = { '@vendor/idb': await idbBlob };
  if (bundle.tailwind) {
    tailwindBlob ??= import('./vendor/tailwind.generated').then(
      (module) => new Blob([module.TAILWIND_BROWSER], { type: 'text/javascript' }),
    );
    vendorAssets['@vendor/tailwind'] = await tailwindBlob;
  }
  const local = 'blobs' in files;
  return {
    html: bundle.html,
    modules: bundle.modules,
    styles: bundle.styles,
    userImports: bundle.userImports,
    netAssets: bundle.netAssets,
    vendor: vendorBlobs(bundle.reactLine),
    vendorAssets,
    files: local ? files.blobs : null,
    assetBase: local ? null : files.assetBase,
    paths: local ? [...files.blobs.keys()] : files.paths,
    root: bundle.root,
    page: bundle.page,
    storage,
    pageUrl: context.pageUrl ?? '',
    basePath: context.basePath ?? '',
    env: bundle.env,
    needsBuffer: bundle.needsBuffer,
    vendorModules: bundle.vendorModules,
  };
}

/** Reads project files over HTTP (used by the Android app, which serves projects from disk). */
export function urlSource(base: string, paths: string[]): FileSource {
  const known = new Set(paths);
  const url = (path: string) => base + path.split('/').map(encodeURIComponent).join('/');
  const get = async (path: string) => {
    const response = await fetch(url(path));
    if (!response.ok) throw new Error(`File not found: ${path}`);
    return response;
  };
  return { has: (path) => known.has(path), text: async (path) => (await get(path)).text(), blob: async (path) => (await get(path)).blob() };
}
