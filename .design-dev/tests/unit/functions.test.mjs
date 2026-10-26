// The two Pages Functions: /api/design-proof (v2 proof requests) and /api/design-event (usage events).
// R2 and SEND_EMAIL are fakes, and the EmailMessage class is handed in because cloudflare:email only exists
// inside a Worker. Both functions are called through their exported handle(request, env, now, deps).
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, root } from './helpers.mjs';
import { createDocument, setQty, setChoices, setSidesMode } from '../../../assets/design/model/document.js';
import * as proof from '../../../functions/api/design-proof.js';
import * as events from '../../../functions/api/design-event.js';
import { IP, UA, DEPS, fakeR2, fakeMail, bytesOf, png, file, pngFile, formOf, postOf, jsonPost, readMime, decodeSubject, spyConsole } from './functions-helpers.mjs';

const env = loadEnv();
const NOW = new Date('2026-10-26T20:15:00Z');
const REF = /^GS-[0-9A-HJKMNP-TV-Z]{8}$/;
const TO = 'sales@getseensignsco.com';
const FROM = 'proofs@getseensignsco.com';

beforeEach(() => proof.resetRateLimit());

// ---------- builders ----------

const canopyDoc = (qty) => (qty ? setQty(createDocument(env, 'canopy'), 0, qty) : createDocument(env, 'canopy'));

function twoPieceDoc() {
  const doc = canopyDoc(3);
  doc.project.pieces.push(createDocument(env, 'feather').project.pieces[0]);
  return doc;
}

// Price read straight from catalog.json, not through pricing.js.
function catalogTotal(doc) {
  return doc.project.pieces.reduce((sum, piece) => {
    const product = env.catalog.products.find((p) => p.id === piece.productId);
    const row = product.prices.find((r) => Object.keys(r.when).every((k) => r.when[k] === piece.choices[k]));
    return sum + row.price * (product.qty ? piece.qty : 1);
  }, 0);
}

const goodRequest = (over) =>
  Object.assign(
    {
      name: 'Pat Smith', email: 'pat@example.com', phone: '334-555-0100', eventDate: '2026-11-14', notes: 'Please make the logo bigger.',
      mode: 'self', source: 'design', viewport: 'd', clientTotal: 1947, elapsedMs: 45000, hear: 'a friend',
    },
    over
  );

const svgBytes = (inner) => new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">' + (inner || '') + '</svg>');
const okParts = (over) => Object.assign({ design: canopyDoc(3), request: goodRequest(), previews: [pngFile(0)] }, over);

function mkEnv(extra) {
  return Object.assign({ DESIGN_PROOF_ENABLED: 'true', DESIGN_PROOF_TO: TO, DESIGN_PROOF_FROM: FROM, PROOFS: fakeR2(), SEND_EMAIL: fakeMail() }, extra);
}

// Every call comes from a new IP so the 8 per hour limit only matters in the test that is about it.
let visitors = 0;
const nextIp = () => '198.18.' + (++visitors >> 8) + '.' + (visitors & 255);

async function send(e, parts, headers) {
  const res = await proof.handle(postOf(formOf(parts), Object.assign({ 'cf-connecting-ip': nextIp() }, headers)), e, NOW, DEPS);
  return { res, body: await res.json() };
}

// The rule the page applies (assets/design/editor.js): success only when ok and emailed.
const pageSaysDone = (res, data) => !!(res.ok && data && data.ok && data.emailed);

async function expectReject(parts, status, error, e) {
  const target = e || mkEnv();
  const { res, body } = await send(target, parts);
  assert.equal(res.status, status, JSON.stringify(body));
  assert.deepEqual(body, { ok: false, error });
  assert.deepEqual(target.PROOFS.keys(), [], 'a rejected request stores nothing');
  assert.equal(target.SEND_EMAIL.sent.length, 0, 'a rejected request sends nothing');
}

// ---------- flags and shape ----------

test('design-proof is off unless the flag is exactly "true"', async () => {
  for (const flag of [undefined, '', 'false', 'TRUE', 'True', '1', 'yes', true]) {
    const e = mkEnv({ DESIGN_PROOF_ENABLED: flag });
    const { res, body } = await send(e, okParts());
    assert.equal(res.status, 503, String(flag));
    assert.deepEqual(body, { ok: false, enabled: false });
    assert.equal(pageSaysDone(res, body), false, 'the page keeps its mailto path');
    assert.deepEqual(e.PROOFS.keys(), []);
    assert.equal(e.SEND_EMAIL.sent.length, 0);
  }
});

test('design-event is off unless the flag is exactly "true"', async () => {
  for (const flag of [undefined, '', 'false', 'TRUE', '1', true]) {
    const e = { DESIGN_EVENTS_ENABLED: flag, PROOFS: fakeR2() };
    const res = await events.handle(jsonPost({ events: [{ name: 'design_view' }] }), e, NOW);
    assert.equal(res.status, 503, String(flag));
    assert.deepEqual(await res.json(), { ok: false, enabled: false });
    assert.deepEqual(e.PROOFS.keys(), []);
  }
});

test('both functions answer POST only and the exported entry points use the handler', async () => {
  for (const mod of [proof, events]) {
    assert.equal(typeof mod.onRequestPost, 'function');
    for (const name of ['onRequest', 'onRequestGet', 'onRequestPut', 'onRequestPatch', 'onRequestDelete', 'onRequestHead', 'onRequestOptions']) {
      assert.equal(mod[name], undefined, name);
    }
  }
  const off = await proof.onRequestPost({ request: postOf(formOf(okParts())), env: {} });
  assert.equal(off.status, 503);
  const evOff = await events.onRequestPost({ request: jsonPost({ events: [] }), env: {} });
  assert.equal(evOff.status, 503);
});

test('responses are private: noindex and no-store, success or not', async () => {
  const check = (res) => {
    assert.equal(res.headers.get('x-robots-tag'), 'noindex');
    assert.equal(res.headers.get('cache-control'), 'no-store');
  };
  check((await send(mkEnv(), okParts())).res);
  check((await send(mkEnv(), okParts({ request: '{' }))).res);
  check((await send(mkEnv({ DESIGN_PROOF_ENABLED: 'no' }), okParts())).res);
  check((await send(mkEnv(), okParts({ gotcha: 'x' }))).res);
  const ev = await events.handle(jsonPost({ events: [{ name: 'undo' }] }), { DESIGN_EVENTS_ENABLED: 'true', PROOFS: fakeR2() }, NOW);
  assert.equal(ev.status, 204);
  check(ev);
  check(await events.handle(jsonPost('nope'), { DESIGN_EVENTS_ENABLED: 'true', PROOFS: fakeR2() }, NOW));
  check(await events.handle(jsonPost('nope'), {}, NOW));
});

test('a missing PROOFS binding answers 500 storage', async () => {
  const { res, body } = await send(mkEnv({ PROOFS: undefined }), okParts());
  assert.equal(res.status, 500);
  assert.deepEqual(body, { ok: false, error: 'storage' });
});

// ---------- bots and limits ----------

test('a filled honeypot gets a fake success and nothing is stored or sent', async () => {
  const e = mkEnv();
  const { res, body } = await send(e, okParts({ gotcha: 'http://spam.example' }));
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(body).sort(), ['emailed', 'ok', 'ref']);
  assert.equal(body.ok, true);
  assert.equal(body.emailed, true);
  assert.match(body.ref, REF);
  assert.equal(pageSaysDone(res, body), true, 'the bot sees the normal success message');
  assert.deepEqual(e.PROOFS.keys(), []);
  assert.equal(e.SEND_EMAIL.sent.length, 0);
  const garbage = await send(e, okParts({ gotcha: 'x', request: 'not json', design: 'nope' }));
  assert.equal(garbage.body.ok, true, 'the honeypot is checked before anything else is parsed');
  assert.deepEqual(e.PROOFS.keys(), []);
  const real = await send(e, okParts({ gotcha: '' }));
  assert.equal(real.body.stored, true, 'the empty honeypot real visitors send is a normal request');
});

test('a submission faster than 3 seconds is treated as a bot; a missing time is allowed', async () => {
  for (const elapsedMs of [0, 1200, 2999]) {
    const e = mkEnv();
    const { res, body } = await send(e, okParts({ request: goodRequest({ elapsedMs }) }));
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(body).sort(), ['emailed', 'ok', 'ref'], String(elapsedMs));
    assert.equal(body.emailed, true);
    assert.deepEqual(e.PROOFS.keys(), [], String(elapsedMs));
    assert.equal(e.SEND_EMAIL.sent.length, 0);
  }
  for (const elapsedMs of [3000, 12000, 'fast', null]) {
    const e = mkEnv();
    const { body } = await send(e, okParts({ request: goodRequest({ elapsedMs }) }));
    assert.equal(body.stored, true, String(elapsedMs));
  }
  const noTime = goodRequest();
  delete noTime.elapsedMs;
  const e = mkEnv();
  assert.equal((await send(e, okParts({ request: noTime }))).body.stored, true);
  assert.equal(e.PROOFS.json(e.PROOFS.keys().find((k) => k.endsWith('request.json'))).elapsedMs, null);
});

