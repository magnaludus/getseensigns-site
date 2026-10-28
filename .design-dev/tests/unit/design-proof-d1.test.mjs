// POST /api/design-proof with D1 for storage and Brevo for email (no R2, no Email Routing), plus the way
// those mix with the older bindings. D1 is node:sqlite, Brevo is a fake fetch. No network, no real keys.
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadEnv } from './helpers.mjs';
import { createDocument, setQty } from '../../../assets/design/model/document.js';
import * as proof from '../../../functions/api/design-proof.js';
import * as adminList from '../../../functions/api/admin/design-proofs.js';
import * as adminOne from '../../../functions/api/admin/design-proofs/[ref].js';
import * as adminFile from '../../../functions/api/admin/design-proofs/[ref]/[file].js';
import { DESIGN_SCHEMA } from '../../../functions/_lib/db.js';
import { sha256Hex } from '../../../functions/_lib/util.js';
import { DEPS, fakeR2, fakeMail, bytesOf, pngFile, file, formOf, postOf, spyConsole, readMime } from './functions-helpers.mjs';
import { fakeD1, installFetch, makeEnv, adminReq, ADMIN } from './orders-helpers.mjs';

const designEnv = loadEnv();
const NOW = new Date('2026-10-28T03:30:00Z');
const root = new URL('../../../', import.meta.url);
let net;

beforeEach(() => {
  proof.resetRateLimit();
  net = installFetch();
});
afterEach(() => net.restore());

const canopyDoc = (qty) => setQty(createDocument(designEnv, 'canopy'), 0, qty || 2);
const goodRequest = (over) => Object.assign({ name: 'Pat Smith', email: 'pat@example.com', phone: '334-555-0100', eventDate: '2026-11-14', notes: 'Please make the logo bigger.', mode: 'self', source: 'design', viewport: 'd', clientTotal: null, elapsedMs: 45000, hear: 'a friend' }, over);
const okParts = (over) => Object.assign({ design: canopyDoc(2), request: goodRequest(), previews: [pngFile(0, 50000)] }, over);

// D1 and Brevo only: the setup the shop uses.
const mkEnv = (extra) => Object.assign(makeEnv({ ASSETS: undefined, ADMIN_TOKEN: ADMIN }), extra);
let visitors = 0;
const nextIp = () => '198.19.' + (++visitors >> 8) + '.' + (visitors & 255);

async function send(env, parts, headers) {
  const res = await proof.handle(postOf(formOf(parts), Object.assign({ 'cf-connecting-ip': nextIp() }, headers)), env, NOW, DEPS);
  return { res, body: await res.json() };
}

const one = (env, sql, ...p) => env.DB.sqlite.prepare(sql).get(...p);
const rows = (env, sql, ...p) => env.DB.sqlite.prepare(sql).all(...p);
const shopMail = () => net.brevo.find((m) => m.body.tags.includes('design-proof') && !m.body.tags.includes('confirmation'));
const confirmMail = () => net.brevo.find((m) => m.body.tags.includes('confirmation'));
const requestCount = (env) => { try { return rows(env, 'SELECT * FROM design_proof_requests').length; } catch (_) { return 0; } };
const b64 = (bytes) => Buffer.from(bytes).toString('base64');

test('on when DB and BREVO_API_KEY are set, off otherwise, and "false" is the off switch', async () => {
  const cases = [
    [{}, 200],
    [{ DESIGN_PROOF_ENABLED: 'true' }, 200],
    [{ DESIGN_PROOF_ENABLED: 'false' }, 503],
    [{ DESIGN_PROOF_ENABLED: 'TRUE' }, 200],
    [{ BREVO_API_KEY: undefined }, 503],
    [{ DB: undefined }, 503],
    [{ DB: undefined, BREVO_API_KEY: undefined }, 503],
  ];
  for (const [extra, status] of cases) {
    const env = mkEnv(extra);
    const { res, body } = await send(env, okParts());
    assert.equal(res.status, status, JSON.stringify(Object.keys(extra)) + ' ' + JSON.stringify(extra.DESIGN_PROOF_ENABLED));
    if (status === 503) assert.deepEqual(body, { ok: false, enabled: false });
  }
});

test('forced on with no storage at all answers 500 storage', async () => {
  const { res, body } = await send(mkEnv({ DESIGN_PROOF_ENABLED: 'true', DB: undefined }), okParts());
  assert.equal(res.status, 500);
  assert.deepEqual(body, { ok: false, error: 'storage' });
});

