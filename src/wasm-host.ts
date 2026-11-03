import { buildPreview } from './lib/compiler';
import { importFileList } from './lib/importer';
import { createPayload, previewDocument } from './lib/runtime';
import { demoBlobs, demoProjects } from './lib/samples';
import { blobSource, getProjectBlobs, getSavedProjects } from './lib/store';
import type { DeckProject } from './lib/types';

/** Bridge for the Kotlin/Wasm build. Kotlin polls the queues below; projects use the same storage as the web app. */
const frame = document.createElement('iframe');
frame.title = 'Project preview';
frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-popups allow-downloads allow-pointer-lock');
Object.assign(frame.style, { position: 'fixed', border: '0', display: 'none', zIndex: '20', background: 'white' });
document.body.appendChild(frame);

let queue = '';
let token = '';
let payload: unknown = null;
let current: DeckProject | null = null;
let messages: string[] = [];
const sources: string[] = [];
const api = window as unknown as Record<string, (...args: never[]) => unknown>;
const blobsFor = async (project: DeckProject) => (project.demo ? demoBlobs.get(project.id) ?? new Map<string, Blob>() : getProjectBlobs(project.id));

function setProject(project: DeckProject) {
  queue = JSON.stringify(project);
  if (!project.demo) { try { localStorage.setItem('portdeck-wasm-recent', project.id); } catch { /* optional */ } }
}

let recent = '';
getSavedProjects().then((projects) => {
  let id = '';
  try { id = localStorage.getItem('portdeck-wasm-recent') || ''; } catch { /* optional */ }
  const match = projects.find((project) => project.id === id) ?? projects[0];
  if (match) recent = JSON.stringify(match);
}).catch(() => undefined);

api.portdeckPick = ((kind: string) => {
  const input = document.createElement('input');
  input.type = 'file';
  if (kind === 'folder') { input.setAttribute('webkitdirectory', ''); input.multiple = true; }
  if (kind === 'zip') input.accept = '.zip,application/zip';
  if (kind === 'files') input.multiple = true;
  input.onchange = async () => {
    if (!input.files?.length) return;
    try { setProject(await importFileList(input.files)); }
    catch (error) { messages.push(`ERROR: ${error instanceof Error ? error.message : String(error)}`); }
  };
  input.click();
}) as never;
api.portdeckDemo = ((id: string) => { const project = demoProjects.find((item) => item.id === id); if (project) setProject(project); }) as never;
api.portdeckTakeProject = (() => { const result = queue; queue = ''; return result; }) as never;
api.portdeckRecent = (() => recent) as never;
api.portdeckTakeLogs = (() => { const result = messages.join('\n'); messages = []; return result; }) as never;
api.portdeckRequestSource = ((path: string) => {
  if (!current) return;
  blobsFor(current).then((blobs) => blobs.get(path)?.slice(0, 3 * 1024 * 1024).text() ?? '')
    .then((text) => { sources.push(JSON.stringify({ path, text })); }).catch(() => { sources.push(JSON.stringify({ path, text: '' })); });
}) as never;
api.portdeckTakeSource = (() => sources.shift() ?? '') as never;
api.portdeckHide = (() => { frame.style.display = 'none'; frame.srcdoc = ''; current = null; }) as never;
api.portdeckBooted = (() => {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.classList.add('done');
  window.setTimeout(() => boot.remove(), 400);
}) as never;
api.portdeckFullscreen = ((on: boolean) => {
  if (on && document.fullscreenEnabled && !document.fullscreenElement) void document.documentElement.requestFullscreen().catch(() => undefined);
  else if (!on && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
}) as never;
let viewport = { width: 0, height: 0 };
let visible = true;
let bounds = { left: 0, top: 0, width: 0, height: 0 };
function placeFrame() {
  const ratio = window.devicePixelRatio || 1;
  const box = { left: bounds.left / ratio, top: bounds.top / ratio, width: bounds.width / ratio, height: bounds.height / ratio };
  const scale = viewport.width ? box.width / viewport.width : 1;
  Object.assign(frame.style, {
    left: `${box.left}px`, top: `${box.top}px`, transformOrigin: 'top left',
    width: `${viewport.width || box.width}px`, height: `${viewport.width ? viewport.height : box.height}px`,
    transform: viewport.width ? `scale(${scale})` : 'none', visibility: visible ? 'visible' : 'hidden',
  });
}
api.portdeckBounds = ((left: number, top: number, width: number, height: number) => { bounds = { left, top, width, height }; placeFrame(); }) as never;
api.portdeckViewport = ((width: number, height: number) => { viewport = { width, height }; placeFrame(); }) as never;
api.portdeckSetVisible = ((on: boolean) => { visible = on; placeFrame(); }) as never;

async function show(project: DeckProject, page?: string) {
  current = project;
  messages.push(`Building ${page ?? project.name}`);
  try {
    let storage: Record<string, string> = {};
    try { storage = JSON.parse(localStorage.getItem(`portdeck-wasm-preview-${project.id}`) || '{}'); } catch { /* optional */ }
    const blobs = await blobsFor(project);
    const bundle = await buildPreview(project, blobSource(blobs), { entry: page });
    payload = await createPayload(bundle, { blobs }, storage);
    if (current !== project) return;
    token = `${project.id}-${Date.now()}`;
    frame.srcdoc = previewDocument();
    frame.style.display = 'block';
    messages.push(`Built in ${bundle.report.elapsedMs} ms · ${bundle.report.modules} modules · ${bundle.report.runtime}`, ...bundle.report.warnings.map((warning) => `WARN: ${warning}`));
  } catch (error) { messages.push(`ERROR: ${error instanceof Error ? error.message : String(error)}`); }
}
api.portdeckShow = ((raw: string) => { void show(JSON.parse(raw) as DeckProject); }) as never;

window.addEventListener('message', (event) => {
  const data = event.data;
  if (event.source !== frame.contentWindow || !data?.__portdeck || data.token !== token) return;
  if (data.type === 'boot') { frame.contentWindow?.postMessage({ __portdeckLoad: token, payload }, '*'); return; }
  if (data.type === 'navigate' && current && typeof data.path === 'string') { void show(current, data.path); return; }
  if (data.type === 'log') messages.push(`${data.level === 'error' ? 'ERROR' : data.level === 'warn' ? 'WARN' : data.level.toUpperCase()}: ${data.text}`);
  if (data.type === 'ready') messages.push('Preview ready');
  if (data.type === 'storage' && data.data && current) {
    try { const value = JSON.stringify(data.data); if (value.length < 2_000_000) localStorage.setItem(`portdeck-wasm-preview-${current.id}`, value); } catch { /* optional */ }
  }
});
