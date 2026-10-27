// The order flow end to end, in process: admin creates an order and proof, the customer approves (evidence is
// stored, Stripe Checkout is created in test mode), the webhook marks it paid or logs a dispute, and admin adds
// tracking. D1 is node:sqlite, Stripe and Brevo are a fake fetch. No network, no real keys.
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as adminOrders from '../../../functions/api/admin/orders.js';
import * as adminOne from '../../../functions/api/admin/orders/[id].js';
import * as adminProof from '../../../functions/api/admin/orders/[id]/proof.js';
import * as adminTracking from '../../../functions/api/admin/orders/[id]/tracking.js';
import * as proofRoute from '../../../functions/proof/[token].js';
import * as orderRoute from '../../../functions/order/[token].js';
import * as webhook from '../../../functions/api/stripe-webhook.js';
import { SCHEMA } from '../../../functions/_lib/db.js';
import { CATALOG } from '../../../functions/_lib/catalog.js';
import { textOfMain, readTerms, versionLabel } from '../../../functions/_lib/terms.js';
import { verifyWebhook, signWebhook, resolveLineItem } from '../../../functions/_lib/stripe.js';
import { recordHashOf, evidenceCore, CONSENT_TEXT } from '../../../functions/_lib/orders.js';
import { renderEmail } from '../../../functions/_lib/emails.js';
import { sha256Hex } from '../../../functions/_lib/util.js';
import { NOW, IP, UA, BASE, PNG, PROOF_URL, PROOF_URL_2, WEBHOOK_SECRET, makeEnv, installFetch, adminReq, formReq, webhookReq } from './orders-helpers.mjs';

const root = new URL('../../../', import.meta.url);
let env;
let net;

beforeEach(() => {
  env = makeEnv();
  net = installFetch();
});
afterEach(() => net.restore());

const ITEMS = [
  { sku: 'banner-13oz-3x6', quantity: 2 },
  { name: 'Custom 4x8 wrap', quantity: 1, unit_amount_cents: 14900 },
];
const SUBTOTAL = 5900 * 2 + 14900;

async function createOrder(extra) {
  const res = await adminOrders.onRequestPost({
    request: adminReq('POST', '/api/admin/orders', Object.assign({ customer_email: 'Pat@Example.com', customer_name: 'Pat Customer', line_items: ITEMS, proof_image_url: PROOF_URL }, extra)),
    env,
    now: NOW,
  });
  const body = await res.json();
  assert.equal(res.status, 201, JSON.stringify(body));
  return { body, token: body.proof_url.split('/').pop() };
}

const rows = (sql, ...p) => env.DB.sqlite.prepare(sql).all(...p);
const one = (sql, ...p) => env.DB.sqlite.prepare(sql).get(...p);

async function termsHash() {
  return (await readTerms(new Request(BASE + '/proof/x'), env)).hash;
}

async function approve(token, extra, headers) {
  const fields = Object.assign({ action: 'approve', proof_version: '1', terms_hash: await termsHash(), customer_name: 'Pat Customer', agree: 'yes' }, extra);
  return proofRoute.onRequestPost({ request: formReq('/proof/' + token, fields, headers), env, params: { token }, now: NOW });
}

const revise = (token, extra) =>
  proofRoute.onRequestPost({ request: formReq('/proof/' + token, Object.assign({ action: 'revise', proof_version: '1', comment: 'Please make the phone number bigger' }, extra)), env, params: { token }, now: NOW });

function signed(event, secret) {
  return webhookReq(event, { secret });
}

function sessionEvent(order, extra) {
  return {
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: {
      object: Object.assign(
        {
          id: 'cs_test_1',
          object: 'checkout.session',
          client_reference_id: order.id,
          metadata: { order_id: order.id },
          payment_status: 'paid',
          payment_intent: 'pi_test_1',
          amount_subtotal: SUBTOTAL,
          amount_total: SUBTOTAL + 700,
          total_details: { amount_tax: 700 },
          customer_details: { name: 'Pat Customer', email: 'pat@example.com', phone: '+13345550100' },
          collected_information: { shipping_details: { name: 'Pat Customer', address: { line1: '1 Test St', city: 'Auburn', state: 'AL', postal_code: '36830', country: 'US' } } },
        },
        extra
      ),
    },
  };
}

async function approvedOrder() {
  const { body, token } = await createOrder();
  const res = await approve(token);
  assert.equal(res.status, 303);
  return { id: body.order_id, token };
}

async function paidOrder() {
  const { id, token } = await approvedOrder();
  const res = await webhook.onRequestPost({ request: await signed(sessionEvent({ id })), env, now: NOW });
  assert.equal(res.status, 200);
  return { id, token };
}

const emailsTo = (to) => net.brevo.filter((m) => m.body.to[0].email === to);
const subjects = () => net.brevo.map((m) => m.body.subject);

// ---------- admin auth ----------

test('admin endpoints refuse a missing, wrong or unconfigured token', async () => {
  for (const [token, expected] of [[null, 401], ['wrong-token-wrong-token', 401]]) {
    const res = await adminOrders.onRequestGet({ request: adminReq('GET', '/api/admin/orders', undefined, token), env });
    assert.equal(res.status, expected);
  }
  const noTracking = await adminTracking.onRequestPost({ request: adminReq('POST', '/x', {}, null), env, params: { id: 'GS-AAAAAAAA' } });
  assert.equal(noTracking.status, 401);
  for (const bad of [undefined, '', 'short']) {
    const res = await adminOrders.onRequestGet({ request: adminReq('GET', '/api/admin/orders'), env: Object.assign({}, env, { ADMIN_TOKEN: bad }) });
    assert.equal(res.status, 503, 'fails closed when ADMIN_TOKEN is ' + JSON.stringify(bad));
  }
  assert.equal(net.brevo.length, 0);
});

