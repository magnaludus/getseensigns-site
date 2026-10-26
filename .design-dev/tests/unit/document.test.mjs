import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv } from './helpers.mjs';
import {
  createDocument, updateElement, setField, setChoices, setQty, setSidesMode, applyTemplate, addLogo, placeLogo,
  removeLogo, addElement, removeElements, duplicateElements, reorderElement, validateDocument, effectiveSide,
  copySide, setPalette, sideNamesFor, productOf, defaultChoices,
} from '../../../assets/design/model/document.js';
import { createHistory } from '../../../assets/design/model/history.js';
import { elementBox } from '../../../assets/design/model/layout.js';
import { specFor } from '../../../assets/design/model/specs.js';

const env = loadEnv();
const ids = ['canopy', 'feather', 'yard', 'throw', 'banner'];

test('every product creates a valid document with its sides', () => {
  for (const id of ids) {
    const doc = createDocument(env, id);
    const piece = doc.project.pieces[0];
    const product = productOf(env, id);
    assert.equal(piece.sides.length, sideNamesFor(product, piece.choices).length, id);
    assert.ok(piece.sides[0].elements.length >= 3, id);
    const check = validateDocument(doc, env);
    assert.deepEqual(check.errors, [], id);
  }
});

test('commands do not mutate the old document', () => {
  const doc = createDocument(env, 'canopy');
  const frozen = JSON.stringify(doc);
  const side = doc.project.pieces[0].sides[0];
  const first = side.elements.find((e) => e.type === 'text');
  const next = updateElement(doc, 0, 0, first.id, { x: first.x + 5 }, env);
  assert.equal(JSON.stringify(doc), frozen);
  assert.notEqual(next, doc);
  assert.equal(next.project.pieces[0].sides[0].elements.find((e) => e.id === first.id).x, first.x + 5);
  assert.equal(next.project.pieces[0].sides[0].edited, true);
});

test('moving a fitted text drops its fit, retyping refits it', () => {
  const doc = createDocument(env, 'yard');
  const el = doc.project.pieces[0].sides[0].elements.find((e) => e.type === 'text' && e.bind === 'name');
  assert.ok(el.fit);
  const moved = updateElement(doc, 0, 0, el.id, { x: el.x + 1 }, env);
  assert.equal(moved.project.pieces[0].sides[0].elements.find((e) => e.id === el.id).fit, null);
  const retyped = updateElement(doc, 0, 0, el.id, { text: 'A' }, env);
  const after = retyped.project.pieces[0].sides[0].elements.find((e) => e.id === el.id);
  assert.ok(after.fit);
  assert.ok(after.size !== el.size);
});

test('editing a field updates every bound text on every side', () => {
  let doc = createDocument(env, 'canopy');
  doc = setSidesMode(doc, 0, 'each');
  doc = setField(doc, 'name', 'RIVER CITY', env);
  for (const side of doc.project.pieces[0].sides) {
    const bound = side.elements.filter((e) => e.type === 'text' && e.bind === 'name');
    assert.ok(bound.length >= 1);
    for (const e of bound) assert.equal(e.text, 'RIVER CITY');
  }
  assert.equal(doc.project.touched.fields, true);
});

test('same mode draws side 0 everywhere, each mode copies it first', () => {
  let doc = createDocument(env, 'canopy');
  const piece = doc.project.pieces[0];
  assert.equal(effectiveSide(piece, 2), piece.sides[0]);
  doc = setSidesMode(doc, 0, 'each');
  const p2 = doc.project.pieces[0];
  assert.equal(p2.sides.length, 4);
  assert.notEqual(p2.sides[1].elements[0].id, p2.sides[0].elements[0].id);
  assert.equal(p2.sides[1].elements.length, p2.sides[0].elements.length);
  const idsAll = p2.sides.flatMap((s) => s.elements.map((e) => e.id));
  assert.equal(new Set(idsAll).size, idsAll.length);
  const edited = updateElement(doc, 0, 2, p2.sides[2].elements[3].id, { text: 'BACK SIDE' }, env);
  assert.notEqual(effectiveSide(edited.project.pieces[0], 2).elements[3].text, effectiveSide(edited.project.pieces[0], 0).elements[3].text);
});

