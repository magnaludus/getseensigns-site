// Lighthouse (mobile, simulated Slow 4G and 4x CPU slowdown) for the designer pages.
// Serves the built site with gzip, a cache header and HTTP/2 (self-signed certificate), like
// Cloudflare Pages does, so the numbers mean something. The designer loads about 50 small modules;
// over HTTP/1.1 Lighthouse charges each batch of six a round trip, which production never pays.
// Usage: node scripts/lighthouse.mjs [path ...]   (default: the hub and one page)
//        LH_PROTOCOL=h1 node scripts/lighthouse.mjs ...   to measure the pessimistic HTTP/1.1 case
import { createServer } from 'node:http';
import { createSecureServer } from 'node:http2';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain', '.ico': 'image/x-icon', '.md': 'text/plain' };
const COMPRESS = new Set(['.html', '.css', '.js', '.json', '.svg', '.xml', '.txt', '.md']);

const handler = async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root) || file.includes('/.')) throw new Error('nope');
    if (!(await stat(file)).isFile()) throw new Error('nope');
    const ext = extname(file);
    let body = await readFile(file);
    const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=14400' };
    if (COMPRESS.has(ext) && /gzip/.test(req.headers['accept-encoding'] || '')) {
      body = gzipSync(body, { level: 9 });
      headers['Content-Encoding'] = 'gzip';
    }
    res.writeHead(200, headers);
    res.end(body);
  } catch (_) {
    res.writeHead(404);
    res.end('not found');
  }
};
function tlsServer() {
  const dir = mkdtempSync(join(tmpdir(), 'gss-lh-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=127.0.0.1', '-days', '1', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem')], { stdio: 'ignore' });
  return createSecureServer({ key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')), allowHTTP1: true }, handler);
}
const useH2 = process.env.LH_PROTOCOL !== 'h1';
let server;
let secure = false;
try {
  server = useH2 ? tlsServer() : createServer(handler);
  secure = useH2;
} catch (_) {
  console.log('openssl not available: serving HTTP/1.1');
  server = createServer(handler);
}
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `${secure ? 'https' : 'http'}://127.0.0.1:${server.address().port}`;
console.log(`serving ${base} (${secure ? 'HTTP/2' : 'HTTP/1.1'})`);
const paths = process.argv.slice(2).length ? process.argv.slice(2) : ['/design/', '/design/canopy-tent/'];
const chrome = await chromeLauncher.launch({ chromePath: chromium.executablePath(), chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', '--ignore-certificate-errors'] });
try {
  for (const path of paths) {
    const run = await lighthouse(base + path, { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'] });
    const { lhr } = run;
    const pct = (k) => Math.round(lhr.categories[k].score * 100);
    const m = lhr.audits;
    const sec = (k) => (m[k].numericValue / 1000).toFixed(2) + ' s';
    console.log(`${path}  performance ${pct('performance')}  accessibility ${pct('accessibility')}  best-practices ${pct('best-practices')}  seo ${pct('seo')}`);
    console.log(`   FCP ${sec('first-contentful-paint')}  LCP ${sec('largest-contentful-paint')}  TBT ${Math.round(m['total-blocking-time'].numericValue)} ms  CLS ${m['cumulative-layout-shift'].numericValue.toFixed(3)}  SI ${sec('speed-index')}  transfer ${Math.round(m['total-byte-weight'].numericValue / 1024)} KB`);
    if (m['cumulative-layout-shift'].numericValue > 0.05) {
      for (const it of (((m['layout-shifts'] || {}).details || {}).items || []).slice(0, 5)) console.log(`   layout shift ${Number(it.score).toFixed(3)}:`, ((it.node && it.node.snippet) || '').slice(0, 110), JSON.stringify(it.subItems || it.extra || '').slice(0, 300));
      console.log('   culprits:', JSON.stringify((m['cls-culprits-insight'] || {}).details || '').slice(0, 1200));
    }
    const lcpNode = (((m['largest-contentful-paint-element'] || {}).details || {}).items || [])[0];
    const first = lcpNode && lcpNode.items && lcpNode.items[0] && lcpNode.items[0].node;
    if (first) console.log('   LCP element:', (first.snippet || '').slice(0, 110));
    const worst = Object.values(m).filter((a) => a.score != null && a.score < 0.9 && a.scoreDisplayMode !== 'informative' && a.scoreDisplayMode !== 'notApplicable').slice(0, 8).map((a) => `${a.id} ${Math.round(a.score * 100)}`);
    if (worst.length) console.log('   below 90:', worst.join(', '));
  }
} finally {
  await chrome.kill();
  server.close();
}
