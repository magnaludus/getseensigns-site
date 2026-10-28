// Built-site checks for the self-serve ordering work: the generated order catalog, the order panel on every product
// page, the Shop page, the nav, and the five new designer products. Reads what the Python build wrote at the repo root.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './helpers.mjs';
import { specFor, dpiLevel } from '../../../assets/design/model/specs.js';
import { createDocument, setChoices } from '../../../assets/design/model/document.js';
import { guidesSvg } from '../../../assets/design/editor/guides.js';
import { CATALOG, PLACEHOLDER_PRICE_IDS } from '../../../functions/_lib/catalog.js';

const root = new URL('../../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), 'utf8');
const body = (html) => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
const order = JSON.parse(read('assets/order/catalog.json'));
const env = loadEnv();

const PAGES = ['bulk-campaign-signs', 'vinyl-banners', 'feather-flags', 'retractable-banners', 'car-magnets', 'real-estate-signs', 'step-and-repeat-backdrops', 'table-throws', 'custom-canopy-tents', 'trade-show-booth-kit', 'hard-hat-decals', 'aluminum-safety-signs', 'challenge-coins', 'custom-patches', 'senior-night-banners', 'holiday-yard-signs'];

function allPages() {
  const out = [];
  const skip = new Set(['.git', '.design-dev', 'node_modules', 'assets', 'functions', 'admin', 'migrations', 'src']);
  const top = fileURLToPath(root).replace(/\/$/, '');
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (dir === top && skip.has(name)) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.html')) out.push(p);
    }
  };
  walk(top);
  return out;
}

test('the order catalog covers every product page and every approved price, and nothing else', () => {
  assert.deepEqual(Object.keys(order.products).sort(), PAGES.slice().sort());
  const offered = new Set([...Object.values(order.products).flatMap((p) => p.rows.map((r) => r.sku)), ...Object.values(order.products).flatMap((p) => p.addons.map((a) => a.sku))]);
  assert.deepEqual([...offered].sort(), Object.keys(order.skus).sort());
  // The one price in the Stripe catalog that the site does not show (the $589 standard tent top) stays quote-only.
  assert.deepEqual(Object.keys(CATALOG).filter((s) => !offered.has(s)), ['tent-standard']);
  assert.ok(!('shipping' in order.skus));
  for (const p of Object.values(order.products)) {
    for (const g of p.groups) for (const c of g.choices) assert.ok(p.rows.some((r) => r.when[g.id] === c.id), `${p.slug} ${g.id}=${c.id} is priced`);
    assert.ok(p.rows.every((r) => r.price > 0 && Number.isInteger(r.price)), p.slug);
  }
  assert.deepEqual(Object.values(order.products).filter((p) => p.uploadOnly).map((p) => p.slug).sort(), ['challenge-coins', 'custom-patches', 'trade-show-booth-kit']);
});

test('every product page has the order panel with its prices, the free shipping note and the proof-first promise', () => {
  for (const slug of PAGES) {
    const html = read(`${slug}/index.html`);
    const text = body(html);
    assert.ok(html.includes('id="order"') && html.includes('id="order-form"'), slug);
    assert.match(html, /<a class="btn btn-y" href="#order">Start my order/, slug + ' hero button');
    assert.ok(html.includes('<link rel="stylesheet" href="/assets/order/order.css">') && html.includes('<script type="module" src="/assets/order/order.js">'), slug);
    assert.match(text, /Free shipping in the lower 48\. Sales tax is added at checkout where required\./, slug);
    assert.match(text, /Nothing is charged and nothing prints until you approve the proof and pay from your proof link/, slug);
    assert.match(text, /within 12 hours, 7 days a week, with 3 revisions included/, slug);
    assert.match(text, /Rather have us design it/, slug);
    assert.match(text, /I have my artwork or logo/, slug);
    const data = JSON.parse(/<script type="application\/json" id="order-data">(.*?)<\/script>/s.exec(html)[1]);
    assert.equal(data.slug, slug);
    assert.deepEqual(data.rows, order.products[slug].rows, slug + ' rows are the generated ones');
    const offers = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)[1])['@graph'].filter((n) => n['@type'] === 'Product').flatMap((n) => [].concat(n.offers));
    const shown = new Set(offers.map((o) => Number(o.price)));
    for (const r of data.rows) assert.ok(shown.has(r.price), `${slug}: panel price $${r.price} is also a page price`);
    assert.equal(/Design it online/.test(text), !!data.designer, slug + ' designer path only where the designer covers it');
    assert.doesNotMatch(html, /Veracity/, slug);
  }
});

