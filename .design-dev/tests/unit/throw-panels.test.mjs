// Table throw panels: where every piece of the printer's flat sits, how each one is turned for print, and the
// numbers the editor works in. Covers the rotation math (cut each panel out of the flat, turn it the way it hangs,
// and it reads upright) and the geometry of all four printer templates (6 and 8 ft, 3-sided and 4-sided).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv } from './helpers.mjs';
import { specFor, specForSide } from '../../../assets/design/model/specs.js';
import {
  buildThrowLayout, turnMatrix, applyMatrix, applyLinear, invertMatrix, mapRect, flatDirections, polygonArea, panelAtFlat,
  panelToFlat, flatToPanel, rectsOverlap, readsOnFlat, PANEL_TURN, PANEL_IDS, PANEL_NAMES, FLAT_NOTE,
} from '../../../assets/design/model/throw-panels.js';

const env = loadEnv();
const SIZES = ['6-3', '6-4', '8-3', '8-4'];
const throwSpec = (key) => {
  const [length, style] = key.split('-');
  return specFor(env.specs, 'throw', { length, style });
};
const near = (a, b, tol = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);

// ---------- the rotation math, on a flat small enough to check cell by cell ----------

// A 4-sided flat in whole inches. The back is as wide as the page; the top, ends and front sit under it.
const TOY = {
  style: '4',
  template: { w: 22, h: 11 },
  boxes: {
    back: { x: 3, y: 0, w: 16, h: 4 },
    top: { x: 6, y: 4, w: 10, h: 4 },
    left: { x: 3, y: 4, w: 3, h: 4 },
    right: { x: 16, y: 4, w: 3, h: 4 },
    front: { x: 6, y: 8, w: 10, h: 3 },
  },
  frontSafe: { x: 1, y: 1, w: 8, h: 1 },
  margins: { edge_in: 1, hang_in: 1, hem_in: 1, open_hem_in: 2 },
};

// Independent array rotations, written without the matrices under test. Rows are y, columns are x.
const rotCW = (a) => {
  const R = a.length;
  const C = a[0].length;
  const out = Array.from({ length: C }, () => Array(R).fill(null));
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) out[c][R - 1 - r] = a[r][c];
  return out;
};
const rotCCW = (a) => {
  const R = a.length;
  const C = a[0].length;
  const out = Array.from({ length: C }, () => Array(R).fill(null));
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) out[C - 1 - c][r] = a[r][c];
  return out;
};
const rot180 = (a) => rotCCW(rotCCW(a));

// What hanging does to a panel cut out of the flat: undo the turn the flat gave it.
const HANG = { front: (a) => a, top: (a) => a, left: rotCCW, right: rotCW, back: rot180 };

// A test pattern with an obvious top, left and reading direction: every cell is unique.
const patternOf = (panel) => Array.from({ length: panel.size.h }, (_, y) => Array.from({ length: panel.size.w }, (_, x) => `${panel.id}:${x},${y}`));

// Paint every panel onto a raster of the flat through the panel's matrix (cell centers, so there is no rounding to argue about).
function paintFlat(layout, W, H) {
  const flat = Array.from({ length: H }, () => Array(W).fill(null));
  for (const panel of layout.panels) {
    const pat = patternOf(panel);
    for (let y = 0; y < panel.size.h; y++) {
      for (let x = 0; x < panel.size.w; x++) {
        const p = applyMatrix(panel.matrix, x + 0.5, y + 0.5);
        const fx = Math.floor(p.x);
        const fy = Math.floor(p.y);
        assert.equal(flat[fy][fx], null, `${panel.id} cell ${x},${y} lands on a cell that is already painted`);
        flat[fy][fx] = pat[y][x];
      }
    }
  }
  return flat;
}

const cutOut = (flat, box) => flat.slice(box.y, box.y + box.h).map((row) => row.slice(box.x, box.x + box.w));

