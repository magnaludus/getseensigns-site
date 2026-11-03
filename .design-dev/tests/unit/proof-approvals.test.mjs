// "Approve your proof" links: /approve/<token>/, the ship-to validation, the admin create and read endpoints,
// status changes, and the email to the shop.
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as page from '../../../functions/approve/[[path]].js';
import * as create from '../../../functions/api/admin/proof-approvals.js';
import * as detail from '../../../functions/api/admin/proof-approvals/[id].js';
import { APPROVAL_SCHEMA } from '../../../functions/_lib/db.js';
import { validateShipTo, normalizeState, normalizeZip, normalizePhone, APPROVAL_REF_RE, APPROVE_TEXT } from '../../../functions/_lib/proof-approvals.js';
import { TOKEN_RE } from '../../../functions/_lib/util.js';
import { installFetch, makeEnv, adminReq, formReq, NOW, IP, UA, BASE } from './orders-helpers.mjs';

const root = new URL('../../../', import.meta.url);
let net;
beforeEach(() => { net = installFetch(); });
afterEach(() => net.restore());

const LATER = new Date(NOW.getTime() + 3600 * 1000);
const PDF = 'https://proofs.example.com/gs/rhytec-tent-v2.pdf';
const PNG_URL = 'https://proofs.example.com/gs/banner.png';
const goodShip = (over) => Object.assign({ ship_name: 'Pat Smith', ship_company: 'Acme Roofing', ship_street1: '100 Main St', ship_street2: 'Suite 4', ship_city: 'Springfield', ship_state: 'IL', ship_zip: '62701', ship_phone: '(217) 555-0100', ship_email: 'pat@example.com' }, over);

async function makeLink(env, body) {
  const res = await create.onRequestPost({ request: adminReq('POST', '/api/admin/proof-approvals', Object.assign({ customer_name: 'Pat Smith', customer_email: 'pat@example.com', order_description: '1 x 10x10 canopy tent, full kit\n1 x 6 ft table throw', proof_url: PDF }, body)), env, now: NOW });
  const json = await res.json();
  return { res, json, token: json.approve_url ? json.approve_url.split('/')[4] : '' };
}
const get = (env, token, path) => page.onRequestGet({ request: new Request(BASE + (path || '/approve/' + token + '/')), env, params: { path: path ? path.split('/').slice(2) : [token, ''] } });
const post = (env, token, fields, headers, now) => page.onRequestPost({ request: formReq('/approve/' + token + '/', fields, headers), env, params: { path: [token, ''] }, now: now || LATER });
const row = (env) => env.DB.sqlite.prepare('SELECT * FROM proof_approvals').get();
// Visible text without the state dropdown (it lists every state, which is fine).
const visible = (text) => text.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<select[\s\S]*?<\/select>/g, '').replace(/<[^>]+>/g, ' ');

// ---------- validation ----------

test('US state: two-letter codes and full names are accepted, anything else is refused', () => {
  assert.equal(normalizeState('al'), 'AL');
  assert.equal(normalizeState('Texas'), 'TX');
  assert.equal(normalizeState('district of columbia'), 'DC');
  assert.equal(normalizeState('D.C.'), 'DC');
  for (const bad of ['', 'XX', 'Ontario', 'PR', 'US', 'Tex']) assert.equal(normalizeState(bad), '', bad);
});

test('ZIP: 5 or 9 digits, stored as 12345 or 12345-6789', () => {
  assert.equal(normalizeZip('62701'), '62701');
  assert.equal(normalizeZip('62701-1234'), '62701-1234');
  assert.equal(normalizeZip('627011234'), '62701-1234');
  assert.equal(normalizeZip(' 62701 1234 '), '62701-1234');
  for (const bad of ['', '6270', '627012', '62701-12', 'ABCDE', '62701-12345']) assert.equal(normalizeZip(bad), '', bad);
});

