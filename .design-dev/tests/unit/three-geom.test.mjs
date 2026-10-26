// Pure helpers of the 3D stage: camera math, spec-derived dimensions, outline sampling.
// Run: node --test tests/unit/   (from .design-dev)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from '../../../assets/design/three/geom.js';
import { specFor } from '../../../assets/design/model/specs.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const specs = JSON.parse(readFileSync(join(root, 'assets', 'design', 'print-specs.json'), 'utf8'));
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

// Independent perspective projection of a box seen from azimuth az, used to verify the fit helpers.
function ndcExtents(half, fovDeg, aspect, az, el, dist, targetY = 0) {
  const a = G.rad(az);
  const e = G.rad(el);
  const cam = [dist * Math.cos(e) * Math.sin(a), targetY + dist * Math.sin(e), dist * Math.cos(e) * Math.cos(a)];
  const f = [-Math.cos(e) * Math.sin(a), -Math.sin(e), -Math.cos(e) * Math.cos(a)];
  const right = [Math.cos(a), 0, -Math.sin(a)];
  const up = [right[1] * f[2] - right[2] * f[1], right[2] * f[0] - right[0] * f[2], right[0] * f[1] - right[1] * f[0]];
  const t = Math.tan(G.rad(fovDeg) / 2);
  let mx = 0;
  let my = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const r = [sx * half.hx - cam[0], sy * half.hy - cam[1] + targetY * 0, sz * half.hz - cam[2]];
    const d = r[0] * f[0] + r[1] * f[1] + r[2] * f[2];
    const x = (r[0] * right[0] + r[1] * right[1] + r[2] * right[2]) / (d * t * aspect);
    const y = (r[0] * up[0] + r[1] * up[1] + r[2] * up[2]) / (d * t);
    mx = Math.max(mx, Math.abs(x));
    my = Math.max(my, Math.abs(y));
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  return { mx, my, mid: (lo + hi) / 2 };
}

test('angles wrap and the short way round is chosen', () => {
  assert.equal(G.wrap360(-90), 270);
  assert.equal(G.wrap360(725), 5);
  assert.equal(G.wrap180(270), -90);
  assert.equal(G.shortestDelta(350, 10), 20);
  assert.equal(G.shortestDelta(10, 350), -20);
  assert.equal(G.shortestDelta(0, 180), 180);
  assert.equal(G.shortestDelta(180, 0), 180);
  assert.equal(G.shortestDelta(90, 90), 0);
});

test('ease and smooth stay in range and hit their ends', () => {
  near(G.ease(0), 0);
  near(G.ease(1), 1);
  near(G.ease(0.5), 0.5);
  assert.ok(G.ease(0.25) < 0.25 && G.ease(0.75) > 0.75);
  near(G.smooth(10, 20, 5), 0);
  near(G.smooth(10, 20, 25), 1);
  near(G.smooth(10, 20, 15), 0.5);
});

test('mulberry is deterministic and uniform enough', () => {
  const a = G.mulberry(5);
  const b = G.mulberry(5);
  const xs = Array.from({ length: 2000 }, () => a());
  assert.deepEqual(xs.slice(0, 5), Array.from({ length: 5 }, () => b()));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(mean > 0.46 && mean < 0.54);
});

test('capSize limits the long edge and keeps the aspect', () => {
  assert.deepEqual(G.capSize(4096, 3072, 2048), [2048, 1536]);
  assert.deepEqual(G.capSize(2400, 24000, 2048), [205, 2048]);
  assert.deepEqual(G.capSize(800, 600, 2048), [800, 600]);
  assert.deepEqual(G.capSize(1, 5000, 1024), [1, 1024]);
});

test('coverTransform crops like CSS cover', () => {
  let t = G.coverTransform(2000, 1000, 1000, 1000);
  assert.deepEqual(t.repeat, [0.5, 1]);
  assert.deepEqual(t.offset, [0.25, 0]);
  t = G.coverTransform(1000, 1000, 2000, 1000);
  assert.deepEqual(t.repeat, [1, 0.5]);
  assert.deepEqual(t.offset, [0, 0.25]);
  t = G.coverTransform(1600, 900, 1600, 900);
  assert.deepEqual(t.repeat, [1, 1]);
  assert.deepEqual(t.offset, [0, 0]);
});

