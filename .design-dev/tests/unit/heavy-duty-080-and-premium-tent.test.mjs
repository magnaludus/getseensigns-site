// Heavy-duty .080 safety sign pack (a normal checkout SKU) and the stronger tent frame (quote only, any quantity).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATALOG } from '../../../functions/_lib/catalog.js';

const root = new URL('../../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), 'utf8');
const order = JSON.parse(read('assets/order/catalog.json'));
const jsonLd = (html) => JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)[1])['@graph'];

test('the .080 pack is a saved live Stripe price at $209 and the order catalog sells it', () => {
  const sku = CATALOG['safety-12x18-5-080'];
  assert.equal(sku.priceId, 'price_1UVnPh67epULNprT2DI4VGCt');
  assert.equal(sku.amount, 20900);
  assert.equal(order.skus['safety-12x18-5-080'] && order.skus['safety-12x18-5-080'].name, sku.name);
  const prod = order.products['aluminum-safety-signs'];
  const row = prod.rows.find((r) => r.sku === 'safety-12x18-5-080');
  assert.deepEqual([row.when, row.price], [{ pack: '12x18_5hd080' }, 209]);
  assert.ok(prod.groups[0].choices.some((c) => c.id === '12x18_5hd080'));
  assert.equal(order.offers['aluminum-safety-signs|12×18 in, 5 heavy duty (.080)'], 'safety-12x18-5-080');
});

test('the safety page lists the .080 pack everywhere it lists pack prices', () => {
  const html = read('aluminum-safety-signs/index.html');
  const text = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style>[\s\S]*?<\/style>/g, '');
  assert.match(text, /12×18 in with 5 heavy duty \(\.080\) signs is \$209/);
  assert.ok(text.includes('12×18 in, 5 heavy duty (.080) ($209)'));
  assert.ok(html.includes('12x18 with 5 heavy duty .080 signs $209'), 'pricing image alt');
  const offers = jsonLd(html).find((n) => n['@type'] === 'Product').offers;
  assert.ok(offers.some((o) => o.price === '209.00' && o.description === '12×18 in, 5 heavy duty (.080)'));
  assert.ok(read('design/safety-sign/index.html').includes('(.080)'));
});

test('the stronger tent frame is quote only: no price, no SKU, no checkout, no offer, no mailto, minimum 1 tent', () => {
  assert.deepEqual(Object.keys(CATALOG).filter((k) => /premium|elite|commercial/i.test(k + CATALOG[k].name)), []);
  assert.doesNotMatch(JSON.stringify(order), /premium|elite/i);
  const html = read('custom-canopy-tents/index.html');
  assert.doesNotMatch(html, /premium-tents|\$1,099|\$1,849|Elite/, 'the old 6+ premium line is gone');
  const section = /<section class="sec paper" id="stronger-frame">([\s\S]*?)<\/section>/.exec(html);
  assert.ok(section, 'stronger frame section exists');
  assert.match(section[1], /Standard<\/dt><dd>\$599, order below/);
  assert.match(section[1], /Commercial grade<\/dt><dd>Quote/);
  assert.match(section[1], /Minimum<\/dt><dd>1 tent</);
  assert.doesNotMatch(section[1], /stripe|checkout|price_|mailto/i);
  assert.doesNotMatch(html, /mailto/i);
  const offers = jsonLd(html).find((n) => n['@type'] === 'Product').offers;
  assert.deepEqual(offers.map((o) => o.price), ['599.00', '849.00', '1459.00', '129.00', '119.00']);
});

test('the stronger frame quote button opens the site quote form (posts to /api/quote-request) with product, quantity and notes prefilled', () => {
  const html = read('custom-canopy-tents/index.html');
  const href = /<a class="btn btn-ink" href="(\/quote\?[^"#]*)#quote">Request a stronger frame quote/.exec(html);
  assert.ok(href, 'CTA found');
  const q = new URL(href[1].replace(/&amp;/g, '&'), 'https://getseensignsco.com').searchParams;
  assert.equal(q.get('product'), '10×10 Canopy Tent');
  assert.equal(q.get('quantity'), '1');
  assert.match(q.get('details'), /stronger, commercial-grade frame/);
  const quote = read('quote.html');
  assert.ok(quote.includes('data-endpoint="/api/quote-request"') && quote.includes('<option>10×10 Canopy Tent</option>'));
  const js = read('assets/site.js');
  assert.match(js, /\['quantity','size','details'\]/);
  assert.doesNotMatch(js, /mailto/i);
});

test('the Black Friday bar comes from site.js, shows only Nov 27 12:00 AM ET to the end of Nov 30 ET, and names the real code', () => {
  const js = read('assets/site.js');
  assert.match(js, /Date\.parse\('2026-11-27T05:00:00Z'\)/);
  assert.match(js, /Date\.parse\('2026-12-01T05:00:00Z'\)/);
  assert.equal(Date.parse('2026-11-27T05:00:00Z'), Date.parse('2026-11-27T00:00:00-05:00'));
  assert.equal(Date.parse('2026-12-01T05:00:00Z'), Date.parse('2026-12-01T00:00:00-05:00'));
  assert.match(js, /\$50 off<\/b> orders of \$500 or more with code <b>BLACKFRIDAY50<\/b>/);
  assert.match(js, /<b>free 6 ft table cover<\/b> printed to match every canopy tent/);
  for (const page of ['index.html', 'custom-canopy-tents/index.html', 'event-booth-bundles/index.html']) {
    const html = read(page);
    assert.ok(html.includes('site.js'), `${page} loads site.js`);
    assert.doesNotMatch(html, /BLACKFRIDAY50/, `${page} itself is unchanged by the sale`);
  }
});

test('the home page hero is simple: shop button first, free mockup second, no photo collage; booth packages linked', () => {
  const html = read('index.html');
  const hero = html.slice(html.indexOf('class="hero"'), html.indexOf('id="products"'));
  assert.match(hero, /<a class="btn btn-y" href="\/shop\/">Shop all products<\/a>/);
  assert.match(hero, /<a class="btn btn-ghost" href="#quote">Get a free design mockup<\/a>/);
  assert.doesNotMatch(hero, /hero-art|sticker|<img/);
  assert.match(html, /<section class="sec ink" id="booth">[\s\S]*?href="\/event-booth-bundles\/">See booth packages/);
});

test('the home page shows products right after the hero: no scrolling ticker, best sellers before the work photos and seasonal cards', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /class="ticker"/);
  const at = (s) => html.indexOf(s);
  assert.ok(at('class="hero"') > 0 && at('id="products"') > at('class="hero"'));
  assert.ok(at('id="products"') < at('class="work"'), 'best sellers come before the work photos');
  assert.ok(at('class="work"') < at('id="booth"') && at('id="booth"') < at('id="seasonal"'));
  assert.match(html, /<h2 class="shop-h">Shop best sellers<\/h2>/);
});