// ---------- create order + proof ----------

test('creating an order stores the proof hash, returns an unguessable link, and sends the proof-ready email', async () => {
  const { body, token } = await createOrder();
  assert.match(body.order_id, /^GS-[0-9A-HJKMNP-TV-Z]{8}$/);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(body.proof_url, BASE + '/proof/' + token);
  assert.equal(body.order_url, BASE + '/order/' + token);
  assert.deepEqual(body.email, { sent: true });

  const order = one('SELECT * FROM orders WHERE id = ?', body.order_id);
  assert.equal(order.status, 'proof_sent');
  assert.equal(order.customer_email, 'pat@example.com');
  assert.equal(order.subtotal_cents, SUBTOTAL);
  const items = JSON.parse(order.line_items_json);
  assert.equal(items[0].price_id, CATALOG['banner-13oz-3x6'].priceId);
  assert.equal(items[1].price_id, '');

  const proof = one('SELECT * FROM proofs WHERE order_id = ?', body.order_id);
  assert.equal(proof.proof_hash, await sha256Hex(PNG));
  assert.equal(JSON.parse(proof.files_json)[0].url, PROOF_URL);

  assert.equal(net.brevo.length, 1);
  const mail = net.brevo[0].body;
  assert.deepEqual(mail.sender, { name: 'Get Seen Signs', email: 'sales@getseensignsco.com' });
  assert.equal(mail.to[0].email, 'pat@example.com');
  assert.equal(net.brevo[0].headers['api-key'], env.BREVO_API_KEY);
  assert.match(mail.subject, /proof is ready/);
  assert.ok(mail.htmlContent.includes(body.proof_url));
  assert.ok(mail.textContent.includes(body.proof_url));
});

test('two orders never share a token or id', async () => {
  const a = await createOrder();
  const b = await createOrder();
  assert.notEqual(a.token, b.token);
  assert.notEqual(a.body.order_id, b.body.order_id);
});

test('order creation rejects bad input without storing anything', async () => {
  const cases = [
    [{ customer_email: 'nope' }, /email/],
    [{ line_items: [] }, /line_items/],
    [{ line_items: [{ sku: 'does-not-exist', quantity: 1 }] }, /unknown sku/],
    [{ line_items: [{ sku: 'banner-13oz-3x6', quantity: 1, unit_amount_cents: 100 }] }, /leave out sku/],
    [{ line_items: [{ name: 'x', quantity: 0, unit_amount_cents: 500 }] }, /quantity/],
    [{ line_items: [{ name: 'x', quantity: 1, unit_amount_cents: 10 }] }, /at least \$0.50/],
    [{ line_items: [{ quantity: 1, unit_amount_cents: 500 }] }, /name or description/],
    [{ proof_image_url: 'http://proofs.example.com/a.png' }, /https/],
    [{ proof_image_url: 'https://proofs.example.com/missing.png' }, /HTTP 404/],
  ];
  net.images['https://proofs.example.com/page.html'] = { type: 'text/html', bytes: PNG };
  cases.push([{ proof_image_url: 'https://proofs.example.com/page.html' }, /png, jpeg/]);
  for (const [extra, pattern] of cases) {
    const res = await adminOrders.onRequestPost({ request: adminReq('POST', '/api/admin/orders', Object.assign({ customer_email: 'a@example.com', line_items: ITEMS, proof_image_url: PROOF_URL }, extra)), env, now: NOW });
    const body = await res.json();
    assert.equal(res.status, 400, JSON.stringify(extra));
    assert.match(body.error, pattern);
  }
  assert.equal(one('SELECT COUNT(*) AS n FROM orders').n, 0);
  assert.equal(net.brevo.length, 0);
});

test('an order is still created when the email cannot be sent, and the failure is reported and logged', async () => {
  net.brevoFail = true;
  const { body } = await createOrder();
  assert.equal(body.email.sent, false);
  assert.match(body.email.error, /Brevo 401/);
  assert.equal(one("SELECT status FROM emails WHERE order_id = ? AND kind = 'proof_ready'", body.order_id).status, 'failed');
});

test('line item resolution: catalog sku uses the catalog amount, custom lines use their own', () => {
  assert.equal(resolveLineItem({ sku: 'yardsign-25-2s', quantity: 3 }).item.unit_amount_cents, 20900);
  assert.equal(resolveLineItem({ sku: 'tent-full-kit' }).item.quantity, 1);
  assert.equal(resolveLineItem({ sku: 'shipping', name: 'Shipping', unit_amount_cents: 2500 }).item.sku, 'shipping');
  assert.ok(resolveLineItem({ sku: '__proto__', quantity: 1 }).error);
  assert.ok(resolveLineItem({ sku: 'banner-13oz-3x6', quantity: 1.5 }).error);
});

test('the catalog has well-formed Stripe prices', () => {
  const entries = Object.entries(CATALOG);
  assert.ok(entries.length >= 60);
  for (const [sku, e] of entries) {
    assert.match(sku, /^[a-z0-9.-]+$/);
    assert.match(e.priceId, /^price_[A-Za-z0-9]{20,}$/, sku);
    assert.ok(Number.isInteger(e.amount) && e.amount >= 2400, sku);
  }
  assert.equal(CATALOG['banner-13oz-3x6'].amount, 5900);
  assert.equal(CATALOG['tent-full-kit'].amount, 145900);
});

// ---------- proof page ----------

