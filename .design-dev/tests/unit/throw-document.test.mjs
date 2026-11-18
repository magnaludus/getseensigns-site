// The table throw as a document: five panels (front, top, left end, right end, back) that are edited one at a
// time, how they come and go with the options, one-click fills, old links and saved designs, and the review rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv } from './helpers.mjs';
import {
  createDocument, setChoices, applyTemplate, setSidesMode, validateDocument, migrateDocument, sideNamesFor, productOf, setField,
  addLogo, placeLogo, addElement, updateElement, clearSide, hasPanels, sideLabel, setPalette, plainBg, setBackground,
} from '../../../assets/design/model/document.js';
import { quickFill, quickFillOptions, panelIndex } from '../../../assets/design/model/quickfill.js';
import { specForSide } from '../../../assets/design/model/specs.js';
import { elementBox } from '../../../assets/design/model/layout.js';
import { aabb } from '../../../assets/design/model/geometry.js';
import { collectWarnings } from '../../../assets/design/model/review.js';
import { sideDisplay } from '../../../assets/design/render/displaylist.js';
import { encodeDoc, decodeDoc } from '../../../assets/design/model/share.js';

const env = loadEnv();
const make = (length = '6', style = '4') => createDocument(env, 'throw', { choices: { length, style } });
const piece = (doc) => doc.project.pieces[0];
const names = (doc) => piece(doc).sides.map((s) => s.name);
const inside = (box, safe, eps = 0.06) => box.x >= safe.x - eps && box.y >= safe.y - eps && box.x + box.w <= safe.x + safe.w + eps && box.y + box.h <= safe.y + safe.h + eps;

test('a new throw has a panel for every printed side, edited one at a time, and only the front starts with art', () => {
  for (const [style, want] of [['3', ['Front', 'Top', 'Left end', 'Right end']], ['4', ['Front', 'Top', 'Left end', 'Right end', 'Back']], ['fitted', ['Front']]]) {
    const doc = make('6', style);
    assert.deepEqual(names(doc), want, style);
    assert.equal(piece(doc).sidesMode, 'each', 'a throw is never "the same on every side"');
    assert.deepEqual(validateDocument(doc, env).errors, [], style);
    assert.ok(piece(doc).sides[0].elements.length >= 3, 'the front has the template');
    piece(doc).sides.slice(1).forEach((side) => {
      assert.deepEqual(side.elements, [], `${style} ${side.name} starts plain`);
      assert.equal(side.edited, false);
      assert.deepEqual(side.bg, piece(doc).sides[0].bg, 'plain panels follow the front background');
    });
  }
  const product = productOf(env, 'throw');
  assert.equal(hasPanels(product), true);
  assert.equal(hasPanels(productOf(env, 'canopy')), false);
  assert.deepEqual(sideNamesFor(product, { length: '6', style: '4' }), ['Front', 'Top', 'Left end', 'Right end', 'Back']);
  assert.equal(sideLabel(product, names(make()), 2), 'Left end panel');
  assert.equal(sideLabel(productOf(env, 'canopy'), ['Front'], 0), 'Front side', 'tents keep their wording');
});

test('the front keeps the printer\'s template layout and every other panel is the size the printer cut it', () => {
  const doc = make('8', '4');
  piece(doc).sides.forEach((side, si) => {
    const spec = specForSide(env.specs, 'throw', piece(doc).choices, si);
    const d = sideDisplay(doc, 0, si, env, { region: 'trim' });
    assert.deepEqual(d.area, spec.trim, side.name);
  });
  // the front is laid out from the same print area as before this change
  const front = specForSide(env.specs, 'throw', piece(doc).choices, 0);
  assert.deepEqual(front.artboard, { w: 96.03, h: 27.59 });
  assert.ok(piece(doc).sides[0].elements.length >= 3);
});

test('switching 3-sided and 4-sided adds and drops the back, and leaves the other panels alone', () => {
  let doc = make('6', '3');
  doc = quickFill(doc, 0, 'name-ends', env).doc;
  const endsBefore = JSON.stringify(piece(doc).sides[2].elements.map((e) => e.text));
  const four = setChoices(doc, 0, { style: '4' }, env);
  assert.deepEqual(names(four), ['Front', 'Top', 'Left end', 'Right end', 'Back']);
  assert.deepEqual(piece(four).sides[4].elements, [], 'the new back is plain, not a copy of the front');
  assert.equal(JSON.stringify(piece(four).sides[2].elements.map((e) => e.text)), endsBefore, 'the end art survives');
  assert.deepEqual(validateDocument(four, env).errors, []);
  const three = setChoices(four, 0, { style: '3' }, env);
  assert.deepEqual(names(three), ['Front', 'Top', 'Left end', 'Right end']);
  assert.deepEqual(validateDocument(three, env).errors, []);
  const fitted = setChoices(four, 0, { style: 'fitted' }, env);
  assert.deepEqual(names(fitted), ['Front']);
  assert.deepEqual(validateDocument(fitted, env).errors, []);
});

