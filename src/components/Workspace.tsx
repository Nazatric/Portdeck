'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { BuildReport } from '@/lib/compiler';
import { addProjectFiles, exportProject, formatSize } from '@/lib/importer';
import { demoBlobs } from '@/lib/samples';
import { blobSource, getProjectBlobs } from '@/lib/store';
import type { DeckProject, FileEntry } from '@/lib/types';
import { BrandIcon, Icon, fileIcon, frameworkBrand, type IconName } from './icons';
import { IconButton, PressButton, Segmented, prefersReducedMotion, usePresence, withViewTransition } from './ui';

type Device = 'fit' | 'phone' | 'tablet' | 'desktop';
type Orientation = 'portrait' | 'landscape';
type Panel = 'console' | 'files' | 'info';
type Tone = 'info' | 'success' | 'error';
interface LogLine { id: number; level: string; text: string; count: number; time: string }

const DEVICES: { value: Device; label: string; icon: IconName; size?: [number, number] }[] = [
  { value: 'fit', label: 'Fit', icon: 'scan' },
  { value: 'phone', label: 'Phone', icon: 'smartphone', size: [390, 844] },
  { value: 'tablet', label: 'Tablet', icon: 'tablet', size: [820, 1180] },
  { value: 'desktop', label: 'Desktop', icon: 'monitor', size: [1440, 900] },
];
const ORIENTATIONS = [
  { value: 'portrait' as const, label: 'Portrait', icon: 'rectangle-vertical' as const },
  { value: 'landscape' as const, label: 'Landscape', icon: 'rectangle-horizontal' as const },
];
const PANELS: { value: Panel; label: string; icon: IconName }[] = [
  { value: 'console', label: 'Console', icon: 'square-terminal' },
  { value: 'files', label: 'Files', icon: 'files' },
  { value: 'info', label: 'Info', icon: 'info' },
];
const LEVEL_ICON: Record<string, IconName> = { error: 'circle-x', warn: 'triangle-alert', success: 'circle-check', info: 'info' };
const ROW = 34;
const SOURCE_LIMIT = 3 * 1024 * 1024;

let logCounter = 0;
const stamp = () => new Date().toLocaleTimeString([], { hour12: false });
const line = (level: string, text: string): LogLine => ({ id: ++logCounter, level, text, count: 1, time: stamp() });
const isTextual = (file: FileEntry) => /^(text\/|application\/(json|javascript|xml|manifest\+json)|image\/svg)/.test(file.type) || /\.(m?[jt]sx?|cjs|mdx?|txt|vue|svelte|astro|ya?ml|toml|env|gitignore|lock)$/i.test(file.path);
function storedHeight(): number {
  try { const value = Number(localStorage.getItem('portdeck-panel-height')); return value >= 120 && value <= 900 ? value : 240; } catch { return 240; }
}

function FileList({ files, onOpen, onPreview }: { files: FileEntry[]; onOpen: (file: FileEntry) => void; onPreview: (path: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 400 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0;
    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setView({ top: element.scrollTop, height: element.clientHeight })); };
    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => { cancelAnimationFrame(frame); element.removeEventListener('scroll', update); observer.disconnect(); };
  }, []);
  const first = Math.max(0, Math.floor(view.top / ROW) - 8);
  const last = Math.min(files.length, Math.ceil((view.top + view.height) / ROW) + 8);
  return <div ref={ref} className="files-list">
    <div className="files-track" style={{ height: files.length * ROW }}>
      {files.slice(first, last).map((file, index) => <div key={file.path} className="file-row-wrap" style={{ transform: `translateY(${(first + index) * ROW}px)` }}>
        <PressButton className="file-row" onClick={() => onOpen(file)}>
          <Icon name={fileIcon(file.path)} size={16} /><span>{file.path}</span><small>{formatSize(file.size)}</small>
        </PressButton>
        {/\.html?$/i.test(file.path) && <IconButton icon="globe" label="Preview this page" size={15} className="file-action" onClick={() => onPreview(file.path)} />}
      </div>)}
    </div>
  </div>;
}

