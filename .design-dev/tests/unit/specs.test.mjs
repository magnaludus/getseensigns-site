// The measured print specs: numbers read from the printers' templates and spec pages, and what the
// resolver makes of them (cut outlines, safe lines, regions). Expected values are the printers' inches.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv } from './helpers.mjs';
import { specFor } from '../../../assets/design/model/specs.js';
import { bounds, boxInside, distanceToEdge, pointInPolygon } from '../../../assets/design/model/outline.js';

const { specs } = loadEnv();
const near = (a, b, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);
const corners = (r) => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];

function placeholders(node, path = '', out = []) {
  if (node && typeof node === 'object') {
    if (node.status === 'TODO_SPEC') out.push(path);
    for (const [k, v] of Object.entries(node)) placeholders(v, path + '.' + k, out);
  }
  return out;
}

test('no placeholder rows are left in the print specs', () => {
  assert.deepEqual(placeholders(specs.products), []);
  for (const [id, product] of Object.entries(specs.products)) {
    for (const key of Object.keys(product.variants)) {
      assert.deepEqual(specFor(specs, id, variantChoices(id, key)).placeholders, [], `${id}/${key}`);
    }
  }
});

// '6-3' -> {length: '6', style: '3'} and so on, from the variant keys
function variantChoices(id, key) {
  const by = specs.products[id].variant_by;
  const parts = key === '*' ? [] : key.split('-');
  return Object.fromEntries(by.map((g, i) => [g, parts[i]]));
}

test('canopy: the printer outline, valance line and safe line', () => {
  const s = specFor(specs, 'canopy', { package: 'valance' });
  assert.deepEqual(s.artboard, { w: 119, h: 84.28 });
  assert.equal(s.valanceLine, 71.24);
  // 29 points, clockwise from the left base corner over the tip to the right base corner
  assert.equal(s.roof.shape, 'polygon');
  assert.equal(s.roof.polygon.length, 29);
  assert.deepEqual(s.roof.polygon[0], [0.5, 71.24]);
  assert.deepEqual(s.roof.polygon[14], [59.5, 0]);
  assert.deepEqual(s.roof.polygon[28], [118.5, 71.24]);
  // the sides bow inward: the middle of the edge is inside the straight line from tip to corner
  const [x, y] = s.roof.polygon.find((p) => Math.abs(p[1] - 29.27) < 0.01);
  assert.ok(x > 59.5 - (59 * y) / 71.24 + 2, `edge point (${x}, ${y}) is bowed in`);
  // cut outline = roof plus the valance sides down to the page corners
  assert.equal(s.cut.length, 31);
  assert.deepEqual(s.cut.slice(-2), [[119, 84.28], [0, 84.28]]);
  // the template's safe line is 115 x 78.84 in at (2, 3.45); the 2 in inset of the outline lands on it
  assert.deepEqual(s.safe, { x: 2, y: 3.45, w: 115, h: 78.84 });
  const b = bounds(s.safePoly);
  near(b.y, 3.45, 0.05, 'top');
  near(b.y + b.h, 82.29, 0.05, 'bottom');
  near(b.x, 2, 0.15, 'left');
  near(b.x + b.w, 117, 0.15, 'right');
  for (const p of s.safePoly) assert.ok(distanceToEdge(p[0], p[1], s.cut) > 1.5, 'the safe line is clear of the cut line');
});

test('canopy: peak and valance blocks fit inside the safe line, valance below the roof', () => {
  const s = specFor(specs, 'canopy', { package: 'valance' });
  const { peak, valance, valancebar, roofarea } = s.regions;
  for (const [name, r] of Object.entries({ peak, valance })) assert.ok(boxInside(corners(r), s.safePoly, 0.05), `${name} is inside the safe line`);
  near(peak.x + peak.w / 2, 59.5, 0.1, 'peak is centered');
  assert.ok(peak.w > 38 && peak.h > 30);
  assert.ok(valance.y >= s.valanceLine && valance.y + valance.h <= 82.3);
  assert.ok(valance.w > 110, `valance is nearly the full width: ${valance.w}`);
  near(valancebar.y, 71.24, 1e-9); near(valancebar.h, 13.04, 1e-9);
  near(roofarea.y, 0); near(roofarea.h, 71.24);
});