test('changing the table size scales each edited panel by its own print area, not the front\'s', () => {
  let doc = make('6', '4');
  doc = quickFill(doc, 0, 'name-ends', env).doc;
  const before = piece(doc).sides[2];
  const el = before.elements[0];
  const from = specForSide(env.specs, 'throw', { length: '6', style: '4' }, 2).artboard;
  const to = specForSide(env.specs, 'throw', { length: '8', style: '4' }, 2).artboard;
  const frontFrom = specForSide(env.specs, 'throw', { length: '6', style: '4' }, 0).artboard;
  const frontTo = specForSide(env.specs, 'throw', { length: '8', style: '4' }, 0).artboard;
  assert.ok(Math.abs(frontTo.w / frontFrom.w - 1) > 0.2, 'the front grows a lot from 6 to 8 ft');
  assert.ok(Math.abs(to.w / from.w - 1) < 0.02, 'an end is nearly the same size');
  const eight = setChoices(doc, 0, { length: '8' }, env);
  const after = piece(eight).sides[2].elements.find((e) => e.id === el.id);
  near(after.x, el.x * (to.w / from.w), 1e-6, 'x follows the end\'s own scale');
  near(after.w, el.w * (to.w / from.w), 1e-6, 'width follows the end\'s own scale');
  assert.ok(inside(aabb(elementBox(after, env.measure, env.fonts)), { x: 0, y: 0, ...to }, 3), 'the end art is still on the end');
  assert.deepEqual(validateDocument(eight, env).errors, []);
  // the front, never edited, is laid out again for the new size: the same as a new 8 ft design
  const fresh = piece(make('8', '4')).sides[0].elements.find((e) => e.type === 'text' && e.bind === 'name');
  const frontText = piece(eight).sides[0].elements.find((e) => e.type === 'text' && e.bind === 'name');
  near(frontText.size, fresh.size, 1e-9, 'front headline size');
  near(frontText.w, fresh.w, 1e-9, 'front headline width');
});

test('choosing a look for the front sets the colors, lines the plain panels up with it and keeps the quick-filled words current', () => {
  let doc = make('6', '4');
  doc = quickFill(doc, 0, 'name-ends', env).doc;
  const tpl = env.templates.throw.find((t) => t.id === 'split-field');
  const next = applyTemplate(doc, 0, 0, 'split-field', env);
  assert.deepEqual(next.project.palette, tpl.palette, 'untouched colors follow the template');
  assert.equal(next.project.fields.name, tpl.sample.name);
  assert.equal(piece(next).templateId, 'split-field');
  assert.equal(piece(next).sides[0].templateId, 'split-field');
  // the end and back words follow the business name from the new template
  for (const id of ['left', 'right', 'back']) {
    const texts = piece(next).sides[panelIndex(piece(next), id)].elements.filter((e) => e.type === 'text');
    assert.ok(texts.length && texts.every((e) => e.text === tpl.sample.name), `${id} shows ${tpl.sample.name}`);
  }
  // the plain panels (top) follow the front's background, the edited ones keep theirs
  assert.deepEqual(piece(next).sides[1].bg, plainBg(piece(next).sides[0].bg));
  // a look for one panel lays out that panel only and leaves the colors alone
  const top = applyTemplate(doc, 0, 1, 'band-stripe', env);
  assert.deepEqual(top.project.palette, doc.project.palette);
  assert.deepEqual(piece(top).sides[0].elements, piece(doc).sides[0].elements, 'the front is untouched');
  assert.equal(piece(top).sides[1].templateId, 'band-stripe');
  assert.ok(piece(top).sides[1].elements.length >= 3);
  const spec = specForSide(env.specs, 'throw', piece(top).choices, 1);
  for (const e of piece(top).sides[1].elements.filter((x) => x.type === 'text')) assert.ok(inside(aabb(elementBox(e, env.measure, env.fonts)), spec.safe), 'the layout fits the top panel');
});

