#!/usr/bin/env node
/**
 * Regenerates the committed, offline asset modules. Run with: node tools/generate-assets.mjs
 *
 *  - composeApp IconData.kt
 *      Lucide icons (ISC License) and Simple Icons brand marks (CC0), normalised to single path strings.
 *  - multiplatform/engine/src/lib/vendor/react.generated.ts
 *      Production React 18 and 19 runtimes (MIT, Copyright Meta Platforms, Inc. and affiliates).
 *  - multiplatform/engine/src/lib/vendor/tailwind.generated.ts
 *      The Tailwind CSS browser build (MIT, Copyright Tailwind Labs, Inc.).
 *  - multiplatform/engine/src/lib/vendor/indexeddb.generated.ts
 *      fake-indexeddb (Apache-2.0), an in-memory IndexedDB used inside sandboxed previews where the real one is blocked.
 *
 * Sources are downloaded once, at pinned versions, into a temporary cache. The app itself never
 * requests them at runtime, so previews of React and Tailwind projects work without a network.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

process.env.NODE_ENV = 'production';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(tmpdir(), 'portdeck-asset-cache');
const PINS = {
  lucide: '1.67.0',
  simpleIcons: '16.36.0',
  tailwind: '4.3.4',
  fakeIndexedDB: '6.2.7',
  react18: { react: '18.3.1', 'react-dom': '18.3.1', scheduler: '0.23.2' },
  react19: { react: '19.2.6', 'react-dom': '19.2.6', scheduler: '0.27.0' },
};

const ICONS = [
  'upload', 'circle-question-mark', 'chevron-left', 'chevron-right', 'chevron-down', 'ellipsis', 'file-plus',
  'download', 'trash-2', 'scan', 'smartphone', 'tablet', 'monitor', 'rotate-cw', 'refresh-cw', 'maximize-2',
  'minimize-2', 'square-terminal', 'folder', 'folder-open', 'folder-input', 'files', 'info', 'x', 'copy', 'check',
  'file-archive', 'file', 'file-code', 'file-braces', 'file-image', 'file-text', 'search', 'triangle-alert',
  'circle-alert', 'circle-check', 'circle-x', 'loader-circle', 'arrow-up-right', 'ban', 'wifi-off', 'package',
  'hard-drive', 'keyboard', 'monitor-smartphone', 'plus', 'rectangle-vertical', 'rectangle-horizontal',
  'database', 'globe', 'house', 'cloud-download', 'external-link',
];
const BRANDS = { react: 'react', nextjs: 'nextdotjs', html5: 'html5', javascript: 'javascript', typescript: 'typescript' };
const BRAND_KOTLIN = { react: 'React', nextjs: 'NextJs', html5: 'Html5', javascript: 'JavaScript', typescript: 'TypeScript' };

mkdirSync(CACHE, { recursive: true });

async function download(url, file) {
  const target = join(CACHE, file);
  if (existsSync(target)) return readFileSync(target, 'utf8');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  const text = await response.text();
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
  return text;
}

/** Installs exact package versions into dir/node_modules without touching the project's package.json. */
function install(dir, packages) {
  for (const [name, version] of Object.entries(packages)) {
    const target = join(dir, 'node_modules', name);
    if (existsSync(join(target, 'package.json'))) continue;
    mkdirSync(target, { recursive: true });
    const output = execFileSync('npm', ['pack', `${name}@${version}`, '--silent', '--pack-destination', CACHE], { encoding: 'utf8' });
    const tarball = output.trim().split('\n').pop();
    execFileSync('tar', ['-xzf', join(CACHE, tarball), '-C', target, '--strip-components=1']);
  }
  writeFileSync(join(dir, 'package.json'), '{"private":true}');
}

const round = (value) => +Number(value).toFixed(3);

/** Re-serialises path data with explicit separators so every parser (browsers and Compose) reads it identically. */
function normalizePath(d) {
  const tokens = [];
  let command = '';
  let index = 0;
  let i = 0;
  while (i < d.length) {
    const ch = d[i];
    if (/[a-zA-Z]/.test(ch)) { tokens.push(ch); command = ch.toLowerCase(); index = 0; i++; continue; }
    if (/[\s,]/.test(ch)) { i++; continue; }
    if (command === 'a' && (index % 7 === 3 || index % 7 === 4)) { tokens.push(ch); index++; i++; continue; }
    const match = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(d.slice(i));
    if (!match) throw new Error(`Unreadable path data near "${d.slice(i, i + 12)}"`);
    tokens.push(String(round(match[0])));
    index++;
    i += match[0].length;
  }
  return tokens.join(' ');
}

function attributes(source) {
  const result = {};
  for (const [, key, value] of source.matchAll(/([\w:-]+)="([^"]*)"/g)) result[key] = value;
  return result;
}