test('phone: 10 digits (a leading 1 is dropped), area code cannot start with 0 or 1', () => {
  assert.equal(normalizePhone('217-555-0100'), '(217) 555-0100');
  assert.equal(normalizePhone('+1 (217) 555 0100'), '(217) 555-0100');
  assert.equal(normalizePhone('2175550100'), '(217) 555-0100');
  for (const bad of ['', '555-0100', '21755501000', '(017) 555-0100', '(117) 555-0100', 'call me']) assert.equal(normalizePhone(bad), '', bad);
});

test('the ship-to needs every required field; company and street 2 are optional', () => {
  const ok = validateShipTo(goodShip({ ship_company: '', ship_street2: '', ship_state: 'illinois', ship_zip: '627011234', ship_phone: '1-217-555-0100' }));
  assert.deepEqual(ok.shipTo, { ship_name: 'Pat Smith', ship_company: '', ship_street1: '100 Main St', ship_street2: '', ship_city: 'Springfield', ship_state: 'IL', ship_zip: '62701-1234', ship_phone: '(217) 555-0100', ship_email: 'pat@example.com' });
  const bad = validateShipTo({ ship_state: 'ZZ', ship_zip: '123', ship_phone: '555', ship_email: 'nope' });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['ship_city', 'ship_email', 'ship_name', 'ship_phone', 'ship_state', 'ship_street1', 'ship_zip']);
  assert.equal(bad.errors.ship_zip, 'Enter a 5 or 9 digit ZIP code.');
  assert.equal(bad.errors.ship_phone, 'Enter a 10 digit phone number.');
  assert.equal(bad.errors.ship_state, 'Pick a US state.');
});

// ---------- admin create and read ----------

test('the admin endpoints answer 401 without the token and 503 when ADMIN_TOKEN is unset', async () => {
  const env = makeEnv();
  assert.equal((await create.onRequestPost({ request: adminReq('POST', '/api/admin/proof-approvals', {}, null), env })).status, 401);
  assert.equal((await create.onRequestPost({ request: adminReq('POST', '/api/admin/proof-approvals', {}, 'wrong-token-0123456789'), env })).status, 401);
  assert.equal((await detail.onRequestGet({ request: adminReq('GET', '/api/admin/proof-approvals/PA-00000000', undefined, null), env, params: { id: 'PA-00000000' } })).status, 401);
  assert.equal((await create.onRequestGet({ request: adminReq('GET', '/api/admin/proof-approvals'), env: makeEnv({ ADMIN_TOKEN: '' }) })).status, 503);
});

test('creating a link returns an unguessable /approve/<token>/ link and a PA- reference, and emails nobody', async () => {
  const env = makeEnv();
  const { res, json, token } = await makeLink(env);
  assert.equal(res.status, 201);
  assert.match(json.ref, APPROVAL_REF_RE);
  assert.equal(json.status, 'sent');
  assert.match(token, TOKEN_RE);
  assert.equal(json.approve_url, BASE + '/approve/' + token + '/');
  const r = row(env);
  assert.deepEqual([r.ref, r.token, r.status, r.customer_name, r.proof_url, r.approved_at, r.ship_name], [json.ref, token, 'sent', 'Pat Smith', PDF, null, '']);
  assert.equal(net.brevo.length, 0);
  const second = await makeLink(env);
  assert.notEqual(second.token, token);
});

test('creating a link checks the customer, the order description and an https proof link', async () => {
  const env = makeEnv();
  for (const [body, error] of [
    [{ customer_name: '' }, 'customer_name is required'],
    [{ order_description: ' ' }, 'order_description is required'],
    [{ proof_url: 'http://proofs.example.com/a.pdf' }, 'proof_url must be an https link to the proof image or PDF'],
    [{ proof_url: 'javascript:alert(1)' }, 'proof_url must be an https link to the proof image or PDF'],
    [{ customer_email: 'nope' }, 'customer_email is not a valid email address'],
  ]) {
    const { res, json } = await makeLink(env, body);
    assert.equal(res.status, 400, error);
    assert.equal(json.error, error);
  }
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM proof_approvals').get().n, 0);
});

