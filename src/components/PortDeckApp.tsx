'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { demoProjects } from '@/lib/samples';
import { formatSize, importDataTransfer, importFileList } from '@/lib/importer';
import { deleteProject, getSavedProjects, saveProject, storageEstimate } from '@/lib/store';
import type { DeckProject, DemoCatalogItem, ImportProgress } from '@/lib/types';
import Backdrop from './Backdrop';
import { BrandIcon, Icon, Logo, frameworkBrand, type IconName } from './icons';
import { IconButton, PressButton, Segmented, TooltipLayer, usePresence, withViewTransition } from './ui';

const loadWorkspace = () => import('./Workspace');
const Workspace = dynamic(loadWorkspace, { ssr: false, loading: () => <div className="workspace-loading"><span className="loader-line" /></div> });

type LibraryTab = 'projects' | 'demos';
export type Tone = 'info' | 'success' | 'error';
interface Toast { id: number; tone: Tone; text: string }

const TOAST_ICON: Record<Tone, IconName> = { info: 'info', success: 'circle-check', error: 'circle-alert' };
const message = (failure: unknown) => (failure instanceof Error ? failure.message : 'Something went wrong.');

function subscribeOnline(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => { window.removeEventListener('online', callback); window.removeEventListener('offline', callback); };
}
function useOnline() { return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true); }

const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function relativeTime(timestamp: number): string {
  const seconds = (timestamp - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  return 'just now';
}

function Dialog({ open, title, icon, onClose, children, wide = false }: { open: boolean; title: string; icon?: IconName; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const { mounted, closing } = usePresence(open, 190);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [open, onClose]);
  if (!mounted) return null;
  return <div className={`dialog-backdrop ${closing ? 'closing' : ''}`} onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panelRef} tabIndex={-1} className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="dialog-header">
        {icon && <span className="dialog-icon"><Icon name={icon} size={16} /></span>}
        <h2>{title}</h2>
        <IconButton icon="x" label="Close" onClick={onClose} />
      </header>
      {children}
    </section>
  </div>;
}

function ImportDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: (project: DeckProject) => Promise<void> }) {
  const zipRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [free, setFree] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!open) return;
    setError(''); setDragging(false); setProgress(null);
    storageEstimate().then((estimate) => setFree(estimate && estimate.quota ? Math.max(0, estimate.quota - estimate.usage) : null));
  }, [open]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async (task: (onProgress: (value: ImportProgress) => void, signal: AbortSignal) => Promise<DeckProject>) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true); setError(''); setProgress(null);
    try { await onImported(await task(setProgress, controller.signal)); }
    catch (failure) { if (!(failure instanceof DOMException && failure.name === 'AbortError')) setError(message(failure)); }
    finally { setBusy(false); setProgress(null); abortRef.current = null; }
  };
  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    if (files.length) void run((onProgress, signal) => importFileList(files, onProgress, signal));
  };
  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    const data = event.dataTransfer;
    // Capture the drop synchronously; the browser clears it once this handler returns.
    let started: ((onProgress: (value: ImportProgress) => void, signal: AbortSignal) => Promise<DeckProject>) | null = null;
    const pending: { onProgress?: (value: ImportProgress) => void } = {};
    const controller = new AbortController();
    const task = importDataTransfer(data, (value) => pending.onProgress?.(value), controller.signal);
    started = (onProgress, signal) => { pending.onProgress = onProgress; signal.addEventListener('abort', () => controller.abort()); return task; };
    void run(started);
  };
  const percent = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : null;
  const options: { icon: IconName; title: string; detail: string; pick: () => void }[] = [
    { icon: 'folder', title: 'Folder', detail: 'A whole project directory', pick: () => folderRef.current?.click() },
    { icon: 'file-archive', title: 'ZIP archive', detail: 'A compressed project', pick: () => zipRef.current?.click() },
    { icon: 'files', title: 'Files', detail: 'One or more loose files', pick: () => filesRef.current?.click() },
  ];

  return <Dialog open={open} title="Import project" icon="upload" onClose={onClose}>
    <div className="import-body">
      <div className={`dropzone ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}>
        <span className="dropzone-icon"><Icon name={busy ? 'loader-circle' : 'folder-input'} size={22} className={busy ? 'spin' : ''} /></span>
        <strong>{busy ? (progress?.phase === 'reading' || !progress ? 'Reading…' : progress.phase === 'saving' ? 'Finishing…' : `Copying ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}`) : 'Drop a folder or ZIP'}</strong>
        <span>{busy && progress ? `${formatSize(progress.bytes)} stored` : 'Files never leave this device.'}</span>
        {busy && <span className="progress" aria-hidden="true"><i style={{ transform: `scaleX(${percent === null ? 0.12 : Math.max(0.02, percent / 100)})` }} className={percent === null ? 'indeterminate' : ''} /></span>}
      </div>
      <div className="import-options">
        {options.map((option) => <PressButton key={option.title} className="import-option" disabled={busy} onClick={option.pick}>
          <span className="tile"><Icon name={option.icon} size={18} /></span>
          <span className="import-option-text"><b>{option.title}</b><small>{option.detail}</small></span>
          <Icon name="chevron-right" size={16} className="chev" />
        </PressButton>)}
      </div>
      {error && <p className="import-error" role="alert"><Icon name="circle-alert" size={16} />{error}</p>}
      {busy ? <PressButton className="ghost-button import-cancel" onClick={() => abortRef.current?.abort()}><Icon name="x" size={15} /><span>Cancel</span></PressButton>
        : <p className="import-note">Any size{free !== null ? ` · ${formatSize(free)} free on this device` : ''} · node_modules and .git are skipped</p>}
      <input ref={(node) => { folderRef.current = node; node?.setAttribute('webkitdirectory', ''); }} type="file" multiple hidden onChange={change} />
      <input ref={zipRef} type="file" accept=".zip,application/zip" hidden onChange={change} />
      <input ref={filesRef} type="file" multiple hidden onChange={change} />
    </div>
  </Dialog>;
}

function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rows: { icon: IconName; title: string; body: string }[] = [
    { icon: 'folder-input', title: 'Import', body: 'Choose a folder, ZIP, or files, or drag them onto the window. Projects are stored in this browser only.' },
    { icon: 'monitor-smartphone', title: 'Preview', body: 'Switch between fit, phone, tablet, and desktop sizes. Console, files, and project details open from the bottom bar.' },
    { icon: 'wifi-off', title: 'Online and offline', body: 'Projects of any size are stored on this device. React, Tailwind CSS, and the interface are bundled; npm packages, CDN scripts, and web fonts a project uses are saved the first time it runs online, then work offline.' },
  ];
  const shortcuts: [string, string][] = [['R', 'Reload preview'], ['F', 'Full screen'], ['1–4', 'Device size'], ['O', 'Rotate phone or tablet'], ['Esc', 'Close or exit']];
  return <Dialog open={open} title="Guide" icon="circle-question-mark" onClose={onClose}>
    <div className="help-body">
      {rows.map((row) => <section key={row.title} className="help-row">
        <span className="tile"><Icon name={row.icon} size={18} /></span>
        <div><h3>{row.title}</h3><p>{row.body}</p></div>
      </section>)}
      <div className="shortcuts" aria-label="Keyboard shortcuts">
        {shortcuts.map(([key, label]) => <div key={key} className="shortcut"><span>{label}</span><kbd>{key}</kbd></div>)}
      </div>
    </div>
  </Dialog>;
}

function ProjectCard({ project, index, meta, transitionName, onOpen }: { project: DeckProject; index: number; meta: string; transitionName?: string; onOpen: (project: DeckProject) => void }) {
  const frame = useRef(0);
  const tilt = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== 'mouse') return;
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      element.style.setProperty('--rx', `${((0.5 - y) * 4).toFixed(2)}deg`);
      element.style.setProperty('--ry', `${((x - 0.5) * 5).toFixed(2)}deg`);
      element.style.setProperty('--gx', `${(x * 100).toFixed(1)}%`);
      element.style.setProperty('--gy', `${(y * 100).toFixed(1)}%`);
    });
  };
  const settle = (event: ReactPointerEvent<HTMLButtonElement>) => {
    cancelAnimationFrame(frame.current);
    event.currentTarget.style.setProperty('--rx', '0deg');
    event.currentTarget.style.setProperty('--ry', '0deg');
  };
  const style = { ['--i' as string]: index, ...(transitionName ? { viewTransitionName: transitionName } : {}) } as CSSProperties;
  return <PressButton className="project-card" style={style} onPointerMove={tilt} onPointerLeave={settle} onClick={() => onOpen(project)} aria-label={`Open ${project.name}`}>
    <span className="card-glow" aria-hidden="true" />
    <span className="card-brackets" aria-hidden="true"><i /><i /><i /><i /></span>
    <span className="card-brand"><BrandIcon name={frameworkBrand(project.framework)} size={19} /></span>
    <Icon name="arrow-up-right" size={17} className="card-arrow" />
    <span className="card-name" style={transitionName ? { viewTransitionName: 'pd-title' } : undefined}>{project.name}</span>
    <span className="card-meta">{meta}</span>
  </PressButton>;
}

function DropOverlay({ open }: { open: boolean }) {
  const { mounted, closing } = usePresence(open, 160);
  if (!mounted) return null;
  return <div className={`drop-overlay ${closing ? 'closing' : ''}`} aria-hidden="true">
    <div className="drop-frame">
      <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
      <Icon name="folder-input" size={30} />
      <strong>Drop to import</strong>
      <span>Folder, ZIP, or files</span>
    </div>
  </div>;
}

function ToastView({ toast, last }: { toast: Toast | null; last: Toast | null }) {
  const { mounted, closing } = usePresence(toast !== null, 200);
  const shown = toast ?? last;
  if (!mounted || !shown) return null;
  return <div key={shown.id} className={`toast ${shown.tone} ${closing ? 'closing' : ''}`} role="status">
    <Icon name={TOAST_ICON[shown.tone]} size={16} />
    <span>{shown.text}</span>
  </div>;
}

export default function PortDeckApp({ catalog }: { catalog: DemoCatalogItem[] }) {
  const [tab, setTab] = useState<LibraryTab>('demos');
  const [direction, setDirection] = useState<'left' | 'right'>('right');
  const [animateCards, setAnimateCards] = useState(true);
  const [projects, setProjects] = useState<DeckProject[] | null>(null);
  const [active, setActive] = useState<DeckProject | null>(null);
  const [transitionId, setTransitionId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'import' | 'help' | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [lastToast, setLastToast] = useState<Toast | null>(null);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState<ImportProgress | null>(null);
  const dragDepth = useRef(0);
  const toastCounter = useRef(0);
  const online = useOnline();

  const notify = useCallback((text: string, tone: Tone = 'info') => {
    toastCounter.current += 1;
    const next = { id: toastCounter.current, text, tone };
    setToast(next);
    setLastToast(next);
  }, []);

  useEffect(() => {
    getSavedProjects()
      .then((saved) => { setProjects(saved); if (saved.length) setTab('projects'); })
      .catch(() => { setProjects([]); notify('Browser storage is unavailable, so projects will not be saved.', 'error'); });
  }, [notify]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(null), 3200); return () => window.clearTimeout(timer); }, [toast]);

  useEffect(() => {
    // Cache the app shell for offline use, then warm the preview engine while the browser is idle.
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (connection?.saveData) return;
    const warm = () => { void loadWorkspace(); void import('@/lib/compiler'); };
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(warm, { timeout: 4000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(warm, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  const demos = useMemo(() => [...demoProjects]
    .sort((a, b) => (catalog.find((item) => item.id === a.id)?.sortOrder ?? 0) - (catalog.find((item) => item.id === b.id)?.sortOrder ?? 0))
    .map((project) => { const item = catalog.find((entry) => entry.id === project.id); return item ? { ...project, name: item.name } : project; }), [catalog]);

  const switchTab = (next: LibraryTab) => {
    if (next === tab) return;
    setDirection(next === 'demos' ? 'right' : 'left');
    setAnimateCards(true);
    setTab(next);
  };
  const open = (project: DeckProject) => {
    // Name the clicked card first so the browser captures it as the shared element.
    flushSync(() => setTransitionId(project.id));
    withViewTransition(() => setActive(project));
  };
  const back = () => {
    const current = active;
    withViewTransition(() => {
      setAnimateCards(false);
      setActive(null);
      if (current) setTab(current.demo ? 'demos' : 'projects');
    });
  };
  const onImported = async (project: DeckProject) => {
    setProjects((current) => [project, ...(current ?? []).filter((item) => item.id !== project.id)]);
    setDialog(null);
    setTab('projects');
    notify(`Imported ${project.name}`, 'success');
    open(project);
  };
  const onProjectUpdated = async (project: DeckProject) => {
    try { await saveProject(project); setProjects((current) => [project, ...(current ?? []).filter((item) => item.id !== project.id)]); }
    catch { notify('Changes are open, but could not be saved.', 'error'); }
    setActive(project);
  };
  const removeProject = async () => {
    if (!active || !window.confirm(`Remove “${active.name}” from PortDeck? The original files are not affected.`)) return;
    try {
      await deleteProject(active.id);
      const removed = active.name;
      setProjects((current) => (current ?? []).filter((item) => item.id !== active.id));
      withViewTransition(() => { setAnimateCards(true); setActive(null); setTab('projects'); });
      notify(`Removed ${removed}`, 'success');
    } catch { notify('Could not remove the saved project.', 'error'); }
  };

  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
  const dragEnter = (event: DragEvent<HTMLDivElement>) => { if (active || dialog || !hasFiles(event)) return; event.preventDefault(); dragDepth.current += 1; setDragging(true); };
  const dragOver = (event: DragEvent<HTMLDivElement>) => { if (active || dialog || !hasFiles(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; };
  const dragLeave = () => { if (!dragging) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); };
  const drop = (event: DragEvent<HTMLDivElement>) => {
    if (active || dialog || !hasFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    setImporting({ phase: 'reading', done: 0, total: 0, bytes: 0 });
    importDataTransfer(event.dataTransfer, setImporting)
      .then(onImported)
      .catch((failure) => notify(message(failure), 'error'))
      .finally(() => setImporting(null));
  };

  const visible = tab === 'projects' ? projects ?? [] : demos;
  const subtitle = tab === 'projects'
    ? projects === null ? 'Loading…' : projects.length ? `${projects.length} saved on this device` : 'Nothing imported yet'
    : 'Small apps to try the preview with';
  const metaFor = (project: DeckProject) => {
    const size = formatSize(project.totalSize ?? project.files.reduce((sum, file) => sum + file.size, 0));
    return project.demo ? `${project.framework} · ${project.files.length} files · ${size}` : `${project.framework} · ${size} · ${relativeTime(project.createdAt)}`;
  };

  return <div className={`app-shell ${active ? 'in-workspace' : ''}`} onDragEnter={dragEnter} onDragOver={dragOver} onDragLeave={dragLeave} onDrop={drop}>
    <div className="ambient" aria-hidden="true" />
    {!active && <Backdrop />}
    {!active && <header className="app-header">
      <PressButton className="app-brand" onClick={() => switchTab(projects?.length ? 'projects' : 'demos')} aria-label="PortDeck"><Logo size={22} /><span>PortDeck</span></PressButton>
      <Segmented label="Library" value={tab} onChange={switchTab} options={[
        { value: 'projects', label: 'Projects', count: projects?.length ?? 0 },
        { value: 'demos', label: 'Demos', count: demos.length },
      ]} />
      <div className="header-actions">
        {!online && <span className="offline-pill" data-tip="No connection. Bundled previews still work."><Icon name="wifi-off" size={14} /><span>Offline</span></span>}
        <IconButton icon="circle-question-mark" label="Guide" className="header-help" onClick={() => setDialog('help')} />
        <PressButton className="primary-button" onClick={() => setDialog('import')}><Icon name="upload" size={16} /><span>Import</span></PressButton>
      </div>
    </header>}
    {active
      ? <Workspace key={active.id} project={active} online={online} onBack={back} onRemove={() => void removeProject()} onUpdate={onProjectUpdated} onNotify={notify} />
      : <main className="library">
        <div className="library-inner">
          <div className="library-head">
            <h1>{tab === 'projects' ? 'Projects' : 'Demos'}</h1>
            <p>{subtitle}</p>
          </div>
          {projects === null
            ? <div className="project-grid">{[0, 1, 2].map((item) => <div key={item} className="skeleton" />)}</div>
            : visible.length
              ? <div key={tab} className={`project-grid ${animateCards ? `animate from-${direction}` : ''}`}>
                {visible.map((project, index) => <ProjectCard key={project.id} project={project} index={index} meta={metaFor(project)} transitionName={project.id === transitionId ? 'pd-active' : undefined} onOpen={open} />)}
              </div>
              : <div className="empty">
                <span className="empty-art"><Icon name="folder-open" size={26} /></span>
                <h2>No projects yet</h2>
                <p>Import a project folder or ZIP. You can also drag one onto this window.</p>
                <div className="empty-actions">
                  <PressButton className="primary-button" onClick={() => setDialog('import')}><Icon name="upload" size={16} /><span>Import</span></PressButton>
                  <PressButton className="ghost-button" onClick={() => switchTab('demos')}><span>Browse demos</span></PressButton>
                </div>
              </div>}
        </div>
      </main>}
    <ImportDialog open={dialog === 'import'} onClose={() => setDialog(null)} onImported={onImported} />
    <HelpDialog open={dialog === 'help'} onClose={() => setDialog(null)} />
    <DropOverlay open={dragging} />
    {importing && <div className="toast import-toast" role="status">
      <Icon name="loader-circle" size={16} className="spin" />
      <span>{importing.total ? `Importing ${importing.done.toLocaleString()} of ${importing.total.toLocaleString()} · ${formatSize(importing.bytes)}` : 'Reading files…'}</span>
      <span className="progress" aria-hidden="true"><i style={{ transform: `scaleX(${importing.total ? Math.max(0.02, importing.done / importing.total) : 0.12})` }} className={importing.total ? '' : 'indeterminate'} /></span>
    </div>}
    {!importing && <ToastView toast={toast} last={lastToast} />}
    <TooltipLayer />
  </div>;
}