test('rotation: cut each panel out of the flat, turn it the way it hangs, and it reads upright', () => {
  const layout = buildThrowLayout(TOY);
  assert.deepEqual(layout.panels.map((p) => p.id), ['front', 'top', 'left', 'right', 'back']);
  const flat = paintFlat(layout, 22, 11);
  for (const panel of layout.panels) {
    const cut = cutOut(flat, panel.box);
    assert.deepEqual(HANG[panel.id](cut), patternOf(panel), `${panel.id} reads upright once hung`);
  }
  // every cell of every panel box is covered exactly once, so nothing is lost or doubled on the flat
  const painted = flat.flat().filter((c) => c !== null).length;
  assert.equal(painted, layout.panels.reduce((n, p) => n + p.box.w * p.box.h, 0));
});

test('rotation: the quarter turns are the right way round, not just consistent', () => {
  const layout = buildThrowLayout(TOY);
  const by = Object.fromEntries(layout.panels.map((p) => [p.id, p]));
  // left end: turned 90 clockwise. Its tops face the top panel (to the right of it) and it reads top to bottom.
  const left = flatDirections(by.left);
  assert.deepEqual([left.up.x, left.up.y], [1, 0]);
  assert.deepEqual([left.reads.x, left.reads.y], [0, 1]);
  // right end: turned the other way. Tops face the top panel (to the left of it), it reads bottom to top.
  const right = flatDirections(by.right);
  assert.deepEqual([right.up.x, right.up.y], [-1, 0]);
  assert.deepEqual([right.reads.x, right.reads.y], [0, -1]);
  // back: upside down. Its tops face down, toward the top panel under it, and it reads right to left.
  const back = flatDirections(by.back);
  assert.deepEqual([back.up.x, back.up.y], [0, 1]);
  assert.deepEqual([back.reads.x, back.reads.y], [-1, 0]);
  // front and top: upright
  for (const id of ['front', 'top']) {
    const d = flatDirections(by[id]);
    assert.deepEqual([d.up.x, d.up.y, d.reads.x, d.reads.y], [0, -1, 1, 0], id);
  }
  // the letter tops of every side panel face the table top
  const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  for (const id of ['left', 'right', 'back', 'front']) {
    const up = flatDirections(by[id]).up;
    const from = center(by[id].box);
    const to = center(by.top.box);
    assert.ok(up.x * (to.x - from.x) + up.y * (to.y - from.y) > 0, `${id}: tops face the top panel`);
  }
  // the first letter of a panel's text starts where the eye starts reading it on the flat
  const startsAt = (id) => panelToFlat(by[id], 0, by[id].size.h / 2);
  assert.ok(startsAt('left').y < by.left.box.y + 0.5 && Math.abs(startsAt('left').x - (by.left.box.x + by.left.box.w / 2)) < 1e-9, 'left end starts at the top of the flat');
  assert.ok(startsAt('right').y > by.right.box.y + by.right.box.h - 0.5, 'right end starts at the bottom of the flat');
});

test('rotation: matrices compose, invert and round-trip points', () => {
  const layout = buildThrowLayout(TOY);
  for (const panel of layout.panels) {
    for (const [x, y] of [[0, 0], [1.25, 0.5], [panel.size.w, panel.size.h], [panel.size.w / 2, panel.size.h / 3]]) {
      const f = panelToFlat(panel, x, y);
      const back = flatToPanel(panel, f.x, f.y);
      near(back.x, x, 1e-9, panel.id);
      near(back.y, y, 1e-9, panel.id);
    }
    // the whole panel lands exactly on its box
    const r = mapRect(panel.matrix, { x: 0, y: 0, w: panel.size.w, h: panel.size.h });
    assert.deepEqual([r.x, r.y, r.w, r.h], [panel.box.x, panel.box.y, panel.box.w, panel.box.h], panel.id);
    // a quarter turn swaps the width and height; a half turn does not
    const quarter = Math.abs(panel.turn) === 90;
    assert.deepEqual([panel.size.w, panel.size.h], quarter ? [panel.box.h, panel.box.w] : [panel.box.w, panel.box.h], panel.id);
    // determinant 1: a turn, not a mirror (text must never come out reversed)
    const m = panel.matrix;
    near(m[0] * m[3] - m[1] * m[2], 1, 1e-9, panel.id + ' is a pure turn');
    const inv = invertMatrix(m);
    const id = applyMatrix(inv, ...Object.values(applyMatrix(m, 3, 2)));
    near(id.x, 3, 1e-9);
    near(id.y, 2, 1e-9);
  }
  // turnMatrix with a free angle still agrees with the quarter turns
  const m90 = turnMatrix({ x: 0, y: 0, w: 4, h: 6 }, { w: 6, h: 4 }, 90);
  assert.deepEqual(m90.map((v) => Math.round(v * 1e9) / 1e9 + 0), [0, 1, -1, 0, 4, 0]);
  const l = applyLinear(turnMatrix({ x: 0, y: 0, w: 1, h: 1 }, { w: 1, h: 1 }, 180), 1, 0);
  assert.deepEqual([l.x, l.y], [-1, 0]);
});