test('products the designer cannot cover offer upload or "we design it" only', () => {
  for (const slug of ['trade-show-booth-kit', 'challenge-coins', 'custom-patches']) {
    const html = read(`${slug}/index.html`);
    assert.ok(!/Design it online/.test(body(html)), slug);
    assert.ok(html.includes('name="path" value="upload" checked'), slug + ' upload is the default');
  }
  for (const slug of ['real-estate-signs', 'senior-night-banners', 'holiday-yard-signs']) assert.ok(!/Design it online/.test(body(read(`${slug}/index.html`))), slug);
});

test('the Custom Patches page: exact prices, upload-only paths, 11 to 15 day turnaround, no Etsy listing', () => {
  const html = read('custom-patches/index.html');
  const text = body(html);
  const graph = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)[1])['@graph'];
  // approved prices, nothing else
  const product = graph.find((n) => n['@type'] === 'Product');
  assert.deepEqual(product.offers.map((o) => [o.price, o.description]), [['329.00', '50 PVC patches, 3 in'], ['239.00', '50 embroidered patches'], ['309.00', '100 embroidered patches']]);
  const data = JSON.parse(/<script type="application\/json" id="order-data">(.*?)<\/script>/s.exec(html)[1]);
  assert.deepEqual(data.rows.map((r) => [r.sku, r.price]), [['patch-pvc-50-3in', 329], ['patch-emb-50', 239], ['patch-emb-100', 309]]);
  assert.deepEqual(order.products['custom-patches'].rows.map((r) => r.price), [329, 239, 309]);
  for (const price of ['$329', '$239', '$309']) assert.ok(text.includes(price), price);
  assert.match(text, /from<\/small> \$239/);
  // upload or "we design it" only
  assert.equal(data.uploadOnly, true);
  assert.equal(data.designer, null);
  assert.ok(!/Design it online/.test(text) && !/Design yours online/.test(text) && !html.includes('id="ord-path-designer"'));
  assert.ok(html.includes('name="path" value="upload" checked') && /Rather have us design it/.test(text));
  // turnaround: 11 to 15 business days after proof approval, proof in 12 hours, never the standard 3 to 8 days
  assert.match(text, /about 11 to 15 business days after you approve the proof/);
  assert.match(text, /within 12 hours, 7 days a week, 3 revisions included/);
  assert.doesNotMatch(text, /3-8 business days|3 to 8 business days|5-10 business days|Arrives 3/);
  const turnaroundRow = /<dt>Turnaround<\/dt><dd>(.*?)<\/dd>/.exec(html)[1];
  assert.match(turnaroundRow, /11 to 15 business days/);
  // handling and transit in the structured data
  for (const o of product.offers) {
    assert.equal(o.url, 'https://getseensignsco.com/custom-patches/', 'the Offer points at the page, not at an Etsy listing');
    assert.equal(o.shippingDetails.shippingRate.value, '0');
    assert.equal(o.shippingDetails.shippingDestination.addressCountry, 'US');
    assert.deepEqual([o.shippingDetails.deliveryTime.handlingTime.minValue, o.shippingDetails.deliveryTime.handlingTime.maxValue], [11, 15]);
    assert.deepEqual([o.shippingDetails.deliveryTime.transitTime.minValue, o.shippingDetails.deliveryTime.transitTime.maxValue], [2, 5]);
    assert.equal(o.hasMerchantReturnPolicy.returnPolicyCategory, 'https://schema.org/MerchantReturnNotPermitted');
  }
  assert.ok(graph.some((n) => n['@type'] === 'BreadcrumbList') && graph.some((n) => n['@type'] === 'FAQPage'));
  // no Etsy listing anywhere on the page: no buttons, no listing links, no listing id in the data. The footer keeps the general Etsy shop link.
  assert.doesNotMatch(html, /etsy\.com\/listing/);
  assert.doesNotMatch(text, /Order on Etsy|Prefer Etsy|order on Etsy/);
  assert.ok(!('etsy' in order.products['custom-patches']));
  assert.match(text, /Prefer to ask first\? <a href="\/\?product=Custom\+Patches#quote">Get a quote<\/a>/);
  // GSS-only plain copy
  assert.doesNotMatch(html, /Veracity|\bdba\b|d\/b\/a|Scott|—/);
  assert.doesNotMatch(text, /\u2014|\u2013/);
  // the stand-in images exist and are the right sizes (real photos are still needed)
  for (const [f, size] of [['p-19-custom-patches.jpg', 1024], ['p-19-custom-patches.webp', 1024], ['p-19-custom-patches-sm.webp', 400], ['g-19-custom-patches-2.jpg', 900], ['g-19-custom-patches-2.webp', 900], ['g-19-custom-patches-2-sm.webp', 480]]) {
    assert.ok(existsSync(new URL('assets/img/' + f, root)), f);
    assert.ok(readFileSync(new URL('assets/img/' + f, root)).length > 1000, f);
  }
  // listed everywhere a product is listed
  assert.ok(read('sitemap.xml').includes('<loc>https://getseensignsco.com/custom-patches/</loc>'));
  const shop = read('shop/index.html');
  assert.ok(shop.includes('href="/custom-patches/#order"') && shop.includes('<a href="/custom-patches/">Custom Patches</a>'));
  assert.ok(JSON.stringify(shop).includes('https://getseensignsco.com/custom-patches/'), 'shop ItemList');
  assert.ok(read('index.html').includes('href="/custom-patches/"') && read('index.html').includes('<span>Custom patches</span>') && read('index.html').includes('<option>Custom Patches</option>'));
  assert.ok(read('404.html').includes('href="/custom-patches/"'));
  assert.ok(read('terms.html').includes('<a href="/custom-patches/">Custom Patches</a>'), 'footer product list');
  assert.ok(read('custom-patches/index.html').includes('<a href="/custom-patches/">Custom Patches</a>'));
  assert.ok(read('index.html').includes('business days after you approve your proof'));
});