test('the proof page shows the proof, the order summary, the price and a required terms checkbox', async () => {
  const { token } = await createOrder();
  const res = await proofRoute.onRequestGet({ request: new Request(BASE + '/proof/' + token), env, params: { token } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const page = await res.text();
  assert.ok(page.includes('<img src="' + PROOF_URL + '"'));
  assert.ok(page.includes('Vinyl Banner (13 oz 3x6)'));
  assert.ok(page.includes('$267.00'), 'subtotal');
  assert.match(page, /<input type="checkbox" name="agree" value="yes" required>/);
  assert.ok(page.includes('<a href="/terms" target="_blank" rel="noopener">Terms of Service</a>'));
  assert.match(page, /name="terms_hash" value="[0-9a-f]{64}"/);
  assert.ok(page.includes('3 of 3 free revisions left'));
  assert.ok(page.includes('/assets/style.css'), 'uses the site stylesheet');
  assert.ok(page.includes('Smiths Station, AL'));
});

test('unknown or malformed tokens get a 404 page, never a lookup error', async () => {
  for (const token of ['short', 'x'.repeat(43), "' OR 1=1 --", 'A'.repeat(44)]) {
    const res = await proofRoute.onRequestGet({ request: new Request(BASE + '/proof/' + encodeURIComponent(token)), env, params: { token } });
    assert.equal(res.status, 404);
    const res2 = await orderRoute.onRequestGet({ request: new Request(BASE + '/order/' + encodeURIComponent(token)), env, params: { token } });
    assert.equal(res2.status, 404);
  }
});

test('customer-controlled and admin text is escaped in pages and emails', async () => {
  const evil = '<script>alert(1)</script>';
  const { token } = await createOrder({ customer_name: evil, line_items: [{ name: evil, quantity: 1, unit_amount_cents: 5000 }], proof_note: evil });
  const page = await (await proofRoute.onRequestGet({ request: new Request(BASE + '/proof/' + token), env, params: { token } })).text();
  assert.ok(!page.includes(evil));
  assert.ok(page.includes('&lt;script&gt;'));
  assert.ok(!net.brevo[0].body.htmlContent.includes(evil));
  const rev = await revise(token, { comment: evil });
  assert.equal(rev.status, 200);
  const alert = net.brevo.find((m) => m.body.tags.includes('shop'));
  assert.ok(!alert.body.htmlContent.includes(evil));
});

// ---------- approval ----------

test('approval needs the checkbox and a name, and records nothing otherwise', async () => {
  const { token } = await createOrder();
  let res = await approve(token, { agree: '' });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /tick the box/);
  res = await approve(token, { customer_name: ' ' });
  assert.equal(res.status, 400);
  assert.equal(one('SELECT COUNT(*) AS n FROM approvals').n, 0);
  assert.equal(one('SELECT status FROM orders').status, 'proof_sent');
  assert.equal(net.stripe.length, 0);
});

test('approval is refused when the Terms changed after the page was shown', async () => {
  const { token } = await createOrder();
  const res = await approve(token, { terms_hash: 'f'.repeat(64) });
  assert.equal(res.status, 409);
  assert.match(await res.text(), /Terms were updated/);
  assert.equal(one('SELECT COUNT(*) AS n FROM approvals').n, 0);
});

test('approval is refused for a stale proof version', async () => {
  const { token } = await createOrder();
  const res = await approve(token, { proof_version: '7' });
  assert.equal(res.status, 409);
  assert.equal(one('SELECT COUNT(*) AS n FROM approvals').n, 0);
});

test('approving stores the full evidence record and sends the customer to Stripe Checkout', async () => {
  const { body, token } = await createOrder();
  const res = await approve(token);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('Location'), 'https://checkout.stripe.com/c/pay/cs_test_1');

  const ev = one('SELECT * FROM approvals');
  const terms = await readTerms(new Request(BASE + '/proof/x'), env);
  assert.match(ev.id, /^EV-[0-9A-HJKMNP-TV-Z]{12}$/);
  assert.equal(ev.order_id, body.order_id);
  assert.equal(ev.token, token);
  assert.equal(ev.customer_name, 'Pat Customer');
  assert.equal(ev.customer_email, 'pat@example.com');
  assert.equal(ev.approved_at, NOW.toISOString());
  assert.equal(ev.ip, IP);
  assert.equal(ev.user_agent, UA);
  assert.equal(ev.proof_hash, await sha256Hex(PNG));
  assert.equal(JSON.parse(ev.proof_files_json)[0].url, PROOF_URL);
  assert.equal(ev.proof_version, 1);
  assert.equal(ev.terms_hash, terms.hash);
  assert.equal(ev.terms_hash, await sha256Hex(terms.text));
  assert.equal(ev.terms_version, 'October 27, 2026');
  assert.equal(ev.terms_url, 'https://getseensignsco.com/terms');
  assert.equal(ev.consent_text, CONSENT_TEXT);
  assert.equal(ev.subtotal_cents, SUBTOTAL);
  assert.equal(ev.record_hash, await recordHashOf(ev));

  const kept = one('SELECT * FROM terms_versions WHERE hash = ?', ev.terms_hash);
  assert.equal(kept.text, terms.text);
  assert.ok(kept.text.includes('Nothing goes to production until you approve the proof'));

  const order = one('SELECT * FROM orders');
  assert.equal(order.status, 'approved');
  assert.equal(order.approval_id, ev.id);
  assert.equal(order.checkout_session_id, 'cs_test_1');
  assert.ok(subjects().some((s) => /Proof approved/.test(s)));
});

test('approval evidence cannot be edited or deleted', async () => {
  await approvedOrder();
  assert.throws(() => env.DB.sqlite.prepare("UPDATE approvals SET ip = '1.1.1.1'").run(), /immutable/);
  assert.throws(() => env.DB.sqlite.prepare('DELETE FROM approvals').run(), /immutable/);
  assert.equal(one('SELECT ip FROM approvals').ip, IP);
});