test('rotation: the words that describe each turn match the matrices', () => {
  assert.deepEqual(PANEL_TURN, { front: 0, top: 0, left: 90, right: -90, back: 180 });
  assert.match(readsOnFlat('left'), /90 degrees clockwise.*top to bottom/);
  assert.match(readsOnFlat('right'), /90 degrees counterclockwise.*bottom to top/);
  assert.match(readsOnFlat('back'), /180/);
  assert.match(readsOnFlat('front'), /upright/);
  assert.equal(FLAT_NOTE, 'Side and back art is turned on the flat so it reads right side up when the cover hangs.');
});

// ---------- the real printer templates, all four sizes ----------

test('geometry: each size has the right panels in the right order, as the printer lays them out', () => {
  for (const key of SIZES) {
    const spec = throwSpec(key);
    const [, style] = key.split('-');
    const flat = spec.flat;
    assert.ok(flat, key);
    assert.deepEqual(flat.panels.map((p) => p.id), style === '4' ? PANEL_IDS : PANEL_IDS.filter((id) => id !== 'back'), key);
    assert.deepEqual(flat.panels.map((p) => p.name), (style === '4' ? PANEL_IDS : PANEL_IDS.filter((id) => id !== 'back')).map((id) => PANEL_NAMES[id]), key);
    flat.panels.forEach((p, i) => assert.equal(p.index, i, `${key} ${p.id} index`));
    assert.deepEqual(flat.panels.map((p) => p.turn), style === '4' ? [0, 0, 90, -90, 180] : [0, 0, 90, -90], key);
    assert.equal(flat.closed, style === '4');
    // the page is the printer's template page
    const page = env.specs.products.throw.template_sizes[key];
    assert.deepEqual([flat.template.w, flat.template.h], [page.w, page.h], key);
    assert.deepEqual([flat.finished.w, flat.finished.h], [page.finished.w, page.finished.h], key);
  }
});

test('geometry: panel boxes are the printer\'s boxes, and every panel fits on the page', () => {
  for (const key of SIZES) {
    const spec = throwSpec(key);
    const v = env.specs.products.throw.variants[key];
    const page = env.specs.products.throw.template_sizes[key];
    for (const p of spec.flat.panels) {
      const printer = v.panels_in_template[p.id];
      if (p.id === 'back') {
        // the 4-sided back is as wide as the page; only the part in line with the top and front is a panel
        assert.deepEqual([p.box.x, p.box.w], [v.panels_in_template.top.x, v.panels_in_template.top.w], `${key} back is in line with the top`);
        assert.deepEqual([p.box.y, p.box.h], [printer.y, printer.h], `${key} back`);
        assert.ok(printer.w > p.box.w + 40, `${key}: the printer's back strip is wider than the panel, the rest is corner drape`);
      } else {
        assert.deepEqual([p.box.x, p.box.y, p.box.w, p.box.h], [printer.x, printer.y, printer.w, printer.h], `${key} ${p.id}`);
      }
      assert.ok(p.box.x >= 0 && p.box.y >= 0 && p.box.x + p.box.w <= page.w + 0.01 && p.box.y + p.box.h <= page.h + 0.01, `${key} ${p.id} is on the page`);
      // panel sizes as they hang: the front is the artboard, the ends are the box turned
      const quarter = Math.abs(p.turn) === 90;
      assert.deepEqual([p.size.w, p.size.h], quarter ? [p.box.h, p.box.w] : [p.box.w, p.box.h], `${key} ${p.id} size`);
    }
    const front = spec.flat.panels[0];
    assert.deepEqual([front.size.w, front.size.h], [spec.artboard.w, spec.artboard.h], `${key}: the front panel is still the artboard`);
  }
});

