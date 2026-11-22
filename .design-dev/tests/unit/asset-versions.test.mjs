// Every /assets/img/ and /assets/brand/ URL in a built page carries ?v=<first 10 hex chars of the file's SHA-256>
// (version_assets in src/site-src-pages.py). _headers lets browsers and Cloudflare keep those two directories for
// 7 days, so a photo replaced under the same filename only reaches visitors because the page's URL changes with it.
// This fails when a photo changed and the pages were not rebuilt (python3 src/site-src-pages.py).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
// The pages the Python build writes. admin/ is hand-written, src/ holds the unversioned templates.
const SKIP = new Set(['node_modules', 'src', 'admin', 'functions', 'assets']);
const IMAGE_URL = /(\/assets\/(?:img|brand)\/[A-Za-z0-9_.-]+\.(?:jpe?g|png|webp|gif|svg|avif))(\?[^"'\s)<>]*)?/g;

function builtPages(dir = root, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) builtPages(path, out);
    else if (entry.name.endsWith('.html')) out.push(path);
  }
  return out;
}

const hashes = new Map();
function versionOf(urlPath) {
  if (!hashes.has(urlPath)) {
    const file = join(root, urlPath);
    let data = existsSync(file) ? readFileSync(file) : null;
    // A Windows checkout may turn text files into CRLF; the build hashes what git stores (LF).
    if (data && urlPath.endsWith('.svg')) data = Buffer.from(data.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
    hashes.set(urlPath, data && createHash('sha256').update(data).digest('hex').slice(0, 10));
  }
  return hashes.get(urlPath);
}

test('every image URL in a built page carries the current content hash', () => {
  const pages = builtPages();
  assert.ok(pages.length > 40, 'found the built pages, got ' + pages.length);
  let refs = 0;
  const problems = [];
  for (const page of pages) {
    for (const [, urlPath, query] of readFileSync(page, 'utf8').matchAll(IMAGE_URL)) {
      refs++;
      const want = versionOf(urlPath);
      if (!want) problems.push(`${page.slice(root.length)}: ${urlPath} does not exist`);
      else if (query !== '?v=' + want) problems.push(`${page.slice(root.length)}: ${urlPath}${query || ''} should end ?v=${want}`);
    }
  }
  assert.ok(refs > 500, 'found the image references, got ' + refs);
  assert.equal(problems.length, 0, `${problems.length} stale image URLs, rebuild with python3 src/site-src-pages.py:\n` + problems.slice(0, 10).join('\n'));
});

test('a photo swap changes the URL: the hash follows the file bytes', () => {
  const urlPath = '/assets/img/p-10-canopy-tent.jpg';
  const real = readFileSync(join(root, urlPath));
  const other = Buffer.concat([real, Buffer.from([0])]);
  const hash = (b) => createHash('sha256').update(b).digest('hex').slice(0, 10);
  assert.notEqual(hash(real), hash(other));
  assert.equal(versionOf(urlPath), hash(real));
});