test('a request is saved in D1 and emailed to the shop through Brevo with the files attached', async () => {
  const env = mkEnv();
  const logo = file(bytesOf('png', 20000), 'acme logo.png', 'image/png');
  const { res, body } = await send(env, okParts({ previews: [pngFile(0, 50000), pngFile(1, 60000)], logos: [logo] }));
  assert.equal(res.status, 200);
  assert.match(body.ref, /^GS-[0-9A-HJKMNP-TV-Z]{8}$/);
  assert.equal(body.ok, true);
  assert.equal(body.emailed, true, 'the page shows its success only when emailed is true');
  assert.equal(body.confirmed, true);
  assert.equal(body.stored, true);

  const row = one(env, 'SELECT * FROM design_proof_requests WHERE ref = ?', body.ref);
  assert.equal(row.status, 'new');
  assert.equal(row.created_at, NOW.toISOString());
  assert.equal(row.customer_email, 'pat@example.com');
  assert.equal(row.shop_email, 'sent');
  assert.equal(row.customer_email_status, 'sent');
  const request = JSON.parse(row.request_json);
  assert.equal(request.name, 'Pat Smith');
  assert.equal(request.notes, 'Please make the logo bigger.');
  assert.equal(request.mode, 'self');
  assert.equal(request.ref, body.ref);
  assert.equal(JSON.parse(row.design_json).project.pieces[0].productId, 'canopy');
  const files = JSON.parse(row.files_json);
  assert.deepEqual(files.map((f) => [f.name, f.attached, f.saved]), [['preview-0.png', true, 'none'], ['preview-1.png', true, 'none'], ['logo-0.png', true, 'none']]);
  assert.equal(files[0].sha256, await sha256Hex(bytesOf('png', 50000)));
  assert.equal(rows(env, 'SELECT * FROM design_proof_files').length, 0, 'nothing that fit in the email is copied into D1');
  assert.doesNotMatch(row.request_json, /203\.0\.113|secret-cookie|test browser/, 'no IP, cookie or user agent');

  const mail = shopMail().body;
  assert.deepEqual(mail.sender, { name: 'Get Seen Signs', email: 'sales@getseensignsco.com' });
  assert.deepEqual(mail.to, [{ email: 'sales@getseensignsco.com' }]);
  assert.deepEqual(mail.replyTo, { email: 'pat@example.com', name: 'Pat Smith' });
  assert.equal(mail.subject, 'Design proof request: Canopy tent (Pat Smith) ' + body.ref);
  assert.deepEqual(mail.attachment.map((a) => a.name), ['preview-0.png', 'preview-1.png', 'logo-0.png']);
  assert.equal(mail.attachment[0].content, b64(bytesOf('png', 50000)));
  assert.equal(shopMail().headers['api-key'], env.BREVO_API_KEY);
  for (const line of ['Reference: ' + body.ref, 'Name: Pat Smith', 'Email: pat@example.com', 'Attached: preview-0.png, preview-1.png, logo-0.png', 'Saved in D1: design_proof_requests, ref ' + body.ref]) {
    assert.ok(mail.textContent.split('\n').includes(line), line + '\n' + mail.textContent);
  }
  assert.ok(!mail.textContent.includes('R2'));
});

test('the customer gets a short Get Seen Signs confirmation with the reference and the 12 hour promise', async () => {
  const env = mkEnv();
  const { body } = await send(env, okParts());
  const mail = confirmMail().body;
  assert.deepEqual(mail.sender, { name: 'Get Seen Signs', email: 'sales@getseensignsco.com' });
  assert.deepEqual(mail.to, [{ email: 'pat@example.com', name: 'Pat Smith' }]);
  assert.deepEqual(mail.replyTo, { email: 'sales@getseensignsco.com', name: 'Get Seen Signs' });
  assert.equal(mail.subject, 'We got your proof request (reference ' + body.ref + ')');
  const all = mail.htmlContent + '\n' + mail.textContent;
  assert.ok(all.includes(body.ref));
  assert.match(mail.textContent, /within 12 hours, 7 days a week/);
  assert.match(mail.textContent, /nothing prints until you approve/i);
  assert.ok(all.includes('Smiths Station, AL') && all.includes('(334) 232-9003') && all.includes('#14161A') && all.includes('#FFD100'));
  assert.doesNotMatch(all, /Veracity|\bdba\b|d\/b\/a|\bLLC\b|Scott|Shadow Wood|36877|trade name/i);
  assert.ok(!mail.attachment, 'the confirmation carries no attachments');
  assert.equal(net.brevo.length, 2, 'one email to the shop, one to the customer');
});