test('catalog.js lists exactly which SKUs still have no saved Stripe price', () => {
  const unsaved = Object.entries(CATALOG).filter(([, e]) => e.priceId === '').map(([sku]) => sku).sort();
  assert.deepEqual(unsaved, [...PLACEHOLDER_PRICE_IDS].sort());
  assert.deepEqual([...PLACEHOLDER_PRICE_IDS].sort(), ['patch-emb-100', 'patch-emb-50', 'patch-pvc-50-3in', 'safety-12x18-5-hd']);
  assert.deepEqual([CATALOG['patch-pvc-50-3in'].amount, CATALOG['patch-emb-50'].amount, CATALOG['patch-emb-100'].amount], [32900, 23900, 30900]);
  assert.match(read('functions/_lib/catalog.js'), /PLACEHOLDER STRIPE PRICES: CUSTOM PATCHES/);
});

test('the Shop page lists every product with its from price and an order link, and is in the sitemap', () => {
  const html = read('shop/index.html');
  const text = body(html);
  assert.match(html, /<link rel="canonical" href="https:\/\/getseensignsco.com\/shop\/">/);
  assert.ok(html.includes('<title>Shop Custom Signs, Banners, Flags, Tents &amp; More | Get Seen Signs</title>'));
  for (const slug of PAGES) assert.ok(html.includes(`href="/${slug}/#order"`), slug + ' order link');
  for (const slug of PAGES) {
    const p = order.products[slug];
    const lowest = Math.min(...p.rows.map((r) => r.price), ...p.addons.map(() => Infinity));
    if (slug === 'holiday-yard-signs') continue;
    assert.ok(text.includes('$' + lowest.toLocaleString('en-US')), `${slug} from $${lowest}`);
  }
  assert.equal((html.match(/class="card shop-card"/g) || []).length, 17);
  assert.match(text, /Proof first, then pay/);
  assert.match(text, /Free shipping in the lower 48/);
  assert.ok(read('sitemap.xml').includes('<loc>https://getseensignsco.com/shop/</loc>'));
  assert.doesNotMatch(html, /Veracity/);
});

