import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv } from './helpers.mjs';
import { layoutText, fitText, alignInk, capHeight, isTooSmall } from '../../../assets/design/model/layout.js';

const env = loadEnv();

test('wraps words to the box width and centers lines', () => {
  const el = { text: 'HARBOR AND RYE COFFEE', font: 'condensed', size: 4, lh: 1, ls: 0, caps: false, w: 30, align: 'center' };
  const lay = layoutText(el, env.measure, env.fonts);
  assert.ok(lay.lines.length >= 2);
  for (const l of lay.lines) {
    assert.ok(l.width <= 30 + 1e-9, 'line within width: ' + l.text);
    assert.ok(Math.abs(l.x - (30 - l.width) / 2) < 1e-9);
  }
  assert.equal(lay.blockH, lay.lines.length * 4);
});

test('breaks a word that is wider than the box', () => {
  const el = { text: 'SUPERCALIFRAGILISTIC', font: 'archivo', size: 3, lh: 1, ls: 0, w: 10, align: 'left' };
  const lay = layoutText(el, env.measure, env.fonts);
  assert.ok(lay.lines.length > 1);
  assert.equal(lay.lines.map((l) => l.text).join(''), 'SUPERCALIFRAGILISTIC');
});

test('respects explicit line breaks, caps and letter spacing', () => {
  const el = { text: 'one\ntwo', font: 'barlow', size: 2, lh: 1.1, ls: 0.1, caps: true, w: 40, align: 'left' };
  const lay = layoutText(el, env.measure, env.fonts);
  assert.deepEqual(lay.lines.map((l) => l.text), ['ONE', 'TWO']);
  const plain = layoutText({ ...el, ls: 0 }, env.measure, env.fonts);
  assert.ok(lay.lines[0].width > plain.lines[0].width);
});

test('cap height is centered in each line box', () => {
  const el = { text: 'AB', font: 'condensed', size: 10, lh: 1, ls: 0, w: 50, align: 'left' };
  const lay = layoutText(el, env.measure, env.fonts);
  const cap = capHeight(el, env.fonts);
  assert.ok(Math.abs(cap - 7) < 1e-9);
  assert.ok(Math.abs(lay.lines[0].baseline - (10 + 7) / 2) < 1e-9);
});

test('fitText returns the largest size that fits', () => {
  const spec = { text: 'NORTHLINE', font: 'condensed', lines: 1, boxW: 49, boxH: 35, max: 30 };
  const res = fitText(spec, env.measure, env.fonts);
  assert.ok(res.fits);
  assert.ok(res.layout.widest <= 49 + 1e-6);
  assert.ok(res.layout.inkH <= 35 + 1e-6);
  const bigger = layoutText({ ...spec, size: res.size * 1.05, lh: 1, w: 49 }, env.measure, env.fonts);
  assert.ok(bigger.widest > 49 || bigger.inkH > 35 || bigger.lines.length > 1, 'a slightly bigger size must not fit');
});

test('fitText honors max lines and the max size', () => {
  const two = fitText({ text: 'MAPLE STREET', font: 'condensed', lines: 2, boxW: 19, boxH: 40, max: 9 }, env.measure, env.fonts);
  assert.ok(two.layout.lines.length <= 2);
  assert.ok(two.size <= 9 + 1e-6);
  const one = fitText({ text: 'MAPLE STREET', font: 'condensed', lines: 1, boxW: 19, boxH: 40, max: 9 }, env.measure, env.fonts);
  assert.equal(one.layout.lines.length, 1);
  assert.ok(one.size < two.size);
});

test('alignInk places the ink at top, middle and bottom', () => {
  const lay = layoutText({ text: 'A', font: 'condensed', size: 10, lh: 1, ls: 0, w: 20, align: 'left' }, env.measure, env.fonts);
  const top = alignInk(lay, 100, 50, 'top');
  const mid = alignInk(lay, 100, 50, 'middle');
  const bot = alignInk(lay, 100, 50, 'bottom');
  assert.ok(Math.abs(top + lay.inkTop - 100) < 1e-9);
  assert.ok(Math.abs(mid + lay.inkTop + lay.inkH / 2 - 125) < 1e-9);
  assert.ok(Math.abs(bot + lay.inkTop + lay.inkH - 150) < 1e-9);
});

test('readability check compares cap height to the product minimum', () => {
  const el = { type: 'text', text: 'SALE', font: 'condensed', size: 3, hidden: false };
  assert.equal(isTooSmall(el, 3, env.fonts), true);
  assert.equal(isTooSmall({ ...el, size: 5 }, 3, env.fonts), false);
  assert.equal(isTooSmall({ ...el, text: '  ' }, 3, env.fonts), false);
});
