// The self-serve order path: POST /api/order-request (the order panel), designer requests that become orders, the
// price rules (the browser can only name a sku and a quantity), and the hand-off to the admin proof flow and the
// customer's proof link. D1 is node:sqlite, Stripe and Brevo are a fake fetch. No network, no real keys.
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadEnv } from './helpers.mjs';
import { createDocument, setChoices, setQty } from '../../../assets/design/model/document.js';
import { projectTotal } from '../../../assets/design/model/pricing.js';
import * as proof from '../../../functions/api/design-proof.js';
import * as orderRequest from '../../../functions/api/order-request.js';
import * as adminOrders from '../../../functions/api/admin/orders.js';
import * as adminOne from '../../../functions/api/admin/orders/[id].js';
import * as adminProof from '../../../functions/api/admin/orders/[id]/proof.js';
import * as proofRoute from '../../../functions/proof/[token].js';
import * as orderRoute from '../../../functions/order/[token].js';
import * as webhook from '../../../functions/api/stripe-webhook.js';
import { CATALOG } from '../../../functions/_lib/catalog.js';
import { resolveLineItem } from '../../../functions/_lib/stripe.js';
import { readTerms } from '../../../functions/_lib/terms.js';
import { DEPS, bytesOf, pngFile, file, formOf, postOf, spyConsole } from './functions-helpers.mjs';
import { makeEnv, installFetch, adminReq, formReq, webhookReq, PROOF_URL, NOW, BASE, ADMIN } from './orders-helpers.mjs';

const designEnv = loadEnv();
const orderCatalog = JSON.parse(readFileSync(new URL('../../../assets/order/catalog.json', import.meta.url), 'utf8'));
let net;

beforeEach(() => {
  proof.resetRateLimit();
  net = installFetch();
});
afterEach(() => net.restore());

const mkEnv = (extra) => makeEnv(extra);
let visitors = 0;
const nextIp = () => '198.20.' + (++visitors >> 8) + '.' + (visitors & 255);
const one = (env, sql, ...p) => env.DB.sqlite.prepare(sql).get(...p);
const rows = (env, sql, ...p) => env.DB.sqlite.prepare(sql).all(...p);
const shopMail = () => net.brevo.find((m) => m.body.tags.includes('design-proof') && !m.body.tags.includes('confirmation'));
const confirmMail = () => net.brevo.find((m) => m.body.tags.includes('confirmation'));

const contact = (over) => Object.assign({ name: 'Pat Smith', email: 'Pat@Example.com', phone: '334-555-0100', eventDate: '2026-11-14', notes: 'Please keep it simple.', source: 'order-panel:vinyl-banners', viewport: 'd', elapsedMs: 45000 }, over);
const orderOf = (items, extra) => ({ order: Object.assign({ items }, extra) });
const uploadReq = (items, over, orderExtra) => contact(Object.assign({ mode: 'upload' }, orderOf(items, orderExtra), over));

async function place(env, request, files, headers) {
  const parts = Object.assign({ request, logos: [file(bytesOf('png', 30000), 'acme logo.png', 'image/png')] }, files);
  const res = await orderRequest.onRequestPost({ request: postOf(formOf(parts), Object.assign({ 'cf-connecting-ip': nextIp() }, headers)), env, now: NOW });
  return { res, body: await res.json() };
}

test('the order endpoint is off without the DB binding and Brevo, and with the off switch', async () => {
  for (const extra of [{ DB: undefined }, { BREVO_API_KEY: undefined }, { DESIGN_PROOF_ENABLED: 'false' }]) {
    const { res, body } = await place(mkEnv(extra), uploadReq([{ sku: 'banner-13oz-3x6', quantity: 1 }]));
    assert.equal(res.status, 503, JSON.stringify(Object.keys(extra)));
    assert.deepEqual(body, { ok: false, enabled: false });
  }
  const forcedNoDb = await place(mkEnv({ DB: undefined, DESIGN_PROOF_ENABLED: 'true' }), uploadReq([{ sku: 'banner-13oz-3x6', quantity: 1 }]));
  assert.equal(forcedNoDb.res.status, 503, 'an order needs the database even when the flag forces the endpoint on');
});

