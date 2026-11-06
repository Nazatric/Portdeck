/**
 * Headless end-to-end test of the preview pipeline, without a browser:
 *
 *   buildPreview (node)  ->  iframe runtime (vm, fake sandboxed frame)
 *     ->  __portdeckLoad handshake  ->  document.write()
 *
 * It fails on the exact symptoms seen in the field: unresolved pd-* tokens in the written
 * HTML, a missing import map, a broken boot handshake, or a crashed start().
 */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildPreview } from '../src/lib/compiler';
import { createPayload, previewDocument } from '../src/lib/runtime';
import { blobSource, inlineBlobs } from '../src/lib/store';
import type { DeckProject } from '../src/lib/types';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', 'composeApp', 'src');
const demos: DeckProject[] = JSON.parse(readFileSync(join(root, 'androidMain', 'assets', 'demos.json'), 'utf8'));

const toBlobs = (project: DeckProject) =>
  inlineBlobs(project.files.map((file) => ({ path: file.path, content: file.content ?? '' })));

/* ---------------------------------- fake DOM ---------------------------------- */

interface Harness {
  window: Record<string, unknown>;
  messages: Record<string, unknown>[];
  writtenHtml: () => string;
  fireDomContentLoaded: () => void;
  dispatchMessage: (data: Record<string, unknown>) => void;
}

function makeHarness(): Harness {
  const messages: Record<string, unknown>[] = [];
  const docListeners = new Map<string, (() => void)[]>();
  const windowListeners = new Map<string, ((event: { data: unknown; source: unknown }) => void)[]>();
  let html = '';

  const documentStub: Record<string, unknown> = {
    cookie: '',
    open() { html = ''; },
    write(chunk: string) { html += chunk; },
    close() { /* no-op */ },
    addEventListener(type: string, fn: () => void) {
      const list = docListeners.get(type) ?? [];
      list.push(fn);
      docListeners.set(type, list);
    },
    removeEventListener() {},
    createElement() { return { style: {}, setAttribute() {}, appendChild() {} }; },
    body: { appendChild() {} },
    getElementById() { return null; },
  };

  const parentRef = {
    postMessage(message: Record<string, unknown>) { messages.push(message); },
  };

  const elementProto: Record<string, unknown> = {
    setAttribute() {},
    setAttributeNS() {},
  };

  const windowStub: Record<string, unknown> = {
    parent: parentRef,
    location: { pathname: '/preview', search: '', hash: '', href: 'https://appassets.androidplatform.net/assets/engine/index.html' },
    navigator: { onLine: true },
    history: { pushState() {}, replaceState() {}, back() {}, forward() {} },
    fetch: () => Promise.reject(new Error('network is disabled in the smoke test')),
    XMLHttpRequest: class {},
    Element: function Element() { /* opaque-origin element stub */ },
    MutationObserver: class { observe() {} disconnect() {} },
    Audio: class {},
    Worker: undefined,
    SharedWorker: undefined,
    Blob,
    Map,
    Set,
    JSON,
    Math,
    Date,
    Promise,
    URL,
    TextEncoder,
    TextDecoder,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    performance,
    addEventListener(type: string, fn: (event: { data: unknown; source: unknown }) => void) {
      const list = windowListeners.get(type) ?? [];
      list.push(fn);
      windowListeners.set(type, list);
    },
    removeEventListener(type: string, fn: (event: { data: unknown; source: unknown }) => void) {
      const list = windowListeners.get(type) ?? [];
      const index = list.indexOf(fn);
      if (index !== -1) list.splice(index, 1);
    },
    open() { return null; },
  };
  windowStub.window = windowStub;
  windowStub.self = windowStub;
  windowStub.globalThis = windowStub;
  windowStub.document = documentStub;
  (windowStub.Element as { prototype: Record<string, unknown> }).prototype = elementProto;

  return {
    window: windowStub,
    messages,
    writtenHtml: () => html,
    fireDomContentLoaded: () => { for (const fn of docListeners.get('DOMContentLoaded') ?? []) fn(); },
    dispatchMessage: (data) => {
      for (const fn of [...(windowListeners.get('message') ?? [])]) fn({ data, source: parentRef });
    },
  };
}

