// The orbit controller: input handling, inertia, zoom limits, tweens, taps. Runs in node with a fake element.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrbit } from '../../../assets/design/three/orbit.js';

class El extends EventTarget {
  constructor() {
    super();
    this.style = {};
  }
  setPointerCapture() {}
  releasePointerCapture() {}
}

function fire(el, type, props) {
  const e = new Event(type, { cancelable: true });
  const all = { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 0, clientY: 0, timeStamp: 0, ...props };
  for (const k of Object.keys(all)) Object.defineProperty(e, k, { value: all[k], configurable: true });
  el.dispatchEvent(e);
  return e;
}

function setup(reduced = false) {
  const el = new El();
  const log = { changes: 0, doubles: [] };
  const orbit = createOrbit(el, { reduced: () => reduced, onChange: () => log.changes++, onDouble: (x, y) => log.doubles.push([x, y]) });
  orbit.limits({ minDist: 50, maxDist: 800 });
  orbit.set({ azimuth: 0, elevation: 20, distance: 300 });
  return { el, orbit, log };
}

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

function drag(el, from, to, steps = 5, t0 = 1000, dtMs = 16, extra = {}) {
  fire(el, 'pointerdown', { clientX: from[0], clientY: from[1], timeStamp: t0, ...extra });
  for (let i = 1; i <= steps; i++) {
    fire(el, 'pointermove', { clientX: from[0] + ((to[0] - from[0]) * i) / steps, clientY: from[1] + ((to[1] - from[1]) * i) / steps, timeStamp: t0 + i * dtMs, ...extra });
  }
  return t0 + steps * dtMs;
}

test('dragging right turns the camera to the left and dragging down raises it', () => {
  const { el, orbit, log } = setup();
  const t = drag(el, [100, 100], [200, 100]);
  assert.ok(orbit.state.azimuth > 320 && orbit.state.azimuth < 340, String(orbit.state.azimuth));
  assert.equal(orbit.state.elevation, 20);
  fire(el, 'pointerup', { clientX: 200, clientY: 100, timeStamp: t + 200 });
  drag(el, [100, 100], [100, 150], 5, 5000);
  near(orbit.state.elevation, 20 + 50 * 0.32, 1e-6);
  assert.ok(log.changes > 5);
});

test('the elevation stops at 3 and 80 degrees', () => {
  const { el, orbit } = setup();
  drag(el, [0, 0], [0, 1000]);
  assert.equal(orbit.state.elevation, 80);
  fire(el, 'pointerup', { timeStamp: 5000 });
  drag(el, [0, 1000], [0, -2000], 6, 6000);
  assert.equal(orbit.state.elevation, 3);
  orbit.set({ elevation: 0 });
  assert.equal(orbit.state.elevation, 3);
  orbit.limits({ maxEl: 30 });
  orbit.set({ elevation: 70 });
  assert.equal(orbit.state.elevation, 30);
});

test('a quick release keeps turning and settles; a slow release stops at once', () => {
  const { el, orbit } = setup();
  const t = drag(el, [100, 100], [260, 100], 8, 1000, 10);
  fire(el, 'pointerup', { clientX: 260, clientY: 100, timeStamp: t + 5 });
  const az0 = orbit.state.azimuth;
  let n = 0;
  while (orbit.step(0.016, 2000 + n * 16) && n < 400) n++;
  assert.ok(n > 5 && n < 200, `inertia lasted ${n} frames`);
  assert.ok(Math.abs(orbit.state.azimuth - az0) > 3, 'it kept turning');
  assert.equal(orbit.step(0.016, 9000), false);
  const t2 = drag(el, [100, 100], [160, 100], 6, 20000, 10);
  fire(el, 'pointerup', { clientX: 160, clientY: 100, timeStamp: t2 + 400 });
  assert.equal(orbit.step(0.016, 21000), false, 'a pause before release means no fling');
});

test('with reduced motion there is no inertia and zoom jumps', () => {
  const { el, orbit } = setup(true);
  const t = drag(el, [100, 100], [260, 100], 8, 1000, 10);
  fire(el, 'pointerup', { timeStamp: t + 5 });
  assert.equal(orbit.step(0.016, 3000), false);
  const d0 = orbit.state.distance;
  fire(el, 'wheel', { deltaY: -100, deltaMode: 0 });
  assert.ok(orbit.state.distance < d0, 'distance changed immediately');
  assert.equal(orbit.step(0.016, 3100), false);
});

