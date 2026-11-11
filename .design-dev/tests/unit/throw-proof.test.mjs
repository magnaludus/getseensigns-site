// A table throw proof request carries every panel: the design with art on the top, ends and back, a picture of the
// whole flat and one of each panel as it reads on the table, labels on those pictures, and a summary that names what
// is on each panel and how it is turned on the flat. Old designs (a front panel only) still go through.
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv } from './helpers.mjs';
import { createDocument } from '../../../assets/design/model/document.js';
import { quickFill } from '../../../assets/design/model/quickfill.js';
import { previewPlan } from '../../../assets/design/model/proof-plan.js';
import * as proof from '../../../functions/api/design-proof.js';
import * as adminOne from '../../../functions/api/admin/design-proofs/[ref].js';
import * as adminOrder from '../../../functions/api/admin/orders/[id].js';
import { DEPS, pngFile, formOf, postOf } from './functions-helpers.mjs';
import { installFetch, makeEnv, adminReq, ADMIN } from './orders-helpers.mjs';

const designEnv = loadEnv();
const NOW = new Date('2026-10-28T03:30:00Z');
let net;
let visitors = 0;
const nextIp = () => '198.19.' + (++visitors >> 8) + '.' + (visitors & 255);

beforeEach(() => {
  proof.resetRateLimit();
  net = installFetch();
});
afterEach(() => net.restore());

const mkEnv = () => makeEnv({ ASSETS: undefined, ADMIN_TOKEN: ADMIN });
const goodRequest = () => ({ name: 'Pat Smith', email: 'pat@example.com', phone: '334-555-0100', eventDate: '2026-11-14', notes: 'Same as our last order.', mode: 'self', source: 'design', viewport: 'd', clientTotal: null, elapsedMs: 45000, hear: 'a friend' });
const rows = (env, sql, ...p) => env.DB.sqlite.prepare(sql).all(...p);
const requestCount = (env) => { try { return rows(env, 'SELECT * FROM design_proof_requests').length; } catch (_) { return 0; } };
const shopMail = () => net.brevo.find((m) => m.body.tags.includes('design-proof') && !m.body.tags.includes('confirmation'));

async function send(env, design, previews) {
  const parts = { design, request: goodRequest(), previews };
  const res = await proof.handle(postOf(formOf(parts), { 'cf-connecting-ip': nextIp() }), env, NOW, DEPS);
  return { res, body: await res.json() };
}

const throwDoc = (style = '4') => {
  let doc = createDocument(designEnv, 'throw', { choices: { length: '6', style } });
  doc = quickFill(doc, 0, 'logo-top', designEnv).doc;
  doc = quickFill(doc, 0, 'name-ends', designEnv).doc;
  return doc;
};
const pictures = (doc) => previewPlan(doc, designEnv).map((p) => pngFile(p.n, 4000));