test('yard sign print option adds and removes the back side', () => {
  let doc = createDocument(env, 'yard');
  assert.equal(doc.project.pieces[0].sides.length, 1);
  doc = setChoices(doc, 0, { print: '2' }, env);
  assert.equal(doc.project.pieces[0].sides.length, 2);
  assert.equal(doc.project.pieces[0].sides[1].name, 'Back');
  doc = setChoices(doc, 0, { print: '1' }, env);
  assert.equal(doc.project.pieces[0].sides.length, 1);
});

test('changing the banner size re-lays out an untouched design and scales an edited one', () => {
  let doc = createDocument(env, 'banner', { choices: { size: '2x4' } });
  const redone = setChoices(doc, 0, { size: '4x8' }, env);
  const spec = specFor(env.specs, 'banner', { size: '4x8' });
  const el = redone.project.pieces[0].sides[0].elements.find((e) => e.type === 'text' && e.bind === 'name');
  assert.ok(el.x >= spec.safe.x - 1e-6 && el.x + el.w <= spec.safe.x + spec.safe.w + 1e-6);
  const name = doc.project.pieces[0].sides[0].elements.find((e) => e.type === 'text' && e.bind === 'name');
  doc = updateElement(doc, 0, 0, name.id, { x: name.x + 1 }, env);
  const scaled = setChoices(doc, 0, { size: '4x8' }, env);
  const moved = scaled.project.pieces[0].sides[0].elements.find((e) => e.id === name.id);
  assert.ok(Math.abs(moved.x - (name.x + 1) * 2) < 1e-6);
});

test('quantity is clamped and fixed for yard packs', () => {
  const doc = createDocument(env, 'canopy');
  assert.equal(setQty(doc, 0, 99).project.pieces[0].qty, 20);
  assert.equal(setQty(doc, 0, 0).project.pieces[0].qty, 1);
  const yard = createDocument(env, 'yard');
  assert.equal(validateDocument(setQty(yard, 0, 3), env).ok, false);
});

test('applying a template follows brand colors only until the customer sets their own', () => {
  let doc = createDocument(env, 'feather');
  const other = env.templates.feather[1];
  const swapped = applyTemplate(doc, 0, 0, other.id, env);
  assert.equal(swapped.project.palette.primary, other.palette.primary);
  assert.equal(swapped.project.fields.name, other.sample.name);
  doc = setPalette(doc, { primary: '#112233' });
  doc = setField(doc, 'name', 'MY SHOP', env);
  const kept = applyTemplate(doc, 0, 0, other.id, env);
  assert.equal(kept.project.palette.primary, '#112233');
  assert.equal(kept.project.fields.name, 'MY SHOP');
  const bound = kept.project.pieces[0].sides[0].elements.find((e) => e.type === 'text' && e.bind === 'name');
  assert.equal(bound.text, 'MY SHOP');
});

test('logo goes into the empty frame, then is cleared when removed', () => {
  let doc = createDocument(env, 'yard', { templateId: 'split-field' });
  const added = addLogo(doc, { name: 'mark.png', w: 400, h: 200, type: 'image/png' });
  doc = added.doc;
  const placed = placeLogo(doc, 0, 0, added.logo.id, env);
  const el = placed.doc.project.pieces[0].sides[0].elements.find((e) => e.id === placed.id);
  assert.equal(el.logoId, added.logo.id);
  assert.ok(Math.abs(el.w / el.h - 2) < 1e-6);
  const removed = removeLogo(placed.doc, added.logo.id);
  assert.equal(removed.project.pieces[0].sides[0].elements.find((e) => e.id === placed.id).logoId, null);
  assert.equal(removed.project.logos.length, 0);
});

test('a logo with no empty frame becomes a new centered element', () => {
  let doc = createDocument(env, 'banner', { templateId: 'bold-center' });
  const added = addLogo(doc, { name: 'mark.png', w: 100, h: 100, type: 'image/png' });
  const before = added.doc.project.pieces[0].sides[0].elements.length;
  const placed = placeLogo(added.doc, 0, 0, added.logo.id, env);
  assert.equal(placed.doc.project.pieces[0].sides[0].elements.length, before + 1);
});