test('one approval per order: a double click or a race records a single evidence row and one Checkout Session', async () => {
  const { token } = await createOrder();
  const results = await Promise.all([approve(token), approve(token), approve(token)]);
  assert.equal(one('SELECT COUNT(*) AS n FROM approvals').n, 1);
  assert.equal(net.stripe.length, 1);
  assert.equal(results.filter((r) => r.headers.get('Location') === 'https://checkout.stripe.com/c/pay/cs_test_1').length, 1);
  const again = await approve(token);
  assert.equal(again.status, 303);
  assert.equal(again.headers.get('Location'), BASE + '/order/' + token);
});

test('a post from another site is refused', async () => {
  const { token } = await createOrder();
  const res = await approve(token, {}, { Origin: 'https://evil.example' });
  assert.equal(res.status, 403);
  assert.equal(one('SELECT COUNT(*) AS n FROM approvals').n, 0);
  const ok = await approve(token, {}, { Origin: BASE });
  assert.equal(ok.status, 303);
});

// ---------- Stripe Checkout Session ----------

test('the Checkout Session carries tax, shipping, terms, metadata and automatic capture', async () => {
  const { body, token } = await createOrder();
  await approve(token);
  assert.equal(net.stripe.length, 1);
  const p = net.stripe[0].params;
  const ev = one('SELECT * FROM approvals');
  assert.equal(p.get('mode'), 'payment');
  assert.equal(p.get('automatic_tax[enabled]'), 'true');
  assert.equal(p.get('shipping_address_collection[allowed_countries][0]'), 'US');
  assert.equal(p.get('shipping_address_collection[allowed_countries][1]'), null);
  assert.equal(p.get('consent_collection[terms_of_service]'), 'required');
  assert.equal(p.get('payment_intent_data[capture_method]'), 'automatic');
  assert.equal(p.get('customer_email'), 'pat@example.com');
  assert.equal(p.get('client_reference_id'), body.order_id);
  assert.equal(p.get('success_url'), BASE + '/order/' + token + '?paid=1');
  assert.equal(p.get('cancel_url'), BASE + '/order/' + token);
  for (const prefix of ['metadata', 'payment_intent_data[metadata]']) {
    assert.equal(p.get(prefix + '[order_id]'), body.order_id, prefix);
    assert.equal(p.get(prefix + '[proof_evidence_id]'), ev.id, prefix);
    assert.equal(p.get(prefix + '[approved_at]'), NOW.toISOString(), prefix);
    assert.equal(p.get(prefix + '[proof_hash]'), ev.proof_hash, prefix);
    assert.equal(p.get(prefix + '[terms_hash]'), ev.terms_hash, prefix);
  }
  assert.equal(net.stripe[0].headers.Authorization, 'Bearer ' + env.STRIPE_SECRET_KEY);
  assert.ok(net.stripe[0].headers['Idempotency-Key']);
  const exp = Number(p.get('expires_at'));
  assert.ok(exp > NOW.getTime() / 1000 + 1800 && exp <= NOW.getTime() / 1000 + 86400);
});

test('test-mode keys bill the catalog amount with price_data; live keys use the saved Stripe Price IDs', async () => {
  let { token } = await createOrder();
  await approve(token);
  let p = net.stripe[0].params;
  assert.equal(p.get('line_items[0][price]'), null);
  assert.equal(p.get('line_items[0][price_data][unit_amount]'), '5900');
  assert.equal(p.get('line_items[0][price_data][tax_behavior]'), 'exclusive');
  assert.equal(p.get('line_items[0][price_data][product_data][name]'), 'Vinyl Banner (13 oz 3x6)');
  assert.equal(p.get('line_items[0][price_data][product_data][tax_code]'), 'txcd_20090028');
  assert.equal(p.get('line_items[0][quantity]'), '2');
  assert.equal(p.get('line_items[1][price_data][unit_amount]'), '14900');

  env = makeEnv({ STRIPE_SECRET_KEY: 'sk_live_unit_test_placeholder' });
  net.stripe.length = 0;
  ({ token } = await createOrder());
  await approve(token);
  p = net.stripe[0].params;
  assert.equal(p.get('line_items[0][price]'), CATALOG['banner-13oz-3x6'].priceId);
  assert.equal(p.get('line_items[0][quantity]'), '2');
  assert.equal(p.get('line_items[0][price_data][unit_amount]'), null);
  assert.equal(p.get('line_items[1][price]'), null, 'custom totals use price_data even with a live key');
  assert.equal(p.get('line_items[1][price_data][unit_amount]'), '14900');
});

test('a shipping line is billed with the shipping tax code', async () => {
  const { token } = await createOrder({ line_items: [{ sku: 'banner-13oz-2x4', quantity: 1 }, { sku: 'shipping', name: 'Shipping', quantity: 1, unit_amount_cents: 2500 }] });
  await approve(token);
  const p = net.stripe[0].params;
  assert.equal(p.get('line_items[1][price_data][product_data][tax_code]'), 'txcd_92010001');
  assert.equal(p.get('line_items[1][price_data][unit_amount]'), '2500');
});

