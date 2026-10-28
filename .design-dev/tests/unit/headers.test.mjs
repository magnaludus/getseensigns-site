// _headers (Cloudflare Pages) is hand-written at the repo root: parse it, check the safe set, and check that the build
// and the deploy workflow leave it alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), 'utf8');

export function parseHeaders(text) {
  const rules = [];
  let current = null;
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (/^\S/.test(raw)) {
      current = { path: raw.trim(), headers: {} };
      rules.push(current);
    } else {
      assert.ok(current, 'a header line needs a path above it: ' + raw);
      const at = raw.indexOf(':');
      assert.ok(at > 0, 'header line needs a colon: ' + raw);
      current.headers[raw.slice(0, at).trim()] = raw.slice(at + 1).trim();
    }
  }
  return rules;
}

test('_headers parses, and /* has the minimal safe set', () => {
  const rules = parseHeaders(read('_headers'));
  const all = rules.find((r) => r.path === '/*');
  assert.ok(all);
  assert.deepEqual(all.headers, {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "frame-ancestors 'none'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Strict-Transport-Security': 'max-age=300',
  });
  const hsts = all.headers['Strict-Transport-Security'];
  assert.doesNotMatch(hsts, /includeSubDomains|preload/i, 'HSTS stays short, without subdomains or preload');
  assert.ok(Number(/max-age=(\d+)/.exec(hsts)[1]) <= 3600);
  assert.doesNotMatch(all.headers['Content-Security-Policy'], /default-src|script-src|style-src/, 'frame-ancestors only, no full CSP');
});

test('the private pages are never cached', () => {
  const rules = parseHeaders(read('_headers'));
  for (const path of ['/proof/*', '/order/*', '/admin*']) {
    const rule = rules.find((r) => r.path === path);
    assert.ok(rule, path);
    assert.equal(rule.headers['Cache-Control'], 'no-store', path);
  }
  assert.deepEqual(rules.map((r) => r.path), ['/*', '/proof/*', '/order/*', '/admin*']);
});

test('the Python build does not write _headers, and the deploy workflow ships it (only dotfiles are skipped)', () => {
  for (const f of ['src/site-src-pages.py', 'src/seo_pages.py', 'src/seo_products.py', 'src/order_catalog.py', 'src/design_catalog.py']) assert.doesNotMatch(read(f), /_headers/, f);
  assert.match(read('src/site-src-pages.py'), /_redirects/, 'the build still writes _redirects');
  const workflow = read('.github/workflows/deploy-cloudflare-pages.yml');
  assert.match(workflow, /rsync -a --exclude='\.\*' \.\/ \.\.\/_deploy\//);
  assert.ok(!'_headers'.startsWith('.'), 'a file called _headers is not excluded by --exclude=.*');
});

test('the private order pages set their own frame and cache headers in the Functions code', () => {
  const util = read('functions/_lib/util.js');
  assert.match(util, /'X-Frame-Options': 'DENY'/);
  assert.match(util, /frame-ancestors 'none'/);
  assert.match(util, /'Cache-Control': 'no-store'/);
});
