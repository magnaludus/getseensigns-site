// POST /api/email-signup: the footer "Free proof + 10% off your first order" signup, saved in D1, synced to a
// Brevo list when one is configured, and welcomed by email. D1 is node:sqlite, Brevo is a fake fetch.
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as signup from '../../../functions/api/email-signup.js';
import { SIGNUP_SCHEMA } from '../../../functions/_lib/db.js';
import { installFetch, makeEnv } from './orders-helpers.mjs';

const NOW = new Date('2026-10-30T15:00:00Z');
const root = new URL('../../../', import.meta.url);
let net;
beforeEach(() => { signup.resetRateLimit(); net = installFetch(); });
afterEach(() => net.restore());

const mkEnv = (extra) => makeEnv(Object.assign({ ASSETS: undefined }, extra));
let visitors = 0;
const nextIp = () => '203.0.' + (++visitors >> 8) + '.' + (visitors & 255);
async function send(env, fields, ip) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(Object.assign({ elapsedMs: '9000' }, fields))) fd.set(k, v);
  const req = new Request('https://getseensignsco.com/api/email-signup', { method: 'POST', body: fd, headers: { 'cf-connecting-ip': ip || nextIp() } });
  const res = await signup.handle(req, env, NOW);
  return { res, body: await res.json() };
}
const rows = (env) => { try { return env.DB.sqlite.prepare('SELECT * FROM email_signups').all(); } catch (_) { return []; } };

test('a signup is saved once, lowercased, and welcomed without a code while no promo code is set', async () => {
  const env = mkEnv();
  const { res, body } = await send(env, { email: 'Pat@Example.com', source: '/shop/' });
  assert.equal(res.status, 200);
  assert.deepEqual([body.ok, body.already, body.synced, body.welcomed], [true, false, false, true]);
  const [row] = rows(env);
  assert.deepEqual([row.email, row.status, row.source, row.brevo_status, row.welcome_status, row.promo_code], ['pat@example.com', 'subscribed', '/shop/', 'not_configured', 'sent', '']);
  assert.ok(!Object.keys(row).some((k) => /ip|agent|cookie/i.test(k)));
  assert.equal(net.contacts.length, 0, 'no Brevo list call without BREVO_SIGNUP_LIST_ID');
  const mail = net.brevo[0].body;
  assert.deepEqual(mail.to, [{ email: 'pat@example.com' }]);
  assert.match(mail.textContent, /10% off code for your first order is on its way/);
  assert.match(mail.textContent, /free digital proof/);
  assert.doesNotMatch(mail.htmlContent + mail.textContent, /\u2014|Veracity|Scott|Smiths Station/);

  const again = await send(env, { email: 'pat@example.com' });
  assert.deepEqual([again.body.ok, again.body.already], [true, true]);
  assert.equal(rows(env).length, 1);
  assert.equal(net.brevo.length, 1, 'no second welcome email');
});

test('with a list id and a promo code set, the contact goes to the Brevo list and the welcome carries the code', async () => {
  const env = mkEnv({ BREVO_SIGNUP_LIST_ID: '7', SIGNUP_PROMO_CODE: 'first10' });
  const { body } = await send(env, { email: 'lee@example.com' });
  assert.deepEqual([body.synced, body.welcomed], [true, true]);
  assert.deepEqual(net.contacts[0].body, { email: 'lee@example.com', listIds: [7], updateEnabled: true });
  assert.equal(net.contacts[0].headers['api-key'], env.BREVO_API_KEY);
  const mail = net.brevo[0].body;
  assert.equal(mail.subject, 'Your 10% off code from Get Seen Signs');
  assert.ok(mail.textContent.includes('FIRST10'));
  const [row] = rows(env);
  assert.deepEqual([row.brevo_status, row.promo_code], ['synced', 'FIRST10']);
});