test('when Stripe fails the approval still stands and the customer can retry from the order page; a live session is reused', async () => {
  const { token } = await createOrder();
  net.stripeFail = true;
  let res = await approve(token);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('Location'), BASE + '/order/' + token + '?payment=retry');
  assert.equal(one('SELECT status FROM orders').status, 'approved');
  assert.equal(one('SELECT COUNT(*) AS n FROM approvals').n, 1);

  const page = await (await orderRoute.onRequestGet({ request: new Request(BASE + '/order/' + token + '?payment=retry'), env, params: { token } })).text();
  assert.ok(page.includes('name="action" value="pay"'));
  assert.ok(page.includes('could not open the payment page'));

  net.stripeFail = false;
  res = await orderRoute.onRequestPost({ request: formReq('/order/' + token, { action: 'pay' }), env, params: { token }, now: NOW });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('Location'), 'https://checkout.stripe.com/c/pay/cs_test_1');
  res = await orderRoute.onRequestPost({ request: formReq('/order/' + token, { action: 'pay' }), env, params: { token }, now: NOW });
  assert.equal(res.headers.get('Location'), 'https://checkout.stripe.com/c/pay/cs_test_1');
  assert.equal(net.stripe.filter((c) => c.params.get('mode')).length, 2, 'one failed call and one good call, nothing more');
});

test('an expired session is replaced with a new one', async () => {
  const { token } = await createOrder();
  await approve(token);
  const later = new Date(NOW.getTime() + 25 * 3600 * 1000);
  const res = await orderRoute.onRequestPost({ request: formReq('/order/' + token, { action: 'pay' }), env, params: { token }, now: later });
  assert.equal(res.headers.get('Location'), 'https://checkout.stripe.com/c/pay/cs_test_2');
});

test('paying is refused for an order that was never approved', async () => {
  const { token } = await createOrder();
  const res = await orderRoute.onRequestPost({ request: formReq('/order/' + token, { action: 'pay' }), env, params: { token }, now: NOW });
  assert.equal(res.status, 409);
  assert.equal(net.stripe.length, 0);
});

// ---------- revisions ----------

test('three free revisions: each is stored, the shop is told, and the fourth is refused', async () => {
  const { body, token } = await createOrder();
  for (let v = 1; v <= 3; v++) {
    const res = await revise(token, { proof_version: String(v), comment: 'Change number ' + v });
    assert.equal(res.status, 200, 'revision ' + v);
    assert.equal(one('SELECT status FROM orders').status, 'revision_requested');
    const added = await adminProof.onRequestPost({ request: adminReq('POST', '/x', { proof_image_url: v % 2 ? PROOF_URL_2 : PROOF_URL }), env, params: { id: body.order_id }, now: NOW });
    assert.equal((await added.json()).proof_version, v + 1);
    assert.equal(one('SELECT status FROM orders').status, 'proof_sent');
  }
  assert.equal(one('SELECT revisions_used AS n FROM orders').n, 3);
  assert.equal(one('SELECT COUNT(*) AS n FROM revisions').n, 3);
  assert.equal(one('SELECT comment FROM revisions WHERE id = 2').comment, 'Change number 2');
  assert.equal(one('SELECT ip FROM revisions WHERE id = 1').ip, IP);
  assert.equal(emailsTo('sales@getseensignsco.com').length, 3);

  const fourth = await revise(token, { proof_version: '4' });
  assert.equal(fourth.status, 409);
  assert.match(await fourth.text(), /included revisions are used/);
  assert.equal(one('SELECT COUNT(*) AS n FROM revisions').n, 3);

  const page = await (await proofRoute.onRequestGet({ request: new Request(BASE + '/proof/' + token), env, params: { token } })).text();
  assert.ok(!page.includes('name="action" value="revise"'));
  assert.ok(page.includes('free revisions are used'));
  assert.ok(subjects().filter((s) => /updated|ready/.test(s)).length >= 4);
});

test('a revision needs a comment, a current proof, and an open proof', async () => {
  const { token } = await createOrder();
  assert.equal((await revise(token, { comment: ' ' })).status, 400);
  assert.equal((await revise(token, { proof_version: '9' })).status, 409);
  assert.equal(one('SELECT COUNT(*) AS n FROM revisions').n, 0);
  await revise(token);
  const again = await revise(token);
  assert.equal(again.status, 409, 'cannot request again while the first request is waiting on a new proof');
  assert.equal(one('SELECT revisions_used AS n FROM orders').n, 1);
});

test('after a revision the old proof version cannot be approved, the new one can', async () => {
  const { body, token } = await createOrder();
  await revise(token);
  const waiting = await approve(token);
  assert.equal(waiting.headers.get('Location'), BASE + '/order/' + token, 'order is waiting on a new proof, so approval just shows the order page');
  assert.equal(one('SELECT COUNT(*) AS n FROM approvals').n, 0);
  await adminProof.onRequestPost({ request: adminReq('POST', '/x', { proof_image_url: PROOF_URL_2 }), env, params: { id: body.order_id }, now: NOW });
  assert.equal((await approve(token, { proof_version: '1' })).status, 409);
  assert.equal((await approve(token, { proof_version: '2' })).status, 303);
  const ev = one('SELECT * FROM approvals');
  assert.equal(ev.proof_version, 2);
  assert.equal(JSON.parse(ev.proof_files_json)[0].url, PROOF_URL_2);
});

test('a new proof cannot be added once the order is approved', async () => {
  const { id } = await approvedOrder();
  const res = await adminProof.onRequestPost({ request: adminReq('POST', '/x', { proof_image_url: PROOF_URL_2 }), env, params: { id }, now: NOW });
  assert.equal(res.status, 409);
});

// ---------- webhook ----------

