// The whole flat of a table throw as the Flat view's map draws it, and the list of pictures a proof request carries
// (the whole flat first, then every panel as it reads on the table), with the plain-words description of each panel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv } from './helpers.mjs';
import { createDocument, addLogo } from '../../../assets/design/model/document.js';
import { quickFill } from '../../../assets/design/model/quickfill.js';
import { specFor } from '../../../assets/design/model/specs.js';
import { matrixAttr, FLAT_NOTE } from '../../../assets/design/model/throw-panels.js';
import { flatSvg, flatOf, baseColorOf, flatArea } from '../../../assets/design/render/flat.js';
import { previewPlan, describePieces, describeSide, sideSummaryText, panelIdOf, MAX_PREVIEWS } from '../../../assets/design/model/proof-plan.js';

const env = loadEnv();
const SIZES = ['6-3', '6-4', '8-3', '8-4'];
const make = (key) => {
  const [length, style] = key.split('-');
  return createDocument(env, 'throw', { choices: { length, style } });
};
const filled = (key) => quickFill(quickFill(make(key), 0, 'name-ends', env).doc, 0, 'logo-top', env).doc;
const count = (text, re) => (text.match(re) || []).length;

test('the flat map draws every panel turned the way it prints, inside the cut shape, with names and safe areas', () => {
  for (const key of SIZES) {
    const doc = filled(key);
    const layout = flatOf(doc, 0, env);
    const svg = flatSvg(doc, 0, env, { selected: 'top', label: 'The flat' });
    assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'), key);
    assert.ok(!/NaN|undefined|Infinity/.test(svg), `${key}: nothing odd in the markup`);
    // the cut shape
    assert.equal(count(svg, /class="flat-cut"/g), 1, key);
    for (const [x, y] of layout.outline) assert.ok(svg.includes(`${x},${y}`), `${key} cut shape corner ${x},${y}`);
    // each panel is drawn upright and turned onto the flat by its own matrix
    for (const p of layout.panels) {
      assert.ok(svg.includes(`data-panel="${p.id}" data-index="${p.index}"`), `${key} ${p.id} can be tapped`);
      assert.ok(svg.includes(`transform="${matrixAttr(p.matrix)}"`), `${key} ${p.id} is turned by its matrix`);
      assert.ok(svg.includes(`<clipPath id="fc`) && svg.includes(`-${p.id}"><rect width="${p.size.w}" height="${p.size.h}"/>`), `${key} ${p.id} is clipped to its own area`);
    }
    assert.equal(count(svg, /class="flat-panel"/g), layout.panels.length);
    assert.equal(count(svg, /data-turn=/g), layout.panels.filter((p) => p.turn).length, 'the ends and the back say they are turned');
    // labels: the panel names
    for (const p of layout.panels) for (const word of p.label.split(' ')) assert.ok(svg.includes(`>${word}</tspan>`) || svg.includes(`>${p.label}</tspan>`), `${key} label ${p.label}`);
    // safe areas on every panel
    assert.equal(count(svg, /class="flat-safe"/g), layout.panels.length, `${key} shows a safe area on every panel`);
    // the selected panel is outlined
    assert.equal(count(svg, /class="flat-sel"/g), 2);
    // 3-sided: a plain back strip, no drape. 4-sided: corner drape on both sides of the back, no strip.
    if (layout.closed) {
      assert.equal(count(svg, />CORNER<\/tspan>/g), 2, key);
      assert.ok(!svg.includes('BACK STRIP'));
      assert.ok(svg.includes('url(#fh'), 'the drape is hatched');
    } else {
      assert.ok(svg.includes('BACK STRIP (PLAIN)'), key);
      assert.ok(!svg.includes('CORNER'));
    }
    // the art is really in there: the business name on both ends, upside down on the back
    const words = count(svg, /HONEYDROP/g);
    assert.ok(words >= (layout.closed ? 4 : 3), `${key}: front, both ends${layout.closed ? ', back' : ''} (${words})`);
    // the view box is the cut shape with a margin, with room above the 3-sided strip's name
    const vb = svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
    const area = flatArea(layout, 1.5, layout.strips.length ? 3.4 * 1.7 : 0);
    assert.deepEqual(vb, [area.x, area.y, area.w, area.h].map((v) => Math.round(v * 1000) / 1000), key);
  }
});

