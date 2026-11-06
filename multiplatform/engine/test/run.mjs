/** Bundles the TS smoke test (with the engine sources) and runs it. */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const bundle = join(here, '.smoke.mjs');

try {
  await build({
    entryPoints: [join(here, 'smoke.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node18',
    outfile: bundle,
    logLevel: 'warning',
    define: { 'process.env.NODE_ENV': '"test"' },
  });
  execFileSync(process.execPath, [bundle], { stdio: 'inherit' });
} finally {
  rmSync(bundle, { force: true });
}
