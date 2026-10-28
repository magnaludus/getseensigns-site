// POST /api/quote-request: the home page "Get a quote" form saved in D1 and emailed through Brevo.
// D1 is node:sqlite, Brevo is a fake fetch. No network, no real keys.
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as quote from '../../../functions/api/quote-request.js';
import { QUOTE_SCHEMA } from '../../../functions/_lib/db.js';
import { installFetch, makeEnv } from './orders-helpers.mjs';

const NOW = new Date('2026-10-28T15:00:00Z');
const root = new URL('../../../', import.meta.url);
let net;

beforeEach(() => {
  quote.resetRateLimit();
  net = installFetch();
});
afterEach(() => net.restore());

const mkEnv = (extra) => makeEnv(Object.assign({ ASSETS: undefined }, extra));
let visitors = 0;
const nextIp = () => '198.51.' + (++visitors >> 8) + '.' + (visitors & 255);
const good = (over) => Object.assign({ name: 'Pat Smith', email: 'Pat@Example.com', product: 'Vinyl Banner', quantity: '4', size: '3x6', needed_by: '2026-11-20', details: 'Grand opening banner.\nBlue and yellow.', elapsedMs: '45000' }, over);

async function send(env, fields, headers, as) {
  const body = as === 'urlencoded' ? new URLSearchParams(Object.entries(fields)) : (() => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.set(k, v); return fd; })();
  const req = new Request('https://getseensignsco.com/api/quote-request', { method: 'POST', body, headers: Object.assign({ 'cf-connecting-ip': nextIp(), cookie: 'a=b', 'user-agent': 'unit' }, headers) });
  const res = await quote.handle(req, env, NOW);
  return { res, body: await res.json() };
}
const rows = (env) => { try { return env.DB.sqlite.prepare('SELECT * FROM quote_requests').all(); } catch (_) { return []; } };
const shopMail = () => net.brevo.find((m) => !m.body.tags.includes('confirmation'));
const confirmMail = () => net.brevo.find((m) => m.body.tags.includes('confirmation'));

test('a quote is saved in D1, emailed to the shop with Reply-To the customer, and confirmed to the customer', async () => {
  const env = mkEnv();
  const { res, body } = await send(env, good());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.match(body.ref, /^QR-[0-9A-HJKMNP-TV-Z]{8}$/);
  assert.deepEqual([body.ok, body.emailed, body.stored, body.confirmed], [true, true, true, true]);

  const [row] = rows(env);
  assert.deepEqual([row.ref, row.status, row.customer_name, row.customer_email, row.product, row.quantity, row.size, row.needed_by, row.details], [body.ref, 'new', 'Pat Smith', 'Pat@Example.com', 'Vinyl Banner', '4', '3x6', '2026-11-20', 'Grand opening banner.\nBlue and yellow.']);
  assert.deepEqual([row.shop_email, row.customer_email_status, row.email_error], ['sent', 'sent', '']);
  assert.equal(row.created_at, NOW.toISOString());
  assert.ok(!Object.keys(row).some((k) => /ip|agent|cookie/i.test(k)), 'no IP, cookie or user agent column');

  const shop = shopMail().body;
  assert.deepEqual(shop.to, [{ email: 'sales@getseensignsco.com' }]);
  assert.deepEqual(shop.replyTo, { email: 'Pat@Example.com', name: 'Pat Smith' });
  assert.equal(shop.sender.email, 'sales@getseensignsco.com');
  assert.match(shop.subject, /^Quote request: Vinyl Banner \(Pat Smith\) QR-/);
  for (const line of ['Name: Pat Smith', 'Product: Vinyl Banner', 'Quantity: 4', 'Size: 3x6', 'Needed by: 2026-11-20', 'Grand opening banner.']) assert.ok(shop.textContent.includes(line), line);

  const mail = confirmMail().body;
  assert.deepEqual(mail.to, [{ email: 'Pat@Example.com', name: 'Pat Smith' }]);
  assert.equal(mail.subject, 'We got your quote request (reference ' + body.ref + ')');
  const all = mail.htmlContent + '\n' + mail.textContent;
  assert.ok(all.includes(body.ref));
  assert.match(mail.textContent, /usually within 1 business day/);
  assert.match(mail.textContent, /Nothing is charged for a quote/);
  assert.ok(mail.htmlContent.includes('getseensignsco.com') && mail.htmlContent.includes('Get Seen Signs'), 'shared branded layout');
  assert.ok(mail.textContent.includes('Smiths Station, AL'));
  assert.doesNotMatch(all, /Veracity|\bdba\b|d\/b\/a|\bLLC\b|Scott|Shadow Wood|36877|trade name|\u2014/i);
});