test('8 requests per hour per IP, then 429; other visitors and later hours are fine', async () => {
  const e = mkEnv();
  const ip = { 'cf-connecting-ip': '198.51.100.1' };
  for (let n = 1; n <= 8; n++) assert.equal((await send(e, okParts(), ip)).res.status, 200, 'request ' + n);
  const stored = e.PROOFS.keys().length;
  const blocked = await send(e, okParts(), ip);
  assert.equal(blocked.res.status, 429);
  assert.deepEqual(blocked.body, { ok: false, error: 'rate' });
  assert.equal(e.PROOFS.keys().length, stored, 'a limited request stores nothing');
  assert.equal((await send(e, okParts(), { 'cf-connecting-ip': '198.51.100.2' })).res.status, 200);
  const later = await proof.handle(postOf(formOf(okParts()), ip), e, new Date(NOW.getTime() + 3600001), DEPS);
  assert.equal(later.status, 200, 'an hour later the window has moved on');
  proof.resetRateLimit();
  assert.equal((await send(e, okParts(), ip)).res.status, 200, 'reset clears the counters');
  const unknown = mkEnv();
  for (let n = 0; n < 10; n++) assert.equal((await send(unknown, okParts(), { 'cf-connecting-ip': null })).res.status, 200, 'no IP header, no limit');
  const fakeCount = mkEnv();
  for (let n = 0; n < 9; n++) await send(fakeCount, okParts({ gotcha: 'x' }), { 'cf-connecting-ip': '198.51.100.9' });
  assert.equal((await send(fakeCount, okParts(), { 'cf-connecting-ip': '198.51.100.9' })).res.status, 429, 'bot traffic counts too');
});

test('a body announced above 40 MB is refused before it is read', async () => {
  const request = { headers: new Headers({ 'content-length': String(41 * 1024 * 1024), 'cf-connecting-ip': IP }), formData: async () => assert.fail('must not parse') };
  const res = await proof.handle(request, mkEnv(), NOW, DEPS);
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { ok: false, error: 'too-large' });
});

// ---------- validation ----------

test('name and a valid email are required', async () => {
  for (const email of ['', 'nope', 'a@b', 'a b@c.co', 'a@b.co\r\nBcc: x@y.co', 'a,b@c.co', '<a@b.co>', 'x@y.co, z@w.co', 'a@b..co', 'a@-b.co', '@b.co']) {
    await expectReject(okParts({ request: goodRequest({ email }) }), 400, 'fields');
  }
  for (const name of ['', '   ', undefined, 7, null]) await expectReject(okParts({ request: goodRequest({ name }) }), 400, 'fields');
  for (const email of ['john.doe+tag@gmail.com', "o'brien@example.co.uk", 'x@sub.domain-name.example.com', 'UPPER@EXAMPLE.COM', ' padded@example.com ']) {
    const e = mkEnv();
    assert.equal((await send(e, okParts({ request: goodRequest({ email }) }))).body.stored, true, email);
    assert.equal(readMime(e.SEND_EMAIL.sent[0].raw).headers['reply-to'], email.trim());
  }
  const phoneless = goodRequest({ phone: undefined, eventDate: undefined, hear: undefined });
  const e = mkEnv();
  assert.equal((await send(e, okParts({ request: phoneless }))).body.stored, true, 'phone, event date and how you heard are optional');
});

test('the request field must be a JSON object with a known mode', async () => {
  for (const request of ['', '{', 'null', '[]', '"text"', '12']) await expectReject(okParts({ request }), 400, 'fields');
  await expectReject({ design: canopyDoc(), previews: [pngFile(0)] }, 400, 'fields');
  await expectReject(okParts({ request: goodRequest({ mode: 'robot' }) }), 400, 'fields');
  await expectReject(okParts({ request: goodRequest({ notes: 'x'.repeat(40000) }) }), 413, 'too-large');
  const e = mkEnv();
  const { body } = await send(e, okParts({ request: goodRequest({ mode: undefined }) }));
  assert.equal(body.stored, true, 'a missing mode means self');
});

test('the design must be a valid v2 document of at most 200 KB', async () => {
  const good = canopyDoc(3);
  const broken = [
    ['not json', '{"v":2,'],
    ['not an object', '[]'],
    ['a v1 payload', JSON.stringify({ product: 'canopy', option: 'valance' })],
    ['wrong version', JSON.stringify({ ...good, v: 1 })],
    ['unknown product', JSON.stringify({ ...good, project: { ...good.project, pieces: [{ ...good.project.pieces[0], productId: 'rocket' }] } })],
    ['unknown choice', JSON.stringify({ ...good, project: { ...good.project, pieces: [{ ...good.project.pieces[0], choices: { package: 'gold' } }] } })],
    ['quantity out of range', JSON.stringify({ ...good, project: { ...good.project, pieces: [{ ...good.project.pieces[0], qty: 99 }] } })],
    ['no pieces', JSON.stringify({ ...good, project: { ...good.project, pieces: [] } })],
    ['a piece that is not an object', JSON.stringify({ ...good, project: { ...good.project, pieces: [null] } })],
  ];
  for (const [label, design] of broken) await expectReject(okParts({ design }), 400, 'design', mkEnv()).catch((err) => assert.fail(label + ': ' + err.message));
  await expectReject({ request: goodRequest(), previews: [pngFile(0)] }, 400, 'design');
  await expectReject(okParts({ design: '' }), 400, 'design');
  await expectReject({ request: goodRequest(), previews: [pngFile(0)], extra: [['design', file(new Uint8Array(20), 'design.json', 'application/json')]] }, 400, 'design');
  await expectReject(okParts({ design: JSON.stringify({ ...good, pad: 'x'.repeat(200000) }) }), 413, 'too-large');
});

test('previews: PNG only, 6 MB each, 1 to 12 files', async () => {
  await expectReject(okParts({ previews: [file(png(6 * 1024 * 1024 + 1), 'big.png', 'image/png')] }), 413, 'too-large');
  const e = mkEnv();
  const edge = await send(e, okParts({ previews: [file(png(6 * 1024 * 1024), 'edge.png', 'image/png')] }));
  assert.equal(edge.body.stored, true, '6 MB exactly is fine');
  await expectReject(okParts({ previews: [file(bytesOf('jpeg', 500), 'p.jpg', 'image/jpeg')] }), 400, 'preview');
  await expectReject(okParts({ previews: [file(bytesOf('jpeg', 500), 'p.png', 'image/png')] }), 400, 'preview');
  await expectReject(okParts({ previews: [file(png(500), 'p.png', 'image/jpeg')] }), 400, 'preview');
  await expectReject(okParts({ previews: [file(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'p.svg', 'image/svg+xml')] }), 400, 'preview');
  await expectReject(okParts({ previews: [file(new Uint8Array(0), 'empty.png', 'image/png')] }), 400, 'preview');
  await expectReject(okParts({ previews: [] }), 400, 'preview');
  await expectReject(okParts({ previews: [pngFile(0)], extra: [['preview-1', 'a string, not a file']] }), 400, 'preview');
  await expectReject(okParts({ previews: [pngFile(0)], extra: [['preview-0', pngFile(0)]] }), 400, 'preview');
  const twelve = Array.from({ length: 12 }, (_, n) => pngFile(n, 300));
  const full = mkEnv();
  const ok12 = await send(full, okParts({ previews: twelve }));
  assert.equal(ok12.body.stored, true);
  assert.equal(full.PROOFS.keys().filter((k) => /preview-\d+\.png$/.test(k)).length, 12);
  await expectReject(okParts({ previews: twelve.concat(pngFile(12, 300)) }), 400, 'preview');
  const heavy = Array.from({ length: 7 }, (_, n) => pngFile(n, 6 * 1024 * 1024));
  await expectReject(okParts({ previews: heavy }), 413, 'too-large');
});