test('the front\'s background sets the color of the whole cover, until a panel is given a background of its own', () => {
  let doc = quickFill(make('6', '4'), 0, 'name-ends', env).doc;
  const gradient = { type: 'gradient', from: '#112233', to: '#445566', angle: 90 };
  const front = setBackground(doc, 0, 0, gradient, env);
  assert.deepEqual(piece(front).sides[0].bg, gradient, 'the front keeps its gradient');
  for (const si of [1, 2, 3, 4]) assert.deepEqual(piece(front).sides[si].bg, { type: 'solid', color: '#112233' }, `${piece(front).sides[si].name} follows the front (edited or not)`);
  // a panel with its own background keeps it, and the cover's color no longer reaches it
  const own = setBackground(front, 0, 1, { type: 'solid', color: '#AA0000' }, env);
  assert.equal(piece(own).sides[1].bgOwn, true);
  const again = setBackground(own, 0, 0, { type: 'solid', color: '#00AA00' }, env);
  assert.deepEqual(piece(again).sides[1].bg, { type: 'solid', color: '#AA0000' }, 'the top keeps its own');
  for (const si of [2, 3, 4]) assert.deepEqual(piece(again).sides[si].bg, { type: 'solid', color: '#00AA00' }, piece(again).sides[si].name);
  assert.deepEqual(validateDocument(again, env).errors, []);
  // choosing a look for the front keeps following too, and leaves an own background alone
  const tpl = applyTemplate(again, 0, 0, 'split-field', env);
  assert.deepEqual(piece(tpl).sides[1].bg, { type: 'solid', color: '#AA0000' });
  assert.deepEqual(piece(tpl).sides[2].bg, plainBg(piece(tpl).sides[0].bg));
  // other products set one side's background and nothing else
  const tent = setBackground(setSidesMode(createDocument(env, 'canopy'), 0, 'each', env), 0, 0, { type: 'solid', color: '#123456' }, env);
  assert.deepEqual(piece(tent).sides[1].bg, piece(createDocument(env, 'canopy')).sides[1].bg);
});

test('"the same on every side" is refused for a throw, and a design that says so is invalid', () => {
  const doc = make();
  assert.equal(setSidesMode(doc, 0, 'same', env), doc);
  const bad = JSON.parse(JSON.stringify(doc));
  bad.project.pieces[0].sidesMode = 'same';
  assert.ok(validateDocument(bad, env).errors.includes('sidesMode'));
  // tents still can
  const tent = createDocument(env, 'canopy');
  assert.equal(setSidesMode(setSidesMode(tent, 0, 'each', env), 0, 'same', env).project.pieces[0].sidesMode, 'same');
});

test('an old throw with only a front panel gets plain panels from the migration, a share link and the server', async () => {
  const fresh = make('6', '4');
  const old = JSON.parse(JSON.stringify(fresh));
  old.project.pieces[0].sides = [old.project.pieces[0].sides[0]];
  old.project.pieces[0].sides[0].name = 'Front panel';
  old.project.pieces[0].sidesMode = 'same';
  assert.ok(validateDocument(old, env).errors.length > 0, 'the old shape is not valid as it stands');
  // the server reads designs with the catalog only
  const server = { catalog: env.catalog, fonts: env.catalog.fonts };
  const migrated = migrateDocument(JSON.parse(JSON.stringify(old)), server);
  assert.deepEqual(validateDocument(migrated, server).errors, []);
  assert.deepEqual(names(migrated), ['Front', 'Top', 'Left end', 'Right end', 'Back']);
  assert.equal(piece(migrated).sidesMode, 'each');
  assert.deepEqual(piece(migrated).sides[0].elements, piece(fresh).sides[0].elements, 'the front is exactly what it was');
  piece(migrated).sides.slice(1).forEach((s) => assert.deepEqual(s.elements, [], s.name));
  // an old share link
  const hash = await encodeDoc(old);
  const opened = await decodeDoc(hash, env);
  assert.ok(opened, 'the old link still opens');
  assert.deepEqual(names(opened), ['Front', 'Top', 'Left end', 'Right end', 'Back']);
  assert.deepEqual(piece(opened).sides[0].elements.map((e) => e.text), piece(fresh).sides[0].elements.map((e) => e.text));
  // a tent link is not touched
  const tent = await decodeDoc(await encodeDoc(createDocument(env, 'canopy')), env);
  assert.equal(piece(tent).sides.length, 4);
  // a new link keeps every panel
  const mine = quickFill(fresh, 0, 'name-ends', env).doc;
  const round = await decodeDoc(await encodeDoc(mine), env);
  assert.deepEqual(piece(round).sides.map((s) => s.elements.map((e) => e.text || e.type)), piece(mine).sides.map((s) => s.elements.map((e) => e.text || e.type)));
});