/* ----------------------------------- tests ----------------------------------- */

async function buildBundle(project: DeckProject) {
  const blobs = toBlobs(project);
  const bundle = await buildPreview(project, blobSource(blobs));
  const payload = await createPayload(bundle, { blobs }, {});
  return { bundle, payload };
}

for (const demo of demos) {
  console.log(`\n=== ${demo.id} (${demo.name}) ===`);
  const { bundle, payload } = await buildBundle(demo);
  console.log(`build: ${bundle.report.modules} modules, runtime ${bundle.report.runtime}, entry ${bundle.report.entry}`);
  if (demo.framework !== 'HTML') assert.ok(bundle.report.modules >= 1, 'expected at least one module for a scripted demo');
  assert.equal(bundle.report.runtime, demo.framework === 'HTML' ? 'Browser' : 'React 18.3.1');

  // The compiled HTML still carries pd- tokens plus the PD_HEAD mark; the frame resolves them.
  assert.ok(payload.html.includes('<!--PD_HEAD-->'), 'compiled html is missing the head mark');

  // Boot the sandboxed frame with the payload and verify the handshake plus document.write.
  const frame = makeHarness();
  const document0 = previewDocument();
  const script = document0.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'preview document is missing the runtime script');
  vm.runInContext(script, vm.createContext(frame.window));

  const boot = frame.messages.find((msg) => msg.type === 'boot') as { token?: string } | undefined;
  assert.ok(boot?.token, 'frame did not announce boot with a token');

  // The host answers with __portdeckLoad, like the fixed native/wasm hosts do.
  frame.dispatchMessage({ __portdeckLoad: boot.token, payload: structuredClone(payload) });

  const written = frame.writtenHtml();
  assert.ok(written.length > 200, 'frame did not write the page');
  assert.ok(!written.includes('pd-module://'), 'unresolved pd-module token in written html');
  assert.ok(!written.includes('pd-style://'), 'unresolved pd-style token in written html');
  assert.ok(!written.includes('pd-asset://'), 'unresolved pd-asset token in written html');
  assert.ok(written.includes('<script type="importmap">'), 'written html is missing the import map');

  const importMap = JSON.parse(
    written.match(/<script type="importmap">(.*?)<\/script>/s)?.[1] ?? '{}',
  ) as { imports: Record<string, string> };
  assert.ok(importMap.imports['@portdeck/react'], 'import map is missing the React bundle entry');
  for (const key of Object.keys(payload.modules)) {
    assert.ok(importMap.imports[key], `import map is missing module ${key}`);
  }
  const logErrors = frame.messages.filter((msg) => msg.level === 'error');
  assert.deepEqual(logErrors, [], 'frame logged errors during start()');
  console.log(`written html ok (${written.length} bytes, ${Object.keys(importMap.imports).length} import-map entries)`);

  frame.fireDomContentLoaded();
  assert.ok(frame.messages.some((msg) => msg.type === 'ready'), 'frame did not report ready on DOMContentLoaded');
  console.log('ready ok');
}

console.log('\nAll smoke tests passed.');

/* ------------------------- synthetic project checks ------------------------- */