test('logos: png, jpeg, webp or svg, 25 MB each (svg 8 MB), at most 4', async () => {
  await expectReject(okParts({ logos: [file(png(25 * 1024 * 1024 + 1), 'big.png', 'image/png')] }), 413, 'too-large');
  await expectReject(okParts({ logos: [file(svgBytes('x'.repeat(8 * 1024 * 1024)), 'big.svg', 'image/svg+xml')] }), 413, 'too-large');
  await expectReject(okParts({ logos: [file(bytesOf('gif', 500), 'a.gif', 'image/gif')] }), 400, 'logo');
  await expectReject(okParts({ logos: [file(bytesOf('pdf', 500), 'a.pdf', 'application/pdf')] }), 400, 'logo');
  await expectReject(okParts({ logos: [file(bytesOf('pdf', 500), 'a.png', 'image/png')] }), 400, 'logo');
  await expectReject(okParts({ logos: [file(new TextEncoder().encode('<html><script>alert(1)</script></html>'), 'a.svg', 'image/svg+xml')] }), 400, 'logo');
  await expectReject(okParts({ logos: [file(new Uint8Array(0), 'a.png', 'image/png')] }), 400, 'logo');
  const five = Array.from({ length: 5 }, (_, n) => file(bytesOf('png', 300), 'l' + n + '.png', 'image/png'));
  await expectReject(okParts({ logos: five }), 400, 'logo');
  const e = mkEnv();
  const four = await send(e, okParts({ logos: five.slice(0, 4) }));
  assert.equal(four.body.stored, true);
  const kinds = mkEnv();
  const mixed = await send(kinds, okParts({
    logos: [
      file(bytesOf('png', 300), 'a.png', 'image/png'),
      file(bytesOf('jpeg', 300), 'b.jpeg', 'image/jpeg'),
      file(bytesOf('webp', 300), 'c.webp', 'image/webp'),
      file(svgBytes('<rect width="1" height="1"/>'), 'd.svg', 'image/svg+xml'),
    ],
  }));
  assert.equal(mixed.body.stored, true);
  const stored = kinds.PROOFS.keys().filter((k) => /\/logo-/.test(k));
  assert.deepEqual(stored.map((k) => k.split('/').pop()), ['logo-0.png', 'logo-1.jpg', 'logo-2.webp', 'logo-3.svg']);
  assert.deepEqual(stored.map((k) => kinds.PROOFS.type(k)), ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
});

test('a file kind is decided by its bytes, not by the name or type it claims', async () => {
  const withParams = mkEnv();
  const typed = await send(withParams, okParts({ previews: [file(png(500), 'p.png', 'IMAGE/PNG; charset=binary')], logos: [file(bytesOf('webp', 300), 'a.webp', 'image/webp;q=1')] }));
  assert.equal(typed.body.stored, true, 'media type parameters and case do not matter');
  const e = mkEnv();
  const { body } = await send(e, okParts({ logos: [file(bytesOf('jpeg', 400), 'logo.png', ''), file(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'mark', '')] }));
  assert.equal(body.stored, true);
  assert.deepEqual(e.PROOFS.keys().filter((k) => /\/logo-/.test(k)).map((k) => k.split('/').pop()), ['logo-0.jpg', 'logo-1.svg']);
});

// ---------- SVG sanitizer ----------

const SHAPES =
  '<rect x="1" y="2" width="30" height="20" fill="#e10600"/><circle cx="50" cy="12" r="9" fill="#14161a"/>' +
  '<path d="M0 0L10 10Z" stroke="#000" stroke-width="2"/><g transform="rotate(5)"><text x="3" y="9">Hi &amp; bye</text></g>' +
  '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect fill="url(#g)" width="4" height="4"/>';

test('the SVG sanitizer removes scripts, handlers, foreignObject and outside links but keeps the shapes', () => {
  const dirty =
    '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>' +
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 60 30" onload="alert(1)">' +
    SHAPES +
    '<script>alert(1)</script><script type="text/javascript"><![CDATA[alert(2)]]></script>' +
    '<foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml"><script>alert(3)</script><iframe src="https://evil.example/"></iframe></div></foreignObject>' +
    '<a xlink:href="javascript:alert(4)"><text>link</text></a><image xlink:href="https://evil.example/x.png" width="1" height="1"/>' +
    '<rect width="2" height="2" onclick="alert(5)" ONMOUSEOVER="alert(6)" fill="red"/><use href="https://evil.example/s.svg#a"/><use xlink:href="#g"/>' +
    '</svg>';
  const clean = proof.sanitizeSvg(dirty);
  const kept = [
    '<rect x="1" y="2" width="30" height="20" fill="#e10600"/>',
    '<circle cx="50" cy="12" r="9" fill="#14161a"/>',
    '<path d="M0 0L10 10Z" stroke="#000" stroke-width="2"/>',
    '<text x="3" y="9">Hi &amp; bye</text>',
    '<stop offset="0" stop-color="#fff"/>',
    'fill="url(#g)"',
    '<use xlink:href="#g"/>',
    'viewBox="0 0 60 30"',
  ];
  for (const shape of kept) assert.ok(clean.includes(shape), 'kept: ' + shape);
  assert.match(clean, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink" viewBox="0 0 60 30">/);
  assert.match(clean, /<rect width="2" height="2" fill="red"\/>/);
  assert.doesNotMatch(clean, /script|onload|onclick|onmouseover|foreignobject|iframe|javascript|evil\.example|alert|ENTITY|DOCTYPE|<\?xml|passwd/i);
  assert.equal(proof.sanitizeSvg(clean), clean, 'a clean file comes through unchanged');
});

test('the SVG sanitizer allows only # links, and data:image on <image>', () => {
  const clean = proof.sanitizeSvg(
    [
      '<svg>',
      '<image href="data:image/png;base64,AAAA" width="1" height="1"/>',
      '<image href="DATA:IMAGE/jpeg;base64,AAAA"/>',
      '<image href="data:text/html;base64,PHNjcmlwdD4="/>',
      '<image href="//evil.example/a.png"/>',
      '<a href="data:image/svg+xml;base64,AAAA"><rect id="a1"/></a>',
      '<a href="https://evil.example/"><rect id="a2"/></a>',
      '<use href="data:image/svg+xml;base64,AAAA#x" id="u1"/>',
      '<use xlink:href="#ok" id="u2"/>',
      '<pattern xlink:href="#p" id="p2"/>',
      '</svg>',
    ].join('')
  );
  assert.match(clean, /<image href="data:image\/png;base64,AAAA" width="1" height="1"\/>/);
  assert.match(clean, /<image href="DATA:IMAGE\/jpeg;base64,AAAA"\/>/);
  assert.equal((clean.match(/<image/g) || []).length, 4, 'images stay, without the bad links');
  assert.doesNotMatch(clean, /text\/html|evil\.example|svg\+xml/);
  assert.match(clean, /<a><rect id="a1"\/><\/a>/);
  assert.match(clean, /<a><rect id="a2"\/><\/a>/);
  assert.doesNotMatch(clean, /id="u1"/, 'a <use> that points outside the file goes entirely');
  assert.match(clean, /<use xlink:href="#ok" id="u2"\/>/);
  assert.match(clean, /<pattern xlink:href="#p" id="p2"\/>/);
});

test('the SVG sanitizer is not fooled by case, entities, spacing, prefixes or nesting', () => {
  const attacks = {
    'upper case': '<SVG ONLOAD="x()"><SCRIPT>alert(1)</SCRIPT><Rect X="1"/></SVG>',
    'entity in the scheme': '<svg><a href="&#106;avascript:alert(1)"><rect/></a><a href="&#x6A;avascript:alert(1)"><rect/></a></svg>',
    'tab and newline in the scheme': '<svg><a href="java&#9;script:alert(1)"><rect/></a><a href="java\nscript:alert(1)"><rect/></a></svg>',
    'leading space': '<svg><a xlink:href="  javascript:alert(1)"><rect/></a></svg>',
    'named entity colon': '<svg><a href="javascript&colon;alert(1)"><rect/></a></svg>',
    'xhtml prefix': '<svg xmlns:h="http://www.w3.org/1999/xhtml"><h:script>alert(1)</h:script><h:iframe src="x"/><rect/></svg>',
    'default xhtml namespace': '<svg><script xmlns="http://www.w3.org/1999/xhtml">alert(1)</script></svg>',
    'prefixed svg script': '<svg:svg xmlns:svg="http://www.w3.org/2000/svg"><svg:script>alert(1)</svg:script></svg:svg>',
    'nested tag trick': '<svg><scr<script>x</script>ipt>alert(1)</scr</script>ipt></svg>',
    'slash as separator': '<svg/onload=alert(1)><rect/onclick=alert(2)></svg>',
    'quote tricks': '<svg><rect title=\'x" onclick="alert(1)\' /><rect title="a\'b" onmouseover=alert(2) /></svg>',
    'unquoted value': '<svg><rect onclick=alert(1) fill=red /></svg>',
    'comment hides a script': '<svg><!-- --><!--<script>alert(1)</script>--><rect/></svg>',
    'cdata hides a script': '<svg><![CDATA[<script>alert(1)</script>]]><rect/></svg>',
    'processing instruction': '<?xml-stylesheet href="http://evil.example/a.xsl" type="text/xsl"?><svg><rect/></svg>',
    'set a handler': '<svg><set attributeName="onmouseover" to="alert(1)"/><rect/></svg>',
    'animate an href': '<svg><a><animate attributeName="xlink:href" values="javascript:alert(1)"/><rect/></a></svg>',
    'animate with entities': '<svg><a><animate attributeName="h&#114;ef" values="javascript:alert(1)"/></a></svg>',
    'object and embed': '<svg><object data="javascript:alert(1)"></object><embed src="javascript:alert(1)"/><rect/></svg>',
    'handler on an xml event attribute': '<svg><rect ev:onclick="x()" xmlns:ev="http://www.w3.org/2001/xml-events"/></svg>',
    'xml:base': '<svg xml:base="http://evil.example/"><use href="#a" xml:base="http://evil.example/"/></svg>',
    'style import and url': '<svg><style>@import url(http://evil.example/a.css); .a{fill:url(http://evil.example/x.svg#f)} .b{fill:url(#ok)}</style><rect style="fill:url(//evil.example/x);stroke:url(#ok)"/></svg>',
    'attribute with url': '<svg><rect fill="url(http://evil.example/x)" filter="url(#f)"/></svg>',
  };
  for (const [label, dirty] of Object.entries(attacks)) {
    const clean = proof.sanitizeSvg(dirty);
    const shape = clean.replace(/="[^"]*"/g, '=""');
    assert.doesNotMatch(shape, /\son\w+\s*=|xml:base|ev:onclick/i, 'no handler attribute: ' + label + ' -> ' + clean);
    assert.doesNotMatch(clean, /<script|<iframe|<object|<embed|<foreignobject|<set|<animate|javascript|evil\.example|<\?|<!|xhtml/i, label + ' -> ' + clean);
    assert.equal(proof.sanitizeSvg(clean), clean, label + ': sanitizing twice changes nothing');
  }
  assert.match(proof.sanitizeSvg(attacks['upper case']), /<Rect X="1"\/>/);
  assert.match(proof.sanitizeSvg(attacks['style import and url']), /\.b\{fill:url\(#ok\)\}/);
  assert.match(proof.sanitizeSvg(attacks['style import and url']), /stroke:url\(#ok\)/);
  assert.match(proof.sanitizeSvg(attacks['attribute with url']), /filter="url\(#f\)"/);
  const escaped = proof.sanitizeSvg('<svg><style>.a{fill:u\\72l(http://evil.example/x)} .b{fill:\\75\\72\\6c(http://evil.example/y)} .c{fill:u\\5c 72l(http://evil.example/z)}</style></svg>');
  assert.match(escaped, /^<svg><style>\.a\{fill:none\} \.b\{fill:none\} \.c\{fill:u72l\(/, 'escapes are resolved first, and what is left of a third one is not a url()');
  assert.doesNotMatch(escaped, /url\(|\\/i);
});

test('the SVG sanitizer survives hostile and broken input quickly', () => {
  const inputs = [
    '<a '.repeat(200000),
    '<svg>' + '<'.repeat(500000),
    '<svg>' + '<rect fill="'.repeat(100000),
    '<svg>' + '<!--'.repeat(100000),
    '<svg>' + '<script>'.repeat(50000),
    '<svg>' + '<![CDATA['.repeat(100000),
    '<svg>' + '<rect onclick=a '.repeat(50000) + '>',
    '<svg>' + '&#x110000;&#0;&#xD800;&amp;&bogus;'.repeat(50000) + '</svg>',
    '<svg>' + 'x'.repeat(3000000) + '</svg>',
    '<svg>' + '<!x>'.repeat(400000),
    '<svg>' + '<!x ['.repeat(300000),
    '<svg><style>' + 'url('.repeat(400000),
    '<svg><style>' + 'url(#a'.repeat(300000) + ')',
    '<svg><style>' + '@import'.repeat(300000),
    '<svg><style>' + 'ur@import;l('.repeat(100000),
    '',
  ];
  const started = Date.now();
  for (const input of inputs) {
    const out = proof.sanitizeSvg(input);
    assert.equal(typeof out, 'string');
    assert.doesNotMatch(out, /<script/i);
  }
  assert.ok(Date.now() - started < 5000, 'took ' + (Date.now() - started) + ' ms');
  assert.doesNotMatch(proof.sanitizeSvg('<svg><style>ur@import x;l(http://evil.example/a)</style></svg>'), /url\(|evil/, 'cutting an @import must not join a new url(');
  assert.doesNotMatch(proof.sanitizeSvg('<svg><style>u@import a;r@import b;l(http://evil.example/a)</style></svg>'), /url\(|evil/);
  assert.equal(proof.sanitizeSvg(String.fromCharCode(0xfeff) + '<svg><rect/></svg>'), '<svg><rect/></svg>', 'a byte order mark is dropped');
  assert.equal(proof.sanitizeSvg('<svg><text>1 < 2 and 3 > 2</text></svg>'), '<svg><text>1 &lt; 2 and 3 > 2</text></svg>');
});

test('an SVG logo is stored and attached already sanitized', async () => {
  const dirty = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)" viewBox="0 0 60 30">' + SHAPES + '<script>alert(1)</script><a href="javascript:alert(2)"><rect width="1" height="1"/></a></svg>';
  const e = mkEnv();
  const { body } = await send(e, okParts({ logos: [file(new TextEncoder().encode(dirty), 'my logo.svg', 'image/svg+xml')] }));
  assert.equal(body.stored, true);
  const key = e.PROOFS.keys().find((k) => k.endsWith('/logo-0.svg'));
  const stored = e.PROOFS.text(key);
  assert.equal(stored, proof.sanitizeSvg(dirty));
  assert.doesNotMatch(stored, /script|onload|javascript/i);
  assert.ok(stored.includes('<circle cx="50" cy="12" r="9" fill="#14161a"/>'));
  const mime = readMime(e.SEND_EMAIL.sent[0].raw);
  const attached = mime.attachments.find((a) => a.filename === 'logo-0.svg');
  assert.equal(attached.type, 'image/svg+xml');
  assert.equal(attached.bytes.toString('utf8'), stored, 'the email carries the sanitized file too');
  assert.equal(e.PROOFS.json(e.PROOFS.keys().find((k) => k.endsWith('request.json'))).files.logos[0].name, 'my logo.svg');
});

// ---------- a good request ----------

test('a valid request stores design, previews, logos and the request, then sends one email', async () => {
  const e = mkEnv();
  const design = twoPieceDoc();
  const total = catalogTotal(design);
  const logoPng = bytesOf('png', 700);
  const logoSvg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>');
  const parts = {
    design,
    request: goodRequest({ clientTotal: total, notes: 'Line one\nLine two' }),
    previews: [pngFile(0, 900), pngFile(1, 800)],
    logos: [file(logoPng, 'acme logo.png', 'image/png'), file(logoSvg, 'mark.svg', 'image/svg+xml')],
    gotcha: '',
  };
  const { res, body } = await send(e, parts, { 'cf-connecting-ip': IP });
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(body).sort(), ['emailed', 'ok', 'priceMismatch', 'ref', 'serverTotal', 'stored']);
  assert.equal(body.ok, true);
  assert.equal(body.emailed, true);
  assert.equal(body.stored, true);
  assert.equal(body.priceMismatch, false);
  assert.equal(body.serverTotal, total);
  assert.match(body.ref, REF);
  assert.equal(pageSaysDone(res, body), true);

  const prefix = 'design-proofs/2026-10-26/' + body.ref + '/';
  assert.deepEqual(e.PROOFS.keys(), ['design.json', 'logo-0.png', 'logo-1.svg', 'preview-0.png', 'preview-1.png', 'request.json'].map((k) => prefix + k));
  assert.equal(e.PROOFS.order[e.PROOFS.order.length - 1], prefix + 'request.json', 'request.json goes last');
  assert.deepEqual(e.PROOFS.json(prefix + 'design.json'), design);
  assert.deepEqual([...e.PROOFS.bytes(prefix + 'preview-0.png')], [...png(900)]);
  assert.deepEqual([...e.PROOFS.bytes(prefix + 'logo-0.png')], [...logoPng]);
  assert.equal(e.PROOFS.type(prefix + 'design.json'), 'application/json; charset=utf-8');
  assert.equal(e.PROOFS.type(prefix + 'preview-1.png'), 'image/png');
  assert.equal(e.PROOFS.type(prefix + 'logo-1.svg'), 'image/svg+xml');

  const record = e.PROOFS.json(prefix + 'request.json');
  assert.deepEqual(record, {
    ref: body.ref,
    receivedAt: '2026-10-26T20:15:00.000Z',
    name: 'Pat Smith',
    email: 'pat@example.com',
    phone: '334-555-0100',
    eventDate: '2026-11-14',
    notes: 'Line one\nLine two',
    hear: 'a friend',
    mode: 'self',
    source: 'design',
    viewport: 'd',
    designForMe: null,
    clientTotal: total,
    serverTotal: total,
    priceMismatch: false,
    elapsedMs: 45000,
    files: {
      previews: ['preview-0.png', 'preview-1.png'],
      logos: [
        { file: 'logo-0.png', name: 'acme logo.png', type: 'image/png', bytes: 700 },
        { file: 'logo-1.svg', name: 'mark.svg', type: 'image/svg+xml', bytes: logoSvg.length },
      ],
    },
  });

  for (const key of e.PROOFS.keys()) {
    const text = new TextDecoder('latin1').decode(e.PROOFS.bytes(key));
    assert.ok(!text.includes(IP) && !text.includes(UA) && !text.includes('secret-cookie') && !text.includes('_gotcha'), 'no IP, user agent, cookie or honeypot in ' + key);
  }

  assert.equal(e.SEND_EMAIL.sent.length, 1);
  const message = e.SEND_EMAIL.sent[0];
  assert.equal(message.from, FROM);
  assert.equal(message.to, TO);
  const mime = readMime(message.raw);
  assert.deepEqual(mime.headerNames, ['from', 'to', 'reply-to', 'subject', 'date', 'message-id', 'mime-version', 'content-type']);
  assert.equal(mime.headers.from, FROM);
  assert.equal(mime.headers.to, TO);
  assert.equal(mime.headers['reply-to'], 'pat@example.com');
  assert.equal(mime.headers.subject, 'Design proof request: Canopy tent + Feather flag (Pat Smith) ' + body.ref);
  assert.equal(mime.headers.date, 'Mon, 26 Oct 2026 20:15:00 GMT');
  assert.match(mime.headers['message-id'], /^<GS-[0-9A-Z]{8}\.[0-9a-z]+@getseensignsco\.com>$/);
  assert.equal(mime.textType, 'text/plain; charset=UTF-8');
  assert.deepEqual(mime.attachments.map((a) => a.filename), ['preview-0.png', 'preview-1.png', 'logo-0.png', 'logo-1.svg']);
  assert.deepEqual(mime.attachments.map((a) => a.type), ['image/png', 'image/png', 'image/png', 'image/svg+xml']);
  assert.deepEqual([...mime.attachments[0].bytes], [...png(900)]);

  const lines = mime.text.split('\n');
  const piece = design.project.pieces[0];
  for (const line of [
    'Design proof request',
    'Reference: ' + body.ref,
    'Mode: Self-designed',
    'Name: Pat Smith',
    'Email: pat@example.com',
    'Phone: 334-555-0100',
    'Event date: 2026-11-14',
    'Heard about us: a friend',
    'Source: design (desktop)',
    'Piece 1: 10×10 pop-up canopy tent',
    '  Options: Package: Top and valance',
    '  Quantity: 3',
    '  Template: ' + piece.templateId,
    '  Sides: same on all sides (Front, Right, Back, Left)',
    'Piece 2: Feather flag',
    '  Options: Height: 10.5 ft, Base: Ground spike',
    'Design text',
    '  name: ' + design.project.fields.name,
    '  line2: ' + design.project.fields.line2,
    '  phone: ' + design.project.fields.phone,
    '  web: ' + design.project.fields.web,
    'Logo files: logo-0.png (acme logo.png), logo-1.svg (mark.svg)',
    'Server total: $' + total.toLocaleString('en-US') + ' (Free shipping)',
    'Attached: preview-0.png, preview-1.png, logo-0.png, logo-1.svg',
    'Files in R2:',
    prefix + 'design.json',
    prefix + 'preview-0.png',
    prefix + 'logo-1.svg',
    prefix + 'request.json',
    'This is a preview, not the print file. Reply with the free proof.',
  ]) {
    assert.ok(lines.includes(line), 'summary has the line: ' + line + '\n' + mime.text);
  }
  assert.ok(lines.includes('Notes: Line one'), 'multi line notes survive');
  assert.ok(lines.includes('Line two'));
  assert.ok(!mime.text.includes('WARNING'));
  assert.ok(!mime.text.includes('Only in R2'));
  assert.ok(!mime.text.includes(IP) && !mime.text.includes('secret-cookie'));
  assert.equal(lines[lines.length - 1], 'This is a preview, not the print file. Reply with the free proof.');
});

test('the summary names each side when they differ and has no quantity for sign packs', async () => {
  const doc = setSidesMode(canopyDoc(2), 0, 'each');
  doc.project.pieces.push(setChoices(createDocument(env, 'yard'), 0, { pack: '10', print: '2' }, env).project.pieces[0]);
  const e = mkEnv();
  const { body } = await send(e, okParts({ design: doc, request: goodRequest({ clientTotal: catalogTotal(doc) }) }));
  assert.equal(body.stored, true);
  const lines = readMime(e.SEND_EMAIL.sent[0].raw).text.split('\n');
  assert.ok(lines.includes('  Sides: each side different (Front, Right, Back, Left)'));
  const yard = lines.indexOf('Piece 2: 18×24 yard sign');
  assert.ok(yard > 0);
  assert.equal(lines[yard + 1], '  Options: Pack: 10 signs, Print: Two sides');
  assert.ok(!lines.slice(yard, yard + 5).some((l) => l.startsWith('  Quantity')), 'a pack has no quantity line');
  assert.equal(lines[yard + 3], '  Sides: same on all sides (Front, Back)');
  assert.equal(e.PROOFS.json(e.PROOFS.keys().find((k) => k.endsWith('design.json'))).project.pieces[0].sidesMode, 'each');
});

test('the email goes only to DESIGN_PROOF_TO; the customer is only the Reply-To', async () => {
  const e = mkEnv();
  const { body } = await send(e, okParts({ request: goodRequest({ email: 'someone.else@example.org' }) }));
  assert.equal(body.emailed, true);
  const message = e.SEND_EMAIL.sent[0];
  assert.equal(message.to, TO);
  const head = message.raw.split('\r\n\r\n')[0];
  assert.match(head, /^To: sales@getseensignsco\.com$/m);
  assert.match(head, /^Reply-To: someone\.else@example\.org$/m);
  assert.doesNotMatch(head, /^(Cc|Bcc):/im);
  assert.equal(e.SEND_EMAIL.sent.length, 1);
});

test('the ref is GS- plus 8 Crockford characters without I, L, O or U', () => {
  const seen = new Set();
  for (let n = 0; n < 3000; n++) {
    const ref = proof.makeRef();
    assert.match(ref, REF);
    assert.doesNotMatch(ref.slice(3), /[ILOU]/);
    seen.add(ref);
  }
  assert.equal(seen.size, 3000);
});

test('the server price comes from the catalog and matches what the page shows', async () => {
  const yard = setChoices(createDocument(env, 'yard'), 0, { pack: '25', print: '2' }, env);
  const cases = [
    [canopyDoc(), 649],
    [canopyDoc(3), 649 * 3],
    [setChoices(canopyDoc(2), 0, { package: 'kit' }, env), 1459 * 2],
    [yard, 209],
    [twoPieceDoc(), null],
  ];
  for (const id of ['canopy', 'feather', 'yard', 'throw', 'banner']) cases.push([createDocument(env, id), null]);
  for (const product of env.catalog.products) {
    for (const row of product.prices) {
      const doc = setChoices(createDocument(env, product.id), 0, row.when, env);
      cases.push([doc, row.price]);
    }
  }
  for (const [doc, expected] of cases) {
    const e = mkEnv();
    const { body } = await send(e, okParts({ design: doc, request: goodRequest({ clientTotal: catalogTotal(doc) }) }));
    assert.equal(body.stored, true, JSON.stringify(doc.project.pieces.map((p) => p.choices)));
    assert.equal(body.serverTotal, catalogTotal(doc));
    if (expected != null) assert.equal(body.serverTotal, expected);
    assert.equal(body.priceMismatch, false);
  }
});

test('a wrong client total is flagged but the request is still taken', async () => {
  const e = mkEnv();
  const { body } = await send(e, okParts({ request: goodRequest({ clientTotal: 5 }) }));
  assert.equal(body.ok, true);
  assert.equal(body.stored, true);
  assert.equal(body.priceMismatch, true);
  assert.equal(body.serverTotal, 1947);
  const record = e.PROOFS.json(e.PROOFS.keys().find((k) => k.endsWith('request.json')));
  assert.equal(record.priceMismatch, true);
  assert.equal(record.clientTotal, 5);
  const text = readMime(e.SEND_EMAIL.sent[0].raw).text;
  assert.ok(text.includes('WARNING: the page showed $5 but the server price is $1,947. Check before quoting.'));

  for (const clientTotal of [undefined, 'abc', '1947', null, -3, Infinity]) {
    const other = mkEnv();
    const out = await send(other, okParts({ request: goodRequest({ clientTotal }) }));
    assert.equal(out.body.priceMismatch, false, 'no usable client total, no warning: ' + String(clientTotal));
  }
  const fine = mkEnv();
  assert.equal((await send(fine, okParts({ request: goodRequest({ clientTotal: 1947 }) }))).body.priceMismatch, false);
  assert.ok(!readMime(fine.SEND_EMAIL.sent[0].raw).text.includes('WARNING'));
});

test('design for me works without a design or previews and skips pricing', async () => {
  const e = mkEnv();
  const request = goodRequest({
    mode: 'design_for_me',
    clientTotal: undefined,
    designForMe: { products: ['canopy', 'Yard sign', 'rocket', 'canopy', 7, ' CANOPY TENT '], wording: 'Riverside Eagles\nBooster Club', siteUrl: 'eagles.example' },
  });
  const { res, body } = await send(e, { request });
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.stored, true);
  assert.equal(body.emailed, true);
  assert.equal(body.serverTotal, null);
  assert.equal(body.priceMismatch, false);
  assert.deepEqual(e.PROOFS.keys(), ['design-proofs/2026-10-26/' + body.ref + '/request.json']);
  const record = e.PROOFS.json(e.PROOFS.keys()[0]);
  assert.deepEqual(record.designForMe, { products: ['canopy', 'yard'], wording: 'Riverside Eagles\nBooster Club', siteUrl: 'eagles.example' });
  assert.equal(record.mode, 'design_for_me');
  assert.equal(record.serverTotal, null);
  const mime = readMime(e.SEND_EMAIL.sent[0].raw);
  assert.equal(mime.multipart, false, 'nothing to attach');
  assert.equal(mime.headers.subject, 'Design proof request: Canopy tent + Yard sign (Pat Smith) ' + body.ref);
  const lines = mime.text.split('\n');
  const expected = [
    'Mode: Design it for me',
    'Products: Canopy tent, Yard sign',
    'Wording: Riverside Eagles',
    'Booster Club',
    'Website: eagles.example',
    'Server total: not priced (no design attached)',
    'Attached: none',
    'This is a preview, not the print file. Reply with the free proof.',
  ];
  for (const line of expected) assert.ok(lines.includes(line), line);

  const withFiles = mkEnv();
  const more = await send(withFiles, { request, design: canopyDoc(2), logos: [file(bytesOf('png', 500), 'a.png', 'image/png')], previews: [pngFile(0)] });
  assert.equal(more.body.stored, true);
  assert.equal(more.body.serverTotal, 1298, 'a design that comes along is priced');
  const bare = mkEnv();
  const logoOnly = await send(bare, { request: goodRequest({ mode: 'design_for_me' }), logos: [file(bytesOf('png', 500), 'a.png', 'image/png')] });
  assert.equal(logoOnly.body.stored, true);
  assert.deepEqual(bare.PROOFS.keys().map((k) => k.split('/').pop()), ['logo-0.png', 'request.json']);
  assert.equal(readMime(bare.SEND_EMAIL.sent[0].raw).headers.subject, 'Design proof request: sign (Pat Smith) ' + logoOnly.body.ref);
  await expectReject({ request: goodRequest({ mode: 'design_for_me' }), design: '{' }, 400, 'design');
});

// ---------- attachments ----------

test('attachments are dropped over 1.5 MB but the summary and the stored files stay', async () => {
  const e = mkEnv();
  const { body } = await send(e, okParts({
    previews: [pngFile(0, 1000000), pngFile(1, 900000)],
    logos: [file(bytesOf('png', 300000), 'logo.png', 'image/png')],
  }));
  assert.equal(body.emailed, true);
  const mime = readMime(e.SEND_EMAIL.sent[0].raw);
  assert.deepEqual(mime.attachments.map((a) => a.filename), ['preview-0.png', 'logo-0.png'], 'previews first, then what still fits');
  assert.equal(mime.attachments.reduce((n, a) => n + a.bytes.length, 0), 1300000);
  assert.ok(mime.text.includes('Attached: preview-0.png, logo-0.png'));
  assert.ok(mime.text.includes('Only in R2: preview-1.png'));
  assert.ok(mime.text.includes('This is a preview, not the print file.'));
  assert.equal(e.PROOFS.keys().filter((k) => /preview-|logo-/.test(k)).length, 3, 'everything is still in R2');

  const logoSkipped = mkEnv();
  await send(logoSkipped, okParts({ previews: [pngFile(0, 1400000)], logos: [file(bytesOf('png', 200000), 'logo.png', 'image/png')] }));
  const second = readMime(logoSkipped.SEND_EMAIL.sent[0].raw);
  assert.deepEqual(second.attachments.map((a) => a.filename), ['preview-0.png']);
  assert.ok(second.text.includes('Only in R2: logo-0.png'));

  const none = mkEnv();
  const big = await send(none, okParts({ previews: [pngFile(0, 2000000)] }));
  assert.equal(big.body.emailed, true);
  const plain = readMime(none.SEND_EMAIL.sent[0].raw);
  assert.equal(plain.multipart, false, 'no attachment fits, so it is a plain text message');
  assert.ok(plain.text.includes('Attached: none'));
  assert.ok(plain.text.includes('Only in R2: preview-0.png'));
  assert.equal(none.PROOFS.bytes(none.PROOFS.keys().find((k) => k.endsWith('preview-0.png'))).length, 2000000);

  const exact = mkEnv();
  await send(exact, okParts({ previews: [pngFile(0, 1500000)] }));
  assert.equal(readMime(exact.SEND_EMAIL.sent[0].raw).attachments.length, 1, 'exactly 1.5 MB still fits');
});

// ---------- email details ----------

test('header values cannot be injected and a non-ASCII subject is encoded', async () => {
  const e = mkEnv();
  const { body } = await send(e, okParts({ request: goodRequest({ name: 'Pat\r\nBcc: attacker@example.com', notes: 'hi\r\nBcc: attacker@example.com' }) }));
  assert.equal(body.emailed, true);
  const raw = e.SEND_EMAIL.sent[0].raw;
  const mime = readMime(raw);
  assert.ok(!mime.headerNames.includes('bcc'));
  assert.equal(mime.headers.subject, 'Design proof request: Canopy tent (Pat Bcc: attacker@example.com) ' + body.ref);
  assert.equal(e.PROOFS.json(e.PROOFS.keys().find((k) => k.endsWith('request.json'))).name, 'Pat Bcc: attacker@example.com');

  const accents = mkEnv();
  const out = await send(accents, okParts({ request: goodRequest({ name: 'José Núñez 🦅', notes: 'Añadir el logo' }) }));
  const parsed = readMime(accents.SEND_EMAIL.sent[0].raw);
  assert.match(parsed.headers.subject, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
  assert.equal(decodeSubject(parsed.headers.subject), 'Design proof request: Canopy tent (José Núñez 🦅) ' + out.body.ref);
  assert.ok(parsed.text.includes('Name: José Núñez 🦅'));
  assert.ok(parsed.text.includes('Notes: Añadir el logo'));
  assert.ok(/^[\x00-\x7F]*$/.test(accents.SEND_EMAIL.sent[0].raw), 'the raw message is plain ASCII');
  for (const line of accents.SEND_EMAIL.sent[0].raw.split('\r\n')) assert.ok(line.length <= 998);
});

test('a long note stays a valid message and every long header stays under the line limit', async () => {
  const e = mkEnv();
  const { body } = await send(e, okParts({ request: goodRequest({ notes: 'word '.repeat(2000) }) }));
  assert.equal(body.emailed, true);
  const raw = e.SEND_EMAIL.sent[0].raw;
  for (const line of raw.split('\r\n')) assert.ok(line.length <= 998);
  const record = e.PROOFS.json(e.PROOFS.keys().find((k) => k.endsWith('request.json')));
  assert.equal(record.notes.length, 4000 - 1, 'notes are cut at 4000 characters after trimming');
});

test('email trouble never loses the request: stored with emailed false', async () => {
  const noBinding = mkEnv({ SEND_EMAIL: undefined });
  let out = await send(noBinding, okParts());
  assert.equal(out.body.ok, true);
  assert.equal(out.body.stored, true);
  assert.equal(out.body.emailed, false);
  assert.equal(pageSaysDone(out.res, out.body), false, 'the page shows its fallback with the reference');
  assert.equal(noBinding.PROOFS.keys().length, 3);

  for (const extra of [{ DESIGN_PROOF_TO: undefined }, { DESIGN_PROOF_FROM: undefined }, { DESIGN_PROOF_TO: 'not an address' }, { DESIGN_PROOF_FROM: 'a@b' }, { DESIGN_PROOF_TO: TO + '\r\nBcc: x@y.co' }]) {
    const e = mkEnv(extra);
    out = await send(e, okParts());
    assert.equal(out.body.emailed, false, JSON.stringify(extra));
    assert.equal(out.body.stored, true);
    assert.equal(e.SEND_EMAIL.sent.length, 0);
  }

  const spy = spyConsole();
  try {
    const failing = mkEnv({ SEND_EMAIL: fakeMail({ fail: true }) });
    out = await send(failing, okParts());
    assert.equal(out.body.emailed, false);
    assert.equal(out.body.stored, true);
    assert.equal(failing.PROOFS.keys().length, 3);
    assert.deepEqual(spy.seen, ['design-proof email failed']);
  } finally {
    spy.restore();
  }

  const e = mkEnv();
  const noClass = await proof.handle(postOf(formOf(okParts())), e, NOW);
  assert.equal(JSON.parse(await noClass.text()).emailed, false, 'without cloudflare:email (outside a Worker) there is no email');
  assert.equal(e.PROOFS.keys().length, 3);
});

// ---------- storage failures and logs ----------

test('a failed write answers 500 storage, removes what was written and sends nothing', async () => {
  const parts = () => okParts({ previews: [pngFile(0), pngFile(1)], logos: [file(bytesOf('png', 500), 'a.png', 'image/png')] });
  for (const failing of ['design.json', 'preview-0.png', 'preview-1.png', 'logo-0.png', 'request.json']) {
    const spy = spyConsole();
    try {
      const e = mkEnv({ PROOFS: fakeR2({ failOn: (key) => key.endsWith('/' + failing) }) });
      const { res, body } = await send(e, parts());
      assert.equal(res.status, 500, failing);
      assert.deepEqual(body, { ok: false, error: 'storage' });
      assert.deepEqual(e.PROOFS.keys(), [], 'nothing is left behind after ' + failing);
      assert.equal(e.SEND_EMAIL.sent.length, 0);
      assert.deepEqual(spy.seen, ['design-proof storage failed']);
    } finally {
      spy.restore();
    }
  }
});

test('logs hold only short constant messages, never names, emails or files', async () => {
  const spy = spyConsole();
  try {
    await send(mkEnv({ PROOFS: fakeR2({ failOn: () => true }) }), okParts());
    await send(mkEnv({ SEND_EMAIL: fakeMail({ fail: true }) }), okParts());
    await proof.onRequestPost({ request: null, env: { DESIGN_PROOF_ENABLED: 'true', PROOFS: fakeR2() } });
    await events.onRequestPost({ request: null, env: { DESIGN_EVENTS_ENABLED: 'true', PROOFS: fakeR2() } });
    await events.handle(jsonPost({ events: [{ name: 'undo' }] }), { DESIGN_EVENTS_ENABLED: 'true', PROOFS: fakeR2({ failOn: () => true }) }, NOW);
    assert.deepEqual(spy.seen, ['design-proof storage failed', 'design-proof email failed', 'design-proof failed', 'design-event failed', 'design-event storage failed']);
  } finally {
    spy.restore();
  }
});

test('an unexpected error becomes a plain 500 server answer', async () => {
  const spy = spyConsole();
  try {
    const res = await proof.onRequestPost({ request: null, env: { DESIGN_PROOF_ENABLED: 'true', PROOFS: fakeR2() } });
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { ok: false, error: 'server' });
    const ev = await events.onRequestPost({ request: null, env: { DESIGN_EVENTS_ENABLED: 'true', PROOFS: fakeR2() } });
    assert.equal(ev.status, 500);
    assert.deepEqual(await ev.json(), { ok: false, error: 'server' });
  } finally {
    spy.restore();
  }
});

test('a request that is not multipart answers 400 form', async () => {
  const req = new Request('https://getseensignsco.com/api/design-proof', { method: 'POST', body: '{"name":"x"}', headers: { 'content-type': 'application/json', 'cf-connecting-ip': IP } });
  const res = await proof.handle(req, mkEnv(), NOW, DEPS);
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { ok: false, error: 'form' });
});

// ---------- design-event ----------

const evEnv = (extra) => Object.assign({ DESIGN_EVENTS_ENABLED: 'true', PROOFS: fakeR2() }, extra);
const NAMES = [
  'design_view', 'design_start', 'product_select', 'option_change', 'template_apply', 'text_edit', 'logo_upload', 'autobrand_apply',
  'piece_add', 'view_3d_open', 'view_3d_fallback', 'scene_change', 'undo', 'share_create', 'share_open', 'reorder_open', 'dpi_warning',
  'readability_warning', 'proof_review_open', 'proof_submit', 'proof_submit_ok', 'proof_submit_fallback', 'designer_help_open',
  'checkout_start', 'checkout_paid', 'editor_error',
];

async function sendEvents(e, list, headers) {
  const res = await events.handle(jsonPost({ events: list }, headers), e, NOW);
  return res;
}

const storedBatch = (e) => {
  assert.equal(e.PROOFS.keys().length, 1);
  return e.PROOFS.json(e.PROOFS.keys()[0]);
};

test('events: only the 26 allowed names are kept', async () => {
  const e = evEnv();
  const res = await sendEvents(e, NAMES.map((name) => ({ name })));
  assert.equal(res.status, 204);
  assert.deepEqual(storedBatch(e).events.map((x) => x.name), NAMES);

  const mixed = evEnv();
  const bad = ['page_view', 'DESIGN_VIEW', 'design_view ', '', 'constructor', '__proto__', 'toString', 7, null, true, ['design_view'], { name: 'design_view' }];
  const list = [{ name: 'design_view' }].concat(bad.map((name) => ({ name })), [null, 'design_start', 42, [], { nope: 1 }, { name: 'undo' }]);
  assert.equal((await sendEvents(mixed, list)).status, 204);
  assert.deepEqual(storedBatch(mixed).events.map((x) => x.name), ['design_view', 'undo']);

  const none = evEnv();
  const res400 = await sendEvents(none, bad.map((name) => ({ name })));
  assert.equal(res400.status, 400);
  assert.deepEqual(await res400.json(), { ok: false, error: 'events' });
  assert.deepEqual(none.PROOFS.keys(), []);
});

test('events: unknown keys are dropped and the known ones are cleaned', async () => {
  const e = evEnv();
  const dirty = {
    name: 'proof_submit_ok',
    t: 12345.6,
    sid: 'abcDEF1234567890XYZ',
    vp: 'm',
    product: 'canopy',
    phase: 2,
    d: { reason: 'ok', count: 3.14159, free: 'Pat Smith', email: 'a@b.co', nested: { a: 1 }, list: [1], flag: true, long: 'x'.repeat(100), extra5: 5, another: 1 },
    ip: '203.0.113.7',
    ua: UA,
    email: 'pat@example.com',
    text: 'secret words',
    url: 'https://getseensignsco.com/design/?x=1',
    cookie: 'secret-cookie',
  };
  assert.equal((await sendEvents(e, [dirty])).status, 204);
  const [event] = storedBatch(e).events;
  assert.deepEqual(event, { name: 'proof_submit_ok', t: 12346, sid: 'abcDEF1234567890', vp: 'm', product: 'canopy', phase: 2, d: { reason: 'ok', count: 3.14, long: 'x'.repeat(40), extra5: 5 } });
  assert.deepEqual(Object.keys(event), ['name', 't', 'sid', 'vp', 'product', 'phase', 'd']);
  assert.deepEqual(Object.keys(event.d).length <= 4, true);
  const text = e.PROOFS.text(e.PROOFS.keys()[0]);
  for (const secret of ['203.0.113.7', 'Mozilla', 'pat@example.com', 'secret words', 'secret-cookie', 'Pat Smith', 'getseensignsco']) assert.ok(!text.includes(secret), secret);
});

test('events: bad values fall back to empty, never to made-up data', () => {
  assert.deepEqual(events.cleanEvent({ name: 'undo', t: -5, sid: 5, vp: 'x', product: 'rocket', phase: 7, d: 'nope' }), { name: 'undo', t: null, sid: '', vp: '', product: '', phase: null, d: {} });
  assert.deepEqual(events.cleanEvent({ name: 'undo' }), { name: 'undo', t: null, sid: '', vp: '', product: '', phase: null, d: {} });
  assert.equal(events.cleanEvent({ name: 'undo', t: 86400001 }).t, null);
  assert.equal(events.cleanEvent({ name: 'undo', t: 86400000 }).t, 86400000);
  assert.equal(events.cleanEvent({ name: 'undo', t: 0 }).t, 0);
  assert.equal(events.cleanEvent({ name: 'undo', t: '12' }).t, null);
  assert.equal(events.cleanEvent({ name: 'undo', t: NaN }).t, null);
  for (const phase of [0, 4, '2', null, 1.5]) assert.equal(events.cleanEvent({ name: 'undo', phase }).phase, null, String(phase));
  for (const phase of [1, 2, 3]) assert.equal(events.cleanEvent({ name: 'undo', phase }).phase, phase);
  assert.equal(events.cleanEvent({ name: 'undo', vp: 'd' }).vp, 'd');
  assert.equal(events.cleanEvent({ name: 'undo', vp: 'M' }).vp, '');
  for (const product of ['canopy', 'feather', 'yard', 'throw', 'banner']) assert.equal(events.cleanEvent({ name: 'undo', product }).product, product);
  assert.equal(events.cleanEvent({ name: 'undo', product: '' }).product, '');
  assert.equal(events.cleanEvent({ name: 'undo', product: ['canopy'] }).product, '');
  assert.equal(events.cleanEvent({ name: 'undo', sid: 'a b/c?d=e&f<g>' }).sid, 'abcdefg');
  assert.equal(events.cleanEvent({ name: 'undo', sid: 'x'.repeat(40) }).sid.length, 16);
  assert.deepEqual(events.cleanEvent({ name: 'undo', d: ['a', 'b'] }).d, {});
  assert.deepEqual(events.cleanEvent({ name: 'undo', d: { ok_key: 'v', '9bad': 'v', 'bad key': 'v', __proto__x: 'v', ['k'.repeat(30)]: 'v' } }).d, { ok_key: 'v' });
  assert.deepEqual(events.cleanEvent({ name: 'undo', d: JSON.parse('{"__proto__":"x","constructor":"y"}') }).d, { constructor: 'y' });
  assert.deepEqual(events.cleanEvent({ name: 'undo', d: { a: 1, b: 'two', c: 3, d: 'four', e: 5 } }).d, { a: 1, b: 'two', c: 3, d: 'four' });
  assert.deepEqual(events.cleanEvent({ name: 'undo', d: { a: Infinity, b: NaN, c: 1e13, d: '', e: 'ok:value/1+2-3_4.5' } }).d, { e: 'ok:value/1+2-3_4.5' });
  assert.deepEqual(events.cleanEvent({ name: 'undo', d: { reason: 'webgl unavailable', mode: 'self' } }).d, { mode: 'self' }, 'free text with spaces is dropped');
});

test('events: more than 50 events or more than 8 KB is too large', async () => {
  const fifty = Array.from({ length: 50 }, () => ({ name: 'text_edit', t: 1 }));
  const e = evEnv();
  assert.equal((await sendEvents(e, fifty)).status, 204);
  assert.equal(storedBatch(e).events.length, 50);

  const many = evEnv();
  const res = await sendEvents(many, fifty.concat({ name: 'undo' }));
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { ok: false, error: 'too-large' });
  assert.deepEqual(many.PROOFS.keys(), []);

  const base = JSON.stringify({ events: [{ name: 'undo' }], pad: '' });
  const exact = jsonPost(JSON.stringify({ events: [{ name: 'undo' }], pad: 'x'.repeat(8192 - base.length) }));
  const atLimit = evEnv();
  assert.equal((await events.handle(exact, atLimit, NOW)).status, 204, '8192 bytes is accepted');
  const over = jsonPost(JSON.stringify({ events: [{ name: 'undo' }], pad: 'x'.repeat(8193 - base.length) }));
  const big = evEnv();
  const bigRes = await events.handle(over, big, NOW);
  assert.equal(bigRes.status, 413);
  assert.deepEqual(big.PROOFS.keys(), []);
  const wide = jsonPost(JSON.stringify({ events: [{ name: 'undo', d: { a: 'é'.repeat(5000) } }] }));
  assert.equal((await events.handle(wide, evEnv(), NOW)).status, 413, 'the limit counts bytes, not characters');
});

test('events: 204 with one object per batch at events/YYYY-MM-DD/<12 hex>.json', async () => {
  const e = evEnv();
  const res = await sendEvents(e, [{ name: 'design_view', vp: 'm', t: 10 }, { name: 'design_start', vp: 'm', t: 900 }]);
  assert.equal(res.status, 204);
  assert.equal(await res.text(), '');
  const second = await events.handle(jsonPost({ events: [{ name: 'undo' }] }), e, new Date('2026-10-27T00:00:01Z'));
  assert.equal(second.status, 204);
  const keys = e.PROOFS.keys();
  assert.equal(keys.length, 2, 'one object per batch');
  assert.match(keys[0], /^events\/2026-10-26\/[0-9a-f]{12}\.json$/);
  assert.match(keys[1], /^events\/2026-10-27\/[0-9a-f]{12}\.json$/);
  const first = e.PROOFS.json(keys[0]);
  assert.deepEqual(Object.keys(first), ['day', 'events']);
  assert.equal(first.day, '2026-10-26');
  assert.equal(first.events.length, 2);
  assert.equal(e.PROOFS.json(keys[1]).day, '2026-10-27');
  assert.equal(e.PROOFS.type(keys[0]), 'application/json; charset=utf-8');
  const ids = new Set();
  for (let n = 0; n < 200; n++) {
    const batch = evEnv();
    await sendEvents(batch, [{ name: 'undo' }]);
    ids.add(batch.PROOFS.keys()[0].split('/').pop());
  }
  assert.equal(ids.size, 200, 'random names do not repeat');
});

test('events: the IP, user agent, cookies, headers and URL are never read or stored', async () => {
  const request = jsonPost({ events: [{ name: 'design_view', vp: 'd' }] }, { referer: 'https://getseensignsco.com/design/?name=Pat', 'x-forwarded-for': '198.51.100.20', 'accept-language': 'fr-CA' });
  for (const prop of ['headers', 'url', 'cf']) {
    Object.defineProperty(request, prop, {
      get() {
        throw new Error('the function read request.' + prop);
      },
    });
  }
  const e = evEnv();
  const res = await events.handle(request, e, NOW);
  assert.equal(res.status, 204);
  const text = e.PROOFS.text(e.PROOFS.keys()[0]);
  for (const secret of [IP, '198.51.100.20', 'Mozilla', 'secret-cookie', 'fr-CA', 'getseensignsco', 'Pat']) assert.ok(!text.includes(secret), secret);
  assert.deepEqual(Object.keys(e.PROOFS.objects.get(e.PROOFS.keys()[0]).options), ['httpMetadata']);
});

test('events: bad input is 400 and a bad store is 500', async () => {
  for (const body of ['', 'nope', '{', 'null', '[]', '{}', '{"events":"x"}', '{"events":{}}', '{"events":[]}', '12', '"text"']) {
    const e = evEnv();
    const res = await events.handle(jsonPost(body), e, NOW);
    assert.equal(res.status, 400, body);
    assert.deepEqual(e.PROOFS.keys(), []);
  }
  assert.deepEqual(await (await events.handle(jsonPost('nope'), evEnv(), NOW)).json(), { ok: false, error: 'json' });
  assert.deepEqual(await (await events.handle(jsonPost({ events: [] }), evEnv(), NOW)).json(), { ok: false, error: 'events' });
  const json = new Request('https://getseensignsco.com/api/design-event', { method: 'POST', body: JSON.stringify({ events: [{ name: 'undo' }] }), headers: { 'content-type': 'application/json' } });
  const ok = evEnv();
  assert.equal((await events.handle(json, ok, NOW)).status, 204, 'application/json works too');
  const noBody = new Request('https://getseensignsco.com/api/design-event', { method: 'POST' });
  assert.equal((await events.handle(noBody, evEnv(), NOW)).status, 400);
  const spy = spyConsole();
  try {
    const down = await events.handle(jsonPost({ events: [{ name: 'undo' }] }), evEnv({ PROOFS: fakeR2({ failOn: () => true }) }), NOW);
    assert.equal(down.status, 500);
    assert.deepEqual(await down.json(), { ok: false, error: 'storage' });
    const none = await events.handle(jsonPost({ events: [{ name: 'undo' }] }), evEnv({ PROOFS: undefined }), NOW);
    assert.equal(none.status, 500);
  } finally {
    spy.restore();
  }
});

// ---------- the report script ----------

test('design_events_report.py reads what design-event stores', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'design-events-'));
  try {
    const e = evEnv();
    const later = new Date('2026-10-27T09:00:00Z');
    const day1 = [
      ...[['m', 's1'], ['m', 's2'], ['d', 's3'], ['d', 's4']].map(([vp, sid]) => ({ name: 'design_start', vp, sid })),
      { name: 'proof_submit', vp: 'm', sid: 's1' },
      { name: 'proof_submit', vp: 'd', sid: 's3' },
      { name: 'proof_submit_ok', vp: 'm', sid: 's1' },
      { name: 'proof_submit_ok', vp: 'd', sid: 's3' },
      { name: 'editor_error', vp: 'm', sid: 's2' },
      { name: 'text_edit', vp: 'm', sid: 's1' },
    ];
    await events.handle(jsonPost({ events: day1 }), e, NOW);
    await events.handle(jsonPost({ events: [{ name: 'design_start', vp: 'm', sid: 's9' }, { name: 'design_view', vp: 'm', sid: 's9' }] }), e, later);
    for (const key of e.PROOFS.keys()) {
      mkdirSync(join(dir, dirname(key)), { recursive: true });
      writeFileSync(join(dir, key), e.PROOFS.bytes(key));
    }
    writeFileSync(join(dir, 'events', 'broken.json'), '{nope');
    const script = fileURLToPath(new URL('src/tools/design_events_report.py', root));
    const out = execFileSync('python3', ['-I', script, join(dir, 'events')], { encoding: 'utf8', cwd: fileURLToPath(root) });
    const row = (label, from) => out.slice(out.indexOf(from || 'Funnel')).split('\n').find((l) => l.startsWith(label)).trim().split(/\s+/);
    assert.match(out, /^Design events report\n12 events in 2 batch files \(1 files skipped\)/);
    assert.deepEqual(row('2026-10-26'), ['2026-10-26', '4', '2', '50.0%', '2', '50.0%', '50.0%']);
    assert.deepEqual(row('2026-10-27'), ['2026-10-27', '1', '0', '0.0%', '0', '-', '-']);
    assert.deepEqual(row('TOTAL'), ['TOTAL', '5', '2', '40.0%', '2', '50.0%', '50.0%']);
    assert.deepEqual(row('2026-10-26', 'Editor errors'), ['2026-10-26', '1', '25.0', '4', '25.0%']);
    assert.deepEqual(row('TOTAL', 'Editor errors'), ['TOTAL', '1', '20.0', '5', '20.0%']);
    assert.deepEqual(row('design_start', 'Events by name'), ['design_start', '4', '1', '5']);
    assert.deepEqual(row('proof_submit_ok', 'Events by name'), ['proof_submit_ok', '2', '0', '2']);
    let failed = null;
    try {
      execFileSync('python3', ['-I', script, join(dir, 'missing')], { encoding: 'utf8', stdio: 'pipe' });
    } catch (err) {
      failed = err;
    }
    assert.equal(failed.status, 2, 'a missing folder is a usage error');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