test('clampCamera keeps the camera above ground and inside the distance range', () => {
  let c = G.clampCamera({ azimuth: -30, elevation: 0, distance: 5 }, { minDist: 40, maxDist: 900 });
  assert.deepEqual(c, { azimuth: 330, elevation: 3, distance: 40 });
  c = G.clampCamera({ azimuth: 400, elevation: 120, distance: 5000 }, { minDist: 40, maxDist: 900 });
  assert.deepEqual(c, { azimuth: 40, elevation: 80, distance: 900 });
  c = G.clampCamera({ azimuth: 10, elevation: 70, distance: 100 }, { maxEl: 30 });
  assert.equal(c.elevation, 30);
  c = G.clampCamera({ azimuth: NaN, elevation: undefined, distance: Infinity * 0 }, { minDist: 10, maxDist: 100 });
  assert.ok(Object.values(c).every(Number.isFinite));
  assert.ok(c.elevation >= G.EL_MIN && c.elevation <= G.EL_MAX);
});

test('distanceLimits scale with the fit distance', () => {
  const l = G.distanceLimits(300);
  assert.ok(l.minDist < 300 && l.maxDist > 600);
  assert.ok(l.minDist > 0);
});

test('fitDistance keeps tall and wide products in view for narrow and wide screens (front and back exactly)', () => {
  const flag = { hx: 12, hy: 108, hz: 4 };
  const tent = { hx: 61.5, hy: 66, hz: 61.5 };
  const throwT = { hx: 49.5, hy: 15.25, hz: 16.5 };
  for (const aspect of [390 / 844, 0.75, 1, 1.6, 2.4]) {
    for (const half of [flag, tent, throwT]) {
      const d = G.fitDistance(half, G.FOV, aspect, 12, 1.1);
      for (const az of [0, 30, 45, 90, 135, 180, 200]) {
        // front and back always fit; other angles may overshoot by a few percent because the nearest end gets closer
        const limit = az === 0 || az === 180 ? 1.0001 : 1.07;
        const e = ndcExtents(half, G.FOV, aspect, az, 12, d);
        assert.ok(e.mx <= limit && e.my <= limit, `fit failed aspect ${aspect} az ${az} half ${JSON.stringify(half)}: ${JSON.stringify(e)}`);
      }
    }
  }
});

test('a tall flag is limited by height, not by the narrow viewport', () => {
  const flag = { hx: 12, hy: 108, hz: 4 };
  const portrait = G.fitDistance(flag, G.FOV, 390 / 844, 6);
  const landscape = G.fitDistance(flag, G.FOV, 1.6, 6);
  assert.ok(portrait / landscape < 1.15, `${portrait} vs ${landscape}`);
  const tent = { hx: 61.5, hy: 66, hz: 61.5 };
  assert.ok(G.fitDistance(tent, G.FOV, 0.46, 12) > G.fitDistance(tent, G.FOV, 1.6, 12) * 1.3);
});

test('fitDistance grows with the product and shrinks with a wider field of view', () => {
  const a = G.fitDistance({ hx: 10, hy: 10, hz: 10 }, 34, 1.5);
  const b = G.fitDistance({ hx: 20, hy: 20, hz: 20 }, 34, 1.5);
  const c = G.fitDistance({ hx: 20, hy: 20, hz: 20 }, 50, 1.5);
  assert.ok(b > a * 1.8 && c < b);
});

test('frameShift centers the projected box vertically', () => {
  const half = { hx: 61.5, hy: 66, hz: 61.5 };
  const d = G.fitDistance(half, G.FOV, 1.6, 13, 1.1);
  const shift = G.frameShift(half, G.FOV, 13, d);
  assert.ok(shift < 0, 'a camera looking down sees a tent low in the frame, so the target moves down');
  // with the target moved by `shift` the projected midpoint should be near zero
  const e = ndcExtents(half, G.FOV, 1.6, 0, 13, d, shift);
  assert.ok(Math.abs(e.mid) < 0.5 * Math.abs(ndcExtents(half, G.FOV, 1.6, 0, 13, d).mid) + 0.03, JSON.stringify(e));
  near(G.frameShift({ hx: 5, hy: 5, hz: 5 }, 34, 0, 100), 0, 1e-9);
});