test('an upload order creates an awaiting_proof order, stores the files, emails the shop and confirms to the customer', async () => {
  const env = mkEnv();
  const { res, body } = await place(env, uploadReq([{ sku: 'banner-18oz-3x6', quantity: 2 }], {}, { options: [{ label: 'Finish', value: 'Pole pockets' }] }));
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(body.emailed, true);
  assert.match(body.ref, /^GS-[0-9A-HJKMNP-TV-Z]{8}$/);
  assert.equal(body.order.id, body.ref, 'the order number is the reference the customer was given');
  assert.equal(body.order.subtotal, 16800, 'two 3x6 18 oz banners at $84, in cents');
  assert.match(body.order.url, /^https:\/\/getseensignsco\.com\/order\/[A-Za-z0-9_-]{43}$/);

  const order = one(env, 'SELECT * FROM orders WHERE id = ?', body.ref);
  assert.equal(order.status, 'awaiting_proof');
  assert.equal(order.customer_email, 'pat@example.com');
  assert.equal(order.customer_name, 'Pat Smith');
  assert.equal(order.subtotal_cents, 16800);
  assert.equal(order.notes, 'Please keep it simple.');
  assert.equal(one(env, 'SELECT COUNT(*) AS n FROM proofs').n, 0, 'no proof yet');
  const items = JSON.parse(order.line_items_json);
  assert.equal(items.length, 1);
  assert.deepEqual([items[0].sku, items[0].quantity, items[0].unit_amount_cents, items[0].price_id], ['banner-18oz-3x6', 2, 8400, CATALOG['banner-18oz-3x6'].priceId]);
  assert.equal(items[0].description, 'Finish: Pole pockets');

  const req = one(env, 'SELECT * FROM design_proof_requests WHERE ref = ?', body.ref);
  const fields = JSON.parse(req.request_json);
  assert.equal(req.mode, 'upload');
  assert.equal(fields.phone, '334-555-0100');
  assert.equal(fields.eventDate, '2026-11-14');
  assert.deepEqual(fields.order.items, [{ sku: 'banner-18oz-3x6', quantity: 2, note: 'Finish: Pole pockets' }]);
  assert.equal(JSON.parse(req.files_json)[0].name, 'logo-0.png');

  const shop = shopMail().body;
  assert.equal(shop.subject, 'New order request: Vinyl Banner (18 oz 3x6) (Pat Smith) ' + body.ref);
  assert.deepEqual(shop.replyTo, { email: 'Pat@Example.com', name: 'Pat Smith' }, 'Reply-To is the address as typed');
  assert.deepEqual(shop.attachment.map((a) => a.name), ['logo-0.png']);
  for (const line of ['New order request (awaiting proof)', 'Mode: Uploaded artwork', 'Order ' + body.ref + ' (nothing charged yet)', '  - Vinyl Banner (18 oz 3x6) x 2 = $168.00 (Finish: Pole pockets)', '  Subtotal before tax: $168.00, free shipping', 'Phone: 334-555-0100']) {
    assert.ok(shop.textContent.split('\n').includes(line), line + '\n' + shop.textContent);
  }

  const mail = confirmMail().body;
  assert.equal(mail.subject, 'We got your order request (reference ' + body.ref + ')');
  assert.deepEqual(mail.to, [{ email: 'Pat@Example.com', name: 'Pat Smith' }]);
  const all = mail.htmlContent + '\n' + mail.textContent;
  assert.ok(all.includes(body.ref));
  assert.ok(all.includes('$168.00'));
  assert.match(mail.textContent, /within 12 hours, 7 days a week/);
  assert.match(mail.textContent, /Three revisions are included/);
  assert.match(mail.textContent, /Nothing is charged and nothing prints until you approve your proof and pay from your proof link/);
  assert.ok(mail.textContent.includes('Order status: ' + body.order.url));
  assert.doesNotMatch(all, /Veracity|\bdba\b|d\/b\/a|\bLLC\b|Scott|Shadow Wood|36877|trade name/i);
  assert.ok(!all.includes('Smiths Station'), 'no city in the order email');
});

