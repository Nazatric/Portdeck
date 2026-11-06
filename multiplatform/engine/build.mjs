/**
 * Bundles the preview engine into the asset the Android app serves:
 *   ../composeApp/src/androidMain/assets/engine/engine.js
 *
 * Run with: npm ci && npm run build
 * Keep the output byte-identical to what CI uploads by not hand-editing the bundle.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

await build({
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  logLevel: 'info',
  entryPoints: [join(here, 'src', 'native-host.ts')],
  outfile: join(here, '..', 'composeApp', 'src', 'androidMain', 'assets', 'engine', 'engine.js'),
});
