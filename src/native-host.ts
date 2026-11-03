import { buildPreview } from './lib/compiler';
import { createPayload, previewDocument, urlSource } from './lib/runtime';
import { blobSource, inlineBlobs } from './lib/store';
import type { DeckProject, InlineFile } from './lib/types';

/**
 * Android engine page. Imported projects live on disk and are served by the app at /project/<id>/…, so only the
 * small manifest crosses the bridge. Demos arrive with their few files inline.
 */
declare global {
  interface Window {
    portdeckBuild: (payload: string, storage: string) => Promise<void>;
    portdeckViewport: (width: number, height: number) => void;
    PortDeckNative?: { postMessage: (message: string) => void };
  }
}

type NativeProject = Omit<DeckProject, 'files'> & { files: (DeckProject['files'][number] & { content?: string })[] };

const frame = document.getElementById('preview') as HTMLIFrameElement;
const send = (message: Record<string, unknown>) => window.PortDeckNative?.postMessage(JSON.stringify(message));
let token = '';
let payload: unknown = null;
let current: { project: NativeProject; storage: Record<string, string> } | null = null;

async function build(page?: string) {
  if (!current) return;
  const { storage } = current;
  const project = current.project as unknown as DeckProject;
  const raw = current.project.files;
  const inline = raw.length > 0 && raw.every((file) => typeof file.content === 'string');
  const started = performance.now();
  try {
    let bundle;
    if (inline) {
      const blobs = inlineBlobs(raw.map((file) => ({ path: file.path, content: file.content ?? '' }) as InlineFile));
      bundle = await buildPreview(project, blobSource(blobs), { entry: page });
      payload = await createPayload(bundle, { blobs }, storage);
    } else {
      const base = `${location.origin}/project/${encodeURIComponent(project.id)}/`;
      const paths = project.files.map((file) => file.path);
      bundle = await buildPreview(project, urlSource(base, paths), { entry: page });
      payload = await createPayload(bundle, { assetBase: base, paths }, storage);
    }
    token = `${project.id}-${Date.now()}`;
    frame.srcdoc = previewDocument();
    send({ type: 'build', text: `Built in ${Math.round(performance.now() - started)} ms · ${bundle.report.modules} modules · ${bundle.report.runtime}` });
    bundle.report.warnings.forEach((warning) => send({ type: 'warn', text: warning }));
    send({ type: 'report', offline: bundle.report.offline, network: bundle.report.network, page: bundle.report.page });
  } catch (error) {
    frame.srcdoc = '<!doctype html><body style="margin:0;display:grid;place-items:center;height:100vh;background:#121011;color:#bdb4b5;font:14px system-ui">Build failed. Open Console for details.</body>';
    send({ type: 'error', text: error instanceof Error ? error.message : String(error) });
  }
}

// Phone and tablet previews lay out at true device size and are scaled to the frame the native UI draws.
let viewport = { width: 0, height: 0 };
function applyViewport() {
  if (!viewport.width) { Object.assign(frame.style, { width: '100%', height: '100%', transform: 'none' }); return; }
  const scale = Math.min(window.innerWidth / viewport.width, window.innerHeight / viewport.height);
  Object.assign(frame.style, { width: `${viewport.width}px`, height: `${viewport.height}px`, transform: `scale(${scale})`, transformOrigin: 'top left' });
}
window.portdeckViewport = (width, height) => { viewport = { width, height }; applyViewport(); };
window.addEventListener('resize', applyViewport);

window.portdeckBuild = async (raw: string, storage: string) => {
  let saved: Record<string, string> = {};
  try { saved = JSON.parse(storage || '{}'); } catch { /* optional */ }
  current = { project: JSON.parse(raw) as NativeProject, storage: saved };
  await build();
};

window.addEventListener('message', (event) => {
  const data = event.data;
  if (event.source !== frame.contentWindow || !data?.__portdeck || data.token !== token) return;
  if (data.type === 'boot') { frame.contentWindow?.postMessage({ __portdeckLoad: token, payload }, '*'); return; }
  if (data.type === 'navigate' && typeof data.path === 'string') { void build(data.path); return; }
  if (data.type === 'log') send({ type: data.level, text: data.text });
  if (data.type === 'ready') send({ type: 'ready', text: 'Preview ready' });
  if (data.type === 'storage') send({ type: 'storage', data: data.data });
});
