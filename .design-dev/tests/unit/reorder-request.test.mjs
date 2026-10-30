// POST /api/reorder-request: the /reorder/ page, saved in D1 and emailed to the shop through Brevo.
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as reorder from '../../../functions/api/reorder-request.js';
import { REORDER_SCHEMA } from '../../../functions/_lib/db.js';
import { installFetch, makeEnv } from './orders-helpers.mjs';

const NOW = new Date('2026-10-30T15:00:00Z');
const root = new URL('../../../', import.meta.url);
let net;
beforeEach(() => { reorder.resetRateLimit(); net = installFetch(); });
afterEach(() => net.restore());

const mkEnv = (extra) => makeEnv(Object.assign({ ASSETS: undefined }, extra));
let visitors = 0;
const nextIp = () => '198.18.' + (++visitors >> 8) + '.' + (visitors & 255);
const good = (over) => Object.assign({ org: 'Eagles Booster Club', name: 'Pat Smith', email: 'Pat@Example.com', phone: '(555) 010-2000', previous_order: 'GS-ABC123, spring banners', notes: 'Same as last time, 12 banners.\nNew year on them.', elapsedMs: '30000' }, over);
async function send(env, fields, ip) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const req = new Request('https://getseensignsco.com/api/reorder-request', { method: 'POST', body: fd, headers: { 'cf-connecting-ip': ip || nextIp() } });
  const res = await reorder.handle(req, env, NOW);
  return { res, body: await res.json() };
}
const rows = (env) => { try { return env.DB.sqlite.prepare('SELECT * FROM reorder_requests').all(); } catch (_) { return []; } };
const shopMail = () => net.brevo.find((m) => !m.body.tags.includes('confirmation'));
const confirmMail = () => net.brevo.find((m) => m.body.tags.includes('confirmation'));

test('a reorder is saved in D1, emailed to the shop with Reply-To the customer, and confirmed to the customer', async () => {
  const env = mkEnv();
  const { res, body } = await send(env, good());
  assert.equal(res.status, 200);
  assert.match(body.ref, reorder.REORDER_REF_RE);
  assert.deepEqual([body.ok, body.emailed, body.stored, body.confirmed], [true, true, true, true]);
  const [row] = rows(env);
  assert.deepEqual([row.ref, row.status, row.org_name, row.customer_name, row.customer_email, row.phone, row.previous_order, row.notes], [body.ref, 'new', 'Eagles Booster Club', 'Pat Smith', 'Pat@Example.com', '(555) 010-2000', 'GS-ABC123, spring banners', 'Same as last time, 12 banners.\nNew year on them.']);
  assert.deepEqual([row.shop_email, row.customer_email_status, row.email_error], ['sent', 'sent', '']);
  assert.ok(!Object.keys(row).some((k) => /ip|agent|cookie/i.test(k)));
  const shop = shopMail().body;
  assert.deepEqual(shop.to, [{ email: 'sales@getseensignsco.com' }]);
  assert.deepEqual(shop.replyTo, { email: 'Pat@Example.com', name: 'Pat Smith' });
  assert.equal(shop.subject, 'Reorder request: Eagles Booster Club ' + body.ref);
  for (const line of ['Organization: Eagles Booster Club', 'Previous order: GS-ABC123, spring banners', 'New year on them.']) assert.ok(shop.textContent.includes(line), line);
  const mail = confirmMail().body;
  assert.equal(mail.subject, 'We got your reorder request (reference ' + body.ref + ')');
  assert.doesNotMatch(mail.htmlContent + mail.textContent, /\u2014|Veracity|Scott|Smiths Station/);
});

test('organization, email and something to reorder are required; phone is checked when given', async () => {
  const env = mkEnv();
  const { res, body } = await send(env, { org: '', email: 'nope', phone: 'call me', elapsedMs: '30000' });
  assert.equal(res.status, 400);
  assert.deepEqual(body.fields, ['org', 'email', 'phone', 'previous_order']);
  const notesOnly = await send(env, { org: 'Acme Roofing', email: 'a@example.com', notes: 'The truck magnets again', elapsedMs: '30000' });
  assert.equal(notesOnly.res.status, 200);
  assert.equal(rows(env).length, 1);
});

test('a retry with the same attempt id answers with the same reference and does not email twice', async () => {
  const env = mkEnv();
  const attempt = 'a1b2c3d4e5f6a7b8c9d0e1f2';
  const one = await send(env, good({ attempt }));
  const two = await send(env, good({ attempt }));
  assert.equal(one.body.ref, two.body.ref);
  assert.equal(rows(env).length, 1);
  assert.equal(net.brevo.length, 2, 'one shop email and one confirmation');
});

test('bots get a fake success and nothing is kept; the form is off without D1 or when proofs are switched off', async () => {
  const env = mkEnv();
  assert.equal((await send(env, good({ _gotcha: 'x' }))).res.status, 200);
  assert.equal((await send(env, good({ elapsedMs: '100' }))).res.status, 200);
  assert.equal(rows(env).length, 0);
  assert.equal(net.brevo.length, 0);
  assert.equal((await send(mkEnv({ DB: undefined }), good())).res.status, 503);
  assert.equal((await send(mkEnv({ DESIGN_PROOF_ENABLED: 'false' }), good())).res.status, 503);
});

test('GET /api/admin/reorder-requests lists requests and can show only the ones the shop was not emailed about', async () => {
  const { listHandler } = await import('../../../functions/api/admin/reorder-requests.js');
  const env = mkEnv();
  await send(env, good({ org: 'Sent Ok' }));
  net.brevoFail = true;
  await send(env, good({ org: 'Mail Failed' }));
  const all = await (await listHandler(new Request('https://getseensignsco.com/api/admin/reorder-requests'), env)).json();
  assert.deepEqual(all.requests.map((r) => r.org_name).sort(), ['Mail Failed', 'Sent Ok']);
  const open = await (await listHandler(new Request('https://getseensignsco.com/api/admin/reorder-requests?needs_attention=1'), env)).json();
  assert.deepEqual(open.requests.map((r) => [r.org_name, r.shop_email]), [['Mail Failed', 'failed']]);
});

test('migrations/0005_reorder_requests.sql matches the schema the function creates', () => {
  const sql = readFileSync(new URL('migrations/0005_reorder_requests.sql', root), 'utf8');
  for (const statement of REORDER_SCHEMA) assert.ok(sql.includes(statement + ';'), statement.slice(0, 70));
  assert.equal((sql.match(/CREATE /g) || []).length, REORDER_SCHEMA.length);
});

test('the /reorder/ page posts to the endpoint with the honeypot and the fields the function reads', () => {
  const page = readFileSync(new URL('reorder/index.html', root), 'utf8');
  assert.match(page, /<form class="quote-form reorder-form js-form" data-endpoint="\/api\/reorder-request"/);
  for (const name of ['org', 'name', 'email', 'phone', 'previous_order', 'notes', '_gotcha']) assert.ok(page.includes(`name="${name}"`), name);
  assert.match(page, /<link rel="canonical" href="https:\/\/getseensignsco.com\/reorder\/">/);
  assert.ok(readFileSync(new URL('sitemap.xml', root), 'utf8').includes('<loc>https://getseensignsco.com/reorder/</loc>'));
});
