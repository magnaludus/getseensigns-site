// Outline math: inset lines, point tests, row spans and the largest box that fits.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupe, signedArea, bounds, insetPolygon, insetConvex, pointInPolygon, distanceToEdge, distanceToLine, rowSpan, bandRect, columnRect, boxInside,
} from '../../../assets/design/model/outline.js';

const near = (a, b, tol = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);
const SQUARE = [[0, 0], [10, 0], [10, 10], [0, 10]];
const corners = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

test('dedupe drops points closer than eps to the one before, and a repeat of the first', () => {
  assert.deepEqual(dedupe([[0, 0], [0.05, 0], [5, 0], [5, 5], [0.02, 0.01]], 0.15), [[0, 0], [5, 0], [5, 5]]);
  assert.deepEqual(dedupe(SQUARE), SQUARE);
});

test('signedArea and bounds', () => {
  assert.equal(signedArea(SQUARE), 100);
  assert.equal(signedArea([...SQUARE].reverse()), -100);
  assert.deepEqual(bounds([[2, 3], [8, 1], [5, 9]]), { x: 2, y: 1, w: 6, h: 8 });
});

test('insetPolygon moves a square in by d on every side, either winding', () => {
  for (const ring of [SQUARE, [...SQUARE].reverse()]) {
    const b = bounds(insetPolygon(ring, 2));
    near(b.x, 2); near(b.y, 2); near(b.w, 6); near(b.h, 6);
  }
  assert.deepEqual(insetPolygon(SQUARE, 0), SQUARE);
});

test('insetPolygon puts the tip of a triangle in by d over the sine of the half angle', () => {
  // isosceles gable: apex (50, 0), base corners (0, 100) and (100, 100); half angle atan(50/100)
  const tri = [[50, 0], [100, 100], [0, 100]];
  const inset = insetPolygon(tri, 2);
  const tip = inset.reduce((a, p) => (p[1] < a[1] ? p : a));
  near(tip[0], 50, 1e-6);
  near(tip[1], 2 / Math.sin(Math.atan(0.5)), 1e-6);
});

test('insetConvex clips to the lines moved in by d and does not loop at a short edge', () => {
  const b = bounds(insetConvex(SQUARE, 2));
  near(b.x, 2); near(b.y, 2); near(b.w, 6); near(b.h, 6);
  // a flag-like tip: the top edge is no longer than the inset distance
  const tip = [[0, 0], [2, 0], [10, 4], [10, 40], [0, 40]];
  const inset = insetConvex(tip, 2);
  assert.ok(inset.length >= 3);
  assert.ok(signedArea(inset) * signedArea(tip) > 0, 'same winding, no loop');
  for (const [x, y] of inset) {
    assert.ok(pointInPolygon(x, y, tip) || distanceToEdge(x, y, tip) < 1e-6, `(${x}, ${y}) is inside`);
    assert.ok(distanceToEdge(x, y, tip) >= 2 - 1e-6, `(${x}, ${y}) is at least 2 in from every edge`);
  }
  // too deep an inset leaves nothing
  assert.ok(insetConvex(SQUARE, 6).length < 3);
});

test('pointInPolygon and the two distance helpers', () => {
  assert.equal(pointInPolygon(5, 5, SQUARE), true);
  assert.equal(pointInPolygon(11, 5, SQUARE), false);
  near(distanceToEdge(5, 5, SQUARE), 5);
  near(distanceToEdge(12, 5, SQUARE), 2);
  near(distanceToLine(3, 4, [[0, 0], [10, 0]]), 4);
  near(distanceToLine(-3, 4, [[0, 0], [10, 0]]), 5);
  assert.equal(distanceToLine(5, 5, [[0, 0]]), Infinity);
});

test('rowSpan gives the left and right ends of a line through the polygon', () => {
  const diamond = [[5, 0], [10, 5], [5, 10], [0, 5]];
  assert.deepEqual(rowSpan(diamond, 5), [0, 10]);
  assert.deepEqual(rowSpan(diamond, 2.5), [2.5, 7.5]);
  assert.equal(rowSpan(diamond, 11), null);
  // a horizontal edge on the line counts
  assert.deepEqual(rowSpan(SQUARE, 0), [0, 10]);
});

test('bandRect is the widest box over a band and null when the band leaves the shape', () => {
  const diamond = [[5, 0], [10, 5], [5, 10], [0, 5]];
  const r = bandRect(diamond, 2.5, 7.5);
  near(r.x, 2.5); near(r.w, 5); near(r.y, 2.5); near(r.h, 5);
  assert.equal(bandRect(diamond, -5, 3), null);
  assert.equal(bandRect([[0, 0], [10, 0], [5, 10]], 9.99, 20), null);
});

test('columnRect is the tallest box over a column', () => {
  const diamond = [[5, 0], [10, 5], [5, 10], [0, 5]];
  const r = columnRect(diamond, 2.5, 7.5);
  near(r.y, 2.5); near(r.h, 5); near(r.x, 2.5); near(r.w, 5);
  assert.equal(columnRect(diamond, 11, 12), null);
});

test('boxInside checks the whole box, rotated or not, with a little give', () => {
  assert.equal(boxInside(corners(1, 1, 8, 8), SQUARE), true);
  assert.equal(boxInside(corners(-1, 1, 8, 8), SQUARE), false);
  assert.equal(boxInside(corners(-0.04, 1, 8, 8), SQUARE, 0.05), true);
  // a box whose corners are inside a diamond but whose edge midpoints are not
  const diamond = [[5, 0], [10, 5], [5, 10], [0, 5]];
  assert.equal(boxInside(corners(3, 3, 4, 4), diamond), true);
  assert.equal(boxInside(corners(1.5, 1.5, 7, 7), diamond), false);
});
