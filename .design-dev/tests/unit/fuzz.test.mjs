// A seeded random walk over the document commands: whatever sequence of edits, option changes,
// side changes and undo/redo a customer makes, the design stays valid, finite, serialisable and drawable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv } from './helpers.mjs';
import {
  createDocument, updateElement, setField, setChoices, setQty, setSidesMode, applyTemplate, addElement, removeElements,
  duplicateElements, reorderElement, validateDocument, copySide, setPalette, setBackground, sideNamesFor, productOf,
} from '../../../assets/design/model/document.js';
import { createHistory } from '../../../assets/design/model/history.js';
import { sideDisplay } from '../../../assets/design/render/displaylist.js';
import { specFor } from '../../../assets/design/model/specs.js';
import { encodeDoc, decodeDoc } from '../../../assets/design/model/share.js';

// FUZZ_STEPS and FUZZ_SEED let you run longer or different walks by hand.
const STEPS = Number(process.env.FUZZ_STEPS) || 220;
const SEED = Number(process.env.FUZZ_SEED) || 7;
const env = loadEnv();
const PRODUCTS = ['canopy', 'feather', 'yard', 'throw', 'banner'];
const WORDS = ['', 'A', 'RIDGELINE ROOFING', 'Two\nlines', 'x'.repeat(130), '😀 emoji 🚀', '<script>alert(1)</script>', 'مرحبا', '555-0142', 'ÅÄÖ ñ é', '   spaced   '];
const HEX = ['#12372B', '#FFD100', '#ffffff', '#000', '#E10600', '#0B3A66', '#F4F0E6'];
const SHAPES = ['rect', 'ellipse', 'triangle', 'star', 'chevron', 'badge'];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function everyNumberIsFinite(node, path = 'doc') {
  if (typeof node === 'number') {
    assert.ok(Number.isFinite(node), `${path} is ${node}`);
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => everyNumberIsFinite(v, `${path}[${i}]`));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) everyNumberIsFinite(v, `${path}.${k}`);
  }
}

function noUndefined(node, path = 'doc') {
  if (node === undefined) assert.fail(`${path} is undefined`);
  if (Array.isArray(node)) node.forEach((v, i) => noUndefined(v, `${path}[${i}]`));
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) noUndefined(v, `${path}.${k}`);
}

function checkDoc(doc, label) {
  const check = validateDocument(doc, env);
  assert.deepEqual(check.errors, [], label);
  everyNumberIsFinite(doc);
  noUndefined(doc, label);
  assert.deepEqual(JSON.parse(JSON.stringify(doc)), doc, label + ' is not plain JSON');
  doc.project.pieces.forEach((piece, pi) => {
    piece.sides.forEach((_, si) => {
      const list = sideDisplay(doc, pi, si, env, { region: 'trim' });
      for (const item of list.items) {
        for (const k of ['x', 'y', 'w', 'h']) assert.ok(Number.isFinite(item[k]), `${label} ${item.k} ${k} = ${item[k]}`);
      }
    });
  });
}