test('the "rather have us design it" path takes the wording and website, with optional logo files', async () => {
  const env = mkEnv();
  const { res, body } = await place(env, contact({ mode: 'design_for_me', designForMe: { products: [], wording: 'ACME FENCE since 1999. Call 334-555-0100', siteUrl: 'acme.example' }, order: { items: [{ sku: 'coins-50', quantity: 1 }] } }), { logos: [] });
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.order.subtotal, 39900);
  const text = shopMail().body.textContent;
  assert.match(text, /Mode: Design it for me/);
  assert.match(text, /Wording: ACME FENCE since 1999/);
  assert.equal(one(env, 'SELECT status FROM orders').status, 'awaiting_proof');
  assert.match(confirmMail().body.textContent, /We will design it for you/);
});

test('the browser cannot set a price: only the sku and quantity are read, and amounts, names and totals are ignored', async () => {
  const env = mkEnv();
  const items = [{ sku: 'banner-13oz-2x4', quantity: 2, unit_amount_cents: 1, price: 0.01, amount: 1, price_id: 'price_free', name: 'Free banner', total: 1, description: 'FREE' }];
  const { res, body } = await place(env, uploadReq(items, { clientTotal: 0.01, total: 0.01, subtotal: 1 }, { total: 1, subtotal_cents: 1, amount: 1 }));
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.order.subtotal, 8800);
  const stored = JSON.parse(one(env, 'SELECT line_items_json FROM orders').line_items_json)[0];
  assert.deepEqual([stored.name, stored.unit_amount_cents, stored.price_id, stored.description], ['Vinyl Banner (13 oz 2x4)', 4400, CATALOG['banner-13oz-2x4'].priceId, '']);
  assert.equal(one(env, 'SELECT subtotal_cents AS n FROM orders').n, 8800);
});

test('every orderable sku is priced from the server catalog, and the browser catalog agrees with it', async () => {
  const skus = Object.keys(orderCatalog.skus);
  assert.equal(skus.length, 82);
  for (const sku of skus) {
    const env = mkEnv();
    const { body } = await place(env, uploadReq([{ sku, quantity: 3 }]));
    assert.equal(body.ok, true, sku);
    assert.equal(body.order.subtotal, CATALOG[sku].amount * 3, sku);
  }
  for (const product of Object.values(orderCatalog.products)) {
    for (const row of product.rows) assert.equal(row.price * 100, CATALOG[row.sku].amount, `${product.slug} ${row.sku}`);
    for (const a of product.addons) assert.equal(a.price * 100, CATALOG[a.sku].amount, `${product.slug} ${a.sku}`);
  }
});

test('custom patches are priced on the server from the saved SKUs, whatever the browser says', async () => {
  const cases = [['patch-pvc-3in-50', 32900, 'Custom Patches (50 PVC, 3 in)'], ['patch-emb-50', 23900, 'Custom Patches (50 embroidered)'], ['patch-emb-100', 30900, 'Custom Patches (100 embroidered)']];
  for (const [sku, cents, name] of cases) {
    const env = mkEnv();
    const items = [{ sku, quantity: 2, unit_amount_cents: 1, price: 0.01, name: 'Free patches', price_id: 'price_free' }];
    const { res, body } = await place(env, uploadReq(items, { source: 'order-panel:custom-patches', clientTotal: 0.01 }));
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.order.subtotal, cents * 2, sku);
    const stored = JSON.parse(one(env, 'SELECT line_items_json FROM orders').line_items_json)[0];
    assert.deepEqual([stored.sku, stored.name, stored.unit_amount_cents, stored.price_id], [sku, name, cents, CATALOG[sku].priceId], sku + ' uses its saved Stripe Price');
    assert.match(stored.price_id, /^price_[A-Za-z0-9]{20,}$/, sku);
    assert.equal(one(env, 'SELECT status FROM orders').status, 'awaiting_proof');
  }
  net.brevo.length = 0;
  const env = mkEnv();
  const { res, body } = await place(env, contact({ mode: 'design_for_me', source: 'order-panel:custom-patches', designForMe: { products: [], wording: 'ACME FENCE', siteUrl: '' }, order: { items: [{ sku: 'patch-emb-100', quantity: 1 }] } }), { logos: [] });
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.order.subtotal, 30900);
  const all = confirmMail().body.textContent + '\n' + shopMail().body.textContent;
  assert.match(all, /Custom Patches \(100 embroidered\)/);
  assert.match(all, /within 12 hours, 7 days a week/);
  assert.doesNotMatch(all, /3-8 business|3 to 8 business|etsy/i, 'the confirmation email makes no standard-turnaround or Etsy claim for patches');
  for (const skuName of ['patch-pvc-3in-50', 'patch-emb-50', 'patch-emb-100']) assert.ok(orderCatalog.skus[skuName], skuName + ' is orderable');
  assert.deepEqual(resolveLineItem({ sku: 'patch-emb-50', quantity: 1 }).item.unit_amount_cents, 23900);
});