test('wheel zooms smoothly toward a limited goal', () => {
  const { el, orbit } = setup();
  const e = fire(el, 'wheel', { deltaY: -120, deltaMode: 0 });
  assert.equal(e.defaultPrevented, true, 'the page does not scroll');
  assert.equal(orbit.state.distance, 300, 'the move is smoothed, not instant');
  let n = 0;
  while (orbit.step(0.016, 1000 + n * 16) && n < 300) n++;
  assert.ok(orbit.state.distance < 280 && orbit.state.distance > 200, String(orbit.state.distance));
  for (let i = 0; i < 40; i++) fire(el, 'wheel', { deltaY: -500, deltaMode: 0 });
  n = 0;
  while (orbit.step(0.016, 9000 + n * 16) && n < 600) n++;
  near(orbit.state.distance, 50, 1e-6);
  for (let i = 0; i < 80; i++) fire(el, 'wheel', { deltaY: 500, deltaMode: 0 });
  n = 0;
  while (orbit.step(0.016, 19000 + n * 16) && n < 900) n++;
  near(orbit.state.distance, 800, 1e-6);
  fire(el, 'wheel', { deltaY: 3, deltaMode: 1 });
  fire(el, 'wheel', { deltaY: 1, deltaMode: 2 });
});

test('arrow keys orbit by 6 degrees, shift triples it, plus and minus zoom', () => {
  const { el, orbit } = setup();
  let e = fire(el, 'keydown', { key: 'ArrowLeft' });
  assert.equal(e.defaultPrevented, true);
  near(orbit.state.azimuth, 6);
  fire(el, 'keydown', { key: 'ArrowRight', shiftKey: true });
  near(orbit.state.azimuth, 348);
  fire(el, 'keydown', { key: 'ArrowUp' });
  near(orbit.state.elevation, 26);
  fire(el, 'keydown', { key: 'ArrowDown', shiftKey: true });
  near(orbit.state.elevation, 8);
  const d = orbit.state.distance;
  fire(el, 'keydown', { key: '+' });
  let n = 0;
  while (orbit.step(0.016, 1000 + n * 16) && n < 300) n++;
  assert.ok(orbit.state.distance < d);
  const d2 = orbit.state.distance;
  fire(el, 'keydown', { key: '-' });
  n = 0;
  while (orbit.step(0.016, 5000 + n * 16) && n < 300) n++;
  assert.ok(orbit.state.distance > d2);
  e = fire(el, 'keydown', { key: 'a' });
  assert.equal(e.defaultPrevented, false, 'other keys are left alone');
  e = fire(el, 'keydown', { key: 'ArrowLeft', ctrlKey: true });
  assert.equal(e.defaultPrevented, false, 'browser shortcuts are left alone');
});

test('tweens take the short way round and end exactly on the goal', () => {
  const { orbit } = setup();
  orbit.set({ azimuth: 350 });
  const t0 = performance.now();
  orbit.tweenTo({ azimuth: 10, elevation: 40, distance: 200 }, 500);
  orbit.step(0.016, t0 + 250);
  const mid = orbit.state.azimuth;
  assert.ok(mid > 349 || mid < 20, 'passes through 0, not through 180: ' + mid);
  assert.ok(orbit.step(0.016, t0 + 400));
  assert.equal(orbit.step(0.016, t0 + 600), false);
  near(orbit.state.azimuth, 10, 1e-6);
  near(orbit.state.elevation, 40, 1e-6);
  near(orbit.state.distance, 200, 1e-6);
  orbit.tweenTo({ azimuth: 270 }, 500);
  const t1 = performance.now();
  orbit.step(0.016, t1 + 600);
  near(orbit.state.azimuth, 270, 1e-6);
});

test('reduced motion tweens jump', () => {
  const { orbit } = setup(true);
  orbit.tweenTo({ azimuth: 90, distance: 120 }, 500);
  near(orbit.state.azimuth, 90);
  near(orbit.state.distance, 120);
  assert.equal(orbit.step(0.016, performance.now()), false);
});

test('touching the view stops a tween', () => {
  const { el, orbit } = setup();
  const t0 = performance.now();
  orbit.tweenTo({ azimuth: 180 }, 1000);
  orbit.step(0.016, t0 + 200);
  const az = orbit.state.azimuth;
  fire(el, 'pointerdown', { clientX: 5, clientY: 5, timeStamp: 1 });
  assert.equal(orbit.step(0.016, t0 + 900), false);
  near(orbit.state.azimuth, az);
});

