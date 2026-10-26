// Builds assets/design/vendor/three.module.min.js from the pinned three release.
// The npm package ships no .min.js, so esbuild bundles, tree-shakes and minifies the
// names listed in three-entry.js. Dev only. The site loads the built file as a plain ES module.
import { build } from 'esbuild';
import { copyFileSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(root, 'assets', 'design', 'vendor', 'three.module.min.js');

await build({
  entryPoints: [join(here, 'three-entry.js')],
  bundle: true,
  format: 'esm',
  minify: true,
  target: 'es2020',
  legalComments: 'none',
  treeShaking: true,
  outfile: out,
  logLevel: 'info',
});
copyFileSync(join(here, '..', 'node_modules', 'three', 'LICENSE'), join(root, 'assets', 'design', 'vendor', 'three.LICENSE'));
const buf = readFileSync(out);
console.log('three.module.min.js', statSync(out).size, 'bytes,', gzipSync(buf, { level: 9 }).length, 'bytes gzip');