test('the admin read endpoint finds a record by reference or token, and the list filters by status', async () => {
  const env = makeEnv();
  const { json, token } = await makeLink(env);
  for (const id of [json.ref, token]) {
    const res = await detail.onRequestGet({ request: adminReq('GET', '/api/admin/proof-approvals/' + id), env, params: { id } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.approval.ref, json.ref);
    assert.equal(body.approval.approve_url, json.approve_url);
  }
  const miss = await detail.onRequestGet({ request: adminReq('GET', '/api/admin/proof-approvals/PA-00000000'), env, params: { id: 'PA-00000000' } });
  assert.equal(miss.status, 404);
  const list = await (await create.onRequestGet({ request: adminReq('GET', '/api/admin/proof-approvals?status=approved'), env })).json();
  assert.deepEqual(list.approvals, []);
  const all = await (await create.onRequestGet({ request: adminReq('GET', '/api/admin/proof-approvals'), env })).json();
  assert.deepEqual(all.approvals.map((a) => a.ref), [json.ref]);
  assert.ok(!('token' in all.approvals[0]), 'the list does not carry the link token');
});

// ---------- token lookup and the page ----------

test('an unknown, malformed or extra-segment token gets a 404 page', async () => {
  const env = makeEnv();
  await makeLink(env);
  assert.equal((await get(env, 'A'.repeat(43))).status, 404);
  assert.equal((await get(env, 'short')).status, 404);
  assert.equal((await get(env, "' OR 1=1 --")).status, 404);
  assert.equal((await get(env, null, '/approve/a/b')).status, 404);
  assert.equal((await post(env, 'A'.repeat(43), goodShip({ approve: 'yes', action: 'approve' }))).status, 404);
});

test('the page shows the customer, the proof and the order, is noindex and never cached, with and without the slash', async () => {
  const env = makeEnv();
  const { token } = await makeLink(env);
  for (const path of ['/approve/' + token + '/', '/approve/' + token]) {
    const res = await get(env, token, path);
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    assert.match(res.headers.get('X-Robots-Tag'), /noindex/);
    assert.equal(res.headers.get('X-Frame-Options'), 'DENY');
    const text = await res.text();
    assert.match(text, /<meta name="robots" content="noindex,nofollow">/);
    assert.ok(text.includes('Hi Pat.'));
    assert.ok(text.includes('href="' + PDF + '"') && text.includes('Open your proof (PDF)'));
    assert.ok(text.includes('1 x 10x10 canopy tent, full kit<br>1 x 6 ft table throw'));
    assert.ok(text.includes(APPROVE_TEXT));
    assert.ok(text.includes('action="/approve/' + token + '/"'));
  }
});

test('an image proof is shown inline; the form uses standard shipping autocomplete and required fields', async () => {
  const env = makeEnv();
  const { token } = await makeLink(env, { proof_url: PNG_URL });
  const text = await (await get(env, token)).text();
  assert.ok(text.includes('<img src="' + PNG_URL + '"'));
  for (const [name, auto] of [['ship_name', 'shipping name'], ['ship_company', 'shipping organization'], ['ship_street1', 'shipping address-line1'], ['ship_street2', 'shipping address-line2'], ['ship_city', 'shipping address-level2'], ['ship_state', 'shipping address-level1'], ['ship_zip', 'shipping postal-code'], ['ship_phone', 'shipping tel'], ['ship_email', 'email']]) {
    const tag = new RegExp('<(input|select)[^>]*name="' + name + '"[^>]*>').exec(text);
    assert.ok(tag, name);
    assert.ok(tag[0].includes('autocomplete="' + auto + '"'), name);
    assert.equal(/\brequired\b/.test(tag[0]), !['ship_company', 'ship_street2'].includes(name), name);
  }
  assert.match(text, /<input type="tel"[^>]*name="ship_phone"/);
  assert.match(text, /<input type="email"[^>]*name="ship_email"[^>]*value="pat@example.com"/);
  assert.match(text, /name="ship_zip"[^>]*inputmode="numeric"/);
  assert.match(text, /<option value="DC">District of Columbia<\/option>/);
  assert.match(text, /value="changes" formnovalidate/);
});

test('the page names no city, area or person, and uses no em dash', async () => {
  const env = makeEnv();
  const { token } = await makeLink(env);
  const open = await (await get(env, token)).text();
  await post(env, token, goodShip({ approve: 'yes', action: 'approve' }));
  const done = await (await get(env, token)).text();
  for (const text of [open, done].map(visible)) {
    assert.doesNotMatch(text, /Smiths Station|Lee County|Columbus|Phenix|Auburn|Opelika|Alabama|Georgia|Scott|Veracity|—/);
  }
  const src = readFileSync(new URL('functions/_lib/proof-approvals.js', root), 'utf8') + readFileSync(new URL('functions/approve/[[path]].js', root), 'utf8');
  assert.doesNotMatch(src, /Smiths Station|Lee County|Columbus|Phenix|Opelika|Veracity|—/);
});

// ---------- status changes ----------

test('approving needs the checkbox and a complete ship-to; errors keep what was typed and change nothing', async () => {
  const env = makeEnv();
  const { token } = await makeLink(env);
  const res = await post(env, token, goodShip({ ship_zip: '1234', ship_phone: '555-0100', action: 'approve', notes: 'Ship before Friday' }));
  assert.equal(res.status, 400);
  const text = await res.text();
  for (const msg of ['Enter a 5 or 9 digit ZIP code.', 'Enter a 10 digit phone number.', 'Tick the box to approve the proof.']) assert.ok(text.includes(msg), msg);
  assert.match(text, /name="ship_zip" value="1234"[^>]*aria-invalid="true"/);
  assert.ok(text.includes('Ship before Friday'));
  assert.ok(text.includes('value="100 Main St"'));
  const r = row(env);
  assert.deepEqual([r.status, r.ship_name, r.approved_at, r.notes], ['sent', '', null, '']);
  assert.equal(net.brevo.length, 0);
});

test('approving saves the ship-to, time, IP and user agent, emails sales@ and shows the thank-you page', async () => {
  const env = makeEnv();
  const { json, token } = await makeLink(env);
  const res = await post(env, token, goodShip({ ship_state: 'Illinois', ship_zip: '627011234', ship_phone: '217.555.0100', approve: 'yes', action: 'approve', notes: 'Leave at the side door' }));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('Location'), '/approve/' + token + '/');
  const r = row(env);
  assert.deepEqual(
    [r.status, r.ship_name, r.ship_company, r.ship_street1, r.ship_street2, r.ship_city, r.ship_state, r.ship_zip, r.ship_phone, r.ship_email, r.notes, r.approve_text, r.approved_at, r.ip, r.user_agent, r.shop_email],
    ['approved', 'Pat Smith', 'Acme Roofing', '100 Main St', 'Suite 4', 'Springfield', 'IL', '62701-1234', '(217) 555-0100', 'pat@example.com', 'Leave at the side door', APPROVE_TEXT, LATER.toISOString(), IP, UA, 'sent']
  );
  assert.equal(net.brevo.length, 1);
  const mail = net.brevo[0].body;
  assert.deepEqual(mail.to, [{ email: 'sales@getseensignsco.com' }]);
  assert.equal(mail.subject, 'Proof approved with ship-to: Pat Smith (' + json.ref + ')');
  for (const line of ['Approved at: ' + LATER.toISOString(), 'Acme Roofing', '100 Main St', 'Suite 4', 'Springfield, IL 62701-1234', 'Phone: (217) 555-0100', 'Email: pat@example.com', 'Customer notes: Leave at the side door', 'Proof: ' + PDF]) {
    assert.ok(mail.textContent.includes(line), line);
  }
  const thanks = await (await get(env, token)).text();
  assert.ok(thanks.includes('Thanks, your proof is approved'));
  assert.ok(thanks.includes('Your invoice is coming by email.'));
  assert.ok(thanks.includes('Springfield, IL 62701-1234'));
  assert.ok(!thanks.includes('<form'), 'no form once approved');
});