test('metal business cards are priced on the server from their saved Stripe Prices', async () => {
  const cases = [['card-ss-50', 24900], ['card-ss-100', 29900], ['card-ss-250', 49900], ['card-blk-50', 35900], ['card-blk-100', 44900], ['card-gold-100', 32900], ['card-rosegold-100', 32900]];
  for (const [sku, cents] of cases) {
    const env = mkEnv();
    const items = [{ sku, quantity: 2, unit_amount_cents: 1, price: 0.01, name: 'Free cards', price_id: 'price_free' }];
    const { res, body } = await place(env, uploadReq(items, { source: 'order-panel:metal-business-cards', clientTotal: 0.01 }));
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.order.subtotal, cents * 2, sku);
    const stored = JSON.parse(one(env, 'SELECT line_items_json FROM orders').line_items_json)[0];
    assert.deepEqual([stored.sku, stored.unit_amount_cents, stored.price_id], [sku, cents, CATALOG[sku].priceId], sku);
    assert.match(stored.price_id, /^price_[A-Za-z0-9]{20,}$/, sku);
    assert.match(stored.name, /^Metal Business Cards \(/);
  }
  net.brevo.length = 0;
  const { res } = await place(mkEnv(), contact({ mode: 'design_for_me', source: 'order-panel:metal-business-cards', designForMe: { products: [], wording: 'ACME', siteUrl: '' }, order: { items: [{ sku: 'card-gold-100', quantity: 1 }] } }), { logos: [] });
  assert.equal(res.status, 200);
  const all = confirmMail().body.textContent + '\n' + shopMail().body.textContent;
  assert.match(all, /Metal Business Cards \(100 gold\)/);
  assert.doesNotMatch(all, /3-8 business|3 to 8 business|etsy/i);
});

test('bad order input is refused before anything is stored or sent', async () => {
  const cases = [
    [[{ sku: 'shipping', quantity: 1 }], 'the shipping line is not for sale'],
    [[{ sku: 'does-not-exist', quantity: 1 }], 'unknown sku'],
    [[{ sku: '__proto__', quantity: 1 }], 'prototype key'],
    [[{ sku: 'constructor', quantity: 1 }], 'prototype key'],
    [[{ quantity: 1 }], 'no sku'],
    [[{ sku: 'banner-13oz-2x4', quantity: 0 }], 'zero quantity'],
    [[{ sku: 'banner-13oz-2x4', quantity: 21 }], 'over the limit'],
    [[{ sku: 'banner-13oz-2x4', quantity: 1.5 }], 'fraction'],
    [[{ sku: 'banner-13oz-2x4', quantity: '2abc' }], 'text quantity'],
    [[{ sku: 'banner-13oz-2x4', quantity: -1 }], 'negative'],
    [[], 'no items'],
    [Array.from({ length: 7 }, () => ({ sku: 'banner-13oz-2x4', quantity: 1 })), 'too many lines'],
    ['banner-13oz-2x4', 'items not a list'],
  ];
  for (const [items, why] of cases) {
    const env = mkEnv();
    const { res, body } = await place(env, uploadReq(items));
    assert.equal(res.status, 400, why);
    assert.deepEqual(body, { ok: false, error: 'order' }, why);
    assert.equal(rows(env, "SELECT name FROM sqlite_master WHERE name = 'orders'").length ? one(env, 'SELECT COUNT(*) AS n FROM orders').n : 0, 0, why);
  }
  assert.equal(net.brevo.length, 0);
  const noOrder = await place(mkEnv(), contact({ mode: 'upload' }));
  assert.deepEqual(noOrder.body, { ok: false, error: 'order' }, 'the order endpoint needs an order');
  const noFile = await place(mkEnv(), uploadReq([{ sku: 'banner-13oz-2x4', quantity: 1 }]), { logos: [] });
  assert.deepEqual(noFile.body, { ok: false, error: 'logo' }, 'the upload path needs a file');
});