test('webhook signature check: good, wrong secret, stale, missing, tampered', async () => {
  const event = { id: 'evt_x', type: 'ping', data: { object: {} } };
  const raw = JSON.stringify(event);
  const ts = Math.floor(NOW.getTime() / 1000);
  const good = await signWebhook(raw, WEBHOOK_SECRET, ts);
  assert.deepEqual(await verifyWebhook(raw, good, WEBHOOK_SECRET, ts), event);
  await assert.rejects(verifyWebhook(raw, await signWebhook(raw, 'whsec_other', ts), WEBHOOK_SECRET, ts), /mismatch/);
  await assert.rejects(verifyWebhook(raw, await signWebhook(raw, WEBHOOK_SECRET, ts - 4000), WEBHOOK_SECRET, ts), /tolerance/);
  await assert.rejects(verifyWebhook(raw, '', WEBHOOK_SECRET, ts), /missing/);
  await assert.rejects(verifyWebhook(raw + ' ', good, WEBHOOK_SECRET, ts), /mismatch/);
  assert.deepEqual(await verifyWebhook(raw, 'v1=bad,' + good, WEBHOOK_SECRET, ts), event, 'any matching v1 is enough');
});

test('the webhook endpoint rejects unsigned and wrongly signed requests and changes nothing', async () => {
  const { id } = await approvedOrder();
  const event = sessionEvent({ id });
  let res = await webhook.onRequestPost({ request: new Request(BASE + '/api/stripe-webhook', { method: 'POST', body: JSON.stringify(event) }), env, now: NOW });
  assert.equal(res.status, 400);
  res = await webhook.onRequestPost({ request: await signed(event, 'whsec_wrong'), env, now: NOW });
  assert.equal(res.status, 400);
  res = await webhook.onRequestPost({ request: await webhookReq(event, { timestamp: 1000 }), env, now: NOW });
  assert.equal(res.status, 400);
  assert.equal(one('SELECT status FROM orders').status, 'approved');
  res = await webhook.onRequestPost({ request: await signed(event), env: Object.assign({}, env, { STRIPE_WEBHOOK_SECRET: '' }), now: NOW });
  assert.equal(res.status, 500, 'unconfigured endpoint never accepts');
});

test('checkout.session.completed marks the order paid once, stores shipping details, and emails once', async () => {
  const { id, token } = await approvedOrder();
  const before = net.brevo.length;
  let res = await webhook.onRequestPost({ request: await signed(sessionEvent({ id })), env, now: NOW });
  assert.equal(res.status, 200);
  const order = one('SELECT * FROM orders WHERE id = ?', id);
  assert.equal(order.status, 'paid');
  assert.equal(order.paid_at, NOW.toISOString());
  assert.equal(order.payment_intent_id, 'pi_test_1');
  assert.equal(order.amount_total_cents, SUBTOTAL + 700);
  assert.equal(order.amount_tax_cents, 700);
  assert.equal(JSON.parse(order.shipping_json).shipping.address.city, 'Auburn');
  assert.equal(net.brevo.length, before + 1);
  const mail = net.brevo.at(-1).body;
  assert.match(mail.subject, /Payment received/);
  assert.ok(mail.htmlContent.includes('$274.00'));
  assert.ok(mail.htmlContent.includes(BASE + '/order/' + token));

  res = await webhook.onRequestPost({ request: await signed(sessionEvent({ id })), env, now: NOW });
  assert.equal(res.status, 200);
  assert.equal(net.brevo.length, before + 1, 'a replayed event sends no second email');
  assert.equal(one('SELECT COUNT(*) AS n FROM emails WHERE kind = ?', 'payment_received').n, 1);
});

test('webhook ignores unpaid sessions, unknown orders and other events', async () => {
  const { id } = await approvedOrder();
  const before = net.brevo.length;
  for (const event of [
    sessionEvent({ id }, { payment_status: 'unpaid' }),
    sessionEvent({ id: 'GS-ZZZZZZZZ' }),
    { id: 'evt_o', type: 'payment_intent.created', data: { object: {} } },
  ]) {
    const res = await webhook.onRequestPost({ request: await signed(event), env, now: NOW });
    assert.equal(res.status, 200);
  }
  assert.equal(one('SELECT status FROM orders WHERE id = ?', id).status, 'approved');
  assert.equal(net.brevo.length, before);
});

test('a mail outage during the webhook does not fail it, and the next delivery retries the email', async () => {
  const { id } = await approvedOrder();
  net.brevoFail = true;
  let res = await webhook.onRequestPost({ request: await signed(sessionEvent({ id })), env, now: NOW });
  assert.equal(res.status, 200);
  assert.equal(one('SELECT status FROM orders').status, 'paid');
  net.brevoFail = false;
  const before = net.brevo.length;
  res = await webhook.onRequestPost({ request: await signed(sessionEvent({ id })), env, now: NOW });
  assert.equal(net.brevo.length, before + 1);
});

function disputeEvent(extra) {
  return {
    id: 'evt_dp',
    type: 'charge.dispute.created',
    data: { object: Object.assign({ id: 'dp_test_1', object: 'dispute', amount: 21500, currency: 'usd', charge: 'ch_test_1', payment_intent: 'pi_test_1', reason: 'fraudulent', status: 'needs_response', evidence_details: { due_by: 1793900000 } }, extra) },
  };
}

test('charge.dispute.created is logged with the stored evidence and the shop is alerted once', async () => {
  const { id } = await paidOrder();
  const logs = [];
  const orig = console.log;
  console.log = (line) => logs.push(line);
  try {
    let res = await webhook.onRequestPost({ request: await signed(disputeEvent()), env, now: NOW });
    assert.equal(res.status, 200);
    res = await webhook.onRequestPost({ request: await signed(disputeEvent()), env, now: NOW });
    assert.equal(res.status, 200);
  } finally {
    console.log = orig;
  }
  const d = one('SELECT * FROM disputes');
  assert.equal(d.id, 'dp_test_1');
  assert.equal(d.order_id, id);
  assert.equal(d.approval_id, one('SELECT id FROM approvals').id);
  assert.equal(d.reason, 'fraudulent');
  assert.equal(d.amount_cents, 21500);
  assert.equal(one('SELECT COUNT(*) AS n FROM disputes').n, 1);

  const entry = logs.map((l) => JSON.parse(l)).find((l) => l.event === 'dispute_created');
  assert.equal(entry.order, id);
  assert.equal(entry.evidence.ip, IP);
  assert.equal(entry.evidence.proof_hash, await sha256Hex(PNG));
  assert.equal(entry.evidence.approved_at, NOW.toISOString());

  const alerts = emailsTo('sales@getseensignsco.com').filter((m) => /Dispute/.test(m.body.subject));
  assert.equal(alerts.length, 1);
  assert.ok(alerts[0].body.textContent.includes(IP));
});

