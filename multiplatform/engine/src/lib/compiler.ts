import * as Babel from '@babel/standalone';
import { init, parse } from 'es-module-lexer/minimal';
import { ASSET_FILE, CODE_FILE, HTML_FILE, STYLE_FILE } from './mime';
import { createNetContext, loadNetAsset, loadNetCss, loadNetModule, netKey } from './net';
import { loadNpmPackage, normalizeNpmPath, probeNpmFile, resolveEntrySubpath, type NpmPackage } from './npm';
import type { DeckProject, FileSource } from './types';
import { REACT_VENDORS } from './vendor/react.generated';

/**
 * Turns a project into a preview bundle. Nothing is inlined as base64: files are referenced by tokens
 * (pd-asset://, pd-module://, pd-style://) that the sandboxed preview resolves to its own blob URLs, so
 * project size only depends on the device's storage.
 */
export interface PreviewBundle {
  html: string;
  modules: Record<string, string>;
  styles: Record<string, string>;
  netAssets: Map<string, Blob>;
  userImports: Record<string, string>;
  env: Record<string, string | boolean>;
  needsBuffer: boolean;
  vendorModules: Record<string, string>;
  reactLine: '18' | '19';
  tailwind: boolean;
  page: string;
  root: string;
  report: BuildReport;
}

export interface BuildReport {
  entry: string;
  page: string;
  runtime: string;
  offline: string[];
  network: string[];
  dependencies: string[];
  warnings: string[];
  modules: number;
  elapsedMs: number;
}

const enc = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
export const assetToken = (key: string) => `pd-asset://${enc(key)}`;
const moduleToken = (key: string) => `pd-module://${enc(key)}`;
const styleToken = (key: string) => `pd-style://${enc(key)}`;
const HEAD_MARK = '<!--PD_HEAD-->';
const MISSING_ASSET =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij48cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIGZpbGw9IiMyYjJiMmIiLz48cGF0aCBkPSJNMTIgNDRsMTItMTYgOSAxMSA2LTcgMTMgMTJ6IiBmaWxsPSIjNTY1NjU2Ii8+PC9zdmc+';
const EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.json', '.css', '.svg'];
const RESOURCE_TAGS = /^(img|source|video|audio|track|input|object|embed|image|use|iframe)$/i;
/** Node built-ins that browser bundles still import, and where a maintained browser build lives. */
const NODE_POLYFILLS: Record<string, string> = {
  buffer: 'https://esm.sh/buffer@6.0.3?target=es2022',
  process: 'https://esm.sh/process@0.11.10?target=es2022',
  events: 'https://esm.sh/events@3.3.0?target=es2022',
  util: 'https://esm.sh/@jspm/core@2.1.0/nodelibs/browser/util?target=es2022',
  path: 'https://esm.sh/path-browserify@1.0.1?target=es2022',
  url: 'https://esm.sh/@jspm/core@2.1.0/nodelibs/browser/url?target=es2022',
  querystring: 'https://esm.sh/querystring@1.0.2?target=es2022',
  stream: 'https://esm.sh/@jspm/core@2.1.0/nodelibs/browser/stream?target=es2022',
  zlib: 'https://esm.sh/browserify-zlib@0.2.0?target=es2022',
  http: 'https://esm.sh/@jspm/core@2.1.0/nodelibs/browser/http?target=es2022',
  https: 'https://esm.sh/@jspm/core@2.1.0/nodelibs/browser/http?target=es2022',
  os: 'https://esm.sh/@jspm/core@2.1.0/nodelibs/browser/os?target=es2022',
  assert: 'https://esm.sh/@jspm/core@2.1.0/nodelibs/browser/assert?target=es2022',
  constants: 'https://esm.sh/@jspm/core@2.1.0/nodelibs/browser/constants?target=es2022',
};
const NODE_BUILTINS = new RegExp(`^(?:node:)?(?:${Object.keys(NODE_POLYFILLS).join('|')})$`);
/** Node core modules with no usable browser build; reported instead of silently returning nothing. */
const NODE_UNSUPPORTED =
  /^(?:node:)?(fs|child_process|crypto|net|tls|dns|worker_threads|cluster|vm|inspector|readline|perf_hooks|async_hooks|v8|module|http2|dgram|repl|tty|trace_events|string_decoder|sys|punycode|domain)(\/|$)/;

function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}
const dir = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '');
const majorOf = (spec?: string) => Number(spec?.match(/\d+/)?.[0] || 0);
const exactVersion = (spec?: string) => spec?.match(/\d+\.\d+\.\d+(?:-[\w.-]+)?/)?.[0];
const isRemote = (value: string) => /^(https?:)?\/\//i.test(value);
const hasScheme = (value: string) => /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//') || value.startsWith('#');

function pickReact(versions: Record<string, string>): '18' | '19' {
  const react = majorOf(versions.react);
  if (react) return react <= 18 ? '18' : '19';
  const next = majorOf(versions.next);
  if (next) return next >= 15 ? '19' : '18';
  return '19';
}

function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') {
        out += text[++i] ?? '';
      } else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

function globToRegex(glob: string): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        source += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
        i += glob[i + 2] === '/' ? 2 : 1;
      } else source += '[^/]*';
    } else if (c === '?') source += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      source += `(?:${glob
        .slice(i + 1, end)
        .split(',')
        .map((part) => part.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
        .join('|')})`;
      i = end;
    } else source += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

function relativeFrom(fromDir: string, path: string): string {
  const from = fromDir.split('/').filter(Boolean);
  const to = path.split('/');
  let shared = 0;
  while (shared < from.length && from[shared] === to[shared]) shared++;
  const up = from.length - shared;
  return `${up ? '../'.repeat(up) : './'}${to.slice(shared).join('/')}`;
}