test('wording options become a short note on the line and cannot carry a price or markup into the email', async () => {
  const env = mkEnv();
  const evil = '<script>alert(1)</script>';
  const { body } = await place(env, uploadReq([{ sku: 'safety-12x18-5-063', quantity: 1 }], { name: evil }, { options: [{ label: 'Sign layout', value: 'Landscape' }, { label: evil, value: evil }, 'junk', null, { label: 'x'.repeat(100), value: 'y'.repeat(200) }] }));
  assert.equal(body.ok, true);
  const stored = JSON.parse(one(env, 'SELECT line_items_json FROM orders').line_items_json)[0];
  assert.equal(stored.unit_amount_cents, 16900);
  assert.equal(stored.price_id, 'price_1UVNpR67epULNprTAbPoa2eq', 'the heavy duty pack uses its saved Stripe Price');
  assert.ok(stored.description.length <= 120 && stored.description.startsWith('Sign layout: Landscape'));
  const mail = confirmMail().body;
  assert.ok(!mail.htmlContent.includes(evil));
  assert.ok(!shopMail().body.htmlContent.includes(evil));
});

test('honeypot, fast submissions and the rate limit still apply to orders', async () => {
  const env = mkEnv();
  const items = [{ sku: 'banner-13oz-2x4', quantity: 1 }];
  const trap = await place(env, uploadReq(items), { gotcha: 'http://spam.example' });
  assert.equal(trap.body.ok, true);
  const fast = await place(env, uploadReq(items, { elapsedMs: 500 }));
  assert.equal(fast.body.ok, true);
  assert.equal(net.brevo.length, 0);
  assert.equal(rows(env, "SELECT name FROM sqlite_master WHERE name = 'orders'").length, 0, 'a bot gets a fake success and nothing is written');
  const headers = { 'cf-connecting-ip': '198.51.100.99' };
  for (let i = 0; i < 8; i++) {
    const res = await orderRequest.onRequestPost({ request: postOf(formOf({ request: uploadReq(items), logos: [file(bytesOf('png', 3000), 'a.png', 'image/png')] }), headers), env, now: NOW });
    assert.equal(res.status, 200, 'request ' + (i + 1));
  }
  const limited = await orderRequest.onRequestPost({ request: postOf(formOf({ request: uploadReq(items), logos: [file(bytesOf('png', 3000), 'a.png', 'image/png')] }), headers), env, now: NOW });
  assert.equal(limited.status, 429);
});

test('if the shop email cannot be sent the order is still saved and the page shows its fallback', async () => {
  net.brevoFail = true;
  const env = mkEnv();
  const spy = spyConsole();
  let out;
  try {
    out = await place(env, uploadReq([{ sku: 'banner-13oz-2x4', quantity: 1 }]));
  } finally {
    spy.restore();
  }
  assert.equal(out.body.ok, true);
  assert.equal(out.body.emailed, false);
  assert.equal(one(env, 'SELECT status FROM orders').status, 'awaiting_proof');
  assert.equal(one(env, 'SELECT shop_email FROM design_proof_requests').shop_email, 'failed');
});

