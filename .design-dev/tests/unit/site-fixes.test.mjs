// Built-page checks for the Oct 27 site fixes: new products, banner materials, fitted covers, videos,
// turnaround wording, and the footer. Reads the pages the Python build wrote at the repo root.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
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
    'custom-canopy-tents': ['10-canopy-tent'], 'holiday-yard-signs': ['11-christmas-banner', '14-thanksgiving-yard-sign'], 'senior-night-banners': ['12-senior-night-banner'], 'trade-show-booth-kit': ['15-vendor-booth-kit'],
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
  const booth = body(read('trade-show-booth-kit/index.html'));
  assert.ok(booth.includes('Arrives 3-8 business days after proof approval; tents and backdrops 5-10 business days.'));
  assert.ok(!/3–5/.test(booth));
  assert.ok(body(read('custom-canopy-tents/index.html')).includes('Arrives 5-10 business days after proof approval.'));
});

test('home page has no Halloween mention', () => {
  assert.doesNotMatch(read('index.html'), /halloween/i);
});

test('the trade-name footer line is gone from every page', () => {
  for (const f of pages()) assert.ok(!readFileSync(f, 'utf8').includes('is a trade name of Veracity Solutions LLC.</p>\n  </div>\n</footer>'), f);
});

test('Veracity is named only on the Terms page (visible text, structured data, meta tags, privacy)', () => {
  for (const f of pages().filter((x) => !/\/terms\.html$/.test(x))) assert.doesNotMatch(readFileSync(f, 'utf8'), /Veracity|legalName|parentOrganization/, f);
  const terms = read('terms.html');
  assert.ok(body(terms).includes('Get Seen Signs (Veracity Solutions LLC)'));
  assert.ok(body(terms).includes('Get Seen Signs is a trade name of Veracity Solutions LLC'));
  assert.doesNotMatch(read('terms.html').match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1], /Veracity/);
});

test('the Privacy page refers to the business only as Get Seen Signs', () => {
  const text = body(read('privacy.html'));
  assert.match(text, /Get Seen Signs is based in Smiths Station, Alabama\./);
  assert.doesNotMatch(text, /\bLLC\b|trade name|\bdba\b|d\/b\/a|Scott/i);
  assert.ok(text.includes('sales@getseensignsco.com'));
});

test('the Organization structured data is Get Seen Signs with its url, logo and contact fields', () => {
  for (const f of ['index.html', 'privacy.html', 'vinyl-banners/index.html']) {
    const org = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(read(f))[1])['@graph'].find((n) => n['@type'] === 'Organization');
    assert.equal(org.name, 'Get Seen Signs');
    assert.equal(org.url, 'https://getseensignsco.com/');
    assert.ok(org.logo.includes('getseen') && org.email === 'sales@getseensignsco.com' && org.telephone === '+1-334-232-9003');
    assert.ok(!('legalName' in org) && !('parentOrganization' in org));
  }
});

test('no Veracity mention in the order code, emails or admin page', () => {
  const root2 = fileURLToPath(root).replace(/\/$/, '');
  const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
  for (const d of ['functions', 'admin']) for (const f of walk(join(root2, d))) assert.doesNotMatch(readFileSync(f, 'utf8'), /Veracity/, f);
});