test('the flat map follows the design: new words, the plain color, no flat for a fitted cover or another product', () => {
  const doc = filled('6-4');
  const base = baseColorOf(doc, 0);
  assert.match(base, /^#[0-9a-f]{6}$/i);
  // changing a panel's text changes the map
  const svg = flatSvg(doc, 0, env);
  assert.ok(svg.includes(base), 'the drape is filled with the plain color');
  assert.equal(flatSvg(createDocument(env, 'throw', { choices: { length: '6', style: 'fitted' } }), 0, env), '');
  assert.equal(flatOf(createDocument(env, 'throw', { choices: { length: '6', style: 'fitted' } }), 0, env), null);
  assert.equal(flatSvg(createDocument(env, 'canopy'), 0, env), '');
  // a logo that was uploaded is an image in the top panel; an empty frame is drawn as a frame
  const withFrame = flatSvg(quickFill(make('6-4'), 0, 'logo-top', env).doc, 0, env);
  assert.ok(withFrame.includes('data-frame="1"'), 'the empty logo frame shows on the top panel');
  const withLogo = addLogo(make('6-4'), { id: 'l1', name: 'mark.png', w: 100, h: 100, type: 'image/png' }).doc;
  const placed = quickFill(withLogo, 0, 'logo-top', env).doc;
  const assets = new Map([['l1', { url: 'blob:logo-1', w: 100, h: 100 }]]);
  assert.ok(flatSvg(placed, 0, env, { assets, assetUrl: (id) => assets.get(id).url }).includes('href="blob:logo-1"'));
  assert.equal(FLAT_NOTE.includes('turned'), true);
});

test('the proof request carries the whole flat first, then each panel as it reads on the table', () => {
  const four = previewPlan(make('6-4'), env);
  assert.deepEqual(four.map((p) => [p.kind, p.si]), [['flat', null], ['side', 0], ['side', 1], ['side', 2], ['side', 3], ['side', 4]]);
  assert.deepEqual(four.map((p) => p.file), [
    'preview-1-table-throw-flat.png', 'preview-1-table-throw-front.png', 'preview-1-table-throw-top.png',
    'preview-1-table-throw-left-end.png', 'preview-1-table-throw-right-end.png', 'preview-1-table-throw-back.png',
  ]);
  assert.deepEqual(four.map((p) => p.n), [0, 1, 2, 3, 4, 5]);
  assert.equal(four[0].label, 'Table throw: the whole flat as it prints (ends and back turned)');
  assert.equal(four[3].label, 'Table throw: Left end panel, as it reads on the table');
  assert.equal(previewPlan(make('8-3'), env).length, 5, '3-sided: the flat and four panels');
  assert.deepEqual(previewPlan(make('6-3'), env).map((p) => p.si), [null, 0, 1, 2, 3]);
  // a fitted cover has no printer flat: just its front
  const fitted = previewPlan(createDocument(env, 'throw', { choices: { length: '6', style: 'fitted' } }), env);
  assert.deepEqual(fitted.map((p) => [p.kind, p.si]), [['side', 0]]);
  // other products keep the pictures they always sent
  const tentSame = previewPlan(createDocument(env, 'canopy'), env);
  assert.deepEqual(tentSame.map((p) => p.file), ['preview-1-canopy-tent-all-sides.png']);
  const tent = createDocument(env, 'canopy');
  tent.project.pieces[0].sidesMode = 'each';
  assert.deepEqual(previewPlan(tent, env).map((p) => p.file), ['front', 'right', 'back', 'left'].map((s) => `preview-1-canopy-tent-${s}.png`));
  // two pieces, and no more than 12 pictures in all
  const many = make('6-4');
  for (let i = 0; i < 2; i++) many.project.pieces.push(JSON.parse(JSON.stringify(many.project.pieces[0])));
  const plan = previewPlan(many, env);
  assert.equal(plan.length, MAX_PREVIEWS);
  assert.deepEqual(plan.map((p) => p.pi), [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
  assert.equal(plan[6].label, 'Table throw 2: the whole flat as it prints (ends and back turned)');
});

test('each panel is described in plain words, with how it is turned on the flat', () => {
  const doc = filled('6-4');
  const [about] = describePieces(doc, env);
  assert.equal(about.panels, true);
  assert.deepEqual(about.sides.map((s) => s.name), ['Front', 'Top', 'Left end', 'Right end', 'Back']);
  assert.deepEqual(about.sides.map((s) => s.id), ['front', 'top', 'left', 'right', 'back']);
  const by = Object.fromEntries(about.sides.map((s) => [s.id, s]));
  assert.deepEqual(by.front.text, ['HONEYDROP', 'APIARY']);
  assert.equal(by.top.frames, 1, 'an empty logo frame is called out');
  assert.equal(sideSummaryText(by.top), 'empty logo frame (no logo yet)');
  assert.deepEqual(by.left.text, ['HONEYDROP']);
  assert.match(by.left.reads, /turned 90 degrees clockwise.*top to bottom/);
  assert.match(by.right.reads, /turned 90 degrees counterclockwise.*bottom to top/);
  assert.match(by.back.reads, /turned 180 degrees/);
  assert.match(by.front.reads, /upright/);
  assert.equal(sideSummaryText(by.left), '"HONEYDROP"');
  // a design with only a front: the other panels say so
  const plain = describePieces(make('6-3'), env)[0].sides;
  assert.equal(plain[1].plain, true);
  assert.equal(sideSummaryText(plain[1]), 'background color only');
  assert.equal(plain.length, 4);
  // a tent is not a table throw: no panel wording
  const tent = describePieces(createDocument(env, 'canopy'), env)[0];
  assert.equal(tent.panels, false);
  assert.ok(tent.sides.every((s) => s.id === null && s.reads === null));
  // hidden and empty text do not count; long words are cut
  const side = { elements: [{ type: 'text', text: '   ', hidden: false }, { type: 'text', text: 'x'.repeat(200), hidden: false }, { type: 'text', text: 'hidden', hidden: true }, { type: 'image', logoId: 'a' }, { type: 'image', logoId: null }, { type: 'shape' }] };
  const d = describeSide(side);
  assert.equal(d.text.length, 1);
  assert.ok(d.text[0].length <= 60);
  assert.deepEqual([d.logos, d.frames, d.shapes], [1, 1, 1]);
  assert.equal(panelIdOf('Right end'), 'right');
  assert.equal(panelIdOf('Side 9'), null);
});

test('specFor keeps handing out the same flat for the same choices, so the map and the proof agree', () => {
  for (const key of SIZES) {
    const [length, style] = key.split('-');
    assert.deepEqual(specFor(env.specs, 'throw', { length, style }).flat, specFor(env.specs, 'throw', { length, style }).flat);
  }
});
