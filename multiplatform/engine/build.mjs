/**
 * Bundles the preview engine into the two assets the native apps serve:
 *   ../composeApp/src/androidMain/assets/engine/engine.js   (Android WebView)
 *   ../composeApp/src/wasmJsMain/resources/host.js          (Kotlin/Wasm host)
 *
 * Run with: npm install && npm run build
 * Keep the output byte-identical to what CI uploads by not hand-editing the bundles.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const out = (...segments) => join(here, '..', 'composeApp', 'src', ...segments);

const shared = {
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  logLevel: 'info',
};

await build({
  ...shared,
  entryPoints: [join(here, 'src', 'native-host.ts')],
  outfile: out('androidMain', 'assets', 'engine', 'engine.js'),
});

await build({
  ...shared,
  entryPoints: [join(here, 'src', 'wasm-host.ts')],
  outfile: out('wasmJsMain', 'resources', 'host.js'),
});