function elementToPath(tag, a) {
  const n = (value) => Number(value ?? 0);
  switch (tag) {
    case 'path': return a.d;
    case 'circle': {
      const cx = n(a.cx), cy = n(a.cy), r = n(a.r);
      return `M${round(cx - r)} ${cy}a${r} ${r} 0 1 0 ${round(2 * r)} 0a${r} ${r} 0 1 0 ${round(-2 * r)} 0Z`;
    }
    case 'ellipse': {
      const cx = n(a.cx), cy = n(a.cy), rx = n(a.rx), ry = n(a.ry);
      return `M${round(cx - rx)} ${cy}a${rx} ${ry} 0 1 0 ${round(2 * rx)} 0a${rx} ${ry} 0 1 0 ${round(-2 * rx)} 0Z`;
    }
    case 'line': return `M${n(a.x1)} ${n(a.y1)}L${n(a.x2)} ${n(a.y2)}`;
    case 'polyline':
    case 'polygon': {
      const points = a.points.trim().split(/[\s,]+/).map(Number);
      let d = `M${points[0]} ${points[1]}`;
      for (let i = 2; i < points.length; i += 2) d += `L${points[i]} ${points[i + 1]}`;
      return tag === 'polygon' ? `${d}Z` : d;
    }
    case 'rect': {
      const x = n(a.x), y = n(a.y), w = n(a.width), h = n(a.height);
      let rx = a.rx !== undefined ? n(a.rx) : n(a.ry);
      let ry = a.ry !== undefined ? n(a.ry) : rx;
      rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
      if (!rx || !ry) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return `M${round(x + rx)} ${y}H${round(x + w - rx)}A${rx} ${ry} 0 0 1 ${x + w} ${round(y + ry)}V${round(y + h - ry)}A${rx} ${ry} 0 0 1 ${round(x + w - rx)} ${y + h}H${round(x + rx)}A${rx} ${ry} 0 0 1 ${x} ${round(y + h - ry)}V${round(y + ry)}A${rx} ${ry} 0 0 1 ${round(x + rx)} ${y}Z`;
    }
    default: throw new Error(`Unsupported SVG element <${tag}>`);
  }
}

/**
 * A path's leading "m" is absolute in SVG, but once several elements are merged into one path it would
 * become relative to the previous subpath. Make it absolute; its implicit follow-up pairs stay relative lines.
 */
function absoluteStart(normalized) {
  const tokens = normalized.split(' ');
  if (tokens[0] !== 'm') return normalized;
  tokens[0] = 'M';
  if (tokens.length > 3 && !/[a-zA-Z]/.test(tokens[3])) tokens.splice(3, 0, 'l');
  return tokens.join(' ');
}

