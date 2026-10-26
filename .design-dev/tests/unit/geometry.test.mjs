import test from 'node:test';
import assert from 'node:assert/strict';
import { aabb, corners, pointInBox, hitTest, resizeBox, rotateAngle, pinchBox, snapTargets, computeSnap, alignBoxes, handlePoints, normalizeAngle } from '../../../assets/design/model/geometry.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('aabb of a rotated box', () => {
  const b = aabb({ x: 0, y: 0, w: 10, h: 2, rot: 90 });
  near(b.w, 2);
  near(b.h, 10);
  near(b.x + b.w / 2, 5);
  near(b.y + b.h / 2, 1);
});

test('hit tests respect rotation and stacking', () => {
  const box = { x: 0, y: 0, w: 10, h: 2, rot: 90 };
  assert.equal(pointInBox(box, 5, 5), true);
  assert.equal(pointInBox(box, 9, 1), false);
  const items = [
    { id: 'low', box: { x: 0, y: 0, w: 10, h: 10, rot: 0 } },
    { id: 'high', box: { x: 2, y: 2, w: 4, h: 4, rot: 0 } },
    { id: 'locked', box: { x: 2, y: 2, w: 4, h: 4, rot: 0 }, locked: true },
  ];
  assert.equal(hitTest(items, 3, 3), 'high');
  assert.equal(hitTest(items, 9, 9), 'low');
  assert.equal(hitTest(items, 20, 20), null);
});

test('corner resize keeps the opposite corner fixed (no rotation)', () => {
  const b = resizeBox({ x: 10, y: 10, w: 20, h: 10, rot: 0 }, 'se', { x: 40, y: 30 });
  near(b.x, 10);
  near(b.y, 10);
  near(b.w, 30);
  near(b.h, 20);
});

test('corner resize keeps the opposite corner fixed (rotated 90)', () => {
  const orig = { x: 10, y: 10, w: 20, h: 10, rot: 90 };
  const before = corners(orig);
  const handle = handlePoints(orig, 2).se;
  const moved = { x: handle.x + 4, y: handle.y + 6 };
  const next = resizeBox(orig, 'se', moved);
  const after = corners(next);
  // the nw corner (index 0) is the anchor for the se handle
  near(after[0].x, before[0].x);
  near(after[0].y, before[0].y);
});

test('aspect lock keeps the ratio on corner handles', () => {
  const b = resizeBox({ x: 0, y: 0, w: 20, h: 10, rot: 0 }, 'se', { x: 60, y: 12 }, { lockAspect: true });
  near(b.w / b.h, 2);
});

test('side handles change one dimension only', () => {
  const b = resizeBox({ x: 0, y: 0, w: 20, h: 10, rot: 0 }, 'e', { x: 35, y: 99 });
  near(b.w, 35);
  near(b.h, 10);
  near(b.x, 0);
});

test('minimum size is enforced', () => {
  const b = resizeBox({ x: 0, y: 0, w: 20, h: 10, rot: 0 }, 'e', { x: -50, y: 0 }, { minW: 3 });
  near(b.w, 3);
});

test('rotate handle snaps to steps and to right angles', () => {
  const box = { x: 0, y: 0, w: 10, h: 10, rot: 0 };
  near(rotateAngle(box, { x: 5, y: -20 }, {}), 0);
  near(rotateAngle(box, { x: 25, y: 5 }, {}), 90);
  near(rotateAngle(box, { x: 20, y: -10 }, { step: 15 }) % 15, 0);
  near(normalizeAngle(270), -90);
});

test('pinch scales, twists and follows the midpoint', () => {
  const orig = { x: 10, y: 10, w: 10, h: 4, rot: 0 };
  const start = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
  const now = [{ x: 0, y: 5 }, { x: 0, y: 25 }];
  const r = pinchBox(orig, start, now);
  near(r.scale, 2);
  near(r.w, 20);
  near(r.h, 8);
  near(r.rot, 90);
  near(r.x + r.w / 2, 15 + (0 - 5));
});

test('snapping pulls to the artboard center and reports a guide', () => {
  const spec = { trim: { x: 0, y: 0, w: 100, h: 50 }, safe: { x: 2, y: 2, w: 96, h: 46 } };
  const targets = snapTargets(spec, []);
  const bbox = { x: 40.4, y: 10, w: 20, h: 5 };
  const s = computeSnap(bbox, targets, 1);
  near(s.dx, -0.4 + 0);
  assert.ok(s.guides.some((g) => g.axis === 'x' && g.pos === 50));
  const far = computeSnap({ x: 20, y: 30, w: 10, h: 5 }, targets, 0.5);
  near(far.dx, 0);
  assert.equal(far.guides.length, 0);
});

test('snapping to other elements uses their edges', () => {
  const spec = { trim: { x: 0, y: 0, w: 100, h: 50 }, safe: { x: 2, y: 2, w: 96, h: 46 } };
  const targets = snapTargets(spec, [{ x: 10, y: 10, w: 20, h: 8, rot: 0 }]);
  const s = computeSnap({ x: 30.3, y: 30, w: 10, h: 5 }, targets, 1);
  near(s.dx, -0.3);
});

test('align moves boxes to the area edge', () => {
  const out = alignBoxes([{ id: 'a', box: { x: 5, y: 5, w: 10, h: 10, rot: 0 } }], { x: 0, y: 0, w: 100, h: 50 }, 'center');
  near(out.a.x, 45);
  const bottom = alignBoxes([{ id: 'a', box: { x: 5, y: 5, w: 10, h: 10, rot: 0 } }], { x: 0, y: 0, w: 100, h: 50 }, 'bottom');
  near(bottom.a.y, 40);
});