// ---------- designer requests become orders ----------

const designPost = (env, design, over, files) =>
  proof.handle(postOf(formOf(Object.assign({ design, request: contact({ mode: 'self', source: 'designer-v2', clientTotal: 1 }), previews: [pngFile(0, 40000)] }, over)), { 'cf-connecting-ip': nextIp() }), env, NOW, DEPS);

test('a designer request becomes an order with the items taken from the design on the server', async () => {
  const env = mkEnv();
  let doc = setChoices(createDocument(designEnv, 'banner'), 0, { size: '3x6', material: '18oz' }, designEnv);
  doc = setQty(doc, 0, 3);
  const res = await designPost(env, doc);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.order.subtotal, 25200, 'three 3x6 18 oz banners; the browser claimed a $1 total');
  const order = one(env, 'SELECT * FROM orders');
  assert.equal(order.status, 'awaiting_proof');
  assert.equal(order.id, body.ref);
  const items = JSON.parse(order.line_items_json);
  assert.deepEqual(items.map((i) => [i.sku, i.quantity]), [['banner-18oz-3x6', 3]]);
  assert.match(confirmMail().body.subject, /^We got your order request/);
  assert.match(body.order.url, /\/order\//);
});

test('every designer option maps to a sku whose price equals the designer price', () => {
  const combos = (groups) => groups.reduce((out, g) => out.flatMap((o) => g.choices.map((c) => ({ ...o, [g.id]: c.id }))), [{}]);
  let checked = 0;
  for (const product of designEnv.catalog.products) {
    for (const choices of combos(product.groups)) {
      let doc = createDocument(designEnv, product.id);
      doc = setChoices(doc, 0, choices, designEnv);
      if (product.qty) doc = setQty(doc, 0, Math.min(3, product.qty.max));
      const items = proof.itemsFromDesign(doc);
      assert.ok(items, `${product.id} ${JSON.stringify(choices)} has a sku`);
      const total = projectTotal(designEnv.catalog, doc).total * 100;
      assert.equal(items.reduce((s, i) => s + i.unit_amount_cents * i.quantity, 0), total, `${product.id} ${JSON.stringify(choices)}`);
      checked += 1;
    }
  }
  assert.equal(checked, 58);
});

test('a two-piece design makes two lines and a quantity is capped', () => {
  const doc = createDocument(designEnv, 'canopy');
  doc.project.pieces.push(createDocument(designEnv, 'feather').project.pieces[0]);
  const items = proof.itemsFromDesign(doc);
  assert.deepEqual(items.map((i) => i.sku), ['tent-standard', 'flag-10.5-spike']);
});

test('without the DB binding a designer request stays a plain proof request with no order', async () => {
  const env = { DESIGN_PROOF_ENABLED: 'true', PROOFS: (await import('./functions-helpers.mjs')).fakeR2() };
  const res = await designPost(env, createDocument(designEnv, 'banner'));
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(!('order' in body));
});

// ---------- from the order panel to a paid order ----------

