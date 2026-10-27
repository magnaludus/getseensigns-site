import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv } from './helpers.mjs';
import { createDocument, updateElement, addLogo, placeLogo, setPalette } from '../../../assets/design/model/document.js';
import { collectWarnings } from '../../../assets/design/model/review.js';
import { dpiLevel, effectiveDpi, specFor } from '../../../assets/design/model/specs.js';
import { lowContrastText } from '../../../assets/design/model/contrast.js';
import { contrast, bestInk, normalizeHex, resolveColor, luminance } from '../../../assets/design/model/color.js';
import { sideDisplay } from '../../../assets/design/render/displaylist.js';

const env = loadEnv();

test('dpi is pixel width over placed inches, with green, amber and red levels', () => {
  assert.equal(effectiveDpi(1200, 8), 150);
  assert.equal(effectiveDpi(0, 8), null);
  const t = { greenMin: 150, amberMin: 100 };
  assert.equal(dpiLevel(150, t), 'green');
  assert.equal(dpiLevel(149.9, t), 'amber');
  assert.equal(dpiLevel(100, t), 'amber');
  assert.equal(dpiLevel(99, t), 'red');
  assert.equal(dpiLevel(null, t), 'green');
});

test('banners use their own dpi thresholds', () => {
  const banner = specFor(env.specs, 'banner', { size: '4x8' });
  assert.deepEqual(banner.dpi, { target: 100, greenMin: 100, amberMin: 72 });
  const yard = specFor(env.specs, 'yard', { pack: '5', print: '1' });
  assert.equal(yard.dpi.greenMin, 150);
});

test('a small logo placed large warns, a vector one does not', () => {
  let doc = createDocument(env, 'yard', { templateId: 'split-field' });
  const added = addLogo(doc, { name: 'tiny.png', w: 200, h: 200, type: 'image/png' });
  const placed = placeLogo(added.doc, 0, 0, added.logo.id, env);
  const assets = new Map([[added.logo.id, { id: added.logo.id, w: 200, h: 200, vector: false }]]);
  const warn = collectWarnings(placed.doc, env, assets).filter((w) => w.kind === 'dpi');
  assert.equal(warn.length, 1);
  assert.match(warn[0].message, /dpi/);
  const vector = new Map([[added.logo.id, { id: added.logo.id, w: 200, h: 200, vector: true }]]);
  assert.equal(collectWarnings(placed.doc, env, vector).filter((w) => w.kind === 'dpi').length, 0);
});

test('small text and content outside the safe zone are flagged', () => {
  let doc = createDocument(env, 'yard');
  const name = doc.project.pieces[0].sides[0].elements.find((e) => e.type === 'text' && e.bind === 'name');
  doc = updateElement(doc, 0, 0, name.id, { size: 1.2 }, env);
  assert.ok(collectWarnings(doc, env, new Map()).some((w) => w.kind === 'small'));
  doc = updateElement(doc, 0, 0, name.id, { x: -5, size: 6 }, env);
  assert.ok(collectWarnings(doc, env, new Map()).some((w) => w.kind === 'safe'));
});

test('the safe line follows the cut outline on the canopy and the flag', () => {
  const flagged = (doc, id) => collectWarnings(doc, env, new Map()).some((w) => w.kind === 'safe' && w.id === id);
  // canopy: the page corners above the roof are cut away, so text there is lost; centered on the roof it is fine
  const canopy = createDocument(env, 'canopy', { templateId: 'bold-center' });
  const cname = canopy.project.pieces[0].sides[0].elements.find((e) => e.type === 'text' && e.bind === 'name');
  assert.equal(flagged(canopy, cname.id), false, 'the template puts it in the peak');
  assert.equal(flagged(updateElement(canopy, 0, 0, cname.id, { x: 0, y: 2, size: 5 }, env), cname.id), true, 'top left corner of the page');
  assert.equal(flagged(updateElement(canopy, 0, 0, cname.id, { x: 76, y: 2, size: 5 }, env), cname.id), true, 'top right corner of the page');
  // flag: the lower right of the page is cut away by the slanted bottom
  const flag = createDocument(env, 'feather', { templateId: 'band-stripe' });
  const fname = flag.project.pieces[0].sides[0].elements.find((e) => e.type === 'text' && e.bind === 'name');
  assert.equal(flagged(flag, fname.id), false, 'the template puts it in the body');
  assert.equal(flagged(updateElement(flag, 0, 0, fname.id, { x: 10, y: 92, size: 4 }, env), fname.id), true, 'below the slanted bottom');
  // and a box that pokes out of the curved top on the pole side
  assert.equal(flagged(updateElement(flag, 0, 0, fname.id, { x: 2, y: 4, size: 4 }, env), fname.id), true, 'inside the cut-away top left');
});

test('contrast warnings find light text on a light background and clear when fixed', () => {
  let doc = createDocument(env, 'banner', { templateId: 'bold-center' });
  doc = setPalette(doc, { ink: '#FFD100' }); // yellow text on the yellow background
  const display = sideDisplay(doc, 0, 0, env, { region: 'trim' });
  assert.ok(lowContrastText(display).length > 0);
  assert.ok(collectWarnings(doc, env, new Map()).some((w) => w.kind === 'contrast'));
  doc = setPalette(doc, { ink: '#14161A' });
  assert.equal(lowContrastText(sideDisplay(doc, 0, 0, env, { region: 'trim' })).length, 0);
});

test('color helpers follow WCAG', () => {
  assert.ok(Math.abs(contrast('#000000', '#FFFFFF') - 21) < 1e-9);
  assert.ok(contrast('#777777', '#FFFFFF') < 4.6 && contrast('#777777', '#FFFFFF') > 4.4);
  assert.equal(bestInk('#FFD100'), '#14161A');
  assert.equal(bestInk('#14161A'), '#FFFFFF');
  assert.equal(normalizeHex('abc'), '#AABBCC');
  assert.equal(normalizeHex('#12345'), null);
  assert.equal(resolveColor('@accent', { accent: '#e24b2b' }), '#E24B2B');
  assert.ok(luminance('#FFFFFF') > 0.99);
});