test('a dispute is matched through the charge metadata when the payment intent is unknown', async () => {
  const { id } = await approvedOrder();
  net.charges.ch_test_9 = { id: 'ch_test_9', metadata: { order_id: id } };
  const res = await webhook.onRequestPost({ request: await signed(disputeEvent({ id: 'dp_test_9', charge: 'ch_test_9', payment_intent: 'pi_unknown' })), env, now: NOW });
  assert.equal(res.status, 200);
  assert.equal(one('SELECT order_id FROM disputes WHERE id = ?', 'dp_test_9').order_id, id);
});

test('an unmatched dispute is still saved', async () => {
  const res = await webhook.onRequestPost({ request: await signed(disputeEvent({ payment_intent: 'pi_nobody', charge: 'ch_nobody' })), env, now: NOW });
  assert.equal(res.status, 200);
  assert.equal(one('SELECT order_id FROM disputes').order_id, null);
});

// ---------- tracking and status ----------

test('tracking is refused until the order is paid', async () => {
  const { body } = await createOrder();
  const res = await adminTracking.onRequestPost({ request: adminReq('POST', '/x', { carrier: 'UPS', tracking_number: '1Z999AA10123456784' }), env, params: { id: body.order_id }, now: NOW });
  assert.equal(res.status, 409);
});

test('adding tracking marks the order shipped, emails the customer, and shows on the status page', async () => {
  const { id, token } = await paidOrder();
  const bad = await adminTracking.onRequestPost({ request: adminReq('POST', '/x', { carrier: 'UPS', tracking_number: 'no' }), env, params: { id }, now: NOW });
  assert.equal(bad.status, 400);
  const res = await adminTracking.onRequestPost({ request: adminReq('POST', '/x', { carrier: 'UPS', tracking_number: '1Z 999 AA1 0123 456 784' }), env, params: { id }, now: NOW });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.status, 'shipped');
  assert.equal(body.shipment.tracking_number, '1Z999AA10123456784');
  assert.equal(body.shipment.tracking_url, 'https://www.ups.com/track?tracknum=1Z999AA10123456784');
  assert.deepEqual(body.email, { sent: true });
  const mail = net.brevo.at(-1).body;
  assert.match(mail.subject, /has shipped/);
  assert.ok(mail.htmlContent.includes('1Z999AA10123456784'));
  assert.ok(mail.textContent.includes('Carrier: UPS'));

  const page = await (await orderRoute.onRequestGet({ request: new Request(BASE + '/order/' + token), env, params: { token } })).text();
  assert.ok(page.includes('Shipped'));
  assert.ok(page.includes('1Z999AA10123456784'));
  assert.ok(page.includes('UPS'));
});

test('the order status page follows the order through each stage', async () => {
  const { id, token } = await createOrder().then((r) => ({ id: r.body.order_id, token: r.token }));
  const view = async (q) => (await orderRoute.onRequestGet({ request: new Request(BASE + '/order/' + token + (q || '')), env, params: { token } })).text();
  assert.ok((await view()).includes('Proof ready for your review'));
  await approve(token);
  const approvedPage = await view();
  assert.ok(approvedPage.includes('Proof approved, waiting for payment'));
  assert.ok(approvedPage.includes('name="action" value="pay"'));
  assert.ok((await view('?paid=1')).includes('http-equiv="refresh"'), 'refreshes while the payment is confirmed');
  await webhook.onRequestPost({ request: await signed(sessionEvent({ id })), env, now: NOW });
  const paidPage = await view('?paid=1');
  assert.ok(paidPage.includes('Paid, in production'));
  assert.ok(!paidPage.includes('http-equiv="refresh"'));
  assert.ok(!paidPage.includes('name="action" value="pay"'));
});

test('the proof link of an approved order shows the approval, not the form', async () => {
  const { token } = await approvedOrder();
  const page = await (await proofRoute.onRequestGet({ request: new Request(BASE + '/proof/' + token), env, params: { token } })).text();
  assert.ok(page.includes('You approved this proof on October 27, 2026'));
  assert.ok(!page.includes('name="agree"'));
});

// ---------- admin detail ----------

test('admin order detail returns the evidence record, its hash check, emails and a dispute packet', async () => {
  const { id } = await paidOrder();
  await webhook.onRequestPost({ request: await signed(disputeEvent()), env, now: NOW });
  const res = await adminOne.onRequestGet({ request: adminReq('GET', '/api/admin/orders/' + id), env, params: { id } });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.order.status, 'paid');
  assert.equal(body.evidence.record_hash_valid, true);
  assert.equal(body.evidence.ip, IP);
  assert.equal(body.evidence.terms_version, 'October 27, 2026');
  assert.equal(body.disputes.length, 1);
  assert.ok(body.emails.some((e) => e.kind === 'payment_received' && e.status === 'sent'));
  assert.ok(body.evidence_packet.includes('IP address: ' + IP));
  assert.ok(body.evidence_packet.includes('SHA-256 ' + (await sha256Hex(PNG))));
  const missing = await adminOne.onRequestGet({ request: adminReq('GET', '/x'), env, params: { id: 'GS-AAAAAAAA' } });
  assert.equal(missing.status, 404);
  const list = await (await adminOrders.onRequestGet({ request: adminReq('GET', '/api/admin/orders'), env })).json();
  assert.equal(list.orders.length, 1);
  assert.ok(!('token' in list.orders[0]), 'the list never exposes customer tokens');
});