test('geometry: the panels, the back strip and the drape tile the cut shape exactly, with no overlaps', () => {
  for (const key of SIZES) {
    const flat = throwSpec(key).flat;
    const pieces = [
      ...flat.panels.map((p) => ({ id: p.id, box: p.box })),
      ...flat.strips.map((s) => ({ id: 'strip-' + s.id, box: s.box })),
      ...flat.drape.map((d) => ({ id: d.id, box: d.box })),
    ];
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) assert.ok(!rectsOverlap(pieces[i].box, pieces[j].box, 0.05), `${key}: ${pieces[i].id} overlaps ${pieces[j].id}`);
    }
    const sum = pieces.reduce((n, p) => n + p.box.w * p.box.h, 0);
    const area = polygonArea(flat.outline);
    assert.ok(Math.abs(sum - area) / area < 0.002, `${key}: boxes ${sum.toFixed(1)} vs cut shape ${area.toFixed(1)}`);
    // the cut shape sits on the page, and its outline is a plus (3-sided, 12 corners) or a T (4-sided, 8 corners)
    assert.equal(flat.outline.length, flat.closed ? 8 : 12, key);
    for (const [x, y] of flat.outline) assert.ok(x >= 0 && y >= 0 && x <= flat.template.w && y <= flat.template.h, `${key} corner ${x},${y} is on the page`);
    assert.ok(flat.bounds.x >= 0 && flat.bounds.y >= 0 && flat.bounds.x + flat.bounds.w <= flat.template.w && flat.bounds.y + flat.bounds.h <= flat.template.h);
    // axis aligned: every edge is horizontal or vertical
    flat.outline.forEach((p, i) => {
      const q = flat.outline[(i + 1) % flat.outline.length];
      assert.ok(p[0] === q[0] || p[1] === q[1], `${key} edge ${i} is straight`);
    });
  }
});

test('geometry: the 3-sided back is a short plain strip, and the 4-sided back flanks are corner drape with no art', () => {
  for (const key of SIZES) {
    const flat = throwSpec(key).flat;
    const v = env.specs.products.throw.variants[key];
    if (!flat.closed) {
      assert.equal(flat.strips.length, 1, key);
      assert.equal(flat.strips[0].id, 'back');
      assert.deepEqual(flat.strips[0].box, { x: v.panels_in_template.back.x, y: v.panels_in_template.back.y, w: v.panels_in_template.back.w, h: v.panels_in_template.back.h }, key);
      assert.ok(flat.strips[0].box.h > 5.5 && flat.strips[0].box.h < 6.5, `${key}: about 6 in`);
      assert.equal(flat.drape.length, 0, key);
      assert.ok(!flat.panels.some((p) => p.id === 'back'), `${key}: no editable back`);
    } else {
      assert.equal(flat.strips.length, 0, key);
      assert.equal(flat.drape.length, 2, key);
      const back = flat.panels.find((p) => p.id === 'back');
      const printerBack = v.panels_in_template.back;
      // panel + both flanks = the printer's whole back strip
      const total = back.box.w + flat.drape[0].box.w + flat.drape[1].box.w;
      near(total, printerBack.w, 0.02, `${key} back + drape`);
      // the flanks sit above the ends, where the cover wraps the table corners
      const left = flat.panels.find((p) => p.id === 'left');
      const right = flat.panels.find((p) => p.id === 'right');
      near(flat.drape[0].box.w, left.box.w, 0.02, key);
      near(flat.drape[1].box.w, right.box.w, 0.02, key);
      assert.equal(flat.drape[0].box.x, left.box.x);
    }
  }
});

