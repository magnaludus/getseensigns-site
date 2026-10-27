// The flat editor's overlay guides draw the printers' real shapes: cut outline, safe line, pole side.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv } from './helpers.mjs';
import { specFor } from '../../../assets/design/model/specs.js';
import { guidesSvg, guideChoices } from '../../../assets/design/editor/guides.js';

const { specs } = loadEnv();

// every point list in the markup, as arrays of [x, y]
function pointLists(svg, tag) {
  const out = [];
  for (const m of svg.matchAll(new RegExp(`<${tag} points="([^"]+)"`, 'g'))) {
    out.push(m[1].trim().split(/\s+/).map((p) => p.split(',').map(Number)));
  }
  return out;
}

test('canopy guides: the cut outline shades what is cut away and the safe line follows the roof', () => {
  const spec = specFor(specs, 'canopy', { package: 'valance' });
  const svg = guidesSvg(spec, {}, 0.1);
  // the roof overlay is drawn twice (casing and color) from the 31 point cut outline
  const polygons = pointLists(svg, 'polygon');
  assert.ok(polygons.filter((p) => p.length === 31).length >= 2, 'cut outline drawn');
  // the safe line is the inset ring, not a four-corner box
  assert.ok(polygons.some((p) => p.length === spec.safePoly.length && p.length > 10), 'safe ring drawn');
  // what is outside the cut outline is dimmed across the whole page, valance sides included
  assert.match(svg, /fill-rule="evenodd"/);
  assert.match(svg, /M0,0 h119 v84\.28 h-119 Z/);
  assert.match(svg, />Valance line</);
  assert.deepEqual(guideChoices(spec).map(([k]) => k), ['trim', 'safe', 'valance_line', 'roof']);
});

test('canopy guides can be switched off one by one', () => {
  const spec = specFor(specs, 'canopy', { package: 'valance' });
  const none = guidesSvg(spec, { trim: false, safe: false, valance_line: false, roof: false }, 0.1);
  assert.equal(none, '');
});

test('flag guides: pole side is marked on the sewn edge and the safe line follows the outline', () => {
  for (const height of ['10.5', '14', '18']) {
    const spec = specFor(specs, 'feather', { height, base: 'spike' });
    const svg = guidesSvg(spec, {}, 0.1);
    assert.match(svg, />Pole side</);
    const lines = pointLists(svg, 'polyline');
    assert.ok(lines.length >= 2 && lines.every((l) => l.length === spec.poleEdge.length), `${height}: pole edge drawn as an open line`);
    const polygons = pointLists(svg, 'polygon');
    assert.ok(polygons.some((p) => p.length === spec.outline.length), `${height}: outline drawn`);
    assert.ok(polygons.some((p) => p.length === spec.safePoly.length), `${height}: safe ring drawn`);
    assert.deepEqual(guideChoices(spec).map(([k]) => k), ['trim', 'safe', 'outline', 'sleeve']);
    assert.deepEqual(guideChoices(spec).find(([k]) => k === 'sleeve'), ['sleeve', 'Pole side']);
  }
});

test('boxy products keep a four-corner safe box', () => {
  const spec = specFor(specs, 'throw', { length: '6', style: '3' });
  const polygons = pointLists(guidesSvg(spec, {}, 0.1), 'polygon');
  assert.ok(polygons.some((p) => p.length === 4 && Math.abs(p[0][0] - 3.17) < 1e-9 && Math.abs(p[0][1] - 4.25) < 1e-9));
});