test('quick fill: "Logo on top" puts a logo frame (or the customer\'s logo) on the top panel only, once', () => {
  const doc = make('6', '4');
  const options = quickFillOptions(doc, 0, env);
  assert.deepEqual(options.map((o) => [o.id, o.label]), [['logo-top', 'Logo on top'], ['name-ends', 'Business name on back and ends']]);
  const res = quickFill(doc, 0, 'logo-top', env);
  assert.deepEqual(res.changed, [1]);
  const top = piece(res.doc).sides[1];
  assert.equal(top.elements.length, 1);
  assert.equal(top.edited, true);
  const frame = top.elements[0];
  assert.equal(frame.type, 'image');
  assert.equal(frame.logoId, null, 'no logo uploaded yet, so it is an empty frame the customer fills');
  const spec = specForSide(env.specs, 'throw', piece(doc).choices, 1);
  assert.ok(inside(aabb(elementBox(frame, env.measure, env.fonts)), spec.safe), 'the frame is inside the top panel\'s safe area');
  assert.ok(Math.abs(frame.x + frame.w / 2 - (spec.safe.x + spec.safe.w / 2)) < 0.1 && Math.abs(frame.y + frame.h / 2 - (spec.safe.y + spec.safe.h / 2)) < 0.1, 'centered');
  assert.deepEqual(piece(res.doc).sides[0].elements, piece(doc).sides[0].elements, 'the front is untouched');
  // pressing it again does not stack a second frame
  const again = quickFill(res.doc, 0, 'logo-top', env);
  assert.deepEqual(again.changed, []);
  assert.deepEqual(again.skipped, [1]);
  assert.equal(piece(again.doc).sides[1].elements.length, 1);
  // with a logo already uploaded, it goes straight in
  const withLogo = addLogo(doc, { id: 'l1', name: 'mark.png', w: 400, h: 200, type: 'image/png' }).doc;
  const filled = quickFill(withLogo, 0, 'logo-top', env);
  const logo = piece(filled.doc).sides[1].elements[0];
  assert.equal(logo.logoId, 'l1');
  assert.ok(Math.abs(logo.w / logo.h - 2) < 1e-6, 'the logo keeps its shape');
  assert.ok(inside(aabb(elementBox(logo, env.measure, env.fonts)), spec.safe));
});

test('quick fill: "Business name on back and ends" fills both ends and the back, in each panel\'s safe area, following the name', () => {
  const doc = make('6', '4');
  const res = quickFill(doc, 0, 'name-ends', env);
  assert.deepEqual(res.changed, [2, 3, 4], 'left end, right end, back');
  for (const si of res.changed) {
    const side = piece(res.doc).sides[si];
    assert.equal(side.edited, true);
    const texts = side.elements.filter((e) => e.type === 'text');
    assert.equal(texts.length, 1, side.name);
    assert.equal(texts[0].bind, 'name', 'the words follow the business name field');
    assert.equal(texts[0].text, doc.project.fields.name);
    const spec = specForSide(env.specs, 'throw', piece(doc).choices, si);
    assert.ok(inside(aabb(elementBox(texts[0], env.measure, env.fonts)), spec.safe), `${side.name} text is inside its safe area`);
    // big enough to read from across a room: well over the 2 in minimum letter height
    assert.ok(texts[0].size > 3, `${side.name} size ${texts[0].size}`);
  }
  assert.deepEqual(piece(res.doc).sides[1].elements, [], 'the top is not touched');
  assert.deepEqual(piece(res.doc).sides[0].elements, piece(doc).sides[0].elements, 'the front is not touched');
  // changing the name changes all of them
  const renamed = setField(res.doc, 'name', 'ACME ROOFING', env);
  for (const si of [2, 3, 4]) assert.equal(piece(renamed).sides[si].elements[0].text, 'ACME ROOFING');
  // once
  assert.deepEqual(quickFill(res.doc, 0, 'name-ends', env).changed, []);
  // a 3-sided throw has no back, and says so
  const open = make('6', '3');
  const o = quickFillOptions(open, 0, env).find((x) => x.id === 'name-ends');
  assert.equal(o.label, 'Business name on both ends');
  assert.deepEqual(quickFill(open, 0, 'name-ends', env).changed, [2, 3]);
  assert.equal(panelIndex(piece(open), 'back'), -1);
  // not a throw: nothing to offer
  assert.deepEqual(quickFillOptions(createDocument(env, 'canopy'), 0, env), []);
  assert.deepEqual(quickFill(createDocument(env, 'canopy'), 0, 'logo-top', env).changed, []);
  // all four sizes
  for (const [length, style] of [['6', '3'], ['6', '4'], ['8', '3'], ['8', '4']]) {
    const d = quickFill(quickFill(make(length, style), 0, 'name-ends', env).doc, 0, 'logo-top', env).doc;
    assert.deepEqual(validateDocument(d, env).errors, [], `${length}-${style}`);
    // what the quick fills add raises no warnings (the front's own template layout is not part of this)
    assert.deepEqual(collectWarnings(d, env, new Map()).filter((w) => w.si > 0 && (w.kind === 'safe' || w.kind === 'small')), [], `${length}-${style} quick fills raise no warnings`);
  }
});