test('"Rather we design it" works the same way, with no design or previews', async () => {
  const env = mkEnv();
  const { res, body } = await send(env, {
    request: goodRequest({ mode: 'design_for_me', designForMe: { products: ['canopy', 'Feather flag'], wording: 'ACME FENCE since 1999', siteUrl: 'https://acme.example' } }),
    logos: [file(bytesOf('png', 5000), 'acme.png', 'image/png')],
  });
  assert.equal(res.status, 200);
  assert.equal(body.emailed, true);
  const row = one(env, 'SELECT * FROM design_proof_requests WHERE ref = ?', body.ref);
  assert.equal(row.mode, 'design_for_me');
  assert.equal(row.design_json, null);
  assert.deepEqual(JSON.parse(row.request_json).designForMe.products, ['canopy', 'feather']);
  const mail = shopMail().body;
  assert.match(mail.textContent, /Mode: Design it for me/);
  assert.match(mail.textContent, /Wording: ACME FENCE since 1999/);
  assert.equal(mail.attachment.length, 1);
  assert.match(confirmMail().body.textContent, /We will design it for you/);
});

test('files over the 3 MB email limit are attached while they fit, the rest are saved in D1 in chunks and can be downloaded', async () => {
  const env = mkEnv();
  const big = bytesOf('png', 2500000);
  const second = bytesOf('png', 1900000);
  const small = bytesOf('png', 100000);
  const { body } = await send(env, okParts({ previews: [file(big, 'preview-0.png', 'image/png'), file(second, 'preview-1.png', 'image/png')], logos: [file(small, 'logo.png', 'image/png')] }));
  assert.equal(body.emailed, true);
  const mail = shopMail().body;
  assert.deepEqual(mail.attachment.map((a) => a.name), ['preview-0.png', 'logo-0.png'], 'previews first, then what still fits');
  assert.ok(mail.attachment.reduce((n, a) => n + Buffer.from(a.content, 'base64').length, 0) <= 3000000);
  assert.ok(mail.textContent.includes('Saved in the orders database (too big for the email): preview-1.png'));

  const chunks = rows(env, "SELECT seq, bytes, length(data) AS len FROM design_proof_files WHERE ref = ? AND name = 'preview-1.png' ORDER BY seq", body.ref);
  assert.equal(chunks.length, Math.ceil(1900000 / (256 * 1024)));
  assert.ok(chunks.every((c) => c.len <= Math.ceil((256 * 1024) / 3) * 4 && c.bytes === 1900000));
  assert.equal(rows(env, "SELECT * FROM design_proof_files WHERE name <> 'preview-1.png'").length, 0);
  const files = JSON.parse(one(env, 'SELECT files_json FROM design_proof_requests WHERE ref = ?', body.ref).files_json);
  assert.deepEqual(files.map((f) => [f.name, f.attached, f.saved]), [['preview-0.png', true, 'none'], ['preview-1.png', false, 'd1'], ['logo-0.png', true, 'none']]);

  const res = await adminFile.onRequestGet({ request: adminReq('GET', '/x'), env, params: { ref: body.ref, file: 'preview-1.png' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'image/png');
  assert.match(res.headers.get('Content-Disposition'), /attachment/);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), second);
});

test('what cannot be saved either is listed with a note to ask the customer for it', async () => {
  const env = mkEnv();
  const huge = bytesOf('png', 12000000);
  const { body } = await send(env, okParts({ previews: [pngFile(0, 100000)], logos: [file(huge, 'huge.png', 'image/png')] }));
  assert.equal(body.emailed, true);
  const mail = shopMail().body;
  assert.deepEqual(mail.attachment.map((a) => a.name), ['preview-0.png']);
  assert.ok(mail.textContent.includes('NOT saved (too big): logo-0.png. Ask the customer to reply with these files.'));
  assert.equal(rows(env, 'SELECT * FROM design_proof_files').length, 0);
  const files = JSON.parse(one(env, 'SELECT files_json FROM design_proof_requests').files_json);
  assert.equal(files[1].saved, 'none');
  assert.equal(files[1].bytes, 12000000);
});

test('an SVG logo is sanitized before it is attached', async () => {
  const env = mkEnv();
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="5" height="5" onload="x()"/></svg>');
  await send(env, okParts({ logos: [file(svg, 'mark.svg', 'image/svg+xml')] }));
  const att = shopMail().body.attachment.find((a) => a.name === 'logo-0.svg');
  const text = Buffer.from(att.content, 'base64').toString();
  assert.ok(text.includes('<rect') && !/script|onload/.test(text));
});