test('Request changes saves the notes without approving, emails sales@, and the proof can still be approved after', async () => {
  const env = makeEnv();
  const { json, token } = await makeLink(env);
  const empty = await post(env, token, { action: 'changes', notes: '   ' });
  assert.equal(empty.status, 400);
  assert.ok((await empty.text()).includes('Tell us what to change.'));
  assert.equal(row(env).status, 'sent');

  const res = await post(env, token, { action: 'changes', notes: 'Make the phone number bigger.\nUse the navy logo.' });
  assert.equal(res.status, 303);
  let r = row(env);
  assert.deepEqual([r.status, r.notes, r.changes_requested_at, r.approved_at, r.ship_name], ['changes_requested', 'Make the phone number bigger.\nUse the navy logo.', LATER.toISOString(), null, '']);
  assert.equal(net.brevo.length, 1);
  assert.equal(net.brevo[0].body.subject, 'Changes requested: Pat Smith (' + json.ref + ')');
  assert.ok(net.brevo[0].body.textContent.includes('Use the navy logo.'));
  const text = await (await get(env, token)).text();
  assert.ok(text.includes('We got your change request'));
  assert.ok(text.includes('<form'));

  await post(env, token, goodShip({ approve: 'yes', action: 'approve' }));
  r = row(env);
  assert.equal(r.status, 'approved');
  assert.equal(r.notes, 'Make the phone number bigger.\nUse the navy logo.', 'an empty notes box on approval keeps the earlier notes');
});