test('a 4-sided throw request stores art on the top, both ends and the back, and labels the flat and every panel picture', async () => {
  const env = mkEnv();
  const doc = throwDoc('4');
  const { res, body } = await send(env, doc, pictures(doc));
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  const row = env.DB.sqlite.prepare('SELECT * FROM design_proof_requests WHERE ref = ?').get(body.ref);
  const stored = JSON.parse(row.design_json);
  const piece = stored.project.pieces[0];
  assert.deepEqual(piece.sides.map((s) => s.name), ['Front', 'Top', 'Left end', 'Right end', 'Back']);
  assert.equal(piece.sidesMode, 'each');
  // the design carries the art on every panel, not just the front
  assert.equal(piece.sides[1].elements.filter((e) => e.type === 'image').length, 1, 'the top has the logo frame');
  for (const si of [2, 3, 4]) assert.deepEqual(piece.sides[si].elements.filter((e) => e.type === 'text').map((e) => e.text), ['HONEYDROP'], piece.sides[si].name);
  // six pictures: the whole flat, then each panel, each saying what it is
  const files = JSON.parse(row.files_json);
  assert.deepEqual(files.map((f) => f.name), ['preview-0.png', 'preview-1.png', 'preview-2.png', 'preview-3.png', 'preview-4.png', 'preview-5.png']);
  assert.deepEqual(files.map((f) => f.label), [
    'Table throw: the whole flat as it prints (ends and back turned)',
    'Table throw: Front panel, as it reads on the table',
    'Table throw: Top panel, as it reads on the table',
    'Table throw: Left end panel, as it reads on the table',
    'Table throw: Right end panel, as it reads on the table',
    'Table throw: Back panel, as it reads on the table',
  ]);
  // the email to the shop says what is on each panel and how it prints
  const text = shopMail().body.textContent;
  assert.ok(text.includes('Panels (each drawn upright, as it reads when the cover hangs on the table):'), text);
  for (const line of [
    '    Front: "HONEYDROP", "APIARY" (upright on the flat)',
    '    Top: empty logo frame (no logo yet) (upright on the flat)',
    '    Left end: "HONEYDROP" (turned 90 degrees clockwise on the flat, so it reads top to bottom)',
    '    Right end: "HONEYDROP" (turned 90 degrees counterclockwise on the flat, so it reads bottom to top)',
    '    Back: "HONEYDROP" (turned 180 degrees on the flat)',
    '  preview-0.png: Table throw: the whole flat as it prints (ends and back turned)',
    '  preview-3.png: Table throw: Left end panel, as it reads on the table',
  ]) assert.ok(text.split('\n').includes(line), line + '\n' + text);
  assert.ok(text.includes('Preview pictures:'));
  assert.ok(text.includes('The first preview is the whole flat as it prints.'));
  assert.ok(!text.includes('Sides: same on all sides'), 'a throw is not "same on all sides"');
  // all six pictures are attached to the email
  assert.deepEqual(shopMail().body.attachment.map((a) => a.name), files.map((f) => f.name));
});

test('a 3-sided throw sends the flat and four panels, and says the back is open and plain', async () => {
  const env = mkEnv();
  const doc = throwDoc('3');
  const { body } = await send(env, doc, pictures(doc));
  const row = env.DB.sqlite.prepare('SELECT * FROM design_proof_requests WHERE ref = ?').get(body.ref);
  const files = JSON.parse(row.files_json);
  assert.equal(files.length, 5);
  assert.ok(files[0].label.includes('whole flat'));
  const text = shopMail().body.textContent;
  assert.ok(!text.includes('    Back:'), 'no back panel on a 3-sided throw');
  assert.ok(text.includes('    Right end: "HONEYDROP" (turned 90 degrees counterclockwise'));
});

test('pictures that do not line up with the design keep their file names instead of being mislabeled', async () => {
  const env = mkEnv();
  const doc = throwDoc('4');
  const { body } = await send(env, doc, [pngFile(0, 4000), pngFile(1, 4000)]);
  const row = env.DB.sqlite.prepare('SELECT * FROM design_proof_requests WHERE ref = ?').get(body.ref);
  assert.deepEqual(JSON.parse(row.files_json).map((f) => f.label), ['preview-0.png', 'preview-1.png']);
  assert.ok(!shopMail().body.textContent.includes('Preview pictures:'));
});

test('a throw saved with only a front panel (an old page, an old link) is accepted and gets plain panels', async () => {
  const env = mkEnv();
  const doc = JSON.parse(JSON.stringify(createDocument(designEnv, 'throw', { choices: { length: '6', style: '4' } })));
  doc.project.pieces[0].sides = [doc.project.pieces[0].sides[0]];
  doc.project.pieces[0].sides[0].name = 'Front panel';
  doc.project.pieces[0].sidesMode = 'same';
  const { res, body } = await send(env, doc, [pngFile(0, 4000)]);
  assert.equal(res.status, 200, JSON.stringify(body));
  const stored = JSON.parse(env.DB.sqlite.prepare('SELECT design_json FROM design_proof_requests WHERE ref = ?').get(body.ref).design_json);
  assert.deepEqual(stored.project.pieces[0].sides.map((s) => s.name), ['Front', 'Top', 'Left end', 'Right end', 'Back']);
  assert.deepEqual(stored.project.pieces[0].sides[4].elements, []);
});