test('cameraPosition puts azimuth 0 on +Z and 90 on +X', () => {
  const p0 = G.cameraPosition([0, 10, 0], { azimuth: 0, elevation: 0, distance: 100 });
  near(p0[0], 0); near(p0[1], 10); near(p0[2], 100);
  const p90 = G.cameraPosition([0, 0, 0], { azimuth: 90, elevation: 0, distance: 50 });
  near(p90[0], 50); near(p90[2], 0, 1e-9);
  const p180 = G.cameraPosition([0, 0, 0], { azimuth: 180, elevation: 0, distance: 50 });
  near(p180[2], -50);
  const up = G.cameraPosition([0, 0, 0], { azimuth: 33, elevation: 30, distance: 100 });
  near(Math.hypot(...up), 100, 1e-9);
  near(up[1], 50, 1e-9);
});

test('presets: front faces +Z, back faces -Z, wide zooms out', () => {
  for (const p of ['canopy', 'feather', 'throw', 'banner', 'yard']) {
    assert.equal(G.presetFor(p, 'front').azimuth, 0);
    assert.equal(G.presetFor(p, 'back').azimuth, 180);
    assert.ok(G.presetFor(p, 'wide').zoom > 1.2);
    assert.equal(G.presetFor(p, 'front').zoom, 1);
    const s = G.presetFor(p, 'side').azimuth;
    assert.ok(s > 30 && s <= 90);
  }
  assert.equal(G.presetFor('canopy', 'side').azimuth, 90);
  assert.equal(G.presetFor('unknown', 'front').azimuth, 0);
  assert.equal(G.presetFor('canopy', 'nope').azimuth, 0);
});

test('sideAzimuth maps canopy sides to the four directions and yard sides to front and back', () => {
  assert.deepEqual([0, 1, 2, 3].map((i) => G.sideAzimuth('canopy', i)), [0, 90, 180, 270]);
  assert.deepEqual([0, 1].map((i) => G.sideAzimuth('yard', i)), [0, 180]);
  assert.equal(G.sideAzimuth('feather', 0), null);
  assert.equal(G.sideAzimuth('banner', 0), null);
  assert.equal(G.sideAzimuth('throw', 0), null);
});

test('canopy face numbers come from the spec and the art is not stretched', () => {
  const s = specFor(specs, 'canopy', { package: 'valance' });
  const f = G.canopyFace(s);
  near(f.slant, s.valanceLine);
  near(f.valance, s.artboard.h - s.valanceLine);
  near(f.rise, Math.sqrt(s.valanceLine ** 2 - (s.artboard.w / 2) ** 2), 1e-9);
  assert.ok(f.rise > 40 && f.rise < 55, String(f.rise));
  const apex = G.canopyPoint(f, s.roof.polygon[0][0], s.roof.polygon[0][1]);
  near(apex[0], 0); near(apex[1], f.eave + f.rise, 1e-9); near(apex[2], 0, 1e-9);
  const left = G.canopyPoint(f, 0, s.valanceLine);
  const right = G.canopyPoint(f, s.artboard.w, s.valanceLine);
  assert.deepEqual([left[0], left[1], left[2]], [-59.5, 84, 59.5]);
  assert.deepEqual([right[0], right[1], right[2]], [59.5, 84, 59.5]);
  const lowerLeft = G.canopyPoint(f, 0, s.artboard.h);
  near(lowerLeft[1], 84 - f.valance);
  near(lowerLeft[2], 59.5);
  // isometry on the roof plane: 3D distances equal art distances
  const pts = [[59.5, 0], [10, 60], [100, 30], [0, 76.28], [119, 76.28], [59.5, 40]];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const a = G.canopyPoint(f, ...pts[i]);
      const b = G.canopyPoint(f, ...pts[j]);
      const d3 = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      const d2 = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
      near(d3, d2, 1e-6);
    }
  }
  // left to right and top to bottom as seen from outside (+Z)
  const a = G.canopyPoint(f, 30, 40);
  const b = G.canopyPoint(f, 90, 40);
  assert.ok(b[0] > a[0]);
  const hi = G.canopyPoint(f, 59.5, 10);
  const lo = G.canopyPoint(f, 59.5, 70);
  assert.ok(hi[1] > lo[1] && hi[2] < lo[2]);
});