test('approved is final: later posts do not change the record or email again', async () => {
  const env = makeEnv();
  const { token } = await makeLink(env);
  await post(env, token, goodShip({ approve: 'yes', action: 'approve' }));
  const before = row(env);
  for (const fields of [{ action: 'changes', notes: 'Actually change it' }, goodShip({ ship_city: 'Elsewhere', approve: 'yes', action: 'approve' })]) {
    const res = await post(env, token, fields, {}, new Date(LATER.getTime() + 60000));
    assert.equal(res.status, 303);
  }
  assert.deepEqual(row(env), before);
  assert.equal(net.brevo.length, 1);
});

test('a post from another site is refused, and an unknown action changes nothing', async () => {
  const env = makeEnv();
  const { token } = await makeLink(env);
  assert.equal((await post(env, token, goodShip({ approve: 'yes', action: 'approve' }), { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post(env, token, goodShip({ approve: 'yes', action: 'delete' }))).status, 400);
  assert.equal(row(env).status, 'sent');
});

test('a failed shop email still saves the approval and marks shop_email failed', async () => {
  const env = makeEnv();
  net.brevoFail = true;
  const { token } = await makeLink(env);
  const res = await post(env, token, goodShip({ approve: 'yes', action: 'approve' }));
  assert.equal(res.status, 303);
  const r = row(env);
  assert.equal(r.status, 'approved');
  assert.equal(r.shop_email, 'failed');
  assert.match(r.email_error, /Brevo 401/);
});

test('migrations/0006_proof_approvals.sql matches the schema the function creates', () => {
  const sql = readFileSync(new URL('migrations/0006_proof_approvals.sql', root), 'utf8');
  for (const statement of APPROVAL_SCHEMA) assert.ok(sql.includes(statement + ';'), statement.slice(0, 70));
  assert.equal((sql.match(/CREATE /g) || []).length, APPROVAL_SCHEMA.length);
});