function oneStep(doc, hist, r) {
  const pick = (list) => list[Math.floor(r() * list.length)];
  const pi = 0;
  const piece = doc.project.pieces[pi];
  const si = piece.sidesMode === 'same' ? 0 : Math.floor(r() * piece.sides.length);
  const side = piece.sides[si];
  const spec = specFor(env.specs, piece.productId, piece.choices);
  const el = side.elements.length ? pick(side.elements) : null;
  const product = productOf(env, piece.productId);
  const span = (v, k) => v * k;
  const op = Math.floor(r() * 17);
  switch (op) {
    case 0:
      return el ? updateElement(doc, pi, si, el.id, { x: span(spec.art.w, r() * 1.4 - 0.2), y: span(spec.art.h, r() * 1.4 - 0.2) }, env) : doc;
    case 1:
      return el && el.type !== 'text' ? updateElement(doc, pi, si, el.id, { w: 0.2 + r() * spec.art.w, h: 0.2 + r() * spec.art.h }, env) : doc;
    case 2:
      return el ? updateElement(doc, pi, si, el.id, { rot: Math.round(r() * 720 - 360) + 0 }, env) : doc;
    case 3:
      return el && el.type === 'text' ? updateElement(doc, pi, si, el.id, { text: pick(WORDS).slice(0, 500) }, env) : doc;
    case 4:
      return el && el.type === 'text' ? updateElement(doc, pi, si, el.id, { size: 0.3 + r() * Math.min(spec.art.h, 60), w: 0.5 + r() * spec.art.w }, env) : doc;
    case 5:
      return el && el.type === 'text' ? updateElement(doc, pi, si, el.id, { font: pick(env.fonts).id, align: pick(['left', 'center', 'right']), caps: r() < 0.5, ls: r() * 0.3 - 0.05, lh: 0.8 + r() * 0.8 }, env) : doc;
    case 6:
      return setField(doc, pick(['name', 'line2', 'phone', 'web']), pick(WORDS), env);
    case 7:
      return setChoices(doc, pi, Object.fromEntries(product.groups.map((g) => [g.id, pick(g.choices).id])), env);
    case 8:
      return product.qty ? setQty(doc, pi, Math.floor(r() * 30) - 3) : doc;
    case 9:
      return piece.sides.length > 1 ? setSidesMode(doc, pi, pick(['same', 'each'])) : doc;
    case 10:
      return applyTemplate(doc, pi, si, pick(product.templates), env);
    case 11:
      return setPalette(doc, { primary: pick(HEX), accent: pick(HEX), ink: pick(HEX) });
    case 12:
      return addElement(doc, pi, si, { type: 'shape', kind: pick(SHAPES), name: 'Shape', x: r() * spec.art.w, y: r() * spec.art.h, w: 1 + r() * 20, h: 1 + r() * 20, fill: pick(['@primary', '@accent', '@ink', pick(HEX)]), stroke: r() < 0.3 ? { color: '@ink', w: r() * 3 } : null, rx: 0 });
    case 13:
      return el ? duplicateElements(doc, pi, si, [el.id], 1).doc : doc;
    case 14:
      return el && r() < 0.4 ? removeElements(doc, pi, si, [el.id]) : doc;
    case 15:
      return el ? reorderElement(doc, pi, si, el.id, pick(['front', 'back', 'forward', 'backward'])) : doc;
    default:
      return piece.sides.length > 1 ? copySide(doc, pi, si, piece.sides.map((_, i) => i).filter((i) => i !== si)) : setBackground(doc, pi, si, { type: 'gradient', from: '@primary', to: pick(HEX), angle: Math.round(r() * 360) });
  }
}

for (const id of PRODUCTS) {
  test(`random edits keep the ${id} design valid, finite and drawable`, () => {
    const r = rng(SEED + id.length * 31);
    let doc = createDocument(env, id);
    const hist = createHistory(doc, { coalesceMs: 0 });
    for (let step = 0; step < STEPS; step++) {
      const before = hist.doc;
      let next;
      try {
        next = oneStep(before, hist, r);
      } catch (err) {
        err.message = `${id} step ${step}: ${err.message}`;
        throw err;
      }
      if (r() < 0.12 && hist.canUndo) hist.undo();
      else if (r() < 0.06 && hist.canRedo) hist.redo();
      else hist.push(next);
      checkDoc(hist.doc, `${id} step ${step}`);
    }
    assert.ok(hist.size > 0);
  });
}

test('a random design survives a share link round trip', async () => {
  const r = rng(99);
  for (const id of PRODUCTS) {
    let doc = createDocument(env, id);
    for (let i = 0; i < 40; i++) doc = oneStep(doc, null, r);
    const hash = await encodeDoc(doc);
    const back = await decodeDoc(hash, env);
    assert.ok(back, `${id} did not decode`);
    assert.deepEqual(validateDocument(back, env).errors, [], id);
    assert.equal(back.project.pieces[0].productId, id);
  }
});