test('Shop is in the main nav on every page, for desktop and for the phone header, and in the footer', () => {
  let checked = 0;
  for (const f of allPages()) {
    const html = readFileSync(f, 'utf8');
    if (!html.includes('<header class="nav">')) continue;
    checked += 1;
    assert.ok(html.includes('<a href="/shop/">Shop</a>'), f + ' desktop nav');
    assert.ok(html.includes('<a class="nav-shop" href="/shop/">Shop</a>'), f + ' phone header');
    assert.ok(html.includes('<a href="/shop/">Shop all products</a>'), f + ' footer');
  }
  assert.ok(checked >= 40, 'checked ' + checked + ' pages');
  const css = read('assets/style.css');
  assert.match(css, /\.nav-links\{display:none\}\.nav-in\{gap:12px\}\.nav-shop,\.nav-design\{display:inline-flex/);
});

// ---------- designer products ----------

const NEW = {
  retractable: { slug: 'retractable-banner', sizes: { '33x81': [33, 81], '47x81': [47, 81] }, by: 'size' },
  backdrop: { slug: 'step-and-repeat', sizes: { '8x8': [96, 96], '10x8': [120, 96] }, by: 'size' },
  magnet: { slug: 'car-magnet', sizes: { '12x18': [18, 12], '18x24': [24, 18] }, by: 'size' },
  decal: { slug: 'hard-hat-decal', sizes: { '2in100': [2, 2], '2in250': [2, 2], '2in500': [2, 2], '3in250': [3, 3], '3in500': [3, 3] }, by: 'pack' },
  safety: { slug: 'safety-sign', sizes: { '12x18_5': [12, 18], '12x18_10': [12, 18], '18x24_5': [18, 24], '12x18_5hd': [12, 18] }, by: 'pack' },
};

test('the designer covers ten products, with the same prices as the product pages', () => {
  assert.deepEqual(env.catalog.products.map((p) => p.id), ['canopy', 'feather', 'yard', 'throw', 'banner', ...Object.keys(NEW)]);
  for (const [id, n] of Object.entries(NEW)) {
    const product = env.catalog.products.find((p) => p.id === id);
    assert.equal(product.slug, n.slug);
    assert.equal(product.designPage, `/design/${n.slug}/`);
    assert.ok(existsSync(new URL(`design/${n.slug}/index.html`, root)), id + ' designer page');
    assert.equal(product.templates.length, 4, id);
    assert.ok(env.templates[id].length === 4, id + ' templates built');
    assert.ok(read('design/index.html').includes(`href="/design/${n.slug}/"`), id + ' on the designer hub');
    assert.ok(read('sitemap.xml').includes(`/design/${n.slug}/`), id + ' in the sitemap');
  }
  const banner = env.catalog.products.find((p) => p.id === 'banner');
  assert.deepEqual(banner.groups.map((g) => g.id), ['size', 'material']);
  assert.equal(banner.prices.length, 12);
  assert.deepEqual(banner.prices.filter((r) => r.when.material === '18oz').map((r) => r.price), [54, 84, 149, 119]);
  assert.deepEqual(banner.prices.filter((r) => r.when.material === 'mesh').map((r) => r.price), [54, 84, 149, 119]);
});

test('new designer products have the right aspect ratio, bleed, safe area and dpi rules', () => {
  for (const [id, n] of Object.entries(NEW)) {
    const spec = env.specs.products[id];
    assert.ok(spec, id);
    for (const [key, [w, h]] of Object.entries(n.sizes)) {
      // safety signs are listed in portrait here; the landscape layouts are checked below
      const choices = id === 'safety' ? { pack: key, orient: 'portrait' } : { [n.by]: key };
      const s = specFor(env.specs, id, choices);
      assert.deepEqual([s.artboard.w, s.artboard.h], [w, h], `${id} ${key} artboard`);
      assert.ok(Math.abs(s.artboard.w / s.artboard.h - w / h) < 1e-9, `${id} ${key} aspect ratio`);
      assert.ok(s.bleed > 0 && s.art.w === s.artboard.w + 2 * s.bleed, `${id} ${key} bleed`);
      assert.ok(s.safe.x > 0 && s.safe.y > 0 && s.safe.x + s.safe.w < s.artboard.w && s.safe.y + s.safe.h < s.artboard.h, `${id} ${key} safe area inside the trim`);
      assert.ok(s.dpi.target >= 100 && s.dpi.greenMin >= 100 && s.dpi.amberMin < s.dpi.greenMin, `${id} ${key} dpi`);
      assert.ok(s.minCapIn > 0 && s.readFt > 0, `${id} ${key} reading size`);
      assert.deepEqual(s.placeholders, [], `${id} ${key} has no placeholder rows`);
    }
  }
  // safety signs come in both layouts
  const land = specFor(env.specs, 'safety', { pack: '12x18_5', orient: 'landscape' });
  assert.deepEqual([land.artboard.w, land.artboard.h], [18, 12]);
  const tall = specFor(env.specs, 'safety', { pack: '18x24_5', orient: 'portrait' });
  assert.deepEqual([tall.artboard.w, tall.artboard.h], [18, 24]);
  assert.deepEqual([specFor(env.specs, 'safety', { pack: '18x24_5', orient: 'landscape' }).artboard.w], [24]);
});

test('print-appropriate dpi checks: small decals need sharper art than a 33x81 banner', () => {
  const decal = specFor(env.specs, 'decal', { pack: '2in100' });
  const stand = specFor(env.specs, 'retractable', { size: '33x81' });
  const sign = specFor(env.specs, 'safety', { pack: '12x18_5', orient: 'landscape' });
  assert.equal(dpiLevel(200, decal.dpi), 'amber');
  assert.equal(dpiLevel(120, decal.dpi), 'red');
  assert.equal(dpiLevel(260, decal.dpi), 'green');
  assert.equal(dpiLevel(100, stand.dpi), 'green');
  assert.equal(dpiLevel(60, stand.dpi), 'red');
  assert.equal(dpiLevel(150, sign.dpi), 'green');
  assert.equal(dpiLevel(120, sign.dpi), 'amber');
});

test('the retractable banner shows the stand zone guide and the sides follow the sign pack', () => {
  const s = specFor(env.specs, 'retractable', { size: '33x81' });
  assert.equal(s.baseZoneIn, 10);
  assert.ok(s.overlays.includes('base_zone'));
  const svg = guidesSvg(s, { trim: true, bleed: true, safe: true, base_zone: true }, 1);
  assert.match(svg, /Often hidden by the stand/);
  const safety = env.catalog.products.find((p) => p.id === 'safety');
  assert.equal(safety.sides.names['12x18_10'].length, 10);
  assert.equal(safety.sides.names['12x18_5hd'].length, 5);
  const doc = setChoices(createDocument(env, 'safety'), 0, { pack: '12x18_10' }, env);
  assert.equal(doc.project.pieces[0].sides.length, 10);
});

test('designer pages for the new products use plain Get Seen Signs copy', () => {
  for (const n of Object.values(NEW)) {
    const html = read(`design/${n.slug}/index.html`);
    const text = body(html);
    assert.match(text, /Nothing prints until you approve it/);
    assert.match(text, /within 12 hours, 7 days a week/);
    assert.doesNotMatch(html, /Veracity|\bdba\b|Scott/);
    assert.doesNotMatch(text, /3 to 5 business days|3–5/);
  }
});

test('the designer opens with the choices in the address from the order panel', () => {
  const app = read('assets/design/app.js');
  assert.match(app, /params\.get\(g\.id\)/);
  assert.match(app, /setChoices\(doc, 0, patch, env\)/);
  for (const p of Object.values(order.products).filter((x) => x.designer)) {
    const dp = env.catalog.products.find((x) => x.id === p.designer);
    assert.ok(dp, p.slug + ' designer product');
    for (const [panelGroup, designerGroup] of Object.entries(p.designerMap)) {
      assert.ok(p.groups.some((g) => g.id === panelGroup), p.slug);
      const dg = dp.groups.find((g) => g.id === designerGroup);
      assert.ok(dg, `${p.slug} designer group ${designerGroup}`);
      const pg = p.groups.find((g) => g.id === panelGroup);
      // a panel choice the designer lacks (fitted table covers) has no designer path
      assert.deepEqual(p.designerOk[panelGroup], pg.choices.map((c) => c.id).filter((id) => dg.choices.some((c) => c.id === id)), `${p.slug} ${panelGroup}`);
      if (p.slug !== 'table-throws') assert.deepEqual(p.designerOk[panelGroup], pg.choices.map((c) => c.id), `${p.slug} ${panelGroup} choices all exist in the designer`);
      else assert.deepEqual(p.designerOk.style, ['3', '4']);
    }
  }
});