const NEXT_SHIMS: Record<string, string> = {
  'next/link': `import React from 'react';export default function Link({href,children,prefetch,replace,scroll,shallow,legacyBehavior,passHref,locale,...props}){return React.createElement('a',{href:typeof href==='string'?href:(href&&href.pathname)||'#',...props},children)}`,
  'next/image': `import React from 'react';export default function Image({src,alt='',fill,priority,placeholder,blurDataURL,quality,loader,unoptimized,...props}){const style=fill?{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover',...props.style}:props.style;return React.createElement('img',{src:typeof src==='string'?src:src&&src.src,alt,...props,style})}export function getImageProps(p){return {props:p}}`,
  'next/head': `import React from 'react';export default function Head({children}){return React.createElement(React.Fragment,null,children)}`,
  'next/navigation': `const nav=(v)=>{location.hash=v};export function useRouter(){return {push:nav,replace:nav,back:()=>history.back(),forward:()=>history.forward(),refresh:()=>{},prefetch:()=>{}}};export function usePathname(){return location.hash.slice(1)||'/'};export function useSearchParams(){return new URLSearchParams(location.hash.split('?')[1]||'')};export function useParams(){return {}};export function useSelectedLayoutSegment(){return null};export function useSelectedLayoutSegments(){return []};export function redirect(v){nav(v)};export function permanentRedirect(v){nav(v)};export function notFound(){throw new Error('Not found')}`,
  'next/router': `const nav=(v)=>{location.hash=typeof v==='string'?v:(v&&v.pathname)||'/';return Promise.resolve(true)};const router={push:nav,replace:nav,prefetch:()=>Promise.resolve(),back:()=>history.back(),reload:()=>{},get pathname(){return location.hash.slice(1)||'/'},get asPath(){return location.hash.slice(1)||'/'},query:{},isReady:true,events:{on(){},off(){},emit(){}}};export function useRouter(){return router};export function withRouter(C){return C};export default router`,
  'next/script': `import React from 'react';export default function Script({strategy,onLoad,onReady,onError,...props}){return React.createElement('script',props)}`,
  'next/dynamic': `import React from 'react';export default function dynamic(loader,options){const Component=React.lazy(()=>Promise.resolve(typeof loader==='function'?loader():loader).then((m)=>m&&m.default?m:{default:m}));return function Dynamic(props){return React.createElement(React.Suspense,{fallback:options&&options.loading?React.createElement(options.loading):null},React.createElement(Component,props))}}`,
  'next/font/google': `const font=()=>({className:'',style:{},variable:''});export default new Proxy({}, {get:()=>font});export const Inter=font,Roboto=font,Roboto_Mono=font,Montserrat=font,Open_Sans=font,Geist=font,Geist_Mono=font,Poppins=font,Lato=font,Manrope=font,DM_Sans=font,Space_Grotesk=font,JetBrains_Mono=font,Outfit=font,Plus_Jakarta_Sans=font,Nunito=font,Raleway=font,Playfair_Display=font,Source_Code_Pro=font,Fira_Code=font,IBM_Plex_Sans=font,IBM_Plex_Mono=font,Work_Sans=font,Rubik=font,Noto_Sans=font,Oswald=font;`,
  'next/font/local': `export default function localFont(){return {className:'',style:{},variable:''}}`,
};
const NEXT_JSX = `import * as R from "@portdeck/vendor/react/jsx-runtime";
const fix=(t,p)=>{if(t==='html'||t==='head'){return [R.Fragment,{children:p&&p.children}]}if(t==='body'){const{children,className,style}=p||{};return ['div',{children,className,style,'data-pd-body':''}]}return [t,p]};
export const Fragment=R.Fragment;
export function jsx(t,p,k){const[a,b]=fix(t,p);return R.jsx(a,b,k)}
export function jsxs(t,p,k){const[a,b]=fix(t,p);return R.jsxs(a,b,k)}
export function jsxDEV(t,p,k){const[a,b]=fix(t,p);return R.jsx(a,b,k)}`;

