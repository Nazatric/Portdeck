const TYPES: Record<string, string> = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript',
  jsx: 'text/javascript', ts: 'text/javascript', tsx: 'text/javascript', json: 'application/json', map: 'application/json',
  webmanifest: 'application/manifest+json', xml: 'application/xml', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
  otf: 'font/otf', eot: 'application/vnd.ms-fontobject', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  m4a: 'audio/mp4', flac: 'audio/flac', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', pdf: 'application/pdf',
  wasm: 'application/wasm', glb: 'model/gltf-binary', gltf: 'model/gltf+json', zip: 'application/zip',
};

export function mimeFor(path: string): string {
  return TYPES[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

export const CODE_FILE = /\.(m?[jt]sx?|cjs)$/i;
export const STYLE_FILE = /\.css$/i;
export const HTML_FILE = /\.html?$/i;
export const ASSET_FILE = /\.(png|jpe?g|gif|webp|avif|ico|bmp|svg|woff2?|ttf|otf|eot|mp3|wav|ogg|m4a|flac|mp4|webm|mov|pdf|wasm|glb|gltf)$/i;