test('optional fields can be left out, and a URL-encoded form works too', async () => {
  const env = mkEnv();
  const { res, body } = await send(env, { name: 'Lee Jones', email: 'lee@example.com', product: 'Something else' }, {}, 'urlencoded');
  assert.equal(res.status, 200, JSON.stringify(body));
  const [row] = rows(env);
  assert.deepEqual([row.quantity, row.size, row.needed_by, row.details], ['', '', '', '']);
  assert.match(shopMail().body.textContent, /Quantity: -/);
});

test('bad input is answered with the names of the fields and nothing is stored or sent', async () => {
  const cases = [
    [{ name: '' }, ['name']],
    [{ name: 'P' }, ['name']],
    [{ email: 'not-an-email' }, ['email']],
    [{ email: '' }, ['email']],
    [{ product: '' }, ['product']],
    [{ quantity: 'lots' }, ['quantity']],
    [{ quantity: '0' }, ['quantity']],
    [{ quantity: '-3' }, ['quantity']],
    [{ needed_by: 'tomorrow' }, ['needed_by']],
    [{ needed_by: '2026-13-45' }, ['needed_by']],
    [{ name: '', email: 'x', product: '' }, ['name', 'email', 'product']],
  ];
  for (const [over, fields] of cases) {
    const env = mkEnv();
    const { res, body } = await send(env, good(over));
    assert.equal(res.status, 400, JSON.stringify(over));
    assert.deepEqual(body, { ok: false, error: 'fields', fields }, JSON.stringify(over));
    assert.equal(rows(env).length, 0);
  }
  assert.equal(net.brevo.length, 0);
});

test('long text is cut to its limits and control characters are removed', async () => {
  const env = mkEnv();
  const { res } = await send(env, good({ name: 'Pat\u0000Smith', details: 'x'.repeat(5000), size: 'y'.repeat(200), product: 'z'.repeat(500) }));
  assert.equal(res.status, 200);
  const [row] = rows(env);
  assert.equal(row.customer_name, 'Pat Smith');
  assert.equal(row.details.length, 3000);
  assert.equal(row.size.length, 60);
  assert.equal(row.product.length, 120);
});

test('the honeypot and a too-quick submit get a fake success and nothing is stored or sent', async () => {
  for (const over of [{ _gotcha: 'http://spam.example' }, { elapsedMs: '800' }]) {
    const env = mkEnv();
    const { res, body } = await send(env, good(over));
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.match(body.ref, /^QR-/);
    assert.equal(rows(env).length, 0);
  }
  assert.equal(net.brevo.length, 0);
});

test('a visitor is limited to 8 requests an hour, and the limit is per IP', async () => {
  const env = mkEnv();
  const ip = { 'cf-connecting-ip': '203.0.113.99' };
  for (let i = 0; i < 8; i++) assert.equal((await send(env, good(), ip)).res.status, 200, 'request ' + i);
  const over = await send(env, good(), ip);
  assert.equal(over.res.status, 429);
  assert.deepEqual(over.body, { ok: false, error: 'rate' });
  assert.equal(over.res.headers.get('Retry-After'), '3600');
  assert.equal((await send(env, good(), { 'cf-connecting-ip': '203.0.113.100' })).res.status, 200);
  assert.equal(rows(env).length, 9);
});

test('Brevo down: the request is still stored, the answer says it was not emailed, and the status is recorded', async () => {
  const env = mkEnv();
  net.brevoFail = true;
  const { res, body } = await send(env, good());
  assert.equal(res.status, 200);
  assert.deepEqual([body.ok, body.emailed, body.stored, body.confirmed], [true, false, true, false]);
  const [row] = rows(env);
  assert.equal(row.ref, body.ref);
  assert.deepEqual([row.shop_email, row.customer_email_status], ['failed', 'failed']);
  assert.match(row.email_error, /Brevo 401/);
});