test('two fingers pinch to zoom', () => {
  const { el, orbit } = setup();
  fire(el, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 200, timeStamp: 1 });
  fire(el, 'pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 200, timeStamp: 2 });
  for (let i = 1; i <= 8; i++) {
    fire(el, 'pointermove', { pointerId: 1, pointerType: 'touch', clientX: 200 - i * 10, clientY: 200, timeStamp: 2 + i });
    fire(el, 'pointermove', { pointerId: 2, pointerType: 'touch', clientX: 300 + i * 10, clientY: 200, timeStamp: 2 + i });
  }
  assert.ok(orbit.state.distance < 200, String(orbit.state.distance));
  near(orbit.state.azimuth, 0, 1e-9);
  fire(el, 'pointerup', { pointerId: 1, pointerType: 'touch', timeStamp: 20 });
  fire(el, 'pointerup', { pointerId: 2, pointerType: 'touch', timeStamp: 21 });
  const d = orbit.state.distance;
  fire(el, 'pointerdown', { pointerId: 3, pointerType: 'touch', clientX: 50, clientY: 50, timeStamp: 100 });
  fire(el, 'pointermove', { pointerId: 3, pointerType: 'touch', clientX: 90, clientY: 50, timeStamp: 116 });
  assert.equal(orbit.state.distance, d, 'one finger orbits again after a pinch');
  assert.ok(orbit.state.azimuth !== 0);
});

test('double tap and double click report the point once', () => {
  const { el, log } = setup();
  const tap = (x, y, t, id = 7) => {
    fire(el, 'pointerdown', { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, timeStamp: t });
    fire(el, 'pointerup', { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, timeStamp: t + 40 });
  };
  tap(100, 100, 1000);
  assert.equal(log.doubles.length, 0);
  tap(103, 102, 1200);
  assert.deepEqual(log.doubles, [[103, 102]]);
  tap(103, 102, 1300);
  assert.equal(log.doubles.length, 1, 'a third tap starts a new pair');
  tap(300, 300, 5000);
  tap(300, 300, 5600);
  assert.equal(log.doubles.length, 1, 'too slow');
  tap(300, 300, 9000);
  tap(380, 300, 9100);
  assert.equal(log.doubles.length, 1, 'too far apart');
  // a drag is not a tap
  fire(el, 'pointerdown', { pointerId: 8, pointerType: 'touch', clientX: 10, clientY: 10, timeStamp: 12000 });
  fire(el, 'pointermove', { pointerId: 8, pointerType: 'touch', clientX: 60, clientY: 10, timeStamp: 12020 });
  fire(el, 'pointerup', { pointerId: 8, pointerType: 'touch', clientX: 60, clientY: 10, timeStamp: 12040 });
  tap(60, 10, 12100);
  assert.equal(log.doubles.length, 1);
});

test('the mouse uses the browser dblclick, and a duplicate within 400 ms is dropped', () => {
  const { el, log } = setup();
  fire(el, 'dblclick', { clientX: 5, clientY: 6 });
  assert.deepEqual(log.doubles, [[5, 6]]);
  fire(el, 'dblclick', { clientX: 7, clientY: 8 });
  assert.equal(log.doubles.length, 1, 'a tap pair and the dblclick that follows it count once');
  fire(el, 'dblclick', { clientX: 9, clientY: 9, pointerType: 'touch' });
  assert.equal(log.doubles.length, 1, 'a touch dblclick is left to the tap detector');
});

test('right and middle mouse buttons do not orbit', () => {
  const { el, orbit } = setup();
  drag(el, [0, 0], [100, 0], 5, 1000, 16, { button: 2 });
  assert.equal(orbit.state.azimuth, 0);
});

test('dispose detaches every listener', () => {
  const { el, orbit, log } = setup();
  orbit.dispose();
  drag(el, [0, 0], [100, 50]);
  fire(el, 'wheel', { deltaY: -100 });
  fire(el, 'keydown', { key: 'ArrowLeft' });
  fire(el, 'dblclick', { clientX: 1, clientY: 1 });
  assert.equal(orbit.state.azimuth, 0);
  assert.equal(orbit.state.distance, 300);
  assert.equal(log.doubles.length, 0);
});

test('the cursor shows a grabbing hand while dragging', () => {
  const { el } = setup();
  fire(el, 'pointerdown', { clientX: 1, clientY: 1, timeStamp: 1 });
  assert.equal(el.style.cursor, 'grabbing');
  fire(el, 'pointerup', { timeStamp: 50 });
  assert.equal(el.style.cursor, 'grab');
});
