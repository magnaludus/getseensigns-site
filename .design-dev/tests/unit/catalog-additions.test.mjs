// Oct 30 additions: five new products and options, the Google Merchant Center feed, the booth bundles page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { CATALOG, PLACEHOLDER_PRICE_IDS } from '../../../functions/_lib/catalog.js';

const root = new URL('../../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const body = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const NEW_PAGES = ['metal-a-frame-signs', 'tabletop-retractable-banners', 'table-runners', 'event-booth-bundles', 'reorder'];
const NEW_SKUS = ['retractable-33x81-deluxe', 'stretch-6ft', 'stretch-8ft', 'aframe-24x36', 'tabletop-retractable', 'runner-throw-8ft'];
const PRICE_IDS = {"retractable-33x81-deluxe": "price_1UWHQz67epULNprTo7pzbECK", "stretch-6ft": "price_1UWHQz67epULNprTxYTRekZ2", "stretch-8ft": "price_1UWHQz67epULNprTty5Ol3Le", "aframe-24x36": "price_1UWHQz67epULNprTvLL3tFbE", "tabletop-retractable": "price_1UWHR067epULNprTzMXFvh13", "runner-throw-8ft": "price_1UWHR067epULNprTl0sOC1cQ"};
const CITY = /Smiths Station|Phenix City|Columbus|Auburn|Opelika|Alabama|Georgia|\bAL\b|\bGA\b|Lee County|36877/;

test('the new products bill at the approved prices', () => {
  const want = { 'retractable-33x81-deluxe': 14900, 'stretch-6ft': 19900, 'stretch-8ft': 23900, 'aframe-24x36': 12900, 'tabletop-retractable': 6900, 'runner-throw-8ft': 9900 };
  for (const [sku, cents] of Object.entries(want)) {
    assert.equal(CATALOG[sku].amount, cents, sku);
    assert.equal(CATALOG[sku].priceId, PRICE_IDS[sku], sku + ' has its saved Stripe price');
    assert.ok(!PLACEHOLDER_PRICE_IDS.includes(sku), sku);
  }
});

test('the new product pages show their prices, photos and an order panel, and have Product JSON-LD', () => {
  const pages = { 'metal-a-frame-signs': ['$129', 'p-21-metal-a-frame-sign'], 'tabletop-retractable-banners': ['$69', 'p-22-tabletop-retractable-banner'], 'table-runners': ['$99', 'p-23-table-runner'] };
  for (const [slug, [price, img]] of Object.entries(pages)) {
    const html = read(`${slug}/index.html`);
    assert.ok(body(html).includes(price), slug + ' price');
    assert.ok(html.includes(`/assets/img/${img}.jpg`), slug + ' photo');
    assert.ok(existsSync(new URL(`assets/img/${img}.jpg`, root)) && existsSync(new URL(`assets/img/${img}-sm.webp`, root)), slug + ' image files');
    assert.ok(html.includes('id="order"'), slug + ' order panel');
    const graph = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)[1])['@graph'];
    assert.ok(graph.some((n) => n['@type'] === 'Product'), slug + ' Product JSON-LD');
  }
  const runner = body(read('table-runners/index.html'));
  for (const color of ['Black', 'Red', 'Yellow', 'Blue', 'Green']) assert.ok(runner.includes(color), color);
  assert.match(body(read('retractable-banners/index.html')), /\$149/);
  assert.ok(read('retractable-banners/index.html').includes('g-05-retractable-banner-deluxe'));
  assert.ok(read('table-throws/index.html').includes('g-09-table-throw-stretch'));
});

test('the Merchant Center feed is RSS 2.0 with the g: namespace, one item per SKU, and the required fields', () => {
  const xml = read('feeds/google-products.xml');
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<rss version="2.0" xmlns:g="http:\/\/base.google.com\/ns\/1.0">/);
  const items = xml.split('<item>').slice(1);
  const ids = items.map((i) => /<g:id>([^<]+)<\/g:id>/.exec(i)[1]);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  for (const sku of NEW_SKUS) assert.ok(ids.includes(sku), sku + ' in feed');
  for (const id of ids) assert.ok(id in CATALOG, id + ' is a real SKU');
  for (const item of items) {
    for (const tag of ['title', 'description', 'link', 'image_link', 'availability', 'price', 'brand', 'condition', 'identifier_exists']) assert.match(item, new RegExp(`<g:${tag}>[^<]+</g:${tag}>`), tag);
    const id = /<g:id>([^<]+)</.exec(item)[1];
    assert.equal(/<g:price>([^<]+)</.exec(item)[1], (CATALOG[id].amount / 100).toFixed(2) + ' USD', id + ' price');
    assert.match(/<g:link>([^<]+)</.exec(item)[1], /^https:\/\/getseensignsco\.com\/[a-z0-9-]+\/$/);
    assert.ok(/<g:title>([^<]+)</.exec(item)[1].length <= 150);
  }
  assert.doesNotMatch(xml, /\u2014|Veracity/);
  assert.doesNotMatch(xml, CITY);
});

test('the booth bundles page links the real product pages, adds up its prices honestly, and is in the sitemap', () => {
  const html = read('event-booth-bundles/index.html');
  const text = body(html);
  for (const slug of ['custom-canopy-tents', 'table-throws', 'feather-flags', 'vinyl-banners', 'retractable-banners', 'tabletop-retractable-banners', 'table-runners', 'metal-a-frame-signs', 'trade-show-booth-kit']) assert.ok(html.includes(`href="/${slug}/`), slug);
  for (const total of ['$931', '$596', '$297']) assert.ok(text.includes('Bought separately ' + total), total);
  assert.match(html, /<link rel="canonical" href="https:\/\/getseensignsco.com\/event-booth-bundles\/">/);
  assert.ok(read('sitemap.xml').includes('<loc>https://getseensignsco.com/event-booth-bundles/</loc>'));
});

test('the new pages have no em dashes, no city or area, and no Veracity', () => {
  for (const slug of NEW_PAGES.concat(['retractable-banners', 'table-throws', 'shop'])) {
    const text = body(read(`${slug}/index.html`));
    assert.doesNotMatch(text, /\u2014/, slug + ' em dash');
    assert.doesNotMatch(text, CITY, slug + ' city');
    assert.doesNotMatch(text, /Veracity|\bdba\b/, slug);
  }
});