export async function buildPreview(project: DeckProject, source: FileSource, options: { entry?: string } = {}): Promise<PreviewBundle> {
  const started = performance.now();
  await init();
  const paths = new Set(project.files.map((file) => file.path));
  const warnings = new Set<string>();
  const modules = new Map<string, string>();
  const styles = new Map<string, string>();
  const styleOrder: string[] = [];
  const userImports: Record<string, string> = {};
  const net = createNetContext();
  const packages = new Map<string, boolean>();
  const tasks: Promise<unknown>[] = [];
  const track = <T>(task: Promise<T>) => {
    tasks.push(task);
    return task;
  };
  const drain = async () => {
    for (let i = 0; i < tasks.length; i++) await tasks[i];
  };

  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
  if (paths.has('package.json')) {
    try {
      pkg = JSON.parse(await source.text('package.json'));
    } catch {
      warnings.add('package.json could not be parsed.');
    }
  }
  const versions: Record<string, string> = { ...pkg.devDependencies, ...pkg.dependencies };
  const reactLine = pickReact(versions);
  const vendor = REACT_VENDORS[reactLine];
  let usesReact = false;
  const vendorModules: Record<string, string> = { buffer: 'https://esm.sh/buffer@6.0.3?target=es2022' };
  let needsBuffer = false;
  const BUNDLE_POLYFILL = /(^|[\s/(])(Buffer|process|global)(\.|\s*[),;]|$)/;
  if (majorOf(versions.react) && majorOf(versions.react) < 18)
    warnings.add(`React ${majorOf(versions.react)} is declared; the preview runs it on the bundled React ${vendor.version}.`);

  // Path aliases from tsconfig/jsconfig, with the common "@/" and "~/" conventions as fallbacks.
  const aliases: { prefix: string; targets: string[] }[] = [];
  for (const config of ['tsconfig.json', 'jsconfig.json', 'tsconfig.app.json']) {
    if (!paths.has(config)) continue;
    try {
      const parsed = JSON.parse(stripJsonComments(await source.text(config)));
      const options = parsed.compilerOptions ?? {};
      const baseUrl = normalize(options.baseUrl ?? '.');
      for (const [pattern, targets] of Object.entries<string[]>(options.paths ?? {})) {
        aliases.push({
          prefix: pattern.replace(/\*$/, ''),
          targets: targets.map((target) => normalize(`${baseUrl}/${target}`).replace(/\*$/, '') + (target.endsWith('/*') ? '/' : '')),
        });
      }
    } catch {
      /* ignore unreadable configs */
    }
  }
  aliases.push({ prefix: '@/', targets: ['src/', ''] }, { prefix: '~/', targets: ['src/', ''] });

  const entry = options.entry ?? project.entry;
  const htmlEntry = HTML_FILE.test(entry);
  const root = HTML_FILE.test(project.entry) ? dir(project.entry) : '';

  const publicEnv: Record<string, string | boolean> = { DEV: true, PROD: false, MODE: 'development', BASE_URL: '/', SSR: false };
  for (const envName of ['.env', '.env.local', '.env.development', '.env.development.local']) {
    if (!paths.has(envName)) continue;
    for (const line of (await source.text(envName)).split(/\r?\n/)) {
      const match = line.match(/^\s*((?:VITE_|NEXT_PUBLIC_|REACT_APP_|PUBLIC_)[A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match) publicEnv[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  }
  const processEnv = JSON.stringify({
    NODE_ENV: 'development',
    ...Object.fromEntries(Object.entries(publicEnv).filter(([key]) => !['DEV', 'PROD', 'MODE', 'BASE_URL', 'SSR'].includes(key))),
  });

  const aliasTargets = (spec: string): string[] | null => {
    for (const alias of aliases)
      if (alias.prefix && spec.startsWith(alias.prefix)) return alias.targets.map((target) => target + spec.slice(alias.prefix.length));
    return null;
  };
  const withCandidates = (base: string) => {
    const path = normalize(base);
    const list = [path, ...EXTENSIONS.map((ext) => path + ext), ...['tsx', 'ts', 'jsx', 'js'].map((ext) => `${path}/index.${ext}`)];
    if (/\.[mc]?jsx?$/i.test(path)) list.push(path.replace(/\.[mc]?jsx?$/i, '.ts'), path.replace(/\.[mc]?jsx?$/i, '.tsx'));
    return list;
  };
  /** Resolves a local reference (import specifier or HTML/CSS URL) to a project path. */
  const findFile = (spec: string, from: string, mode: 'module' | 'url'): string | undefined => {
    let path = spec.split(/[?#]/)[0];
    try {
      path = decodeURI(path);
    } catch {
      /* keep raw */
    }
    let bases: string[];
    if (path.startsWith('/')) bases = [root + path.slice(1), path.slice(1), `public/${path.slice(1)}`];
    else if (path.startsWith('./') || path.startsWith('../')) bases = [dir(from) + path];
    else bases = [...(aliasTargets(path) ?? []), ...(mode === 'url' ? [dir(from) + path] : [])];
    for (const base of bases)
      for (const candidate of mode === 'url' ? [normalize(base)] : withCandidates(base)) if (paths.has(candidate)) return candidate;
    return undefined;
  };
  const isLocalSpec = (spec: string) =>
    spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/') || aliasTargets(spec) !== null;

  const rewriteCss = async (css: string, from: string, seen: Set<string> = new Set()): Promise<string> => {
    const imports = [...css.matchAll(/@import\s+(?:url\()?\s*(['"])([^'"]+)\1\s*\)?([^;]*);/g)];
    for (const match of imports) {
      const spec = match[2];
      let replacement = '';
      if (spec === 'tailwindcss' || spec.startsWith('tailwindcss/')) replacement = '';
      else if (isRemote(spec))
        replacement = (await loadNetCss(spec.startsWith('//') ? `https:${spec}` : spec, net, assetToken)) ?? match[0];
      else {
        const local = findFile(spec, from, 'url') ?? findFile(spec, from, 'module');
        if (local && !seen.has(local)) {
          seen.add(local);
          replacement = await rewriteCss(await source.text(local), local, seen);
        } else if (!local && !spec.startsWith('.') && !spec.startsWith('/'))
          replacement = (await loadNetCss(npmUrl(spec, 'css'), net, assetToken)) ?? '';
        else if (!local) warnings.add(`Stylesheet not found: ${spec} (in ${from})`);
      }
      css = css.replace(match[0], replacement);
    }
    return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, _quote, value: string) => {
      if (hasScheme(value)) return match;
      const local = findFile(value, from, 'url');
      if (!local) {
        warnings.add(`Asset not found: ${value} (in ${from})`);
        return match;
      }
      const hash = value.includes('#') ? value.slice(value.indexOf('#')) : '';
      return `url("${assetToken(local)}${hash}")`;
    });
  };

  const registerStyle = (path: string) => {
    if (!styleOrder.includes(path)) styleOrder.push(path);
    if (!styles.has(path)) {
      styles.set(path, '');
      track(
        source
          .text(path)
          .then((css) => rewriteCss(css, path))
          .then((css) => {
            styles.set(path, css);
          }),
      );
    }
    return path;
  };

  const npmEntryKey = (spec: string) => `@npm/${spec}`;
  const npmModuleKey = (pkg: NpmPackage, path: string) => `@npm/${pkg.name}@${pkg.version}/${path}`;
  const npmStubKey = (label: string) => `@npm/#stub/${label.replace(/[^\w./@-]/g, '_')}`;

  const fallbackToCdn = (spec: string, key: string) => {
    const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    const url = npmUrl(spec, 'module');
    loadPackage(name, url);
    modules.set(key, `import d, * as m from ${JSON.stringify(url)};export * from ${JSON.stringify(url)};export default d;`);
  };

  const esmSpecifierFor = (pkg: NpmPackage, path: string): string => {
    const trimmed = path.replace(/\.(m?js|cjs|json)$/, '').replace(/(^|\/)index$/, '');
    return trimmed ? `${pkg.name}/${trimmed}` : pkg.name;
  };

  const ensureNpmStub = (label: string): string => {
    const key = npmStubKey(label);
    if (!modules.has(key)) modules.set(key, 'export default {};');
    return key;
  };

  // eslint-disable-next-line prefer-const
  let rewriteNpmModule: (pkg: NpmPackage, path: string, key: string) => Promise<void>;

  const ensureNpmModule = (pkg: NpmPackage, path: string): string => {
    const key = npmModuleKey(pkg, path);
    if (!modules.has(key)) {
      modules.set(key, '');
      track(rewriteNpmModule(pkg, path, key));
    }
    return key;
  };

  rewriteNpmModule = async (pkg: NpmPackage, path: string, key: string): Promise<void> => {
    try {
      const code = pkg.files.get(path);
      if (code === undefined) throw new Error(`${path} is missing from the tarball`);
      if (path.endsWith('.cjs')) throw new Error('CommonJS files are served through the CDN shim');
      if (path.endsWith('.js') && /(^|[^\w$])module\.exports\b/.test(code) && !/(^|[^\w$])(import|export)[ \n{*]/.test(code)) {
        // A CommonJS .js file would crash when executed as an ES module; esm.sh wraps those correctly.
        throw new Error('CommonJS .js file served through the CDN shim');
      }
      if (path.endsWith('.json')) {
        try {
          JSON.parse(code);
          modules.set(key, `export default ${code};`);
        } catch {
          warnings.add(`${pkg.name}@${pkg.version}: "${path}" is not valid JSON; using an empty object.`);
          modules.set(key, 'export default {};');
        }
        packages.set(pkg.name, true);
        return;
      }
      await init();
      const [imports] = parse(code);
      if (imports.length === 0) {
        modules.set(key, code);
        packages.set(pkg.name, true);
        return;
      }
      const dir = path.split('/').slice(0, -1).join('/');
      const pieces: string[] = [];
      let cursor = 0;
      for (const item of imports) {
        if (!item.n) continue;
        const spec = item.n;
        const dynamic = item.d >= 0;
        const emit = (resolved: string) => {
          pieces.push(code.slice(cursor, item.s), dynamic ? JSON.stringify(resolved) : resolved);
          cursor = item.e;
        };
        // Relative or absolute-path imports inside the package: resolve file-relative, like Node.
        if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/')) {
          const base = spec.startsWith('/') ? normalizeNpmPath(spec.slice(1)) : normalizeNpmPath(dir ? `${dir}/${spec}` : spec);
          if (/\.(css|scss|less|sass|styl|wasm|node)$/.test(base)) {
            emit(ensureNpmStub(`${pkg.name}@${pkg.version}/${base}`));
            continue;
          }
          const probed = probeNpmFile(pkg.files, base);
          if (probed) {
            emit(ensureNpmModule(pkg, probed));
          } else {
            warnings.add(`${pkg.name}@${pkg.version}: "${spec}" imported by "${path}" is missing; using a placeholder.`);
            emit(ensureNpmStub(`${key}#missing:${spec}`));
          }
          continue;
        }
        if (isRemote(spec)) {
          const url = spec.startsWith('//') ? `https:${spec}` : spec;
          track(loadNetModule(url, net));
          emit(url);
          continue;
        }
        const builtin = spec.replace(/^node:/, '');
        if (NODE_BUILTINS.test(builtin)) {
          const polyfill = NODE_POLYFILLS[builtin];
          track(loadNetModule(polyfill, net));
          emit(polyfill);
          continue;
        }
        // Self-references from inside the package go through the exports map, as they should.
        if (spec === pkg.name || spec.startsWith(`${pkg.name}/`)) {
          const sub = spec.slice(pkg.name.length).replace(/^\//, '');
          const entry = resolveEntrySubpath(pkg, sub);
          if (entry) {
            emit(ensureNpmModule(pkg, entry));
            continue;
          }
        }
        if (/\.(css|scss|less|sass|styl|wasm)$/.test(spec)) {
          emit(ensureNpmStub(`${pkg.name}@${pkg.version}/${spec}`));
          continue;
        }
        // A transitive dependency: keep the CDN strategy for it.
        const depName = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        const depVersion = exactVersion(pkg.dependencies?.[depName] ?? versions[depName] ?? '');
        const url = `https://esm.sh/${depName}${depVersion ? `@${depVersion}` : ''}${spec.slice(depName.length)}?external=react,react-dom&target=es2022`;
        track(loadNetModule(url, net));
        emit(url);
      }
      pieces.push(code.slice(cursor));
      modules.set(key, pieces.join(''));
      packages.set(pkg.name, true);
    } catch {
      warnings.add(`${pkg.name}@${pkg.version}: "${path}" could not be bundled; it is loading from the CDN.`);
      fallbackToCdn(esmSpecifierFor(pkg, path), key);
    }
  };

  const bundleNpmEntry = async (spec: string, name: string, version: string, key: string): Promise<void> => {
    const pkg = await loadNpmPackage(name, version);
    if (!pkg) {
      warnings.add(`"${spec}" could not be fetched from the npm registry; loading it from the CDN.`);
      fallbackToCdn(spec, key);
      return;
    }
    const sub = spec.slice(name.length).replace(/^\//, '');
    const entry = resolveEntrySubpath(pkg, sub);
    if (!entry) {
      warnings.add(`"${spec}" was not found in ${name}@${version}; loading it from the CDN.`);
      fallbackToCdn(spec, key);
      return;
    }
    await rewriteNpmModule(pkg, entry, key);
  };

  const npmUrl = (spec: string, kind: 'module' | 'css') => {
    const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    const version = exactVersion(versions[name]);
    const sub = spec.slice(name.length);
    return kind === 'css'
      ? `https://cdn.jsdelivr.net/npm/${name}${version ? `@${version}` : ''}${sub}`
      : `https://esm.sh/${name}${version ? `@${version}` : ''}${sub}?external=react,react-dom&target=es2022`;
  };

  const loadPackage = (name: string, url: string) => {
    track(
      loadNetModule(url, net).then((ok) => {
        packages.set(name, (packages.get(name) ?? true) && ok);
      }),
    );
  };

  const ensureModule = (path: string): string => {
    const key = `@pd/${path}`;
    if (!modules.has(key)) {
      modules.set(key, '');
      track(compileCode(path, key));
    }
    return key;
  };

  const resolveLocal = (path: string, query: string): string => {
    if (/(^|&)raw(&|$)/.test(query)) {
      const key = `@pd/${path}?raw`;
      if (!modules.has(key)) {
        modules.set(key, '');
        track(
          source.text(path).then((text) => {
            modules.set(key, `export default ${JSON.stringify(text)};`);
          }),
        );
      }
      return key;
    }
    if (/(^|&)(url|inline)(&|$)/.test(query) || (!CODE_FILE.test(path) && !STYLE_FILE.test(path) && !/\.json$/i.test(path))) {
      const key = `@pd/${path}?url`;
      modules.set(key, `export default ${JSON.stringify(assetToken(path))};`);
      return key;
    }
    if (STYLE_FILE.test(path)) {
      registerStyle(path);
      const key = `@pd/${path}?style`;
      if (!modules.has(key)) {
        modules.set(key, 'export default {};');
        if (/\.module\.css$/i.test(path))
          track(
            source.text(path).then((css) => {
              const names = Object.fromEntries([...css.matchAll(/\.(-?[_a-zA-Z]+[\w-]*)/g)].map((match) => [match[1], match[1]]));
              const camel = Object.fromEntries(
                Object.keys(names).map((name) => [name.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase()), name]),
              );
              modules.set(key, `const s=${JSON.stringify({ ...camel, ...names })};export default s;`);
            }),
          );
      }
      return key;
    }
    return ensureModule(path);
  };

  const resolveSpec = (spec: string, importer: string): string => {
    if (spec.startsWith('@pd/') || spec.startsWith('@portdeck/') || /^(data|blob):/.test(spec)) return spec;
    if (isRemote(spec)) {
      const url = spec.startsWith('//') ? `https:${spec}` : spec;
      track(loadNetModule(url, net));
      return url;
    }
    const queryIndex = spec.indexOf('?');
    const bare = queryIndex >= 0 ? spec.slice(0, queryIndex) : spec;
    const query = queryIndex >= 0 ? spec.slice(queryIndex + 1) : '';
    if (isLocalSpec(bare)) {
      const path = findFile(bare, importer, 'module');
      if (path) return resolveLocal(path, query);
      if (bare.startsWith('.') || bare.startsWith('/')) {
        if (ASSET_FILE.test(bare)) {
          warnings.add(`Asset not found: ${spec} (imported by ${importer}); showing a placeholder.`);
          return `data:text/javascript,export default ${encodeURIComponent(JSON.stringify(MISSING_ASSET))}`;
        }
        throw new Error(`Cannot find "${spec}" imported by ${importer}`);
      }
    }
    if (NEXT_SHIMS[bare]) {
      const key = `@pd/__next/${bare}`;
      modules.set(key, NEXT_SHIMS[bare]);
      return key;
    }
    if (bare.startsWith('next/')) {
      warnings.add(`${bare} is not available in the preview; it was replaced with an empty module.`);
      const key = `@pd/__next/${bare}`;
      modules.set(key, 'export default {};');
      return key;
    }
    if (vendor.modules[bare]) {
      usesReact = true;
      return bare;
    }
    if (/^(react|react-dom)(\/|$)/.test(bare)) {
      usesReact = true;
      warnings.add(`${bare} is not part of the bundled React runtime.`);
    }
    if (/^node:/.test(bare)) return resolveSpec(bare.slice(5), importer);
    if (NODE_BUILTINS.test(bare)) {
      const polyfill = NODE_POLYFILLS[bare];
      track(
        loadNetModule(polyfill, net).then((ok) => {
          packages.set(bare, ok);
        }),
      );
      if (bare === 'buffer') needsBuffer = true;
      return polyfill;
    }
    if (NODE_UNSUPPORTED.test(bare)) {
      warnings.add(`${bare} is a Node.js built-in with no browser equivalent, so it is empty in the preview.`);
      return 'data:text/javascript,export default {};';
    }
    // Bundle npm packages straight from the registry. CDN transform services can mis-resolve a
    // package's exports map (drizzle-orm's pg-core/utils is the field example), so file-relative
    // tarball resolution is the correct-by-construction path. Falls back to the CDN on any failure.
    if (!STYLE_FILE.test(bare)) {
      const bundledName = bare.startsWith('@') ? bare.split('/').slice(0, 2).join('/') : bare.split('/')[0];
      const bundledVersion = exactVersion(versions[bundledName]);
      if (bundledVersion) {
        const key = npmEntryKey(bare);
        if (!modules.has(key)) {
          modules.set(key, '');
          track(bundleNpmEntry(bare, bundledName, bundledVersion, key));
        }
        return key;
      }
    }
    const name = bare.startsWith('@') ? bare.split('/').slice(0, 2).join('/') : bare.split('/')[0];
    if (STYLE_FILE.test(bare)) {
      const key = netKey(npmUrl(bare, 'css'));
      if (!styles.has(key)) {
        styles.set(key, '');
        styleOrder.push(key);
        track(
          loadNetCss(npmUrl(bare, 'css'), net, assetToken).then((css) => {
            styles.set(key, css ?? `@import url("${npmUrl(bare, 'css')}");`);
            packages.set(name, (packages.get(name) ?? true) && css !== null);
          }),
        );
      }
      return 'data:text/javascript,export default {}';
    }
    const url = npmUrl(bare, 'module');
    loadPackage(name, url);
    if (bare === 'react-router-dom' || bare === 'react-router') {
      // The preview document has no real URL path, so browser-history routers start in memory instead.
      const key = `@pd/__shim/${bare}`;
      modules.set(
        key,
        `export * from ${JSON.stringify(url)};export { MemoryRouter as BrowserRouter, createMemoryRouter as createBrowserRouter } from ${JSON.stringify(url)};`,
      );
      return key;
    }
    return url;
  };

  const transformGlobs = (code: string, importer: string): { code: string; hoisted: string[] } => {
    const hoisted: string[] = [];
    let counter = 0;
    const out = code.replace(
      /import\.meta\.glob(?:<[^>]*>)?\(\s*(\[[\s\S]*?\]|(['"`])[\s\S]*?\2)\s*(?:,\s*(\{[\s\S]*?\}))?\s*\)/g,
      (_match, arg: string, _q, opts = '') => {
        const patterns = [...arg.matchAll(/(['"`])(.*?)\1/g)].map((match) => match[2]);
        const eager = /eager\s*:\s*true/.test(opts);
        const importName = opts.match(/import\s*:\s*['"]([\w*]+)['"]/)?.[1];
        const query = opts.match(/query\s*:\s*['"]\??([^'"]+)['"]/)?.[1] ?? opts.match(/as\s*:\s*['"](raw|url)['"]/)?.[1] ?? '';
        const toPath = (pattern: string) =>
          pattern.startsWith('/')
            ? normalize(root + pattern.slice(1))
            : pattern.startsWith('.')
              ? normalize(dir(importer) + pattern)
              : normalize((aliasTargets(pattern) ?? [pattern])[0]);
        const include = patterns.filter((pattern) => !pattern.startsWith('!')).map((pattern) => globToRegex(toPath(pattern)));
        const exclude = patterns.filter((pattern) => pattern.startsWith('!')).map((pattern) => globToRegex(toPath(pattern.slice(1))));
        const matched = [...paths]
          .filter((path) => include.some((re) => re.test(path)) && !exclude.some((re) => re.test(path)) && path !== importer)
          .sort();
        const keyFor = (path: string) =>
          patterns[0]?.startsWith('/')
            ? `/${path.slice(root.length)}`
            : patterns[0]?.startsWith('.')
              ? relativeFrom(dir(importer), path)
              : path;
        const entries = matched.map((path) => {
          const key = resolveLocal(path, query);
          if (eager) {
            const name = `__pdGlob${counter++}`;
            hoisted.push(`import * as ${name} from ${JSON.stringify(key)};`);
            return `${JSON.stringify(keyFor(path))}: ${importName ? `${name}[${JSON.stringify(importName)}]` : name}`;
          }
          return `${JSON.stringify(keyFor(path))}: () => import(${JSON.stringify(key)})${importName ? `.then((m) => m[${JSON.stringify(importName)}])` : ''}`;
        });
        return `({${entries.join(', ')}})`;
      },
    );
    return { code: out, hoisted };
  };

  async function compileCode(path: string, key: string): Promise<void> {
    const text = await source.text(path);
    if (/\.json$/i.test(path)) {
      try {
        JSON.parse(text);
      } catch {
        throw new Error(`Invalid JSON in ${path}`);
      }
      modules.set(key, `export default ${text};`);
      return;
    }
    let code = text;
    if (code.includes('import.meta.env')) code = code.replace(/import\.meta\.env\b/g, JSON.stringify(publicEnv));
    if (code.includes('process.env'))
      code = code
        .replace(/process\.env\.([A-Za-z_$][\w$]*)/g, (_m, name: string) =>
          name === 'NODE_ENV' ? '"development"' : JSON.stringify(publicEnv[name] ?? null),
        )
        .replace(/process\.env\b/g, `(${processEnv})`);
    if (code.includes('import.meta.url')) {
      code = code.replace(/new\s+URL\(\s*(['"`])([^'"`$]+)\1\s*,\s*import\.meta\.url\s*\)/g, (match, _q, spec: string) => {
        const target = findFile(spec, path, 'module');
        if (!target) return match;
        return `new URL(${JSON.stringify(CODE_FILE.test(target) && !/\.json$/i.test(target) ? moduleToken(ensureModule(target)) : assetToken(target))})`;
      });
    }
    let hoisted: string[] = [];
    if (code.includes('import.meta.glob')) ({ code, hoisted } = transformGlobs(code, path));
    if (hoisted.length) code = `${hoisted.join('\n')}\n${code}`;
    const ts = /\.(tsx?|mts|cts)$/i.test(path);
    const jsx =
      /\.[jt]sx$/i.test(path) || (!ts && code.length < 800_000 && /<\/[A-Za-z][\w.-]*>|<[A-Za-z][\w.-]*(\s[^<>]*)?\/>|<>/.test(code));
    if (ts || jsx) {
      const presets: (string | [string, Record<string, unknown>])[] = [];
      if (jsx) presets.push(['react', { runtime: 'automatic' }]);
      if (ts) presets.push('typescript');
      try {
        code = Babel.transform(code, { filename: path, presets, sourceType: 'module', compact: code.length > 400_000 })?.code ?? '';
      } catch (error) {
        throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (jsx) usesReact = true;
    }
    let imports;
    try {
      [imports] = parse(code);
    } catch {
      modules.set(key, `${code}\n//# sourceURL=${path}`);
      return;
    }
    const pieces: string[] = [];
    let cursor = 0;
    for (const item of imports) {
      if (item.d === -2) continue;
      if (item.n === undefined) {
        // Computed dynamic import: precompile everything the specifier can statically reach
        // (template literals and string concatenation), then resolve at runtime via __pdImport.
        const raw = code.slice(item.s, item.e);
        let prefix: string | undefined;
        let suffix = '';
        if (raw.startsWith('`')) {
          prefix = raw.slice(1, raw.indexOf('${'));
          suffix = raw.slice(raw.lastIndexOf('}') + 1, -1);
        } else {
          const head = raw.match(/^(['"])((?:\.\.?\/|\/)[^'"]*)\1\s*\+/);
          const tail = raw.match(/\+\s*(['"])([^'"]*)\1\s*$/);
          if (head) {
            prefix = head[2];
            suffix = tail?.[2] ?? '';
          }
        }
        if (prefix !== undefined && (prefix.startsWith('.') || prefix.startsWith('/'))) {
          const base = prefix.startsWith('/')
            ? normalize(root + prefix.slice(1))
            : normalize(dir(path) + prefix) + (prefix.endsWith('/') ? '/' : '');
          for (const candidate of paths)
            if (candidate.startsWith(base) && candidate.endsWith(suffix) && (CODE_FILE.test(candidate) || /\.json$/i.test(candidate)))
              ensureModule(candidate);
        }
        pieces.push(code.slice(cursor, item.ss), `__pdImport.bind(null,${JSON.stringify(path)})`);
        cursor = item.ss + 6;
        continue;
      }
      const resolved = resolveSpec(item.n, path);
      pieces.push(code.slice(cursor, item.s), item.d > -1 ? JSON.stringify(resolved) : resolved);
      cursor = item.e;
      // Import attributes (with { type: 'json' }) would clash with the JS module we serve instead.
      if (item.a > -1 && item.d === -1) {
        const close = code.indexOf('}', item.a);
        if (close > -1) {
          pieces.push(code.slice(cursor, item.a).replace(/\s*(with|assert)\s*$/, ''));
          cursor = close + 1;
        }
      }
    }
    pieces.push(code.slice(cursor), `\n//# sourceURL=${path}`);
    modules.set(key, pieces.join(''));
  }

  const resourceAttr = (tag: string, attr: string) => (attr === 'href' ? /^(use|image)$/i.test(tag) : RESOURCE_TAGS.test(tag));
  const rewriteUrlValue = (value: string, from: string, attr: string): string => {
    if (attr === 'srcset')
      return value
        .split(',')
        .map((candidate) => {
          const [url, ...rest] = candidate.trim().split(/\s+/);
          return [rewriteUrlValue(url, from, 'src'), ...rest].join(' ');
        })
        .join(', ');
    if (!value || hasScheme(value)) return value;
    const local = findFile(value, from, 'url');
    if (!local) {
      warnings.add(`Asset not found: ${value} (in ${from})`);
      return value;
    }
    return assetToken(local) + (value.includes('#') ? value.slice(value.indexOf('#')) : '');
  };

  async function processHtml(page: string): Promise<string> {
    let html = await source.text(page);
    html = html.replace(/<base\b[^>]*>/gi, '').replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');
    let inlineIndex = 0;
    const replacements: Promise<[string, string]>[] = [];
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      const [whole, attrs, body] = match;
      const type = attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i)?.[1]?.toLowerCase() ?? '';
      const src = attrs.match(/\bsrc\s*=\s*["']([^"']*)["']/i)?.[1] ?? attrs.match(/\bsrc\s*=\s*([^\s>]+)/i)?.[1];
      if (type === 'importmap') {
        try {
          const map = JSON.parse(body) as { imports?: Record<string, string> };
          for (const [spec, target] of Object.entries(map.imports ?? {})) {
            if (isRemote(target)) {
              const url = target.startsWith('//') ? `https:${target}` : target;
              track(loadNetModule(url, net));
              userImports[spec] = url;
            } else {
              const local = findFile(target, page, 'module');
              if (local) userImports[spec] = ensureModule(local);
            }
          }
        } catch {
          warnings.add(`The import map in ${page} could not be parsed.`);
        }
        replacements.push(Promise.resolve([whole, '']));
        continue;
      }
      const isModule = type === 'module';
      const rest = attrs.replace(/\s(src|type|integrity|crossorigin)\s*=\s*(["'][^"']*["']|[^\s>]+)/gi, '');
      if (src === undefined) {
        if (!isModule) continue;
        const key = `@pd/${page}#inline-${inlineIndex++}`;
        modules.set(key, '');
        const virtualPath = `${dir(page)}__inline-${inlineIndex}.js`;
        replacements.push(
          (async () => {
            await compileInline(body, key, virtualPath);
            return [whole, `<script type="module"${rest} src="${moduleToken(key)}"></script>`] as [string, string];
          })(),
        );
        continue;
      }
      if (src.includes('@vite/client')) {
        replacements.push(Promise.resolve([whole, '']));
        continue;
      }
      replacements.push(
        (async (): Promise<[string, string]> => {
          if (isRemote(src)) {
            const url = src.startsWith('//') ? `https:${src}` : src;
            if (isModule)
              return [whole, (await loadNetModule(url, net)) ? `<script type="module"${rest} src="${moduleToken(url)}"></script>` : whole];
            const asset = await loadNetAsset(url, net);
            return [whole, asset ? `<script${rest} src="${assetToken(asset)}"></script>` : whole];
          }
          const local = findFile(src, page, 'url') ?? findFile(src, page, 'module');
          if (!local) {
            warnings.add(`Script not found: ${src} (in ${page})`);
            return [whole, ''];
          }
          if (isModule || /\.(tsx?|jsx)$/i.test(local))
            return [whole, `<script type="module"${rest} src="${moduleToken(ensureModule(local))}"></script>`];
          return [
            whole,
            `<script${type && type !== 'text/javascript' ? ` type="${type}"` : ''}${rest} src="${assetToken(local)}"></script>`,
          ];
        })(),
      );
    }
    for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
      const tag = match[0];
      const href = tag.match(/\bhref\s*=\s*["']([^"']*)["']/i)?.[1];
      const rel = tag.match(/\brel\s*=\s*["']?([^"'>]+)/i)?.[1]?.toLowerCase() ?? '';
      if (!href) continue;
      replacements.push(
        (async (): Promise<[string, string]> => {
          if (rel.includes('modulepreload') || (rel.includes('preload') && !isRemote(href))) return [tag, ''];
          if (rel.includes('stylesheet')) {
            if (isRemote(href)) {
              const url = href.startsWith('//') ? `https:${href}` : href;
              const css = await loadNetCss(url, net, assetToken);
              if (css === null) return [tag, tag];
              styles.set(netKey(url), css);
              return [tag, tag.replace(href, styleToken(netKey(url)))];
            }
            const local = findFile(href, page, 'url');
            if (!local) {
              warnings.add(`Stylesheet not found: ${href} (in ${page})`);
              return [tag, ''];
            }
            styles.set(local, await rewriteCss(await source.text(local), local));
            return [tag, tag.replace(href, styleToken(local))];
          }
          if (isRemote(href) || hasScheme(href)) return [tag, tag];
          const local = findFile(href, page, 'url');
          return [tag, local ? tag.replace(href, assetToken(local)) : tag];
        })(),
      );
    }
    for (const match of html.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi)) {
      replacements.push(rewriteCss(match[2], page).then((css) => [match[0], `<style${match[1]}>${css}</style>`] as [string, string]));
    }
    const resolved = await Promise.all(replacements);
    for (const [from, to] of resolved) html = html.replace(from, () => to);
    html = html.replace(/<([a-zA-Z][\w-]*)\b([^>]*)>/g, (tag, name: string, attrs: string) => {
      if (!/\s(src|srcset|poster|data|href|style)\s*=/.test(attrs)) return tag;
      const next = attrs.replace(
        /\s(src|srcset|poster|data|href|style|xlink:href)\s*=\s*(["'])(.*?)\2/gi,
        (whole, attr: string, quote: string, value: string) => {
          const lower = attr.toLowerCase();
          if (lower === 'style')
            return value.includes('url(')
              ? ` ${attr}=${quote}${value.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, _q, url: string) => (hasScheme(url) || url.startsWith('pd-') ? m : `url(${rewriteUrlValue(url, page, 'src')})`))}${quote}`
              : whole;
          if (value.startsWith('pd-') || !resourceAttr(name, lower === 'xlink:href' ? 'href' : lower)) return whole;
          return ` ${attr}=${quote}${rewriteUrlValue(value, page, lower)}${quote}`;
        },
      );
      return `<${name}${next}>`;
    });
    if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, (head) => `${head}${HEAD_MARK}`);
    else if (/<html[^>]*>/i.test(html)) html = html.replace(/<html[^>]*>/i, (tag) => `${tag}<head>${HEAD_MARK}</head>`);
    else html = `<!doctype html><html><head>${HEAD_MARK}</head><body>${html}</body></html>`;
    return html;
  }

  async function compileInline(body: string, key: string, virtualPath: string): Promise<void> {
    paths.add(virtualPath);
    const original = source.text.bind(source);
    const reader: FileSource = { ...source, text: (path) => (path === virtualPath ? Promise.resolve(body) : original(path)) };
    const previous = source;
    source = reader;
    try {
      await compileCode(virtualPath, key);
    } finally {
      source = previous;
      paths.delete(virtualPath);
    }
  }

  let html: string;
  if (htmlEntry) html = await processHtml(entry);
  else {
    let bootstrap: string;
    if (project.framework === 'Next.js') {
      const appDir = dir(entry);
      const layout = /(^|\/)app\/page\./.test(entry)
        ? ['tsx', 'jsx', 'js', 'ts'].map((ext) => `${appDir}layout.${ext}`).find((path) => paths.has(path))
        : undefined;
      const customApp = /(^|\/)pages\//.test(entry)
        ? ['tsx', 'jsx', 'js'].map((ext) => `${appDir}_app.${ext}`).find((path) => paths.has(path))
        : undefined;
      userImports['react/jsx-runtime'] = '@pd/__next/jsx-runtime';
      userImports['react/jsx-dev-runtime'] = '@pd/__next/jsx-runtime';
      modules.set('@pd/__next/jsx-runtime', NEXT_JSX);
      const page = ensureModule(entry);
      const wrapper = layout ? ensureModule(layout) : customApp ? ensureModule(customApp) : null;
      bootstrap = `import React from 'react';import{createRoot}from'react-dom/client';import Page from ${JSON.stringify(page)};${wrapper ? `import Wrap from ${JSON.stringify(wrapper)};` : ''}
const tree=${layout ? 'React.createElement(Wrap,null,React.createElement(Page))' : customApp ? 'React.createElement(Wrap,{Component:Page,pageProps:{}})' : 'React.createElement(Page)'};
createRoot(document.getElementById('root')).render(tree);`;
      usesReact = true;
    } else bootstrap = `import ${JSON.stringify(ensureModule(entry))};`;
    modules.set('@pd/__entry', bootstrap);
    html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${project.name.replace(/[<>&]/g, '')}</title>${HEAD_MARK}</head><body><div id="root"></div><script type="module" src="${moduleToken('@pd/__entry')}"></script></body></html>`;
  }

  await drain();
  for (const [key, code] of net.modules) modules.set(key, code);

  const cssTexts = [...styles.values()].join('\n');
  const tailwind =
    /@tailwind\b|@import\s+["']tailwindcss|@theme\b/.test(cssTexts) ||
    [...paths].some((path) => /(^|\/)tailwind\.config\.[cm]?[jt]s$/.test(path));
  if ([...paths].some((path) => /(^|\/)tailwind\.config\.[cm]?[jt]s$/.test(path)))
    warnings.add('tailwind.config is not executed in the preview; theme extensions and plugins are skipped.');
  const head = styleOrder
    .map((key) =>
      tailwind && !key.startsWith('@net/')
        ? `<style type="text/tailwindcss">${(styles.get(key) ?? '').replace(/<\/style/gi, '<\\/style')}</style>`
        : `<link rel="stylesheet" href="${styleToken(key)}">`,
    )
    .join('');
  html = html
    .replace(HEAD_MARK, `${HEAD_MARK}${tailwind ? `<script src="${assetToken('@vendor/tailwind')}"></script>` : ''}`)
    .replace(/<\/head>/i, `${head}</head>`);
  if (!html.includes(HEAD_MARK)) html = html.replace(/<head[^>]*>/i, (tag) => `${tag}${HEAD_MARK}`);

  const offline: string[] = [];
  const network: string[] = [];
  if (usesReact) offline.push(`React ${vendor.version}`);
  if (tailwind) offline.push('Tailwind CSS');
  for (const [name, ok] of packages) (ok ? offline : network).push(name);
  for (const host of net.missing) if (!network.some((item) => item === host)) network.push(host);
  if (network.length)
    warnings.add(
      `${network.join(', ')} could not be saved for offline use${typeof navigator !== 'undefined' && !navigator.onLine ? ' while offline' : ''}; ${network.length === 1 ? 'it loads' : 'they load'} from the network.`,
    );

  return {
    html,
    env: publicEnv,
    needsBuffer,
    vendorModules,
    modules: Object.fromEntries(modules),
    styles: Object.fromEntries([...styles].filter(([key]) => !tailwind || key.startsWith('@net/') || !styleOrder.includes(key))),
    netAssets: net.assets,
    userImports,
    reactLine,
    tailwind,
    page: htmlEntry ? entry : '',
    root,
    report: {
      entry: project.entry,
      page: entry,
      runtime: usesReact ? `React ${vendor.version}` : 'Browser',
      offline,
      network,
      dependencies: [...packages.keys()].sort(),
      warnings: [...warnings],
      modules: modules.size,
      elapsedMs: Math.round(performance.now() - started),
    },
  };
}