const synthetic: DeckProject[] = [
  {
    id: 'test-tsx', name: 'TSX App', framework: 'React', entry: 'src/main.tsx',
    files: [
      { path: 'package.json', size: 40, type: 'application/json', content: JSON.stringify({ dependencies: { react: '18.3.1', 'react-dom': '18.3.1' } }) },
      { path: 'src/main.tsx', size: 120, type: 'text/javascript', content: 'import React from \'react\';\nimport { createRoot } from \'react-dom/client\';\nimport App from \'./App\';\ncreateRoot(document.getElementById(\'root\')!).render(<App />);' },
      { path: 'src/App.tsx', size: 400, type: 'text/javascript', content: 'import React from \'react\';\nimport styles from \'./app.module.css\';\nimport logo from \'./logo.svg\';\nexport default function App() { return <main className={styles.wrap}><img src={logo} alt="logo" /><h1>Hello</h1></main> }' },
      { path: 'src/app.module.css', size: 40, type: 'text/css', content: '.wrap { color: rebeccapurple; }' },
      { path: 'src/logo.svg', size: 100, type: 'image/svg+xml', content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>' },
    ],
    size: 700, updatedAt: 0,
  } as unknown as DeckProject,
  {
    id: 'test-dynamic', name: 'Dynamic Imports', framework: 'JavaScript', entry: 'src/main.js',
    files: [
      { path: 'src/main.js', size: 200, type: 'text/javascript', content: 'const name = \'a\';\nimport(\'./pages/\' + name + \'.js\').then((m) => console.log(\'loaded\', m.default));' },
      { path: 'src/pages/a.js', size: 30, type: 'text/javascript', content: 'export default \'a\';' },
      { path: 'src/pages/b.js', size: 30, type: 'text/javascript', content: 'export default \'b\';' },
    ],
    size: 260, updatedAt: 0,
  } as unknown as DeckProject,
  {
    id: 'test-next', name: 'Next Layout', framework: 'Next.js', entry: 'app/page.jsx',
    files: [
      { path: 'package.json', size: 60, type: 'application/json', content: JSON.stringify({ dependencies: { next: '14.2.0', react: '18.3.1', 'react-dom': '18.3.1' } }) },
      { path: 'app/layout.tsx', size: 120, type: 'text/javascript', content: 'export default function Layout({ children }: { children: React.ReactNode }) { return <section className="layout">{children}</section> }' },
      { path: 'app/page.jsx', size: 200, type: 'text/javascript', content: 'import React from \'react\';\nimport \'./style.css\';\nexport default function Page() { return <h1>Next page</h1> }' },
      { path: 'app/style.css', size: 30, type: 'text/css', content: 'h1 { color: teal; }' },
    ],
    size: 410, updatedAt: 0,
  } as unknown as DeckProject,
  {
    id: 'test-html-assets', name: 'HTML Assets', framework: 'HTML', entry: 'index.html',
    files: [
      { path: 'index.html', size: 200, type: 'text/html', content: '<!doctype html><html><head><link rel="stylesheet" href="./style.css"></head><body><img src="./logo.png" alt="l"><script src="./app.js"></script></body></html>' },
      { path: 'style.css', size: 20, type: 'text/css', content: 'body { background: white; }' },
      { path: 'logo.png', size: 16, type: 'image/png', content: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' },
      { path: 'app.js', size: 10, type: 'text/javascript', content: 'console.log(\'hi\');' },
    ],
    size: 250, updatedAt: 0,
  } as unknown as DeckProject,
];

for (const project of synthetic) {
  console.log(`\n=== ${project.id} (${project.name}) ===`);
  const { bundle, payload } = await buildBundle(project);
  console.log(`build: ${bundle.report.modules} modules, runtime ${bundle.report.runtime}, entry ${bundle.report.entry}`);
  if (project.framework !== 'HTML') assert.ok(bundle.report.modules >= 1, 'expected compiled modules');
  const frame = makeHarness();
  const document0 = previewDocument();
  const script = document0.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  vm.runInContext(script!, vm.createContext(frame.window));
  const boot = frame.messages.find((msg) => msg.type === 'boot') as { token?: string } | undefined;
  assert.ok(boot?.token, 'frame did not announce boot');
  frame.dispatchMessage({ __portdeckLoad: boot.token, payload: structuredClone(payload) });
  const written = frame.writtenHtml();
  assert.ok(!/pd-(module|style|asset):\/\//.test(written), 'unresolved pd token in written html');
  assert.ok(written.includes('<script type="importmap">'), 'written html is missing the import map');
  const logErrors = frame.messages.filter((msg) => msg.level === 'error');
  assert.deepEqual(logErrors, [], 'frame logged errors during start()');
  if (project.id === 'test-dynamic') {
    // The compiler precompiles the reachable modules and the frame exposes __pdImport.
    assert.ok(bundle.modules['@pd/src/pages/a.js'], 'dynamic-import target was not precompiled');
    assert.ok(bundle.modules['@pd/src/pages/b.js'], 'dynamic-import target was not precompiled');
    assert.equal(typeof frame.window.__pdImport, 'function', 'frame is missing __pdImport');
  }
  console.log('synthetic checks ok');
}

console.log('\nAll synthetic checks passed.');