test('"Clear this panel" takes everything off one panel and nothing else', () => {
  let doc = quickFill(make('6', '4'), 0, 'name-ends', env).doc;
  const cleared = clearSide(doc, 0, 2);
  assert.deepEqual(piece(cleared).sides[2].elements, []);
  assert.deepEqual(piece(cleared).sides[3].elements, piece(doc).sides[3].elements);
  assert.equal(clearSide(cleared, 0, 2), cleared, 'nothing to clear');
  const front = clearSide(doc, 0, 0);
  assert.deepEqual(piece(front).sides[0].elements, []);
  assert.equal(piece(front).sides[0].edited, true, 'a cleared front is not laid out again by a size change');
  assert.deepEqual(piece(setChoices(front, 0, { length: '8' }, env)).sides[0].elements, []);
});

test('a logo with no frame goes in the middle of the safe area of the panel being edited', () => {
  let doc = make('6', '4');
  doc = addLogo(doc, { id: 'l1', name: 'mark.png', w: 300, h: 300, type: 'image/png' }).doc;
  const placed = placeLogo(doc, 0, 3, 'l1', env).doc;
  const el = piece(placed).sides[3].elements[0];
  const spec = specForSide(env.specs, 'throw', piece(doc).choices, 3);
  assert.ok(inside(aabb(elementBox(el, env.measure, env.fonts)), spec.safe));
  near(el.x + el.w / 2, spec.safe.x + spec.safe.w / 2, 1e-6);
  assert.deepEqual(piece(placed).sides[0].elements, piece(doc).sides[0].elements);
});

test('review: art past a panel\'s safe area is flagged by panel, and a 3-sided end needs more room next to the open back', () => {
  const textAt = (doc, si, x, y) => {
    const base = { type: 'text', name: 'T', text: 'HELLO', bind: null, font: 'condensed', size: 3, lh: 1, ls: 0, align: 'left', caps: true, fill: '@ink', stroke: null, fit: null, x, y, w: 8 };
    return addElement(doc, 0, si, base);
  };
  const warn = (doc) => collectWarnings(doc, env, new Map()).filter((w) => w.kind === 'safe');
  // top panel: 3 in margins
  assert.equal(warn(textAt(make('6', '4'), 1, 10, 4)).length, 0);
  const hit = warn(textAt(make('6', '4'), 1, 1, 4));
  assert.equal(hit.length, 1);
  assert.equal(hit[0].si, 1);
  assert.match(hit[0].message, /\(Top panel\)/);
  // the same spot on the left end: fine with the end sewn to a back, too close to the open hem on a 3-sided throw
  const x = 4;
  assert.equal(warn(textAt(make('6', '4'), 2, x, 6)).length, 0, '4-sided: 3 in is enough');
  const open = warn(textAt(make('6', '3'), 2, x, 6));
  assert.equal(open.length, 1, '3-sided: the open hem needs more');
  assert.match(open[0].message, /\(Left end panel\)/);
  // and from the other side: the right end's open hem is on its right, so a word that ends 23 in across is too close to it
  assert.equal(warn(textAt(make('6', '3'), 3, 15, 6)).length, 1, '3-sided right end: the safe area stops 6 in from its right edge');
  assert.equal(warn(textAt(make('6', '4'), 3, 15, 6)).length, 0, '4-sided right end: 3 in at its back edge is enough');
});

test('palette changes reach every panel, because the panels hold color names and not colors', () => {
  const doc = quickFill(make('6', '4'), 0, 'name-ends', env).doc;
  const next = setPalette(doc, { primary: '#112233', ink: '#FFEEDD' });
  for (const side of piece(next).sides) assert.ok(JSON.stringify(side.bg).includes('@primary'), side.name);
  const d = sideDisplay(next, 0, 3, env, { region: 'trim' });
  assert.equal(d.bg.color, '#112233');
  assert.equal(d.items[0].fill, '#FFEEDD');
});

function near(a, b, tol = 1e-6, msg = '') {
  assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);
}