test('a Brevo list failure still keeps the address, and a failed welcome is retried on the next signup', async () => {
  const env = mkEnv({ BREVO_SIGNUP_LIST_ID: '7' });
  net.contactsFail = true;
  net.brevoFail = true;
  const first = await send(env, { email: 'kim@example.com' });
  assert.deepEqual([first.res.status, first.body.synced, first.body.welcomed], [200, false, false]);
  assert.deepEqual([rows(env)[0].brevo_status, rows(env)[0].welcome_status], ['failed', 'failed']);
  net.contactsFail = false;
  net.brevoFail = false;
  const second = await send(env, { email: 'kim@example.com' });
  assert.deepEqual([second.body.already, second.body.synced, second.body.welcomed], [true, true, true]);
  assert.deepEqual([rows(env)[0].brevo_status, rows(env)[0].welcome_status], ['synced', 'sent']);
});

test('bad emails, bots, a switched-off site and a flood are all handled', async () => {
  const env = mkEnv();
  const bad = await send(env, { email: 'not-an-email' });
  assert.deepEqual([bad.res.status, bad.body.fields], [400, ['email']]);
  const bot = await send(env, { email: 'bot@example.com', _gotcha: 'x' });
  assert.equal(bot.res.status, 200);
  const fast = await send(env, { email: 'fast@example.com', elapsedMs: '200' });
  assert.equal(fast.res.status, 200);
  assert.equal(rows(env).length, 0, 'bots are not stored');
  const off = await send(mkEnv({ DESIGN_PROOF_ENABLED: 'false' }), { email: 'x@example.com' });
  assert.equal(off.res.status, 503);
  const noDb = await send(mkEnv({ DB: undefined }), { email: 'x@example.com' });
  assert.equal(noDb.res.status, 503);
  const statuses = [];
  for (let i = 0; i < 8; i += 1) statuses.push((await send(env, { email: 'n' + i + '@example.com' }, '192.0.2.9')).res.status);
  assert.ok(statuses.includes(429));
});

test('a code that is not a plain code is ignored', () => {
  assert.equal(signup.promoCode({ SIGNUP_PROMO_CODE: 'first10' }), 'FIRST10');
  assert.equal(signup.promoCode({ SIGNUP_PROMO_CODE: '<b>x</b>' }), '');
  assert.equal(signup.promoCode({}), '');
});

test('GET /api/admin/email-signups lists signups and can show only the ones still waiting for a code', async () => {
  const { listHandler } = await import('../../../functions/api/admin/email-signups.js');
  const env = mkEnv();
  await send(env, { email: 'a@example.com' });
  env.SIGNUP_PROMO_CODE = 'FIRST10';
  await send(env, { email: 'b@example.com' });
  const all = await (await listHandler(new Request('https://getseensignsco.com/api/admin/email-signups'), env)).json();
  assert.deepEqual(all.signups.map((r) => r.email).sort(), ['a@example.com', 'b@example.com']);
  const waiting = await (await listHandler(new Request('https://getseensignsco.com/api/admin/email-signups?no_code=1'), env)).json();
  assert.deepEqual(waiting.signups.map((r) => r.email), ['a@example.com']);
});

test('migrations/0004_email_signups.sql matches the schema the function creates', () => {
  const sql = readFileSync(new URL('migrations/0004_email_signups.sql', root), 'utf8');
  for (const statement of SIGNUP_SCHEMA) assert.ok(sql.includes(statement + ';'), statement.slice(0, 70));
  assert.equal((sql.match(/CREATE /g) || []).length, SIGNUP_SCHEMA.length);
});

test('every page footer has the signup form posting to the endpoint, with a honeypot', () => {
  for (const file of ['index.html', 'shop/index.html', 'table-runners/index.html', 'event-booth-bundles/index.html', 'reorder/index.html']) {
    const page = readFileSync(new URL(file, root), 'utf8');
    assert.match(page, /<form class="signup js-form"[^>]*data-endpoint="\/api\/email-signup"/, file);
    assert.match(page, /name="_gotcha"/, file);
    assert.match(page, /Free proof \+ 10% off your first order/, file);
  }
});

test('no secret-looking values and no Veracity in the new endpoints', () => {
  for (const f of ['functions/api/email-signup.js', 'functions/api/reorder-request.js', 'functions/_lib/forms.js', 'functions/api/admin/email-signups.js', 'functions/api/admin/reorder-requests.js']) {
    const text = readFileSync(new URL(f, root), 'utf8');
    assert.doesNotMatch(text, /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}|xkeysib-[A-Za-z0-9]{8,}|Veracity/, f);
  }
});