test('add, duplicate, reorder and remove elements', () => {
  let doc = createDocument(env, 'throw');
  const side = () => doc.project.pieces[0].sides[0];
  const n = side().elements.length;
  doc = addElement(doc, 0, 0, { type: 'shape', kind: 'rect', name: 'Box', x: 1, y: 1, w: 4, h: 4, fill: '@accent' });
  assert.equal(side().elements.length, n + 1);
  const added = side().elements[n];
  const dup = duplicateElements(doc, 0, 0, [added.id], 2);
  doc = dup.doc;
  assert.equal(side().elements.length, n + 2);
  assert.equal(dup.ids.length, 1);
  doc = reorderElement(doc, 0, 0, dup.ids[0], 'back');
  assert.equal(side().elements[0].id, dup.ids[0]);
  doc = reorderElement(doc, 0, 0, dup.ids[0], 'front');
  assert.equal(side().elements[side().elements.length - 1].id, dup.ids[0]);
  doc = removeElements(doc, 0, 0, [added.id, dup.ids[0]]);
  assert.equal(side().elements.length, n);
});

test('copy a side onto others with fresh ids', () => {
  let doc = setSidesMode(createDocument(env, 'canopy'), 0, 'each');
  doc = updateElement(doc, 0, 0, doc.project.pieces[0].sides[0].elements.find((e) => e.type === 'text').id, { text: 'FRONT ONLY' }, env);
  doc = copySide(doc, 0, 0, [1, 3]);
  const texts = doc.project.pieces[0].sides.map((s) => s.elements.find((e) => e.type === 'text').text);
  assert.equal(texts[1], 'FRONT ONLY');
  assert.equal(texts[3], 'FRONT ONLY');
  assert.notEqual(texts[2], 'FRONT ONLY');
});

test('validation rejects broken documents', () => {
  const good = createDocument(env, 'banner');
  const bad = JSON.parse(JSON.stringify(good));
  bad.project.pieces[0].sides[0].elements[0].x = NaN;
  assert.equal(validateDocument(bad, env).ok, false);
  const bad2 = JSON.parse(JSON.stringify(good));
  bad2.project.pieces[0].choices.size = '9x9';
  assert.equal(validateDocument(bad2, env).ok, false);
  const bad3 = JSON.parse(JSON.stringify(good));
  bad3.project.pieces[0].sides[0].elements.find((e) => e.type === 'text').font = 'comic';
  assert.equal(validateDocument(bad3, env).ok, false);
  assert.equal(validateDocument({ v: 1 }, env).ok, false);
});

test('history: 120 steps undo and redo, and coalescing', () => {
  let doc = createDocument(env, 'yard');
  const h = createHistory(doc, { limit: 200, coalesceMs: 500, now: (() => { let t = 0; return () => (t += 10); })() });
  const el = doc.project.pieces[0].sides[0].elements.find((e) => e.type === 'text');
  for (let i = 1; i <= 120; i++) {
    doc = updateElement(doc, 0, 0, el.id, { x: i }, env);
    h.push(doc);
  }
  assert.equal(h.size, 120);
  for (let i = 0; i < 120; i++) h.undo();
  assert.equal(h.canUndo, false);
  assert.equal(h.doc.project.pieces[0].sides[0].elements.find((e) => e.id === el.id).x, el.x);
  for (let i = 0; i < 120; i++) h.redo();
  assert.equal(h.doc.project.pieces[0].sides[0].elements.find((e) => e.id === el.id).x, 120);
  const before = h.size;
  h.push(updateElement(h.doc, 0, 0, el.id, { size: 1 }, env), 'size');
  h.push(updateElement(h.doc, 0, 0, el.id, { size: 2 }, env), 'size');
  h.push(updateElement(h.doc, 0, 0, el.id, { size: 3 }, env), 'size');
  assert.equal(h.size, before + 1);
  h.undo();
  assert.notEqual(h.doc.project.pieces[0].sides[0].elements.find((e) => e.id === el.id).size, 3);
});

test('a new edit after undo clears redo', () => {
  const doc = createDocument(env, 'banner');
  const h = createHistory(doc);
  const el = doc.project.pieces[0].sides[0].elements[0];
  h.push(updateElement(doc, 0, 0, el.id, { x: 5 }, env));
  h.undo();
  assert.equal(h.canRedo, true);
  h.push(updateElement(doc, 0, 0, el.id, { x: 6 }, env));
  assert.equal(h.canRedo, false);
});

test('element boxes use the text layout height', () => {
  const doc = createDocument(env, 'throw');
  const el = doc.project.pieces[0].sides[0].elements.find((e) => e.type === 'text');
  const box = elementBox(el, env.measure, env.fonts);
  assert.ok(box.h > 0 && box.w === el.w);
});

test('default choices cover every option group', () => {
  for (const id of ids) {
    const p = productOf(env, id);
    assert.deepEqual(Object.keys(defaultChoices(p)), p.groups.map((g) => g.id));
  }
});