export default function Workspace({ project, online, onBack, onRemove, onUpdate, onNotify }: {
  project: DeckProject;
  online: boolean;
  onBack: () => void;
  onRemove: () => void;
  onUpdate: (project: DeckProject) => Promise<void>;
  onNotify: (text: string, tone?: Tone) => void;
}) {
  const [blobs, setBlobs] = useState<Map<string, Blob> | null>(() => (project.demo ? demoBlobs.get(project.id) ?? null : null));
  const [location, setLocation] = useState('/');
  const [nonce, setNonce] = useState(0);
  const [page, setPage] = useState(project.entry);
  const [report, setReport] = useState<BuildReport | null>(null);
  const [error, setError] = useState('');
  const [building, setBuilding] = useState(true);
  const [buildNumber, setBuildNumber] = useState(0);
  const [device, setDevice] = useState<Device>('fit');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [panel, setPanel] = useState<Panel | null>(null);
  const [lastPanel, setLastPanel] = useState<Panel>('console');
  const [panelHeight, setPanelHeight] = useState(storedHeight);
  const [resizing, setResizing] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [idle, setIdle] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const [shown, setShown] = useState<FileEntry | null>(null);
  const [sourceText, setSourceText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const consoleRef = useRef<HTMLDivElement>(null);
  const addFilesRef = useRef<HTMLInputElement>(null);
  const tokenRef = useRef('');
  const frameTokenRef = useRef('');
  const payloadRef = useRef<unknown>(null);
  const floodRef = useRef({ second: 0, count: 0 });
  const flip = useRef<{ rect: DOMRect; turn: number } | null>(null);
  const sheet = usePresence(panel !== null, 220);
  const menu = usePresence(menuOpen, 150);
  const source = usePresence(selected !== null, 190);

  /** Maps a document path to the project file the preview should build. */
  const pathToFile = useCallback((path: string): string => {
    if (!path || path === '/') return project.entry;
    const clean = path.split('?')[0].replace(/^\//, '');
    if (project.files.some((file) => file.path === clean)) return clean;
    const rooted = project.entry.includes('/') ? `${project.entry.slice(0, project.entry.lastIndexOf('/') + 1)}${clean}` : clean;
    if (project.files.some((file) => file.path === rooted)) return rooted;
    if (!/\.html?$/i.test(clean)) {
      const index = project.files.find((file) => file.path === `${rooted}/index.html` || file.path === `${clean}/index.html` || file.path === `${rooted}.html`);
      if (index) return index.path;
    }
    return project.entry;
  }, [project]);
  /** The page the preview document is written for, so project-relative links resolve. */
  const urlFor = useCallback((path: string) => (path === '/' || path === '' ? '/' : path.startsWith('/') ? path : `/${path}`), []);
  const navigateTo = useCallback((path: string) => { setLocation(path); setNonce((value) => value + 1); }, []);
  const frameSrc = useMemo(() => urlFor(location), [location, urlFor]);

  useEffect(() => {
    if (project.demo) return;
    let cancelled = false;
    getProjectBlobs(project.id).then((map) => { if (!cancelled) setBlobs(map); }).catch(() => { if (!cancelled) { setError('This project could not be read from storage.'); setBuilding(false); } });
    return () => { cancelled = true; };
  }, [project]);

  useEffect(() => {
    if (!blobs) return;
    let cancelled = false;
    setBuilding(true); setError(''); setReport(null);
    setLogs([line('info', `Building ${page === project.entry ? project.name : page}`)]);
    let storage: Record<string, string> = {};
    try { storage = JSON.parse(localStorage.getItem(`portdeck-preview-${project.id}`) || '{}'); } catch { /* optional */ }
    (async () => {
      const [{ buildPreview }, { createPayload }] = await Promise.all([import('@/lib/compiler'), import('@/lib/runtime')]);
      const bundle = await buildPreview(project, blobSource(blobs), { entry: page });
      const payload = await createPayload(bundle, { blobs }, storage, { pageUrl: urlFor(location) });
      if (cancelled) return;
      payloadRef.current = payload;
      setReport(bundle.report);
      setBuilding(false);
      setLogs((current) => [...current, line('success', `Built in ${bundle.report.elapsedMs} ms · ${bundle.report.modules} modules · ${bundle.report.runtime}`), ...bundle.report.warnings.map((warning) => line('warn', warning))]);
    })().catch((failure) => {
      if (cancelled) return;
      const text = failure instanceof Error ? failure.message : String(failure);
      setError(text); setBuilding(false); setLogs((current) => [...current, line('error', text)]);
    });
    return () => { cancelled = true; };
  }, [blobs, project, page, buildNumber, location, nonce, pathToFile, urlFor]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const data = event.data;
      const frame = iframeRef.current?.contentWindow;
      if (!frame || event.source !== frame || !data?.__portdeck) return;
      // Boot is the handshake that establishes the token, so it is accepted before the check.
      if (data.type !== 'boot' && data.token !== frameTokenRef.current) return;
      // A freshly loaded document reports where it actually is, so deep links and browser back/forward resolve.
      if (data.type === 'boot') {
        // The frame mints the token, so the handshake needs no shared secret in the URL.
        frameTokenRef.current = String(data.token ?? '');
        frame.postMessage({ __portdeckLoad: frameTokenRef.current, payload: payloadRef.current }, '*');
        if (typeof data.path === 'string' && data.path !== location) setPage(pathToFile(data.path));
        return;
      }
      if (data.type === 'storage' && data.data && typeof data.data === 'object') {
        try { const value = JSON.stringify(data.data); if (value.length < 2_000_000) localStorage.setItem(`portdeck-preview-${project.id}`, value); } catch { /* optional */ }
      }
      if (data.type === 'navigate' && typeof data.path === 'string') { setPage(pathToFile(data.path)); navigateTo(data.path); return; }
      // The app pushed or popped its own route: back/forward needs a rebuild, pushState does not.
      if (data.type === 'history' && typeof data.path === 'string') {
        setPage(pathToFile(data.path));
        if (data.pop) navigateTo(data.path);
        return;
      }
      if (data.type === 'ready') setLogs((current) => current[current.length - 1]?.text === 'Preview ready' ? current : [...current, line('success', 'Preview ready')]);
      if (data.type === 'log' && typeof data.text === 'string') {
        const second = Math.floor(Date.now() / 1000);
        if (floodRef.current.second !== second) floodRef.current = { second, count: 0 };
        if (++floodRef.current.count > 30) return;
        setLogs((current) => {
          const next = [...current];
          const last = next[next.length - 1];
          if (last && last.level === data.level && last.text === data.text) next[next.length - 1] = { ...last, count: last.count + 1 };
          else next.push(line(data.level || 'log', data.text.slice(0, 4000)));
          return next.slice(-400);
        });
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [project.id, location, navigateTo, pathToFile]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = consoleRef.current;
    if (element && element.scrollHeight - element.scrollTop - element.clientHeight < 96) element.scrollTop = element.scrollHeight;
  }, [logs, panel]);

  useEffect(() => {
    if (!selected || !blobs) return;
    setShown(selected);
    setSourceText(null);
    const blob = blobs.get(selected.path);
    if (!blob || !isTextual(selected)) return;
    let cancelled = false;
    blob.slice(0, SOURCE_LIMIT).text().then((text) => { if (!cancelled) setSourceText(text); });
    return () => { cancelled = true; };
  }, [selected, blobs]);

  useEffect(() => {
    const change = () => { if (!document.fullscreenElement) setImmersive(false); };
    document.addEventListener('fullscreenchange', change);
    return () => {
      document.removeEventListener('fullscreenchange', change);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (!immersive) return;
    let timer = window.setTimeout(() => setIdle(true), 2200);
    const wake = () => { setIdle(false); window.clearTimeout(timer); timer = window.setTimeout(() => setIdle(true), 2200); };
    window.addEventListener('pointermove', wake, { passive: true });
    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('keydown', wake);
    return () => { window.clearTimeout(timer); window.removeEventListener('pointermove', wake); window.removeEventListener('pointerdown', wake); window.removeEventListener('keydown', wake); };
  }, [immersive]);

  const narrow = stageSize.width > 0 && stageSize.width < 600;
  const devices = DEVICES.filter((item) => item.value !== 'desktop' || !narrow);
  useEffect(() => { if (narrow && device === 'desktop') setDevice('tablet'); }, [narrow, device]);
  const rotatable = device === 'phone' || device === 'tablet';
  const landscape = rotatable && orientation === 'landscape';

  // Size changes slide and scale the frame; orientation changes physically turn it.
  useLayoutEffect(() => {
    const before = flip.current;
    flip.current = null;
    const element = frameRef.current;
    if (!before || !element || prefersReducedMotion()) return;
    const after = element.getBoundingClientRect();
    if (!after.width || !after.height) return;
    const dx = before.rect.left + before.rect.width / 2 - (after.left + after.width / 2);
    const dy = before.rect.top + before.rect.height / 2 - (after.top + after.height / 2);
    const from = before.turn
      ? `translate(${dx}px, ${dy}px) rotate(${before.turn}deg) scale(${before.rect.height / after.width}, ${before.rect.width / after.height})`
      : `translate(${dx}px, ${dy}px) scale(${before.rect.width / after.width}, ${before.rect.height / after.height})`;
    element.animate([{ transform: from }, { transform: 'none' }], before.turn
      ? { duration: 560, easing: 'cubic-bezier(.3, 1.3, .5, 1)' }
      : { duration: 440, easing: 'cubic-bezier(.2, .8, .2, 1)' });
  }, [device, orientation]);

  const spec = DEVICES.find((item) => item.value === device) ?? DEVICES[0];
  const base = spec.size ?? null;
  const width = base ? (landscape ? base[1] : base[0]) : 0;
  const height = base ? (landscape ? base[0] : base[1]) : 0;
  const gutter = immersive ? 32 : narrow ? 24 : 56;
  const scale = base && stageSize.width ? Math.min((stageSize.width - gutter) / width, (stageSize.height - gutter) / height, 1) : 1;
  const query = search.trim().toLowerCase();
  const visibleFiles = useMemo(() => (query ? project.files.filter((file) => file.path.toLowerCase().includes(query)) : project.files), [project.files, query]);
  const errorCount = logs.filter((entry) => entry.level === 'error').reduce((sum, entry) => sum + entry.count, 0);
  const totalSize = project.totalSize || project.files.reduce((sum, file) => sum + file.size, 0);
  const shownPanel = panel ?? lastPanel;

  const captureFrame = (turn = 0) => { const rect = frameRef.current?.getBoundingClientRect(); flip.current = rect ? { rect, turn } : null; };
  const changeDevice = (next: Device) => { if (next === device) return; captureFrame(); setDevice(next); };
  const changeOrientation = (next: Orientation) => { if (next === orientation || !rotatable) return; captureFrame(next === 'landscape' ? 90 : -90); setOrientation(next); };
  const toggleOrientation = () => changeOrientation(orientation === 'portrait' ? 'landscape' : 'portrait');
  const reload = () => setBuildNumber((value) => value + 1);
  const previewPage = (path: string) => { setPage(path); setSelected(null); navigateTo(`/${path === project.entry ? '' : path}`.replace('//', '/')); };
  const togglePanel = (next: Panel) => { if (panel === next) setPanel(null); else { setLastPanel(next); setPanel(next); } };
  const enterImmersive = () => {
    setMenuOpen(false);
    setIdle(false);
    if (document.fullscreenEnabled && !document.fullscreenElement) { setImmersive(true); void document.documentElement.requestFullscreen().catch(() => undefined); }
    else withViewTransition(() => setImmersive(true));
  };
  const exitImmersive = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    withViewTransition(() => setImmersive(false));
  };
  const copySource = async () => {
    if (sourceText === null) return;
    try { await navigator.clipboard.writeText(sourceText); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }
    catch { onNotify('Clipboard access was blocked.', 'error'); }
  };
  const addFiles = async (files: FileList | null) => {
    if (!files?.length || !blobs) return;
    try { await onUpdate(await addProjectFiles(project, blobs, files)); onNotify(`Updated ${files.length} file${files.length === 1 ? '' : 's'}`, 'success'); }
    catch (failure) { onNotify(failure instanceof Error ? failure.message : String(failure), 'error'); }
  };
  const exportFiles = () => {
    if (!blobs) return;
    exportProject(project, blobs).then((saved) => { if (saved) onNotify('Exported ZIP', 'success'); }).catch((failure) => onNotify(failure instanceof Error ? failure.message : String(failure), 'error'));
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = panelHeight;
    const max = Math.max(180, (workspaceRef.current?.clientHeight ?? 640) * 0.72);
    let next = startHeight;
    let frame = 0;
    setResizing(true);
    const move = (moveEvent: PointerEvent) => {
      next = Math.min(max, Math.max(84, startHeight + startY - moveEvent.clientY));
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setPanelHeight(next));
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      cancelAnimationFrame(frame);
      setResizing(false);
      if (next < 120) { setPanel(null); setPanelHeight(startHeight); return; }
      setPanelHeight(next);
      try { localStorage.setItem('portdeck-panel-height', String(Math.round(next))); } catch { /* optional */ }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      if (event.key === 'Escape') {
        if (menuOpen) setMenuOpen(false);
        else if (immersive) exitImmersive();
        else if (panel) setPanel(null);
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'r') reload();
      else if (key === 'f') { if (immersive) exitImmersive(); else enterImmersive(); }
      else if (key === 'o') toggleOrientation();
      else if (/^[1-4]$/.test(key)) { const next = DEVICES[Number(key) - 1]; if (devices.includes(next)) changeDevice(next.value); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });

  const status = building
    ? { tone: 'building', label: 'Building', icon: 'loader-circle' as IconName }
    : error ? { tone: 'failed', label: 'Error', icon: 'circle-alert' as IconName } : { tone: 'live', label: 'Live', icon: null };
  const lastLog = logs[logs.length - 1]?.text ?? '';
  const frameStyle: CSSProperties | undefined = base ? { width: width * scale, height: height * scale } : undefined;
  const awayFromEntry = location !== '/';

  return <main ref={workspaceRef} className={`workspace ${immersive ? 'is-immersive' : ''} ${idle ? 'is-idle' : ''} ${resizing ? 'resizing' : ''}`}>
    <header className="ws-header" style={{ viewTransitionName: 'ws-header' } as CSSProperties}>
      <PressButton className="back-button" onClick={onBack} aria-label={`Back to ${project.demo ? 'demos' : 'projects'}`} tip="Back">
        <Icon name="chevron-left" size={19} /><span>{project.demo ? 'Demos' : 'Projects'}</span>
      </PressButton>
      <div className="ws-title">
        <span className="ws-brand"><BrandIcon name={frameworkBrand(project.framework)} size={15} /></span>
        <h1 style={{ viewTransitionName: 'pd-title' } as CSSProperties}>{project.name}</h1>
        {awayFromEntry && <PressButton className="page-chip" onClick={() => { setPage(project.entry); navigateTo('/'); }} tip="Back to the start page" aria-label={`Showing ${location}. Back to the start page`}>
          <Icon name="house" size={13} /><span>{location.replace(/^\//, '') || '/'}</span>
        </PressButton>}
        <span className={`status ${status.tone}`} role="status">
          {status.icon ? <Icon name={status.icon} size={13} className={building ? 'spin' : ''} /> : <i className="status-dot" />}
          <span>{status.label}</span>
        </span>
        {!online && <span className="offline-dot" data-tip="Offline"><Icon name="wifi-off" size={14} /></span>}
      </div>
      <div className="ws-actions">
        <IconButton icon="refresh-cw" label="Reload (R)" spin={building} onClick={reload} />
        <div className="ws-more">
          <IconButton icon="ellipsis" label="More" aria-expanded={menuOpen} aria-haspopup="menu" onClick={() => setMenuOpen((value) => !value)} />
          {menu.mounted && <>
            <button className="menu-dismiss" aria-label="Close menu" tabIndex={-1} onClick={() => setMenuOpen(false)} />
            <div className={`menu ${menu.closing ? 'closing' : ''}`} role="menu">
              <button role="menuitem" onClick={() => { setMenuOpen(false); addFilesRef.current?.click(); }}><Icon name="file-plus" size={16} />Add or replace files</button>
              <button role="menuitem" onClick={() => { setMenuOpen(false); exportFiles(); }}><Icon name="download" size={16} />Export as ZIP</button>
              <button role="menuitem" onClick={enterImmersive}><Icon name="maximize-2" size={16} />Full screen</button>
              {!project.demo && <><div className="menu-sep" /><button role="menuitem" className="danger" onClick={() => { setMenuOpen(false); onRemove(); }}><Icon name="trash-2" size={16} />Remove project</button></>}
            </div>
          </>}
          <input ref={addFilesRef} type="file" multiple hidden onChange={(event) => { void addFiles(event.target.files); event.target.value = ''; }} />
        </div>
      </div>
    </header>

    <div className="ws-toolbar" style={{ viewTransitionName: 'ws-toolbar' } as CSSProperties}>
      <div className="ws-switches">
        <Segmented label="Preview size" value={device} onChange={changeDevice} className="device-switch" options={devices.map(({ value, label, icon }) => ({ value, label, icon }))} />
        <div className={`orientation-slot ${rotatable ? 'open' : ''}`} aria-hidden={!rotatable}>
          <Segmented label="Orientation" value={orientation} onChange={changeOrientation} className="orientation-switch" options={ORIENTATIONS} />
        </div>
      </div>
      <div className="ws-tools">
        {base && <span className="zoom" aria-label="Zoom">{Math.round(scale * 100)}%</span>}
        <IconButton icon="maximize-2" label="Full screen (F)" onClick={enterImmersive} />
      </div>
    </div>

    <div ref={stageRef} className="ws-stage" style={{ viewTransitionName: 'pd-active' } as CSSProperties}>
      {building && <div className="build-state">
        <div className="scan" aria-hidden="true"><i /><i /><i /><i /><span /></div>
        <strong>Building</strong>
        <small>{lastLog}</small>
      </div>}
      {error && !building && <div className="build-state failed">
        <span className="tile danger"><Icon name="circle-alert" size={22} /></span>
        <strong>Build failed</strong>
        <pre>{error}</pre>
        <PressButton className="ghost-button" onClick={reload}><Icon name="refresh-cw" size={15} /><span>Try again</span></PressButton>
      </div>}
      {!building && !error && <div key={`${page}-${nonce}`} ref={frameRef} className={`device-frame ${device} ${landscape ? 'landscape' : ''}`} style={frameStyle}>
        <iframe key={`${page}-${nonce}`} ref={iframeRef} title={`${project.name} preview`} sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads allow-pointer-lock" allow="clipboard-write; fullscreen; autoplay; gamepad"
          srcDoc={frameSrc} style={base ? { width, height, transform: `scale(${scale})`, transformOrigin: 'top left' } : undefined} />
      </div>}
      {immersive && <div className="immersive-bar">
        {rotatable && <PressButton className="immersive-button" onClick={toggleOrientation} aria-label={`Switch to ${orientation === 'portrait' ? 'landscape' : 'portrait'}`} tip={`${orientation === 'portrait' ? 'Landscape' : 'Portrait'} (O)`}>
          <Icon name="rotate-cw" size={18} />
        </PressButton>}
        <PressButton className="immersive-button" onClick={exitImmersive} aria-label="Exit full screen" tip="Exit full screen (Esc)"><Icon name="minimize-2" size={18} /></PressButton>
      </div>}
    </div>

    {sheet.mounted && !immersive && <section className={`sheet ${sheet.closing ? 'closing' : ''}`} style={{ height: panelHeight }} aria-label={shownPanel}>
      <div className="sheet-handle" onPointerDown={startResize} role="separator" aria-orientation="horizontal" aria-label="Resize panel"><span /></div>
      {shownPanel === 'console' && <div ref={consoleRef} className="console">
        {logs.length ? logs.map((entry) => <div key={entry.id} className={`log ${entry.level}`}>
          <Icon name={LEVEL_ICON[entry.level] ?? 'chevron-right'} size={14} />
          <code>{entry.text}</code>
          {entry.count > 1 ? <span className="count">{entry.count}</span> : <span />}
          <time>{entry.time}</time>
        </div>) : <p className="panel-empty">Console is clear.</p>}
      </div>}
      {shownPanel === 'files' && <div className="files">
        <label className="files-search"><Icon name="search" size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Filter ${project.files.length.toLocaleString()} files`} aria-label="Filter files" /></label>
        {visibleFiles.length ? <FileList files={visibleFiles} onOpen={setSelected} onPreview={previewPage} /> : <p className="panel-empty">No files match “{search}”.</p>}
      </div>}
      {shownPanel === 'info' && <div className="info-panel">
        <div className="info-item"><span>Framework</span><strong><BrandIcon name={frameworkBrand(project.framework)} size={14} />{project.framework}</strong></div>
        <div className="info-item mono"><span>Page</span><strong>{location}</strong></div>
        <div className="info-item"><span>Size</span><strong>{project.files.length.toLocaleString()} files · {formatSize(totalSize)}</strong></div>
        <div className="info-item"><span>Runtime</span><strong>{report ? `${report.runtime} · ${report.modules} modules` : '…'}</strong></div>
        <div className="info-item"><span>Works offline</span><strong className="chips">{report?.offline.length ? report.offline.map((item) => <span key={item} className="chip local"><Icon name="hard-drive" size={12} />{item}</span>) : 'Everything is local'}</strong></div>
        <div className="info-item"><span>Needs network</span><strong className="chips">{report?.network.length ? report.network.map((item) => <span key={item} className="chip network"><Icon name="cloud-download" size={12} />{item}</span>) : 'Nothing'}</strong></div>
        {report?.warnings.length ? <div className="info-item wide"><span>Notes</span><strong className="notes">{report.warnings.map((warning) => <span key={warning}>{warning}</span>)}</strong></div> : null}
      </div>}
    </section>}

    <nav className="ws-tabs" aria-label="Panels" style={{ viewTransitionName: 'ws-tabs' } as CSSProperties}>
      <div className="ws-tab-group">
        {PANELS.map((item) => <PressButton key={item.value} className={`ws-tab ${panel === item.value ? 'active' : ''}`} aria-pressed={panel === item.value} onClick={() => togglePanel(item.value)}>
          <Icon name={item.icon} size={16} />
          <span>{item.label}</span>
          {item.value === 'console' && errorCount > 0 && <b className="badge">{errorCount > 99 ? '99+' : errorCount}</b>}
          {item.value === 'files' && <small>{project.files.length > 9999 ? `${Math.round(project.files.length / 1000)}k` : project.files.length}</small>}
        </PressButton>)}
      </div>
      <div className="ws-tab-tools">
        {panel === 'console' && <IconButton icon="ban" label="Clear console" onClick={() => setLogs([])} />}
        {panel && <IconButton icon="chevron-down" label="Hide panel" onClick={() => setPanel(null)} />}
      </div>
    </nav>

    {source.mounted && shown && <div className={`dialog-backdrop ${source.closing ? 'closing' : ''}`} onPointerDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
      <section className="dialog wide source-dialog" role="dialog" aria-modal="true" aria-label={`Source of ${shown.path}`}>
        <header className="dialog-header">
          <span className="dialog-icon"><Icon name={fileIcon(shown.path)} size={16} /></span>
          <h2 className="mono">{shown.path}</h2>
          <span className="source-size">{formatSize(shown.size)}</span>
          {/\.html?$/i.test(shown.path) && <IconButton icon="globe" label="Preview this page" onClick={() => previewPage(shown.path)} />}
          {sourceText !== null && <IconButton icon={copied ? 'check' : 'copy'} label={copied ? 'Copied' : 'Copy'} className={copied ? 'is-on' : ''} onClick={() => void copySource()} />}
          <IconButton icon="x" label="Close" onClick={() => setSelected(null)} />
        </header>
        {!isTextual(shown)
          ? <div className="binary-notice"><span className="tile"><Icon name={fileIcon(shown.path)} size={22} /></span><strong>{shown.type.startsWith('image/') ? 'Image' : shown.type.startsWith('video/') ? 'Video' : shown.type.startsWith('audio/') ? 'Audio' : 'Binary file'}</strong><span>{shown.type || 'Unknown type'} · {formatSize(shown.size)}</span></div>
          : sourceText === null
            ? <div className="binary-notice"><span className="loader-line" /></div>
            : <div className="source-body">
              <pre className="source-gutter" aria-hidden="true">{Array.from({ length: sourceText.split('\n').length }, (_, index) => index + 1).join('\n')}</pre>
              <pre className="source-code"><code>{sourceText}</code>{shown.size > SOURCE_LIMIT && <span className="source-cut">{`\n\n— Showing the first ${formatSize(SOURCE_LIMIT)} of ${formatSize(shown.size)} —`}</span>}</pre>
            </div>}
      </section>
    </div>}
  </main>;
}