test('honeypot, fast submissions, validation and size caps behave as before and write nothing', async () => {
  const env = mkEnv();
  const trap = await send(env, okParts({ gotcha: 'http://spam.example' }));
  assert.equal(trap.body.ok, true);
  const fast = await send(env, okParts({ request: goodRequest({ elapsedMs: 800 }) }));
  assert.equal(fast.body.ok, true);
  assert.equal(net.brevo.length, 0);
  assert.equal(requestCount(env), 0);
  for (const [parts, status, error] of [
    [okParts({ request: goodRequest({ email: 'nope' }) }), 400, 'fields'],
    [okParts({ request: goodRequest({ name: ' ' }) }), 400, 'fields'],
    [okParts({ design: 'not json' }), 400, 'design'],
    [okParts({ previews: [] }), 400, 'preview'],
    [okParts({ previews: [file(bytesOf('png', 6 * 1024 * 1024 + 1), 'preview-0.png', 'image/png')] }), 413, 'too-large'],
    [okParts({ previews: [file(new Uint8Array(500), 'preview-0.png', 'image/png')] }), 400, 'preview'],
    [okParts({ logos: [file(new TextEncoder().encode('<html>'), 'x.svg', 'image/svg+xml')] }), 400, 'logo'],
  ]) {
    const { res, body } = await send(env, parts);
    assert.equal(res.status, status, error);
    assert.deepEqual(body, { ok: false, error });
  }
  assert.equal(requestCount(env), 0);
  assert.equal(net.brevo.length, 0);
});

test('8 requests per hour per visitor, then 429', async () => {
  const env = mkEnv();
  const headers = { 'cf-connecting-ip': '198.51.100.77' };
  for (let i = 0; i < 8; i++) {
    const res = await proof.handle(postOf(formOf(okParts()), headers), env, NOW, DEPS);
    assert.equal(res.status, 200, 'request ' + (i + 1));
  }
  const res = await proof.handle(postOf(formOf(okParts()), headers), env, NOW, DEPS);
  assert.equal(res.status, 429);
  assert.equal(rows(env, 'SELECT * FROM design_proof_requests').length, 8);
});

test('when Brevo is down the request is still saved, emailed is false and the page keeps its fallback', async () => {
  net.brevoFail = true;
  const env = mkEnv();
  const spy = spyConsole();
  let out;
  try {
    out = await send(env, okParts());
  } finally {
    spy.restore();
  }
  assert.equal(out.res.status, 200);
  assert.equal(out.body.ok, true);
  assert.equal(out.body.stored, true);
  assert.equal(out.body.emailed, false);
  assert.equal(!!(out.res.ok && out.body.ok && out.body.emailed), false, 'the page shows its fallback with the reference');
  const row = one(env, 'SELECT * FROM design_proof_requests WHERE ref = ?', out.body.ref);
  assert.equal(row.shop_email, 'failed');
  assert.equal(row.customer_email_status, 'skipped');
  assert.match(row.email_error, /Brevo 401/);
  assert.deepEqual(spy.seen, ['design-proof email failed'], 'logs hold only a short constant message');
});

test('a failed customer confirmation does not undo the request', async () => {
  const env = mkEnv();
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('brevo') && JSON.parse(init.body).tags.includes('confirmation')) return Response.json({ message: 'nope' }, { status: 400 });
    return real(url, init);
  };
  const spy = spyConsole();
  let out;
  try {
    out = await send(env, okParts());
  } finally {
    spy.restore();
    globalThis.fetch = real;
  }
  assert.equal(out.body.emailed, true);
  assert.equal(out.body.confirmed, false);
  const row = one(env, 'SELECT * FROM design_proof_requests');
  assert.equal(row.shop_email, 'sent');
  assert.equal(row.customer_email_status, 'failed');
});

test('a D1 failure with no other storage answers 500 storage and sends nothing', async () => {
  const env = mkEnv();
  const real = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => (/^INSERT INTO design_proof_requests/.test(sql) ? { bind: () => ({ run: async () => { throw new Error('D1 is down'); } }) } : real(sql));
  const spy = spyConsole();
  try {
    const { res, body } = await send(env, okParts());
    assert.equal(res.status, 500);
    assert.deepEqual(body, { ok: false, error: 'storage' });
    assert.deepEqual(spy.seen, ['design-proof database failed']);
  } finally {
    spy.restore();
  }
  assert.equal(net.brevo.length, 0);
});