test('if only the customer confirmation fails the shop is still told', async () => {
  const env = mkEnv();
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('brevo') && JSON.parse(init.body).tags.includes('confirmation')) return Response.json({ message: 'rejected' }, { status: 400 });
    return real(url, init);
  };
  const { body } = await send(env, good());
  assert.deepEqual([body.ok, body.emailed, body.confirmed], [true, true, false]);
  assert.deepEqual([rows(env)[0].shop_email, rows(env)[0].customer_email_status], ['sent', 'failed']);
});

test('on when DB and BREVO_API_KEY are set, off otherwise, and "false" is the off switch', async () => {
  const cases = [
    [{}, 200],
    [{ DESIGN_PROOF_ENABLED: 'true' }, 200],
    [{ DESIGN_PROOF_ENABLED: 'false' }, 503],
    [{ BREVO_API_KEY: undefined }, 503],
    [{ DB: undefined }, 503],
    [{ DB: undefined, DESIGN_PROOF_ENABLED: 'true' }, 503],
  ];
  for (const [extra, status] of cases) {
    const env = mkEnv(extra);
    const { res, body } = await send(env, good());
    assert.equal(res.status, status, JSON.stringify(extra));
    if (status === 503) assert.deepEqual(body, { ok: false, enabled: false });
  }
});

test('a database failure answers 500 storage and sends nothing', async () => {
  const env = mkEnv();
  env.DB = { prepare() { throw new Error('D1 is down'); }, batch() { throw new Error('D1 is down'); } };
  const { res, body } = await send(env, good());
  assert.equal(res.status, 500);
  assert.deepEqual(body, { ok: false, error: 'storage' });
  assert.equal(net.brevo.length, 0);
});

test('onRequestPost works as a Pages Function and a non-form body is a 400', async () => {
  const env = mkEnv();
  const fd = new FormData();
  for (const [k, v] of Object.entries(good())) fd.set(k, v);
  const res = await quote.onRequestPost({ request: new Request('https://getseensignsco.com/api/quote-request', { method: 'POST', body: fd, headers: { 'cf-connecting-ip': nextIp() } }), env, now: NOW });
  assert.equal(res.status, 200);
  const bad = await quote.onRequestPost({ request: new Request('https://getseensignsco.com/api/quote-request', { method: 'POST', body: '{"name":"x"}', headers: { 'content-type': 'application/json', 'cf-connecting-ip': nextIp() } }), env, now: NOW });
  assert.equal(bad.status, 400);
});

test('migrations/0003_quote_requests.sql matches the schema the function creates', () => {
  const sql = readFileSync(new URL('migrations/0003_quote_requests.sql', root), 'utf8');
  for (const statement of QUOTE_SCHEMA) assert.ok(sql.includes(statement + ';'), statement.slice(0, 70));
  assert.equal((sql.match(/CREATE /g) || []).length, QUOTE_SCHEMA.length);
});

test('the home page form posts to the endpoint, keeps the honeypot, and the page keeps mailto only as the error fallback', () => {
  const home = readFileSync(new URL('index.html', root), 'utf8');
  assert.match(home, /<form class="quote-form" id="quote-form" data-endpoint="\/api\/quote-request" data-mailto="sales@getseensignsco.com" novalidate>/);
  assert.ok(home.includes('name="_gotcha"'));
  const js = readFileSync(new URL('assets/site.js', root), 'utf8');
  assert.match(js, /res\.status===200&&j\.ok&&j\.emailed/);
  assert.match(js, /elapsedMs/);
  assert.doesNotMatch(js, /formspree|web3forms/i);
  const successBranch = js.slice(js.indexOf('res.status===200&&j.ok&&j.emailed'), js.indexOf('if(res.status===200&&j.ok){fallback'));
  assert.ok(!successBranch.includes('mailto') && !successBranch.includes('fallback('), 'a success never opens the email app');
});

test('no secret-looking values and no Veracity in the quote endpoint', () => {
  const text = readFileSync(new URL('functions/api/quote-request.js', root), 'utf8');
  assert.doesNotMatch(text, /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}|xkeysib-[A-Za-z0-9]{8,}|Veracity/);
});