function svgToPath(svg) {
  const parts = [];
  for (const [, tag, attrs] of svg.matchAll(/<(path|circle|rect|line|polyline|polygon|ellipse)\b([^>]*?)\/?>/g)) {
    parts.push(absoluteStart(normalizePath(elementToPath(tag, attributes(attrs)))));
  }
  if (!parts.length) throw new Error('SVG contains no drawable elements');
  return parts.join(' ');
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

function reactVendor(major, pins) {
  const dir = join(CACHE, `react-${pins.react}`);
  install(dir, pins);
  const require = createRequire(join(dir, 'package.json'));
  const specs = { react: 'React', 'react-dom': 'ReactDOM', 'react-dom/client': 'ReactDOMClient', 'react/jsx-runtime': 'JSXRuntime', 'react/compiler-runtime': 'CompilerRuntime' };
  const available = Object.entries(specs).filter(([spec]) => { try { require.resolve(spec); return true; } catch { return false; } });
  const entry = `${available.map(([spec, id]) => `import * as ${id} from '${spec}';`).join('\n')}\nexport { ${available.map(([, id]) => id).join(', ')} };`;
  const { outputFiles } = buildSync({
    stdin: { contents: entry, resolveDir: dir, loader: 'js', sourcefile: 'react-entry.js' },
    bundle: true, write: false, format: 'esm', minify: true, platform: 'browser', target: 'es2020',
    legalComments: 'none', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
  });
  const modules = {};
  for (const [spec, id] of available) {
    const names = Object.keys(require(spec)).filter((name) => name !== 'default' && IDENT.test(name));
    let source;
    if (spec === 'react-dom' && major === '19') {
      // React 19 removed the legacy root API; keep older entry points such as ReactDOM.render working.
      source = 'import{ReactDOM as N,ReactDOMClient as NC}from"@portdeck/react";const M=N.default||N;const C=NC.default||NC;const roots=new WeakMap();'
        + 'export function render(e,c,cb){let r=roots.get(c);if(!r){r=C.createRoot(c);roots.set(c,r)}r.render(e);if(cb)setTimeout(cb,0);return null}'
        + 'export function hydrate(e,c,cb){return render(e,c,cb)}'
        + 'export function unmountComponentAtNode(c){const r=roots.get(c);if(!r)return false;r.unmount();roots.delete(c);return true}'
        + 'export default Object.assign({},M,{render,hydrate,unmountComponentAtNode});';
    } else {
      source = `import{${id} as N}from"@portdeck/react";const M=N.default||N;export default M;`;
    }
    source += names.map((name) => `export const ${name}=M.${name};`).join('');
    modules[spec] = source;
  }
  modules['react/jsx-dev-runtime'] = 'import{JSXRuntime as N}from"@portdeck/react";const M=N.default||N;export const Fragment=M.Fragment;export const jsxDEV=(t,p,k)=>M.jsx(t,p,k);export default{Fragment,jsxDEV};';
  return { version: pins.react, bundle: outputFiles[0].text, modules };
}

const kb = (text) => `${(Buffer.byteLength(text) / 1024).toFixed(0)} KB`;

async function main() {
  const icons = {};
  for (const name of ICONS) {
    const svg = await download(`https://cdn.jsdelivr.net/npm/lucide-static@${PINS.lucide}/icons/${name}.svg`, `lucide-${PINS.lucide}/${name}.svg`);
    icons[name] = svgToPath(svg);
  }
  const brands = {};
  for (const [name, slug] of Object.entries(BRANDS)) {
    const svg = await download(`https://cdn.jsdelivr.net/npm/simple-icons@${PINS.simpleIcons}/icons/${slug}.svg`, `simple-icons-${PINS.simpleIcons}/${slug}.svg`);
    brands[name] = svgToPath(svg);
  }

  const pascal = (name) => name.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join('');
  const iconKt = `// Generated by tools/generate-assets.mjs. Do not edit.
// Icons: Lucide ${PINS.lucide} (ISC License). Brand marks: Simple Icons ${PINS.simpleIcons} (CC0 1.0).
package app.portdeck

import androidx.compose.ui.graphics.vector.ImageVector

object DeckIcons {
${Object.entries(icons).map(([name, d]) => `    val ${pascal(name)}: ImageVector by lazy { strokeIcon("${name}", "${d}") }`).join('\n')}
}

object BrandIcons {
${Object.entries(brands).map(([name, d]) => `    val ${BRAND_KOTLIN[name]}: ImageVector by lazy { fillIcon("${name}", "${d}") }`).join('\n')}
}
`;
  writeFileSync(join(ROOT, 'multiplatform/composeApp/src/commonMain/kotlin/app/portdeck/IconData.kt'), iconKt);

  const react18 = reactVendor('18', PINS.react18);
  const react19 = reactVendor('19', PINS.react19);
  const reactTs = `// Generated by tools/generate-assets.mjs. Do not edit.
// React ${react18.version} and ${react19.version} production builds. React is MIT licensed, Copyright (c) Meta Platforms, Inc. and affiliates.
export interface ReactVendor { version: string; bundle: string; modules: Record<string, string> }
export const REACT_VENDORS: Record<'18' | '19', ReactVendor> = ${JSON.stringify({ 18: react18, 19: react19 })};
`;
  mkdirSync(join(ROOT, 'multiplatform/engine/src/lib/vendor'), { recursive: true });
  writeFileSync(join(ROOT, 'multiplatform/engine/src/lib/vendor/react.generated.ts'), reactTs);

  const tailwindDir = join(CACHE, `tailwind-${PINS.tailwind}`);
  install(tailwindDir, { '@tailwindcss/browser': PINS.tailwind });
  const tailwind = readFileSync(join(tailwindDir, 'node_modules/@tailwindcss/browser/dist/index.global.js'), 'utf8');
  const tailwindTs = `// Generated by tools/generate-assets.mjs. Do not edit.
// Tailwind CSS browser build ${PINS.tailwind}. MIT licensed, Copyright (c) Tailwind Labs, Inc.
export const TAILWIND_VERSION = '${PINS.tailwind}';
export const TAILWIND_BROWSER = ${JSON.stringify(tailwind)};
`;
  writeFileSync(join(ROOT, 'multiplatform/engine/src/lib/vendor/tailwind.generated.ts'), tailwindTs);

  const idbDir = join(CACHE, `fake-indexeddb-${PINS.fakeIndexedDB}`);
  install(idbDir, { 'fake-indexeddb': PINS.fakeIndexedDB });
  const idb = buildSync({
    stdin: { contents: "import * as all from 'fake-indexeddb'; window.__pdFakeIDB = all;", resolveDir: idbDir, loader: 'js', sourcefile: 'idb-entry.js' },
    bundle: true, write: false, format: 'iife', minify: true, platform: 'browser', target: 'es2020', legalComments: 'none', logLevel: 'silent',
  }).outputFiles[0].text;
  writeFileSync(join(ROOT, 'multiplatform/engine/src/lib/vendor/indexeddb.generated.ts'), `// Generated by tools/generate-assets.mjs. Do not edit.
// fake-indexeddb ${PINS.fakeIndexedDB}. Apache License 2.0, Copyright (c) Jeremy Scheff.
export const FAKE_INDEXEDDB = ${JSON.stringify(idb)};
`);
  console.log(`fake-indexeddb ${kb(idb)}`);

  console.log(`icons: ${Object.keys(icons).length} + ${Object.keys(brands).length} brands`);
  console.log(`react 18 bundle ${kb(react18.bundle)}, react 19 bundle ${kb(react19.bundle)}, modules ${Object.keys(react19.modules).join(', ')}`);
  console.log(`tailwind ${kb(tailwind)}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