test('R2 and Email Routing still work with no D1 and no Brevo', async () => {
  const env = { DESIGN_PROOF_ENABLED: 'true', DESIGN_PROOF_TO: 'sales@getseensignsco.com', DESIGN_PROOF_FROM: 'proofs@getseensignsco.com', PROOFS: fakeR2(), SEND_EMAIL: fakeMail() };
  const { res, body } = await send(env, okParts());
  assert.equal(res.status, 200);
  assert.equal(body.emailed, true);
  assert.ok(!('confirmed' in body));
  assert.equal(env.PROOFS.keys().length, 3);
  assert.equal(env.SEND_EMAIL.sent.length, 1);
  assert.equal(net.brevo.length, 0);
  assert.ok(readMime(env.SEND_EMAIL.sent[0].raw).text.includes('Files in R2:'));
});

test('with R2, D1 and Brevo together every file goes to R2, D1 keeps the request, and Brevo sends the mail', async () => {
  const env = mkEnv({ PROOFS: fakeR2() });
  const { body } = await send(env, okParts({ previews: [file(bytesOf('png', 2500000), 'preview-0.png', 'image/png'), file(bytesOf('png', 1900000), 'preview-1.png', 'image/png')] }));
  assert.equal(body.emailed, true);
  assert.equal(env.PROOFS.keys().filter((k) => /preview-/.test(k)).length, 2);
  assert.equal(rows(env, 'SELECT * FROM design_proof_files').length, 0);
  const files = JSON.parse(one(env, 'SELECT files_json FROM design_proof_requests').files_json);
  assert.deepEqual(files.map((f) => f.saved), ['r2', 'r2']);
  const text = shopMail().body.textContent;
  assert.ok(text.includes('Only in R2: preview-1.png') && text.includes('Files in R2:'));
});

test('Brevo is tried first and Email Routing is the fallback when both are set up', async () => {
  net.brevoFail = true;
  const env = mkEnv({ DESIGN_PROOF_TO: 'sales@getseensignsco.com', DESIGN_PROOF_FROM: 'proofs@getseensignsco.com', SEND_EMAIL: fakeMail() });
  const spy = spyConsole();
  let out;
  try {
    out = await send(env, okParts());
  } finally {
    spy.restore();
  }
  assert.equal(out.body.emailed, true);
  assert.equal(env.SEND_EMAIL.sent.length, 1);
  assert.equal(one(env, 'SELECT shop_email FROM design_proof_requests').shop_email, 'sent');
});

test('admin read-back needs the token and returns the request, design and file list', async () => {
  const env = mkEnv();
  const { body } = await send(env, okParts());
  assert.equal((await adminOne.onRequestGet({ request: adminReq('GET', '/x', undefined, null), env, params: { ref: body.ref } })).status, 401);
  assert.equal((await adminList.onRequestGet({ request: adminReq('GET', '/x', undefined, 'wrong-token-wrong-token'), env })).status, 401);
  const list = await (await adminList.onRequestGet({ request: adminReq('GET', '/x'), env })).json();
  assert.equal(list.requests.length, 1);
  assert.equal(list.requests[0].ref, body.ref);
  const detail = await (await adminOne.onRequestGet({ request: adminReq('GET', '/x'), env, params: { ref: body.ref } })).json();
  assert.equal(detail.request.name, 'Pat Smith');
  assert.equal(detail.design.project.pieces[0].productId, 'canopy');
  assert.equal(detail.files[0].name, 'preview-0.png');
  assert.deepEqual(detail.emails, { shop: 'sent', customer: 'sent', error: '' });
  for (const params of [{ ref: 'GS-AAAAAAAA' }, { ref: "x' OR 1=1" }]) assert.equal((await adminOne.onRequestGet({ request: adminReq('GET', '/x'), env, params })).status, 404);
  for (const params of [{ ref: body.ref, file: 'preview-0.png' }, { ref: body.ref, file: '../../etc/passwd' }, { ref: body.ref, file: 'design.json' }]) {
    assert.equal((await adminFile.onRequestGet({ request: adminReq('GET', '/x'), env, params })).status, 404, params.file);
  }
});

test('migrations/0002_design_proof_requests.sql matches the schema the function creates', () => {
  const sql = readFileSync(new URL('migrations/0002_design_proof_requests.sql', root), 'utf8');
  for (const statement of DESIGN_SCHEMA) assert.ok(sql.includes(statement + ';'), statement.slice(0, 70));
});

test('no secret-looking values and no Veracity in the new code', () => {
  for (const f of ['functions/api/design-proof.js', 'functions/api/admin/design-proofs.js', 'functions/api/admin/design-proofs/[ref].js', 'functions/api/admin/design-proofs/[ref]/[file].js']) {
    const text = readFileSync(new URL(f, root), 'utf8');
    assert.doesNotMatch(text, /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}|xkeysib-[A-Za-z0-9]{8,}|Veracity/, f);
  }
});
