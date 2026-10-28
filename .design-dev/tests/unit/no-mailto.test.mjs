// Nothing on getseensignsco.com may open a visitor's email app. Every quote or contact request goes through the
// site form and POST /api/quote-request (or the order and designer endpoints). This fails if a mailto: link or a
// script that builds one shows up in the source, in the deployed files, or in a fresh build of the pages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const SKIP_DIRS = new Set(['node_modules', '__pycache__', 'vendor']);
const TEXT = /\.(html|js|mjs|css|json|xml|txt|py|toml|sql)$|^_(redirects|headers)$/;
// Anything that would make a browser hand the visitor to their email app.
const FORBIDDEN = [/mailto/i, /data-mail/i, /\bmail\s*['"`]?\s*\+\s*['"`]?\s*to\s*:/i];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (TEXT.test(name)) yield full;
  }
}

function offenders(dir) {
  const out = [];
  for (const file of walk(dir)) {
    const text = readFileSync(file, 'utf8');
    for (const re of FORBIDDEN) if (re.test(text)) out.push(relative(dir, file) + ' matches ' + re);
  }
  return out;
}

test('no page, script, function or build source contains a mailto: link or builds one', () => {
  assert.deepEqual(offenders(root), []);
});

test('a fresh build of the pages has no mailto: anywhere in its output, and the quote form is on /, /quote and /contact', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'gss-nomailto-'));
  try {
    for (const name of readdirSync(root)) {
      if (['.git', '.design-dev', 'node_modules'].includes(name)) continue;
      cpSync(join(root, name), join(tmp, name), { recursive: true });
    }
    execFileSync('python3', ['src/site-src-pages.py'], { cwd: tmp, env: { ...process.env, BUILD_DATE: '2026-10-28' }, stdio: 'pipe' });
    assert.deepEqual(offenders(tmp), []);
    for (const page of ['index.html', 'quote.html', 'contact.html']) {
      const html = readFileSync(join(tmp, page), 'utf8');
      assert.match(html, /<form class="quote-form" id="quote-form" data-endpoint="\/api\/quote-request" novalidate>/, page);
      assert.ok(html.includes('name="_gotcha"'), page + ' keeps the honeypot');
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('the address sales@getseensignsco.com may be shown as plain text but never as a link', () => {
  for (const file of walk(root)) {
    if (!/\.html$/.test(file)) continue;
    const html = readFileSync(file, 'utf8');
    assert.doesNotMatch(html, /<a\b[^>]*>\s*[^<]*@getseensignsco\.com/i, relative(root, file) + ' links an email address');
  }
});

test('the quote form script has no way to leave the page: no mailto and no location change', () => {
  const js = readFileSync(join(root, 'assets/site.js'), 'utf8');
  const quote = js.slice(0, js.indexOf('// Mobile message button'));
  assert.doesNotMatch(quote, /location\s*(\.href)?\s*=|location\.(assign|replace)|window\.open/);
  assert.match(quote, /\/api\/quote-request|data-endpoint|dataset\.endpoint/);
  const proof = readFileSync(join(root, 'assets/design/ui/proof.js'), 'utf8');
  assert.doesNotMatch(proof, /location\s*(\.href)?\s*=|location\.(assign|replace)|window\.open/);
});

test('the built pages that used to have an "Email us" button now send people to the quote form', () => {
  const page = readFileSync(join(root, 'car-magnets/index.html'), 'utf8');
  assert.doesNotMatch(page, /Email us/);
  assert.match(page, /href="\/\?product=Car\+Magnet\+Pair#quote"/);
});
