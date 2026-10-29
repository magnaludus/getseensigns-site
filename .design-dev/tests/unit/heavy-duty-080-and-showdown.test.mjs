// Heavy-duty .080 safety sign pack (a normal checkout SKU) and the Showdown premium canopy line (quote only).
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

test('the Showdown line is quote only: priced on the page, no SKU, no checkout, no offer, no mailto', () => {
  assert.deepEqual(Object.keys(CATALOG).filter((k) => /showdown|premium|elite/i.test(k + CATALOG[k].name)), []);
  assert.doesNotMatch(JSON.stringify(order), /showdown/i);
  const html = read('custom-canopy-tents/index.html');
  const section = /<section class="sec paper" id="showdown">([\s\S]*?)<\/section>/.exec(html);
  assert.ok(section, 'showdown section exists');
  assert.match(section[1], /Premium<\/dt><dd>\$1,099 each/);
  assert.match(section[1], /Elite<\/dt><dd>\$1,849 each/);
  assert.match(section[1], /Minimum<\/dt><dd>6 tents/);
  assert.doesNotMatch(section[1], /stripe|checkout|price_|mailto/i);
  assert.doesNotMatch(html, /mailto/i);
  const offers = jsonLd(html).find((n) => n['@type'] === 'Product').offers;
  assert.deepEqual(offers.map((o) => o.price), ['599.00', '849.00', '1459.00']);
});

test('the Showdown button opens the site quote form (posts to /api/quote-request) with product, quantity and notes prefilled', () => {
  const html = read('custom-canopy-tents/index.html');
  const href = /<a class="btn btn-ink" href="(\/quote\?[^"#]*)#quote">Request a Showdown quote/.exec(html);
  assert.ok(href, 'CTA found');
  const q = new URL(href[1].replace(/&amp;/g, '&'), 'https://getseensignsco.com').searchParams;
  assert.equal(q.get('product'), '10×10 Canopy Tent');
  assert.equal(q.get('quantity'), '6');
  assert.match(q.get('details'), /Showdown premium canopy tent/);
  const quote = read('quote.html');
  assert.ok(quote.includes('data-endpoint="/api/quote-request"') && quote.includes('<option>10×10 Canopy Tent</option>'));
  const js = read('assets/site.js');
  assert.match(js, /\['quantity','size','details'\]/);
  assert.doesNotMatch(js, /mailto/i);
});