test('Vendor Booth Kit is now the Trade Show Booth Kit, same price, old URL redirects', () => {
  const html = read('trade-show-booth-kit/index.html');
  assert.ok(!existsSync(new URL('vendor-booth-kit/index.html', root)), 'old page removed');
  assert.match(html, /<title>Trade Show Booth Kit: Throw, Banner &amp; Flag \| Get Seen Signs<\/title>/);
  assert.match(html, /<h1>Trade show booth kit: <span class="block">throw, banner and flag, matched\.<\/span><\/h1>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/getseensignsco.com\/trade-show-booth-kit\/">/);
  const text = body(html);
  assert.ok(text.includes('Built for exhibitors at gun shows, industry expos, and manufacturing and industrial trade shows.'));
  const product = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)[1])['@graph'].find((n) => n['@type'] === 'Product');
  assert.equal(product.name, 'Trade Show Booth Kit');
  assert.equal(product.offers.price, '339.00');
  assert.equal(product.offers.url, 'https://getseensignsco.com/trade-show-booth-kit/');
  for (const sku of ['6 ft 3-sided table throw', '33×81 in retractable banner stand', '10.5 ft feather flag with ground spike']) assert.ok(text.includes(sku), sku);
  const sitemap = read('sitemap.xml');
  assert.ok(sitemap.includes('/trade-show-booth-kit/') && !sitemap.includes('vendor-booth-kit'));
  const redirects = read('_redirects');
  for (const from of ['/vendor-booth-kit', '/vendor-booth-kit/', '/vendor-booth-kit/index.html']) assert.ok(redirects.includes(`${from} /trade-show-booth-kit/ 301`), from);
  assert.ok(redirects.includes('/custom-yard-signs /bulk-campaign-signs/ 301'), 'existing redirects kept');
  for (const f of pages()) {
    const t = readFileSync(f, 'utf8').replace(/assets\/(?:img|video)\/[^"' ,]*/g, '');
    assert.doesNotMatch(t, /vendor-booth-kit|Vendor Booth Kit|vendor booth kit/, f);
  }
  assert.match(read('index.html'), /<h3>Trade Show Booth Kit<\/h3>/);
  assert.match(read('index.html'), /<option>Trade Show Booth Kit<\/option>/);
});

test('the Columbus page links the working sign inspection page, not the old broken address', () => {
  const html = read('signs-columbus-ga-phenix-city/index.html');
  assert.ok(html.includes('href="https://columbusga.gov/inscode/What-We-Do/Sign-Inspection"'));
  for (const f of pages()) assert.ok(!readFileSync(f, 'utf8').includes('inspections-and-code-2'), f);
});

test('sitemap dates come from the build date (America/New_York, or BUILD_DATE) and a rebuild only touches the sitemap and blog dateModified', () => {
  const sm = read('sitemap.xml');
  const dates = [...sm.matchAll(/<loc>([^<]+)<\/loc><lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/g)];
  assert.ok(dates.length >= 40);
  const lastmod = (path) => dates.find((m) => m[1] === 'https://getseensignsco.com' + path)[2];
  assert.equal(lastmod('/terms'), '2026-10-28');
  assert.equal(lastmod('/privacy'), '2026-10-28');
  assert.equal(lastmod('/contact'), '2026-10-27');
  const src = read('src/site-src-pages.py');
  assert.match(src, /ZoneInfo\('America\/New_York'\)/);
  assert.match(src, /os\.environ\.get\('BUILD_DATE'\)/);

  const tmp = mkdtempSync(join(tmpdir(), 'gss-build-'));
  try {
    const top = fileURLToPath(root).replace(/\/$/, '');
    for (const name of readdirSync(top)) {
      if (['.git', '.design-dev', 'node_modules'].includes(name)) continue;
      cpSync(join(top, name), join(tmp, name), { recursive: true });
    }
    const build = (date) => execFileSync('python3', ['src/site-src-pages.py'], { cwd: tmp, env: { ...process.env, BUILD_DATE: date }, stdio: 'pipe' });
    const snapshot = () => {
      const out = new Map();
      const walk = (dir) => { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) { if (n !== '__pycache__') walk(p); } else if (/\.(html|xml|txt|json)$/.test(n)) out.set(p.slice(tmp.length), readFileSync(p, 'utf8')); } };
      walk(tmp);
      return out;
    };
    build('2031-02-03');
    const first = snapshot();
    assert.match(first.get('/sitemap.xml'), /<loc>https:\/\/getseensignsco.com\/shop\/<\/loc><lastmod>2031-02-03<\/lastmod>/);
    assert.match(first.get('/sitemap.xml'), /<loc>https:\/\/getseensignsco.com\/privacy<\/loc><lastmod>2026-10-28<\/lastmod>/, 'an explicit override stays');
    build('2031-02-03');
    const again = snapshot();
    assert.deepEqual([...again].filter(([k, v]) => first.get(k) !== v).map(([k]) => k), [], 'the same date rebuilds to identical files');
    build('2031-02-04');
    const next = snapshot();
    const changed = [...next].filter(([k, v]) => first.get(k) !== v).map(([k]) => k).sort();
    assert.ok(changed.includes('/sitemap.xml'));
    assert.deepEqual(changed.filter((k) => k !== '/sitemap.xml' && !k.startsWith('/blog/')), [], 'only the sitemap and the blog pages (JSON-LD dateModified) use the date');
    assert.throws(() => execFileSync('python3', ['src/site-src-pages.py'], { cwd: tmp, env: { ...process.env, BUILD_DATE: 'tomorrow' }, stdio: 'pipe' }));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('every product Offer points at our own page and ships free to the lower 48 only', () => {
  const LOWER_48 = 'AL AR AZ CA CO CT DE FL GA IA ID IL IN KS KY LA MA MD ME MI MN MO MS MT NC ND NE NH NJ NM NV NY OH OK OR PA RI SC SD TN TX UT VA VT WA WI WV WY'.split(' ');
  assert.equal(LOWER_48.length, 48);
  let offers = 0;
  for (const f of pages()) {
    const html = readFileSync(f, 'utf8');
    const ld = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html);
    if (!ld) continue;
    for (const node of JSON.parse(ld[1])['@graph'].filter((n) => n['@type'] === 'Product')) {
      const slug = /\/([^/]+)\/index\.html$/.exec(f)[1];
      for (const o of [].concat(node.offers)) {
        offers += 1;
        assert.equal(o.url, `https://getseensignsco.com/${slug}/`, f);
        assert.doesNotMatch(o.url, /etsy/, f);
        const dest = o.shippingDetails.shippingDestination;
        assert.equal(dest.addressCountry, 'US', f);
        assert.deepEqual([...dest.addressRegion].sort(), [...LOWER_48].sort(), f + ' lower 48 only');
        assert.ok(!dest.addressRegion.includes('AK') && !dest.addressRegion.includes('HI'), f);
        assert.deepEqual([o.shippingDetails.shippingRate.value, o.shippingDetails.shippingRate.currency], ['0', 'USD'], f);
      }
    }
  }
  assert.ok(offers >= 60, 'checked ' + offers + ' offers');
});

test('audit fixes: meta descriptions under 160 characters, brand in the tailgate title, PNG logo, link names that start with the visible text', () => {
  const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  for (const f of pages()) {
    const html = readFileSync(f, 'utf8');
    const m = /<meta name="description" content="([^"]*)"/.exec(html);
    if (m) assert.ok(decode(m[1]).length < 160, `${f} description is ${decode(m[1]).length} characters`);
    // an accessible name that is set must start with the text people see on the link
    for (const a of html.matchAll(/<a\b[^>]*\baria-label="([^"]+)"[^>]*>([^<]+)<\/a>/g)) {
      const visible = decode(a[2]).trim().toLowerCase();
      if (!visible || a[1].startsWith('Get Seen Signs home')) continue;
      assert.ok(decode(a[1]).toLowerCase().startsWith(visible), `${f}: aria-label "${a[1]}" vs visible "${visible}"`);
    }
  }
  assert.match(read('tailgate-and-gameday-signs/index.html'), /<title>Tailgate Tents &amp; Gameday Signs \| Get Seen Signs<\/title>/);
  const org = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(read('index.html'))[1])['@graph'].find((n) => n['@type'] === 'Organization');
  assert.equal(org.logo, 'https://getseensignsco.com/assets/brand/getseen-horizontal-for-dark-bg.png');
  assert.ok(existsSync(new URL('assets/brand/getseen-horizontal-for-dark-bg.png', root)));
  const html = read('index.html');
  assert.ok(html.includes('aria-label="Text us at (334) 232-9003"') && html.includes('aria-label="Chat on WhatsApp with Get Seen Signs"'));
  assert.ok(!html.includes('aria-label="Text Get Seen Signs at'));
  assert.ok(read('assets/design/ui/tabs/templates.js').includes("'aria-hidden': 'true'"));
});