test('canopy: wall pieces keep the printer safe boxes', () => {
  const walls = specs.products.canopy.other_pieces;
  assert.deepEqual([walls.back_wall.w, walls.back_wall.h], [115.07, 80.07]);
  assert.deepEqual(walls.back_wall.safe, { x: 2.03, y: 2.03, w: 111, h: 76, source: 'printer template' });
  assert.deepEqual([walls.half_wall.w, walls.half_wall.h], [115.07, 41.07]);
  assert.deepEqual([walls.half_wall.safe.x, walls.half_wall.safe.y, walls.half_wall.safe.w, walls.half_wall.safe.h], [2.06, 2.03, 111, 37]);
});

test('feather: three printer outlines, pole on the left, safe line 2 in inside', () => {
  const want = {
    '10.5': { art: [24, 104], page: { w: 25.5, h: 105.5, offsetX: 0.71, offsetY: 1.25 } },
    '14': { art: [28.04, 138], page: { w: 29.5, h: 139.5, offsetX: 1.23, offsetY: 1.25 } },
    '18': { art: [24.11, 183.68], page: { w: 27, h: 187.5, offsetX: 1.75, offsetY: 1.92 } },
  };
  for (const [height, w] of Object.entries(want)) {
    const s = specFor(specs, 'feather', { height, base: 'spike' });
    assert.deepEqual([s.artboard.w, s.artboard.h], w.art, height);
    assert.deepEqual(s.templatePage, w.page, height);
    assert.equal(s.poleSide, 'left');
    assert.equal(s.outline.length, 34, `${height}: 34 points`);
    // the artboard is the flag: the outline touches all four sides of it
    const b = bounds(s.outline);
    near(b.x, 0, 0.005, `${height} left`); near(b.y, 0, 0.005, `${height} top`);
    near(b.w, s.artboard.w, 0.005, `${height} width`); near(b.h, s.artboard.h, 0.005, `${height} height`);
    // the sewn edge runs from the bottom pole-side corner to the top tip
    assert.deepEqual(s.poleEdge[0], s.outline[s.outline.length - 1]);
    assert.equal(Math.min(...s.poleEdge.map((p) => p[1])), 0);
    assert.ok(s.poleEdge.length >= 33);
    // 2 in safe zone: every corner of the safe line is inside the flag and 2 in from its edge
    for (const [x, y] of s.safePoly) {
      assert.ok(pointInPolygon(x, y, s.outline), `${height}: safe point (${x}, ${y}) is on the flag`);
      assert.ok(distanceToEdge(x, y, s.outline) >= 2 - 0.05, `${height}: safe point (${x}, ${y}) is 2 in in`);
    }
    // the sleeve width is not published, so the data says so instead of guessing
    assert.equal(s.sleeveWidthIn, null);
  }
});

test('feather: head, body and foot stack down the flag inside the safe line', () => {
  for (const height of ['10.5', '14', '18']) {
    const s = specFor(specs, 'feather', { height, base: 'spike' });
    const { head, body, foot } = s.regions;
    for (const [name, r] of Object.entries({ head, body, foot })) {
      assert.ok(r.w > 8 && r.h > 10, `${height} ${name} is a usable block: ${r.w} x ${r.h}`);
      assert.ok(boxInside(corners(r), s.safePoly, 0.05), `${height} ${name} is inside the safe line`);
    }
    assert.ok(head.y < body.y && body.y < foot.y, `${height}: top to bottom`);
    // the top of the flag is cut away on the pole side, so the head block keeps to the right
    assert.ok(head.x > body.x + 3, `${height}: head ${head.x} is right of body ${body.x}`);
    // the bottom is cut on a slant that rises to the right, so the foot block keeps to the left
    assert.ok(foot.x + foot.w < body.x + body.w - 2, `${height}: foot ends before the body does`);
  }
});