test('an order request flows through the admin proof, the customer approval and payment', async () => {
  const env = mkEnv();
  const { body } = await place(env, uploadReq([{ sku: 'decal-2in-250', quantity: 2 }]));
  assert.equal(body.ok, true);
  const id = body.ref;
  const token = body.order.url.split('/').pop();

  // admin sees it and what the customer sent
  const list = await (await adminOrders.onRequestGet({ request: adminReq('GET', '/api/admin/orders'), env })).json();
  assert.deepEqual(list.orders.map((o) => [o.id, o.status]), [[id, 'awaiting_proof']]);
  const detail = await (await adminOne.onRequestGet({ request: adminReq('GET', '/x'), env, params: { id } })).json();
  assert.equal(detail.order.status, 'awaiting_proof');
  assert.equal(detail.request.fields.phone, '334-555-0100');
  assert.equal(detail.request.fields.eventDate, '2026-11-14');
  assert.equal(detail.request.files[0].name, 'logo-0.png');
  assert.equal(detail.proofs.length, 0);

  // the customer's links work before the proof exists
  const waiting = await (await proofRoute.onRequestGet({ request: new Request(BASE + '/proof/' + token), env, params: { token } })).text();
  assert.match(waiting, /We are making your proof/);
  assert.ok(!waiting.includes('name="agree"'));
  const status = await (await orderRoute.onRequestGet({ request: new Request(BASE + '/order/' + token), env, params: { token } })).text();
  assert.match(status, /We are making your proof/);
  assert.ok(!status.includes('name="action" value="pay"'));
  const early = await proofRoute.onRequestPost({ request: formReq('/proof/' + token, { action: 'approve', proof_version: '1', terms_hash: 'x', customer_name: 'Pat', agree: 'yes' }), env, params: { token }, now: NOW });
  assert.equal(one(env, 'SELECT COUNT(*) AS n FROM approvals').n, 0, 'nothing can be approved before a proof exists');
  assert.equal(early.status, 303);

  // admin sends the proof; the customer gets the proof-ready email
  const before = net.brevo.length;
  const sent = await adminProof.onRequestPost({ request: adminReq('POST', '/x', { proof_image_url: PROOF_URL }), env, params: { id }, now: NOW });
  const sentBody = await sent.json();
  assert.equal(sent.status, 200, JSON.stringify(sentBody));
  assert.equal(sentBody.proof_version, 1);
  assert.equal(one(env, 'SELECT status FROM orders').status, 'proof_sent');
  const proofMail = net.brevo.slice(before).find((m) => /proof is ready/.test(m.body.subject));
  assert.ok(proofMail && proofMail.body.to[0].email === 'pat@example.com');
  assert.ok(proofMail.body.htmlContent.includes('/proof/' + token));

  // the customer approves and is sent to Stripe Checkout with the server's prices
  const termsHash = (await readTerms(new Request(BASE + '/proof/x'), env)).hash;
  const approve = await proofRoute.onRequestPost({ request: formReq('/proof/' + token, { action: 'approve', proof_version: '1', terms_hash: termsHash, customer_name: 'Pat Smith', agree: 'yes' }), env, params: { token }, now: NOW });
  assert.equal(approve.status, 303);
  assert.match(approve.headers.get('Location'), /^https:\/\/checkout\.stripe\.com\//);
  const stripe = net.stripe.at(-1).params;
  assert.equal(stripe.get('line_items[0][price_data][unit_amount]'), '7900');
  assert.equal(stripe.get('line_items[0][quantity]'), '2');
  assert.equal(stripe.get('metadata[order_id]'), id);
  assert.equal(stripe.get('payment_intent_data[capture_method]'), 'automatic');

  // payment lands
  const session = { id: 'cs_test_1', client_reference_id: id, metadata: { order_id: id }, payment_status: 'paid', payment_intent: 'pi_1', amount_subtotal: 15800, amount_total: 16800, total_details: { amount_tax: 1000 } };
  const hook = await webhook.onRequestPost({ request: await webhookReq({ id: 'evt_1', type: 'checkout.session.completed', data: { object: session } }), env, now: NOW });
  assert.equal(hook.status, 200);
  assert.equal(one(env, 'SELECT status FROM orders').status, 'paid');
});

test('an order cannot be paid before it is approved', async () => {
  const env = mkEnv();
  const { body } = await place(env, uploadReq([{ sku: 'banner-13oz-2x4', quantity: 1 }]));
  const token = body.order.url.split('/').pop();
  const res = await orderRoute.onRequestPost({ request: formReq('/order/' + token, { action: 'pay' }), env, params: { token }, now: NOW });
  assert.equal(res.status, 409);
  assert.equal(net.stripe.length, 0);
});

test('the admin page explains the new flow and lets a row fill the order number', () => {
  const html = readFileSync(new URL('../../../admin/index.html', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../../../admin/admin.js', import.meta.url), 'utf8');
  assert.match(html, /awaiting_proof/);
  assert.match(html, /Send the proof/);
  assert.match(js, /needs proof/);
  assert.match(js, /\$\('p-order'\)\.value = o\.id/);
});