test('canopy face follows a changed valance line (data, not constants)', () => {
  const s = specFor(specs, 'canopy', {});
  const s2 = { ...s, valanceLine: 70, artboard: { w: 119, h: 84.28 }, roof: { ...s.roof, polygon: [[59.5, 0], [119, 70], [0, 70]] } };
  const f = G.canopyFace(s2);
  near(f.slant, 70);
  near(f.valance, 14.28, 1e-9);
  near(f.rise, Math.sqrt(70 ** 2 - 59.5 ** 2), 1e-9);
});

test('outlineToUV maps the artboard corners to texture corners', () => {
  const s = specFor(specs, 'feather', { height: '10.5' });
  const uv = G.outlineToUV(s.outline, s.artboard);
  assert.equal(uv.length, s.outline.length);
  assert.deepEqual(uv[0], [0, 1]);
  assert.ok(uv.every(([u, v]) => u >= 0 && u <= 1 && v >= 0 && v <= 1));
  assert.equal(Math.max(...uv.map((p) => p[0])), 1);
  const last = uv[uv.length - 1];
  assert.deepEqual(last, [0, 0]);
  // v decreases down the flag
  assert.ok(uv[3][1] < uv[1][1]);
});

test('outlineRows follows the feather outline row by row', () => {
  for (const h of ['10.5', '14', '18']) {
    const s = specFor(specs, 'feather', { height: h });
    const rows = G.outlineRows(s.outline, 60, s.artboard.h);
    assert.equal(rows.length, 61);
    near(rows[0][0], 0);
    near(rows[60][0], s.artboard.h);
    assert.ok(rows.every(([, x0]) => x0 === 0), 'the left edge is the straight pole sleeve edge');
    assert.ok(rows.every(([, , x1]) => x1 >= 0 && x1 <= s.artboard.w + 1e-9));
    near(rows[0][2], 0, 1e-9);
    const widest = Math.max(...rows.map((r) => r[2]));
    near(widest, s.artboard.w, s.artboard.w * 0.03);
    const wi = rows.findIndex((r) => r[2] === widest);
    assert.ok(wi > 20 && wi < 45, `widest row ${wi}`);
    assert.ok(rows[60][2] > 0.3 * s.artboard.w && rows[60][2] < 0.5 * s.artboard.w, 'the base edge ends at 40 percent of the width');
  }
});

test('outlineRows handles polygons that do not touch the left edge', () => {
  const diamond = [[50, 0], [100, 50], [50, 100], [0, 50]];
  const rows = G.outlineRows(diamond, 4, 100);
  assert.deepEqual(rows.map((r) => [Math.round(r[1]), Math.round(r[2])]), [[50, 50], [25, 75], [0, 100], [25, 75], [50, 50]]);
});

test('poleHeightIn follows the height choice', () => {
  assert.equal(G.poleHeightIn({ height: '10.5' }), 126);
  assert.equal(G.poleHeightIn({ height: '14' }), 168);
  assert.equal(G.poleHeightIn({ height: '18' }), 216);
  assert.equal(G.poleHeightIn({}), 126);
  assert.equal(G.poleHeightIn(null), 126);
});

test('throwDims comes from the table spec', () => {
  for (const [len, w] of [['6', 72], ['8', 96]]) {
    const s = specFor(specs, 'throw', { length: len, style: '3' });
    const d = G.throwDims(s);
    assert.equal(d.L, w);
    assert.equal(d.D, 30);
    assert.equal(d.H, 30);
    assert.equal(d.hem, 2);
    assert.equal(d.panelH, 28);
    assert.equal(d.frontTop, 30);
  }
});

