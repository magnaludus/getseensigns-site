// Built-page checks for the Oct 27 site fixes: new products, banner materials, fitted covers, videos,
// turnaround wording, and the footer. Reads the pages the Python build wrote at the repo root.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), 'utf8');
const body = (html) => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');

function pages() {
  const out = [];
  const skip = new Set(['.git', '.design-dev', 'node_modules', 'assets', 'functions', 'admin', 'migrations', 'src']);
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name) && dir === fileURLToPath(root).replace(/\/$/, '')) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.html')) out.push(p);
    }
  };
  walk(fileURLToPath(root).replace(/\/$/, ''));
  return out;
}

test('the three new Etsy products have pages with the approved prices and links', () => {
  const cases = [
    ['hard-hat-decals', '4603860981', ['$54', '$79', '$119', '$99', '$169']],
    ['aluminum-safety-signs', '4603884832', ['$119', '$199']],
    ['challenge-coins', '4603863951', ['$399', '$549']],
  ];
  for (const [slug, etsy, prices] of cases) {
    const html = read(`${slug}/index.html`);
    assert.ok(html.includes(`https://www.etsy.com/listing/${etsy}`), slug);
    for (const p of prices) assert.ok(body(html).includes(p), slug + ' ' + p);
    assert.ok(read('sitemap.xml').includes(`https://getseensignsco.com/${slug}/`), slug + ' in sitemap');
    assert.ok(read('index.html').includes(`href="/${slug}/"`), slug + ' on the shop index');
    assert.ok(read('terms.html').includes(`href="/${slug}/"`), slug + ' in the footer');
    for (const f of [`p-${{ 'hard-hat-decals': '16-hard-hat-decals', 'aluminum-safety-signs': '17-aluminum-safety-signs', 'challenge-coins': '18-challenge-coins' }[slug]}.jpg`]) assert.ok(existsSync(new URL('assets/img/' + f, root)), f);
  }
  const safetyHtml = read('aluminum-safety-signs/index.html');
  const safety = body(safetyHtml);
  assert.ok(safety.includes('12×18 in, 5 heavy duty (.063) ($169)'), 'heavy duty option listed');
  const offers = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(safetyHtml)[1])['@graph'].find((n) => n['@type'] === 'Product').offers;
  assert.deepEqual(offers.map((o) => [o.price, o.description]), [['119.00', '12×18 in, 5 signs'], ['199.00', '12×18 in, 10 signs'], ['199.00', '18×24 in, 5 signs'], ['169.00', '12×18 in, 5 heavy duty (.063)']]);
  assert.ok(safetyHtml.includes('g-17-aluminum-safety-signs-pricing') && safetyHtml.includes('g-17-aluminum-safety-signs-specs'));
  assert.match(body(read('challenge-coins/index.html')), /3 to 4 weeks/);
  assert.match(body(read('hard-hat-decals/index.html')), /4 to 8 business days/);
  assert.match(body(read('aluminum-safety-signs/index.html')), /5 to 9 business days/);
});

test('banner page lists 13 oz, 18 oz heavy duty and mesh at the approved prices', () => {
  const html = body(read('vinyl-banners/index.html'));
  for (const text of ['13 oz $44', '13 oz $59', '13 oz $89', '13 oz $79', '18 oz or mesh $54', '18 oz or mesh $84', '18 oz or mesh $149', '18 oz or mesh $119']) assert.ok(html.includes(text), text);
  assert.ok(read('vinyl-banners/index.html').includes('g-03-vinyl-banner-materials'));
  assert.ok(read('vinyl-banners/index.html').includes('g-03-vinyl-banner-fence'));
  const offers = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(read('vinyl-banners/index.html'))[1])['@graph'].find((n) => n['@type'] === 'Product').offers;
  assert.equal(offers.length, 12);
  assert.deepEqual(offers.map((o) => o.price), ['44.00', '59.00', '89.00', '79.00', '54.00', '84.00', '149.00', '119.00', '54.00', '84.00', '149.00', '119.00']);
});

test('table page offers fitted closed-back covers at $159 and $179 and no stretch cover', () => {
  const html = body(read('table-throws/index.html'));
  assert.match(html, /6 ft fitted is \$159 and 8 ft fitted is \$179/);
  assert.doesNotMatch(html, /stretch/i);
});

test('every matching product page embeds its video with a poster', () => {
  const map = {
    'bulk-campaign-signs': ['02-bulk-yard-signs'], 'vinyl-banners': ['03-vinyl-banner'], 'feather-flags': ['04-feather-flags'], 'retractable-banners': ['05-retractable-banner'],
    'car-magnets': ['06-car-magnets'], 'real-estate-signs': ['07-real-estate-sign'], 'step-and-repeat-backdrops': ['08-step-and-repeat'], 'table-throws': ['09-table-throw'],
    'custom-canopy-tents': ['10-canopy-tent'], 'holiday-yard-signs': ['11-christmas-banner', '14-thanksgiving-yard-sign'], 'senior-night-banners': ['12-senior-night-banner'], 'vendor-booth-kit': ['15-vendor-booth-kit'],
  };
  let count = 0;
  for (const [slug, names] of Object.entries(map)) {
    const html = read(`${slug}/index.html`);
    for (const n of names) {
      count++;
      assert.match(html, new RegExp(`<video controls muted playsinline preload="none" poster="/assets/video/${n}-poster.jpg"[^>]*><source src="/assets/video/${n}.mp4" type="video/mp4">`), slug + ' ' + n);
      assert.ok(existsSync(new URL(`assets/video/${n}.mp4`, root)) && existsSync(new URL(`assets/video/${n}-poster.jpg`, root)), n);
    }
  }
  assert.equal(count, 13);
});

test('turnaround uses the Etsy wording and the old production wording is gone', () => {
  for (const f of pages()) {
    const text = body(readFileSync(f, 'utf8'));
    assert.doesNotMatch(text, /3[–-]5 business days to make|3[–-]5 day production|business days to make after|Most items are made in/i, f);
  }
  const booth = body(read('vendor-booth-kit/index.html'));
  assert.ok(booth.includes('Arrives 3-8 business days after proof approval; tents and backdrops 5-10 business days.'));
  assert.ok(!/3–5/.test(booth));
  assert.ok(body(read('custom-canopy-tents/index.html')).includes('Arrives 5-10 business days after proof approval.'));
});

test('home page has no Halloween mention', () => {
  assert.doesNotMatch(read('index.html'), /halloween/i);
});

test('the trade-name footer line is gone from every page and Terms copy is untouched', () => {
  for (const f of pages()) assert.ok(!readFileSync(f, 'utf8').includes('is a trade name of Veracity Solutions LLC.</p>\n  </div>\n</footer>'), f);
  for (const f of pages().filter((x) => !/\/(terms|privacy)\.html$/.test(x))) assert.doesNotMatch(body(readFileSync(f, 'utf8')).replace(/<footer[\s\S]*<\/footer>/, ''), /Veracity/, f);
  assert.ok(body(read('terms.html')).includes('Get Seen Signs (Veracity Solutions LLC)'));
});