test('a throw with the wrong number of panels is refused, and "same on all sides" is corrected to one panel at a time', async () => {
  const env = mkEnv();
  const doc = throwDoc('4');
  const six = JSON.parse(JSON.stringify(doc));
  six.project.pieces[0].sides.push(JSON.parse(JSON.stringify(six.project.pieces[0].sides[1])));
  assert.equal((await send(env, six, [pngFile(0, 4000)])).res.status, 400);
  assert.equal(requestCount(env), 0, 'nothing is stored for a refused request');
  // an old page that still says "same on all sides" for a throw is brought up to date, not turned away
  const same = JSON.parse(JSON.stringify(doc));
  same.project.pieces[0].sidesMode = 'same';
  const { res, body } = await send(env, same, pictures(doc));
  assert.equal(res.status, 200);
  const stored = JSON.parse(env.DB.sqlite.prepare('SELECT design_json FROM design_proof_requests WHERE ref = ?').get(body.ref).design_json);
  assert.equal(stored.project.pieces[0].sidesMode, 'each');
});

test('the admin read-back shows the flat and each panel as it reads installed, with the pictures that go with them', async () => {
  const env = mkEnv();
  const doc = throwDoc('4');
  const { body } = await send(env, doc, pictures(doc));
  const detail = await (await adminOne.onRequestGet({ request: adminReq('GET', '/x'), env, params: { ref: body.ref } })).json();
  assert.equal(detail.ok, true);
  assert.deepEqual(detail.previews.map((p) => [p.file, p.kind, p.side]), [
    ['preview-0.png', 'flat', null], ['preview-1.png', 'side', 0], ['preview-2.png', 'side', 1],
    ['preview-3.png', 'side', 2], ['preview-4.png', 'side', 3], ['preview-5.png', 'side', 4],
  ]);
  const [piece] = detail.pieces;
  assert.equal(piece.panels, true);
  assert.deepEqual(piece.sides.map((s) => [s.name, s.id]), [['Front', 'front'], ['Top', 'top'], ['Left end', 'left'], ['Right end', 'right'], ['Back', 'back']]);
  assert.match(piece.sides[2].reads, /turned 90 degrees clockwise/);
  assert.deepEqual(piece.sides[4].text, ['HONEYDROP']);
  assert.equal(piece.sides[1].frames, 1);
  // every picture on the list is a file that was saved with the request
  assert.deepEqual(detail.files.filter((f) => f.name.startsWith('preview-')).map((f) => f.name), detail.previews.map((p) => p.file));
});

test('the admin order shows the same: what is on each panel, and which saved picture is the flat and which is each panel', async () => {
  const env = mkEnv();
  const doc = throwDoc('4');
  const { body } = await send(env, doc, pictures(doc));
  assert.ok(body.order, 'a designer request for a throw becomes an order');
  const res = await adminOrder.onRequestGet({ request: adminReq('GET', '/x'), env, params: { id: body.ref } });
  assert.equal(res.status, 200);
  const detail = await res.json();
  const intake = detail.request;
  assert.deepEqual(intake.previews.map((p) => [p.file, p.kind, p.side]), [
    ['preview-0.png', 'flat', null], ['preview-1.png', 'side', 0], ['preview-2.png', 'side', 1],
    ['preview-3.png', 'side', 2], ['preview-4.png', 'side', 3], ['preview-5.png', 'side', 4],
  ]);
  assert.equal(intake.files.filter((f) => f.name.startsWith('preview-')).length, 6);
  assert.deepEqual(intake.pieces[0].sides.map((s) => s.name), ['Front', 'Top', 'Left end', 'Right end', 'Back']);
  assert.match(intake.pieces[0].sides[4].reads, /turned 180 degrees/);
  assert.deepEqual(intake.pieces[0].sides[2].text, ['HONEYDROP']);
  // an order made by hand has no design to describe
  assert.equal(detail.order.id, body.ref);
});