test('grommetPoints: corners plus about every 24 inches, no duplicates', () => {
  for (const size of ['2x4', '3x6', '4x8', '3x10']) {
    const s = specFor(specs, 'banner', { size });
    const { w, h } = s.artboard;
    const pts = G.grommetPoints(w, h, s.grommetEveryIn, 1.1);
    const key = (p) => p.map((v) => v.toFixed(3)).join(',');
    assert.equal(new Set(pts.map(key)).size, pts.length, 'no duplicates ' + size);
    for (const c of [[1.1, 1.1], [w - 1.1, 1.1], [1.1, h - 1.1], [w - 1.1, h - 1.1]]) assert.ok(pts.some((p) => Math.abs(p[0] - c[0]) < 1e-9 && Math.abs(p[1] - c[1]) < 1e-9), 'corner ' + c + ' ' + size);
    assert.ok(pts.every(([x, y]) => x >= 1 && x <= w - 1 && y >= 1 && y <= h - 1));
    const top = pts.filter((p) => p[1] < 2).map((p) => p[0]).sort((a, b) => a - b);
    for (let i = 1; i < top.length; i++) {
      const gap = top[i] - top[i - 1];
      assert.ok(gap > 14 && gap < 34, `gap ${gap} on ${size}`);
    }
  }
  assert.equal(G.grommetPoints(48, 24, 24, 1.1).length, 6);
  assert.equal(G.grommetPoints(96, 48, 24, 1.1).length, 12);
  assert.ok(G.grommetPoints(10, 10, 0, 1).length >= 4, 'a bad spacing falls back to 24 in');
});

test('packExtras shows two to three more signs', () => {
  assert.deepEqual(['5', '10', '25', '50', '100'].map(G.packExtras), [2, 2, 3, 3, 3]);
  assert.ok(G.EXTRA_POSES.length >= 3);
  assert.ok(G.EXTRA_POSES.every((p) => p.z < 0), 'extras stand behind the first sign');
  assert.equal(new Set(G.EXTRA_POSES.map((p) => p.ry)).size, G.EXTRA_POSES.length, 'every extra has its own angle');
});

test('insetView fits the product to the part of the canvas that is not covered', () => {
  const v0 = G.insetView(800, 600, {}, 34);
  near(v0.fov, 34);
  near(v0.aspect, 800 / 600);
  assert.equal(v0.offsetX, 0);
  assert.equal(v0.offsetY, 0);
  const v1 = G.insetView(390, 844, { bottom: 100 }, 34);
  assert.ok(v1.fov < 34 && v1.fov > 25);
  near(v1.aspect, 390 / 744);
  assert.equal(v1.offsetX, 0);
  near(v1.offsetY, 50);
  const v2 = G.insetView(390, 844, { top: 40, bottom: 40 }, 34);
  assert.equal(v2.offsetY, 0);
  assert.ok(v2.fov < 34);
  near(G.insetView(800, 600, { left: 60 }, 34).offsetX, -30);
  near(G.insetView(800, 600, { right: 60 }, 34).offsetX, 30);
  const tiny = G.insetView(300, 300, { top: 500, bottom: 500 }, 34);
  assert.ok(Number.isFinite(tiny.fov) && tiny.fov > 0 && tiny.aspect > 0, 'absurd insets stay finite');
  // a flag fitted to the free area stays inside it
  const flag = { hx: 12, hy: 108, hz: 4 };
  const d = G.fitDistance(flag, v1.fov, v1.aspect, 12, 1.1);
  const e = ndcExtents(flag, v1.fov, v1.aspect, 0, 12, d);
  assert.ok(e.mx <= 1.0001 && e.my <= 1.0001, JSON.stringify(e));
  assert.ok(d > G.fitDistance(flag, 34, 390 / 844, 12, 1.1), 'covered pixels mean a larger distance');
});