// ---------- emails ----------

test('customer emails are branded for Get Seen Signs and leak no personal names, legal names or street address', async () => {
  const { id } = await paidOrder();
  await adminTracking.onRequestPost({ request: adminReq('POST', '/x', { carrier: 'USPS', tracking_number: '9400111899223197428490' }), env, params: { id }, now: NOW });
  const customerMails = net.brevo.filter((m) => !m.body.tags.includes('shop'));
  assert.ok(customerMails.length >= 4);
  for (const m of customerMails) {
    const all = m.body.htmlContent + '\n' + m.body.textContent + '\n' + m.body.subject;
    assert.ok(m.body.htmlContent.includes('#14161A') && m.body.htmlContent.includes('#FFD100'), 'brand colors');
    assert.ok(m.body.htmlContent.includes('https://getseensignsco.com/assets/brand/getseen-horizontal-for-dark-bg.png'), 'logo');
    assert.ok(all.includes('Get Seen Signs'));
    assert.ok(all.includes('Smiths Station, AL'));
    assert.ok(all.includes('(334) 232-9003') && all.includes('sales@getseensignsco.com') && all.includes('getseensignsco.com'));
    assert.doesNotMatch(all, /Veracity|\bdba\b|d\/b\/a|\bLLC\b|Scott|Shadow Wood|36877|trade name/i);
    assert.deepEqual(m.body.sender, { name: 'Get Seen Signs', email: 'sales@getseensignsco.com' });
  }
  assert.deepEqual(customerMails.map((m) => m.body.tags[1]), ['proof_ready', 'proof_approved', 'payment_received', 'shipped']);
});

test('the pages customers see leak no personal names, legal names or street address either', async () => {
  const { token } = await createOrder();
  const proofPage = await (await proofRoute.onRequestGet({ request: new Request(BASE + '/proof/' + token), env, params: { token } })).text();
  const orderPageHtml = await (await orderRoute.onRequestGet({ request: new Request(BASE + '/order/' + token), env, params: { token } })).text();
  for (const page of [proofPage, orderPageHtml]) {
    const main = page.slice(page.indexOf('<main'));
    assert.doesNotMatch(main, /Veracity|\bdba\b|d\/b\/a|\bLLC\b|Scott|Shadow Wood|36877|trade name/i);
    assert.ok(main.includes('(334) 232-9003'));
  }
});

test('every email kind renders, with plain-text alternatives', () => {
  const order = { id: 'GS-ABCDEFGH', customer_email: 'a@example.com', customer_name: '' };
  const items = [{ name: 'Vinyl Banner (13 oz 3x6)', quantity: 1, unit_amount_cents: 5900, description: '' }];
  const links = { proof: BASE + '/proof/t', order: BASE + '/order/t' };
  for (const [kind, extra] of [['proof_ready', { version: 2 }], ['proof_approved', {}], ['payment_received', { amountTotalCents: 6400 }], ['shipped', { shipment: { carrier: 'FedEx', tracking_number: '123456789012', tracking_url: '' } }]]) {
    const m = renderEmail(kind, Object.assign({ order, items, links }, extra));
    assert.ok(m.subject && m.html.startsWith('<!doctype html>') && m.text.length > 40, kind);
    assert.ok(m.text.startsWith('Hello,'), 'no name falls back to a plain greeting');
  }
  assert.throws(() => renderEmail('nope', { order, items, links }));
});

// ---------- schema, terms, secrets ----------

test('migrations/0001_orders.sql matches the schema the functions create', () => {
  const file = readFileSync(new URL('migrations/0001_orders.sql', root), 'utf8');
  for (const sql of SCHEMA) assert.ok(file.includes(sql + ';'), sql.slice(0, 70));
});

test('terms text extraction is stable and ignores markup, scripts and the surrounding page', () => {
  const page = '<html><head><title>x</title></head><body><nav>menu</nav><main class="doc"><h1>Terms</h1><p class="meta"><strong>Last updated:</strong> May 5, 2027</p><p>Tom &amp; Jerry<br>say&nbsp;hi</p><script>evil()</script></main><footer>foot</footer></body></html>';
  assert.equal(textOfMain(page), 'Terms\nLast updated: May 5, 2027\nTom & Jerry\nsay hi');
  assert.equal(versionLabel(textOfMain(page)), 'May 5, 2027');
  assert.equal(textOfMain('<p>no main</p>'), '');
});

test('the real /terms page yields a version label and a repeatable hash', async () => {
  const req = new Request(BASE + '/proof/x');
  const a = await readTerms(req, env);
  const b = await readTerms(req, env);
  assert.equal(a.hash, b.hash);
  assert.equal(a.version, 'October 27, 2026');
  assert.ok(a.text.includes('Everything is made to order'));
  await assert.rejects(readTerms(req, Object.assign({}, env, { ASSETS: { fetch: async () => new Response('x', { status: 500 }) } })));
});

test('no secret-looking values are committed in the order code or admin page', () => {
  const dirs = ['functions', 'admin'].map((d) => fileURLToPath(new URL(d, root)));
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  dirs.forEach(walk);
  assert.ok(files.length > 10);
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    assert.doesNotMatch(text, /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}/, f);
    assert.doesNotMatch(text, /\bwhsec_[A-Za-z0-9]{8,}/, f);
    assert.doesNotMatch(text, /\bxkeysib-[A-Za-z0-9]{8,}/, f);
  }
});