test('geometry: no art can reach the corner drape, the back strip or the cut line', () => {
  for (const key of SIZES) {
    const flat = throwSpec(key).flat;
    const keepOut = [...flat.drape.map((d) => d.box), ...flat.strips.map((s) => s.box)];
    for (const p of flat.panels) {
      // the whole of an editable panel, and so everything inside it, stays inside its own box on the flat
      const area = mapRect(p.matrix, { x: 0, y: 0, w: p.size.w, h: p.size.h });
      assert.deepEqual(area, p.box, `${key} ${p.id}`);
      for (const k of keepOut) assert.ok(!rectsOverlap(area, k, 0.05), `${key} ${p.id} reaches ${JSON.stringify(k)}`);
      // the safe area is inside the panel, with room all round
      const s = p.safe;
      assert.ok(s.x >= 0 && s.y >= 0 && s.x + s.w <= p.size.w + 1e-9 && s.y + s.h <= p.size.h + 1e-9, `${key} ${p.id} safe is inside the panel`);
      assert.ok(s.w > 10 && s.h > 10, `${key} ${p.id} safe area is usable: ${s.w} x ${s.h}`);
      // and its place on the flat is inside the panel's box
      const f = p.safeFlat;
      assert.ok(f.x >= p.box.x - 1e-6 && f.y >= p.box.y - 1e-6 && f.x + f.w <= p.box.x + p.box.w + 1e-6 && f.y + f.h <= p.box.y + p.box.h + 1e-6, `${key} ${p.id} safe on the flat`);
      for (const k of keepOut) assert.ok(!rectsOverlap(f, k, 0.05), `${key} ${p.id} safe area touches drape`);
    }
  }
});

test('geometry: safe areas follow the margins in the print specs, the front keeps the printer\'s own', () => {
  const m = env.specs.products.throw.panel_safe;
  assert.equal(m.status, 'UX_DEFAULT', 'our own margins are marked as ours');
  for (const key of SIZES) {
    const spec = throwSpec(key);
    const flat = spec.flat;
    const by = Object.fromEntries(flat.panels.map((p) => [p.id, p]));
    const v = env.specs.products.throw.variants[key];
    assert.deepEqual(by.front.safe, { x: v.safe.x, y: v.safe.y, w: v.safe.w, h: v.safe.h }, `${key} front is the printer's safe box`);
    const gaps = (p) => ({ l: p.safe.x, t: p.safe.y, r: p.size.w - p.safe.x - p.safe.w, b: p.size.h - p.safe.y - p.safe.h });
    const eq = (a, b, msg) => near(a, b, 0.011, `${key} ${msg}`);
    const t = gaps(by.top);
    for (const side of ['l', 't', 'r', 'b']) eq(t[side], m.edge_in, `top ${side}`);
    for (const id of ['left', 'right']) {
      const g = gaps(by[id]);
      eq(g.t, m.hang_in, `${id} top (the table edge)`);
      eq(g.b, m.hem_in, `${id} bottom (the hem)`);
      // the edge that faces the back of the table: the left end's left, the right end's right
      const openSide = id === 'left' ? 'l' : 'r';
      const frontSide = id === 'left' ? 'r' : 'l';
      eq(g[frontSide], m.edge_in, `${id} front edge`);
      eq(g[openSide], flat.closed ? m.edge_in : m.open_hem_in, `${id} back edge (${flat.closed ? 'sewn to the back' : 'the open hem'})`);
    }
    if (flat.closed) {
      const g = gaps(by.back);
      eq(g.t, m.hang_in, 'back top');
      eq(g.b, m.hem_in, 'back bottom');
      eq(g.l, m.edge_in, 'back left');
      eq(g.r, m.edge_in, 'back right');
    }
    // 3-sided: the open hem sits on the edge next to the back, which is the top of the flat for both ends
    if (!flat.closed) {
      assert.equal(by.left.openEdge, 'left');
      assert.equal(by.right.openEdge, 'right');
      assert.ok(m.open_hem_in > m.edge_in, 'the open hem gets more room than a sewn edge');
      // on the flat the back is the top of the page, so the clearance is along the top edge of both end boxes
      for (const id of ['left', 'right']) near(by[id].safeFlat.y - by[id].box.y, m.open_hem_in, 0.011, `${key} ${id} keeps ${m.open_hem_in} in clear of the open hem on the flat`);
    } else {
      assert.equal(by.left.openEdge, null);
      assert.equal(by.right.openEdge, null);
    }
  }
});