test('throw: the front panel and safe box come from each template', () => {
  const want = {
    '6-3': [72.23, 28.33, 3.17, 4.25, 65.98, 19.45],
    '6-4': [72.66, 27.65, 3.34, 3.84, 65.99, 19.43],
    '8-3': [95.92, 28.02, 2.79, 3.91, 89.95, 19.61],
    '8-4': [96.03, 27.59, 2.52, 4.37, 89.99, 19.24],
  };
  for (const [key, [w, h, sx, sy, sw, sh]] of Object.entries(want)) {
    const [length, style] = key.split('-');
    const s = specFor(specs, 'throw', { length, style });
    assert.equal(s.variant, key);
    assert.deepEqual([s.artboard.w, s.artboard.h], [w, h], key);
    assert.deepEqual([s.safe.x, s.safe.y, s.safe.w, s.safe.h], [sx, sy, sw, sh], key);
    // the front panel in the printer's template is the artboard
    const front = specs.products.throw.variants[key].panels_in_template.front;
    assert.deepEqual([front.w, front.h], [w, h]);
    // top, sides and back sit in the same template page
    const t = specs.products.throw.template_sizes[key];
    const panels = specs.products.throw.variants[key].panels_in_template;
    for (const [name, p] of Object.entries(panels).filter(([, v]) => v && typeof v === 'object')) assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= t.w + 0.01 && p.y + p.h <= t.h + 0.01, `${key} ${name} is on the page`);
    // the safe distances from the template differ by side, so the box is not centered by construction
    assert.ok(s.safe.x + s.safe.w <= w && s.safe.y + s.safe.h <= h);
  }
});

test('yard sign: second printer file rules are recorded and nothing is left as a placeholder', () => {
  const profiles = specs.products.yard.profiles;
  const second = profiles.find((p) => p.profile === 'second printer');
  assert.equal(second.bleed, 0);
  assert.deepEqual(second.artboard, { w: 24, h: 18 });
  assert.equal(second.dpi_min, 100);
  assert.equal(second.color_mode, 'CMYK');
  assert.deepEqual(second.file_types, ['pdf']);
  assert.equal(second.max_file_mb, 150);
  const s = specFor(specs, 'yard', { pack: '5', print: '1' });
  assert.equal(s.grassLineIn, 2);
  assert.deepEqual(s.placeholders, []);
});

test('yard sign: 1 in safe zone on every side and vertical flutes, both confirmed', () => {
  const s = specFor(specs, 'yard', { pack: '5', print: '1' });
  assert.deepEqual(s.safe, { x: 1, y: 1, w: 22, h: 16 });
  assert.equal(s.safePoly, undefined, 'a plain box, no outline');
  // flutes run parallel to the 18 in side of the 24 x 18 sign, so the H stake slides up into them
  assert.equal(s.flutes, 'vertical');
  assert.ok(s.artboard.w > s.artboard.h, 'landscape');
  assert.match(specs.products.yard.variants['*'].flutes.note, /parallel to the 18 in side/);
});

test('feather flag: sleeve on the left only, the reverse flag is not sold', () => {
  for (const [key, v] of Object.entries(specs.products.feather.variants)) {
    assert.equal(v.outline.pole_side, 'left', key);
    assert.equal(v.pole_sleeve.side, 'left', key);
    assert.match(v.pole_sleeve.note, /reverse flag.*not sold/, key);
  }
  for (const height of ['10.5', '14', '18']) assert.equal(specFor(specs, 'feather', { height, base: 'spike' }).poleSide, 'left');
});

test('the print spec file carries no supplier links or names that look like links', () => {
  const text = JSON.stringify(specs);
  assert.ok(!/https?:|www\.|\.com\b/i.test(text));
});