test('geometry: a click on the flat finds the panel under it, and nothing over drape, strip or outside', () => {
  for (const key of SIZES) {
    const flat = throwSpec(key).flat;
    for (const p of flat.panels) assert.equal(panelAtFlat(flat, p.box.x + p.box.w / 2, p.box.y + p.box.h / 2).id, p.id, `${key} ${p.id}`);
    for (const d of flat.drape) assert.equal(panelAtFlat(flat, d.box.x + d.box.w / 2, d.box.y + d.box.h / 2), null, `${key} drape`);
    for (const s of flat.strips) assert.equal(panelAtFlat(flat, s.box.x + s.box.w / 2, s.box.y + s.box.h / 2), null, `${key} strip`);
    assert.equal(panelAtFlat(flat, -5, -5), null);
  }
});

test('specForSide: every panel has its own artboard, trim, safe area and regions; other products are untouched', () => {
  for (const key of SIZES) {
    const [length, style] = key.split('-');
    const choices = { length, style };
    const base = specFor(env.specs, 'throw', choices);
    const count = style === '4' ? 5 : 4;
    for (let si = 0; si < count; si++) {
      const s = specForSide(env.specs, 'throw', choices, si);
      const p = base.flat.panels[si];
      assert.equal(s.panel.id, p.id);
      assert.deepEqual(s.artboard, { w: p.size.w, h: p.size.h }, `${key} ${p.id}`);
      assert.deepEqual(s.trim, { x: 0, y: 0, w: p.size.w, h: p.size.h });
      assert.deepEqual(s.art, s.trim, 'no bleed on a throw');
      assert.deepEqual(s.safe, p.safe);
      assert.deepEqual(s.regions.safe, p.safe);
      assert.deepEqual(s.regions.art, s.trim);
      assert.equal(s.minCapIn, base.minCapIn, 'the same letter height rule on every panel');
      assert.equal(s.dpi.target, base.dpi.target);
    }
    assert.deepEqual(specForSide(env.specs, 'throw', choices, 0).artboard, base.artboard, 'the front is the artboard');
    assert.deepEqual(specForSide(env.specs, 'throw', choices, count + 3).artboard, base.artboard, 'out of range falls back to the front');
  }
  // fitted covers have no printer template: one panel, as before
  const fitted = specFor(env.specs, 'throw', { length: '6', style: 'fitted' });
  assert.equal(fitted.flat, undefined);
  assert.deepEqual(specForSide(env.specs, 'throw', { length: '6', style: 'fitted' }, 2).artboard, fitted.artboard);
  // other products give the same spec for every side
  for (const id of ['canopy', 'yard', 'banner']) {
    const choices = id === 'canopy' ? { package: 'valance' } : id === 'yard' ? { pack: '5', print: '2' } : { size: '3x6' };
    assert.deepEqual(specForSide(env.specs, id, choices, 1).artboard, specFor(env.specs, id, choices).artboard, id);
  }
});

test('buildThrowLayout: a 3-sided layout built by hand has the plus-shaped outline and the open hem on both ends', () => {
  const layout = buildThrowLayout({
    style: '3',
    template: { w: 22, h: 11 },
    boxes: { ...TOY.boxes, back: { x: 6, y: 3, w: 10, h: 1 } },
    frontSafe: TOY.frontSafe,
    margins: TOY.margins,
  });
  assert.deepEqual(layout.panels.map((p) => p.id), ['front', 'top', 'left', 'right']);
  assert.equal(layout.outline.length, 12);
  near(polygonArea(layout.outline), 10 * 3 + 10 * 4 + 3 * 4 + 3 * 4 + 10 * 1, 1e-9);
  const left = layout.panels.find((p) => p.id === 'left');
  // the left end's open hem is its left edge as it hangs, so 2 in of clearance there and 1 in everywhere else
  assert.deepEqual([left.safe.x, left.safe.y, left.safe.w, left.safe.h], [2, 1, left.size.w - 3, left.size.h - 2]);
  const right = layout.panels.find((p) => p.id === 'right');
  assert.deepEqual([right.safe.x, right.safe.y, right.safe.w, right.safe.h], [1, 1, right.size.w - 3, right.size.h - 2]);
});
