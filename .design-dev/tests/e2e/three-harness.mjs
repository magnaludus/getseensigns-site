// End-to-end check of the lazy 3D stage in headless Chromium (software WebGL).
// Run from .design-dev:  node tests/e2e/three-harness.mjs
// Serves the repo root on a free port, screenshots every product, scene and viewport into
// .design-dev/out/three/ and asserts orientation, colors, interaction, disposal and failure modes.
import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const out = join(root, '.design-dev', 'out', 'three');
mkdirSync(join(out, 'plates'), { recursive: true });

import * as G from '../../../assets/design/three/geom.js';
import { specFor } from '../../../assets/design/model/specs.js';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (e) {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
const seen = [];
const server = http.createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(root, path);
  const ok = file.startsWith(root) && existsSync(file) && statSync(file).isFile();
  seen.push({ path, status: ok ? 200 : 404 });
  if (!ok) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(Number(process.env.THREE_PORT) || 0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  if (!cond) console.log('  FAIL ' + name + (detail ? ' :: ' + detail : ''));
}

const KNOWN = /GL Driver Message|GPU stall|swiftshader|Automatic fallback to software WebGL/i;
const problems = [];
const stats = {};

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });

async function open(width, height, query, opts = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, ...(opts.context || {}) });
  const page = await context.newPage();
  page.on('console', (m) => {
    const allowed = opts.allow && (opts.allow.test(m.text()) || opts.allow.test(m.location().url || ''));
    if ((m.type() === 'error' || m.type() === 'warning') && !KNOWN.test(m.text()) && !allowed) problems.push(`[${query}] ${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[${query}] pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400 && !(opts.allow && opts.allow.test(r.url()))) problems.push(`[${query}] HTTP ${r.status()} ${r.url()}`);
  });
  page.on('requestfailed', (r) => {
    if (!(opts.allow && opts.allow.test(r.url()))) problems.push(`[${query}] request failed ${r.url()}`);
  });
  if (opts.init) await page.addInitScript(opts.init);
  await page.addInitScript(SCAN);
  await page.goto(`${base}/.design-dev/harness/3d.html?${query}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
  return { page, context };
}

// Page-side helpers: classify screenshot pixels by hue and report counts and centroids.
const SCAN = `
window.__scan = (rules, region) => {
  const c = window.__stage.screenshot();
  const t = document.createElement('canvas');
  t.width = c.width; t.height = c.height;
  const g = t.getContext('2d');
  g.drawImage(c, 0, 0);
  const k = c.width / window.innerWidth;
  const r = region || [0, 0, window.innerWidth, window.innerHeight];
  const x0 = Math.floor(r[0] * k), y0 = Math.floor(r[1] * k), w = Math.floor(r[2] * k), h = Math.floor(r[3] * k);
  const d = g.getImageData(x0, y0, w, h).data;
  const res = {};
  for (const n in rules) res[n] = { n: 0, x: 0, y: 0 };
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      const R = d[i] / 255, G = d[i + 1] / 255, B = d[i + 2] / 255;
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B), v = mx, s = mx ? (mx - mn) / mx : 0;
      if (s < 0.5 || v < 0.3) continue;
      let hu;
      const dd = mx - mn;
      if (mx === R) hu = ((G - B) / dd) % 6; else if (mx === G) hu = (B - R) / dd + 2; else hu = (R - G) / dd + 4;
      hu = (hu * 60 + 360) % 360;
      for (const n in rules) {
        const [a, b] = rules[n];
        const inside = a <= b ? hu >= a && hu <= b : hu >= a || hu <= b;
        if (inside) { res[n].n++; res[n].x += x / k + r[0]; res[n].y += y / k + r[1]; }
      }
    }
  }
  for (const n in res) if (res[n].n) { res[n].x /= res[n].n; res[n].y /= res[n].n; }
  return res;
};
window.__px = (x, y) => {
  const c = window.__stage.screenshot();
  const t = document.createElement('canvas');
  t.width = c.width; t.height = c.height;
  const g = t.getContext('2d');
  g.drawImage(c, 0, 0);
  const k = c.width / window.innerWidth;
  const d = g.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data;
  return [d[0], d[1], d[2]];
};
`;

const MARK = { A: [255, 285], B: [310, 335], C: [62, 82] };
const SIDE_HUES = { s0: [352, 14], s1: [208, 232], s2: [128, 152], s3: [30, 50] };

async function shot(page, name) {
  await page.screenshot({ path: join(out, name + '.png') });
}

async function state(page) {
  return page.evaluate(() => window.__stage.getState());
}

async function view(page, fn, ...args) {
  return page.evaluate(fn, ...args);
}

// Show a product, optionally with a camera setup, and return the scene stats.
async function show(page, product, choices, cam = {}) {
  await page.evaluate(([p, c, cam]) => {
    const st = window.__stage;
    window.__apply(p, c);
    if (cam.scene) st.setScene(cam.scene);
    if (cam.preset) st.setCameraPreset(cam.preset, { animate: false });
    if (cam.focus != null) st.focusSide(cam.focus, { animate: false });
    if (cam.state) st.setCameraState(cam.state);
    st.renderNow();
  }, [product, choices, cam]);
  return state(page);
}

function markerOrder(m, mirrored) {
  const ok = m.A.n > 8 && m.B.n > 8 && m.C.n > 8;
  const upright = m.A.y < m.B.y - 2;
  const dir = mirrored ? m.C.x < m.A.x - 2 : m.C.x > m.A.x + 2;
  return { ok, upright, dir };
}

const t0 = Date.now();
// THREE_ONLY=resize,motion runs just those sections (shots, canopy, orientation, interaction, textures, resize, motion, plates, context, failure).
const only = (process.env.THREE_ONLY || '').split(',').filter(Boolean);
const want = (name) => !only.length || only.includes(name);

// ---------------------------------------------------------------- desktop and phone shots
if (want('shots')) {
const PRODUCTS = [
  ['canopy', { package: 'valance' }, 'pkg-valance'],
  ['canopy', { package: 'back' }, 'pkg-back'],
  ['canopy', { package: 'kit' }, 'pkg-kit'],
  ['feather', { height: '10.5', base: 'spike' }, '10-5-spike'],
  ['feather', { height: '14', base: 'cross' }, '14-cross'],
  ['feather', { height: '18', base: 'spike' }, '18-spike'],
  ['throw', { length: '6', style: '3' }, '6ft-3sided'],
  ['throw', { length: '8', style: '4' }, '8ft-4sided'],
  ['banner', { size: '2x4' }, '2x4'],
  ['banner', { size: '4x8' }, '4x8'],
  ['banner', { size: '3x10' }, '3x10'],
  ['yard', { pack: '5', print: '1' }, 'pack5-one-side'],
  ['yard', { pack: '25', print: '2' }, 'pack25-two-sides'],
];

for (const [label, w, h] of [['desktop', 1440, 900], ['phone', 390, 844]]) {
  const { page, context } = await open(w, h, 'product=canopy');
  check(`${label}: stage created`, await page.evaluate(() => !!window.__stage && !window.__failure));
  check(`${label}: onReady fired`, await page.evaluate(() => window.__firstFrame === true));
  for (const [product, choices, tag] of PRODUCTS) {
    const s = await show(page, product, choices, { scene: 'studio', preset: 'front' });
    await shot(page, `${label}-${product}-${tag}-studio-front`);
    stats[`${product}/${tag}/${label}`] = s.info;
    check(`${label}: ${product} ${tag} draws something`, s.info.triangles > 100, JSON.stringify(s.info));
  }
  for (const scene of ['studio', 'yard', 'storefront']) {
    for (const [product, choices, tag] of [
      ['canopy', { package: 'valance' }, 'canopy'],
      ['feather', { height: '14', base: 'spike' }, 'feather'],
      ['throw', { length: '6', style: '4' }, 'throw'],
      ['banner', { size: '3x6' }, 'banner'],
      ['yard', { pack: '10', print: '2' }, 'yard'],
    ]) {
      await show(page, product, choices, { scene, preset: 'front' });
      await shot(page, `${label}-scene-${scene}-${tag}`);
    }
  }
  if (label === 'phone') {
    // A tall 18 ft flag must be fully visible in the front view on a narrow screen.
    await show(page, 'feather', { height: '18', base: 'spike' }, { scene: 'studio', preset: 'front' });
    const pts = await page.evaluate(() => {
      const s = window.__stage;
      return { top: s._project([0, 216, 0]), base: s._project([0, 0, 0]), edge: s._project([12, 100, 0]), w: window.innerWidth, h: window.innerHeight };
    });
    check('phone: 18 ft flag top is inside the viewport', pts.top.y > 0 && pts.top.y < pts.h * 0.2, JSON.stringify(pts.top));
    check('phone: 18 ft flag base is inside the viewport', pts.base.y < pts.h && pts.base.y > pts.h * 0.8, JSON.stringify(pts.base));
    check('phone: flag width fits', pts.edge.x > 0 && pts.edge.x < pts.w);
    await shot(page, 'phone-feather-18ft-fit');
  }
  check(`${label}: no canvases leaked before dispose (1 stage canvas)`, (await page.evaluate(() => document.querySelectorAll('canvas').length)) === 1);
  await context.close();
}
}

// ---------------------------------------------------------------- canopy sides and art orientation
if (want('canopy')) {
{
  const { page, context } = await open(1440, 900, 'product=canopy');
  const colors = ['red', 'blue', 'green', 'amber'];
  for (let i = 0; i < 4; i++) {
    await show(page, 'canopy', { package: 'valance' }, { preset: 'front' });
    await page.evaluate((i) => { window.__stage.focusSide(i, { animate: false }); window.__stage.renderNow(); }, i);
    const m = await page.evaluate((r) => window.__scan(r), SIDE_HUES);
    const own = m['s' + i].n;
    const others = [0, 1, 2, 3].filter((j) => j !== i).map((j) => m['s' + j].n);
    check(`canopy side ${i} (${colors[i]}) dominates its own view`, own > 2000 && own > 2.5 * Math.max(...others), `${own} vs ${others.join(',')}`);
    await shot(page, `desktop-canopy-side${i}-${colors[i]}`);
    const mk = await page.evaluate((r) => window.__scan(r), MARK);
    const o = markerOrder(mk, false);
    check(`canopy side ${i}: art not flipped or mirrored`, o.ok && o.upright && o.dir, JSON.stringify(mk));
    const st = await state(page);
    check(`canopy side ${i}: camera azimuth is ${i * 90}`, Math.abs(st.camera.azimuth - i * 90) < 0.01, String(st.camera.azimuth));
  }
  // the same, from the inside the art is mirrored (print-through) but never upside down
  await page.evaluate(() => { const s = window.__stage; s.setCameraState({ azimuth: 180, elevation: 5, distance: 120 }); s.renderNow(); });
  await shot(page, 'desktop-canopy-inside-looking-at-front');
  await show(page, 'canopy', { package: 'valance' }, { preset: 'wide' });
  await shot(page, 'desktop-canopy-wide');
  await show(page, 'canopy', { package: 'kit' }, { preset: 'back' });
  await shot(page, 'desktop-canopy-kit-back');
  await show(page, 'canopy', { package: 'kit' }, { preset: 'side' });
  await shot(page, 'desktop-canopy-kit-side');
  await show(page, 'canopy', { package: 'valance' }, { state: { azimuth: 20, elevation: 4, distance: 170 } });
  await shot(page, 'desktop-canopy-low-close');
  // The art is a hue ramp down the artboard. Sampling the screen where known art points land shows that the
  // roof, the eave seam and the valance all carry the right part of the art.
  const specs = JSON.parse(readFileSync(join(root, 'assets', 'design', 'print-specs.json'), 'utf8'));
  const spec = specFor(specs, 'canopy', { package: 'valance' });
  const face = G.canopyFace(spec);
  const probes = [[59.5, 12], [30, 40], [90, 40], [20, 70], [100, 70], [60, face.vy - 1.5], [60, face.vy + 1.5], [30, face.vy + 6], [90, face.vy + 4]].map(([x, y]) => ({ x, y, p: G.canopyPoint(face, x, y), hue: (240 * y) / face.h }));
  await show(page, 'canopy', { package: 'valance' }, { preset: 'front', state: { azimuth: 0, elevation: 10, distance: 330 } });
  await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1190;
    c.height = 843;
    const g = c.getContext('2d');
    for (let y = 0; y < c.height; y++) {
      g.fillStyle = `hsl(${(240 * y) / c.height}, 90%, 50%)`;
      g.fillRect(0, y, c.width, 1);
    }
    window.__stage.setSideTexture(0, c);
    window.__stage.renderNow();
  });
  const seen = await page.evaluate((probes) => probes.map((q) => {
    const s = window.__stage._project(q.p);
    const [r, g, b] = window.__px(s.x, s.y);
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const d = mx - mn || 1;
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    return { hue: h, sat: mx ? d / mx : 0 };
  }), probes);
  probes.forEach((q, i) => {
    const off = Math.abs(seen[i].hue - q.hue);
    check(`canopy art point (${q.x}, ${q.y.toFixed(1)}) lands where the hue ramp says`, seen[i].sat > 0.3 && off < 16, `expected ${q.hue.toFixed(0)}, saw ${seen[i].hue.toFixed(0)} sat ${seen[i].sat.toFixed(2)}`);
  });
  await show(page, 'canopy', { package: 'valance' }, { preset: 'front' });
  await context.close();
}
}

// orientation of the other products
if (want('orientation')) {
{
  const { page, context } = await open(1440, 900, 'product=feather');
  const cases = [
    ['feather', { height: '14', base: 'spike' }, { preset: 'front' }, false, 'feather front'],
    ['feather', { height: '14', base: 'spike' }, { preset: 'back' }, true, 'feather back (print-through is mirrored)'],
    ['throw', { length: '6', style: '4' }, { preset: 'front' }, false, 'throw front'],
    ['banner', { size: '3x6' }, { preset: 'front' }, false, 'banner on fence'],
    ['banner', { size: '3x6' }, { preset: 'front', mount: 'wall' }, false, 'banner on wall'],
    ['yard', { pack: '5', print: '2' }, { focus: 0 }, false, 'yard front'],
    ['yard', { pack: '5', print: '2' }, { focus: 1 }, false, 'yard back (own art, reads left to right)'],
  ];
  for (const [product, choices, cam, mirrored, name] of cases) {
    if (cam.mount) await page.evaluate((m) => window.__stage.setOptions({ mount: m }), cam.mount);
    else await page.evaluate(() => window.__stage.setOptions({ mount: 'fence' }));
    await show(page, product, choices, cam);
    const mk = await page.evaluate((r) => window.__scan(r), MARK);
    const o = markerOrder(mk, mirrored);
    check(`${name}: markers found`, o.ok, JSON.stringify(mk));
    check(`${name}: not upside down`, o.upright);
    check(`${name}: left/right ${mirrored ? 'mirrored' : 'correct'}`, o.dir);
    await shot(page, 'orient-' + name.replace(/[^a-z0-9]+/gi, '-').toLowerCase());
  }
  await page.evaluate(() => window.__stage.setOptions({ mount: 'fence' }));
  // banner wall mount and close up grommets
  await show(page, 'banner', { size: '3x6' }, { state: { azimuth: 12, elevation: 8, distance: 75 } });
  await shot(page, 'detail-banner-grommets-fence');
  await show(page, 'yard', { pack: '5', print: '1' }, { state: { azimuth: 18, elevation: 62, distance: 26 } });
  await shot(page, 'detail-yard-flutes');
  await show(page, 'yard', { pack: '5', print: '1' }, { state: { azimuth: 0, elevation: 3, distance: 70 } });
  await shot(page, 'detail-yard-low');
  await show(page, 'throw', { length: '6', style: '3' }, { state: { azimuth: 160, elevation: 22 } });
  await shot(page, 'detail-throw-open-back');
  await show(page, 'throw', { length: '6', style: '4' }, { state: { azimuth: 160, elevation: 22 } });
  await shot(page, 'detail-throw-closed-back');
  await show(page, 'feather', { height: '10.5', base: 'cross' }, { state: { azimuth: 35, elevation: 6, distance: 140 } });
  await shot(page, 'detail-feather-cross-close');
  await context.close();
}
}

// ---------------------------------------------------------------- interaction
if (want('interaction')) {
{
  const { page, context } = await open(1440, 900, 'product=canopy');
  const cx = 720;
  const cy = 450;
  let s0 = await state(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  let s1 = await state(page);
  const dAz = ((s1.camera.azimuth - s0.camera.azimuth + 540) % 360) - 180;
  check('drag right orbits the camera to the left (azimuth decreases)', dAz < -25 && dAz > -140, `delta ${dAz.toFixed(1)}`);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + 60, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const s2 = await state(page);
  check('drag down raises the camera', s2.camera.elevation > s1.camera.elevation + 8, `${s1.camera.elevation} -> ${s2.camera.elevation}`);
  await page.evaluate(() => window.__stage.setCameraState({ azimuth: 0, elevation: 12, distance: 330 }));
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(700);
  const s3 = await state(page);
  check('wheel up zooms in', s3.camera.distance < 300, String(s3.camera.distance));
  await page.mouse.wheel(0, 2500);
  await page.waitForTimeout(900);
  const s4 = await state(page);
  check('wheel down zooms out but is limited', s4.camera.distance > s3.camera.distance * 1.2 && s4.camera.distance < 1200, `${s3.camera.distance} -> ${s4.camera.distance}`);
  // limits
  await page.evaluate(() => window.__stage.setCameraState({ elevation: 0, distance: 1 }));
  let s5 = await state(page);
  check('elevation floor keeps the camera above ground', s5.camera.elevation >= 3, String(s5.camera.elevation));
  check('distance floor', s5.camera.distance > 20, String(s5.camera.distance));
  await page.evaluate(() => window.__stage.setCameraState({ elevation: 95, distance: 99999 }));
  s5 = await state(page);
  check('elevation ceiling', s5.camera.elevation <= 80.0001, String(s5.camera.elevation));
  check('distance ceiling', s5.camera.distance < 5000, String(s5.camera.distance));
  // keyboard
  await page.evaluate(() => { window.__stage.setCameraState({ azimuth: 0, elevation: 20, distance: 330 }); });
  await page.evaluate(() => window.__stage.canvas.focus());
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');
  let s6 = await state(page);
  check('ArrowLeft orbits', Math.abs(s6.camera.azimuth - 6) < 0.5, String(s6.camera.azimuth));
  check('ArrowUp raises', Math.abs(s6.camera.elevation - 26) < 0.5, String(s6.camera.elevation));
  await page.keyboard.press('+');
  await page.waitForTimeout(500);
  const s7 = await state(page);
  check('+ zooms in', s7.camera.distance < 330, String(s7.camera.distance));
  await page.keyboard.press('-');
  await page.keyboard.press('-');
  await page.waitForTimeout(500);
  const s8 = await state(page);
  check('- zooms out', s8.camera.distance > s7.camera.distance, `${s7.camera.distance} -> ${s8.camera.distance}`);
  // picking
  await page.evaluate(() => { window.__stage.setCameraPreset('front', { animate: false }); window.__stage.renderNow(); });
  const hit = await page.evaluate(() => window.__stage.pick(720, 330));
  check('pick on the front roof returns side 0', hit && hit.sideIndex === 0, JSON.stringify(hit));
  const miss = await page.evaluate(() => window.__stage.pick(30, 30));
  check('pick on the background returns null', miss === null, JSON.stringify(miss));
  await page.evaluate(() => { window.__picks = []; });
  await page.mouse.dblclick(720, 330);
  await page.waitForTimeout(100);
  let picks = await page.evaluate(() => window.__picks);
  check('double click calls onPick with the side', picks.length === 1 && picks[0].sideIndex === 0, JSON.stringify(picks));
  await page.mouse.dblclick(30, 30);
  picks = await page.evaluate(() => window.__picks);
  check('double click on the background does not pick', picks.length === 1);
  // double tap and pinch with synthetic touch pointers
  const tap = (x, y, id) => page.evaluate(([x, y, id]) => {
    const c = window.__stage.canvas;
    const o = { pointerId: id, pointerType: 'touch', isPrimary: true, bubbles: true, clientX: x, clientY: y, button: 0 };
    c.dispatchEvent(new PointerEvent('pointerdown', o));
    c.dispatchEvent(new PointerEvent('pointerup', o));
  }, [x, y, id]);
  await page.evaluate(() => { window.__picks = []; });
  await tap(720, 330, 5);
  await page.waitForTimeout(120);
  await tap(722, 331, 6);
  picks = await page.evaluate(() => window.__picks);
  check('double tap calls onPick', picks.length === 1 && picks[0].sideIndex === 0, JSON.stringify(picks));
  await page.evaluate(() => window.__stage.setCameraState({ azimuth: 0, elevation: 12, distance: 330 }));
  const d0 = (await state(page)).camera.distance;
  await page.evaluate(() => {
    const c = window.__stage.canvas;
    const ev = (t, id, x) => c.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: 'touch', bubbles: true, clientX: x, clientY: 450, isPrimary: id === 1 }));
    ev('pointerdown', 1, 620);
    ev('pointerdown', 2, 720);
    for (let i = 1; i <= 10; i++) { ev('pointermove', 1, 620 - i * 15); ev('pointermove', 2, 720 + i * 15); }
    ev('pointerup', 1, 470);
    ev('pointerup', 2, 870);
  });
  await page.waitForTimeout(300);
  const d1 = (await state(page)).camera.distance;
  check('pinch out zooms in', d1 < d0 * 0.7, `${d0} -> ${d1}`);

  // presets and animated camera moves settle on their targets
  await page.evaluate(() => window.__stage.setCameraPreset('side', { animate: true }));
  await page.waitForTimeout(1300);
  let sp = await state(page);
  check('animated preset reaches side view', Math.abs(sp.camera.azimuth - 90) < 0.5, String(sp.camera.azimuth));
  await page.evaluate(() => window.__stage.focusSide(3, { animate: true }));
  await page.waitForTimeout(1300);
  sp = await state(page);
  check('animated focusSide(3) reaches azimuth 270', Math.abs(sp.camera.azimuth - 270) < 0.5, String(sp.camera.azimuth));
  await page.evaluate(() => window.__stage.setCameraPreset('back', { animate: false }));
  sp = await state(page);
  check('jump preset back is azimuth 180', Math.abs(sp.camera.azimuth - 180) < 0.01);
  const cs = await page.evaluate(() => { const s = window.__stage; s.setCameraState({ azimuth: 33, elevation: 21, distance: 400 }); return s.getCameraState(); });
  check('get/setCameraState round trip', Math.abs(cs.azimuth - 33) < 1e-6 && Math.abs(cs.elevation - 21) < 1e-6 && Math.abs(cs.distance - 400) < 1e-6, JSON.stringify(cs));
  await context.close();
}
}

// ---------------------------------------------------------------- textures, base color, options
if (want('textures')) {
{
  const { page, context } = await open(1440, 900, 'product=yard&choices=pack:5,print:2&noart=1');
  await page.evaluate(() => {
    const st = window.__stage;
    const c = document.createElement('canvas');
    c.width = 4096; c.height = 3072;
    const g = c.getContext('2d');
    g.fillStyle = '#d93a2f';
    g.fillRect(0, 0, c.width, c.height);
    window.__big = c;
    st.setSideTexture(0, c);
    st.setCameraPreset('front', { animate: false });
    st.renderNow();
  });
  let st = await state(page);
  check('large art is capped to maxTexture on the long edge', st.textures[0] && Math.max(...st.textures[0]) === 2048 && st.textures[0][1] === 1536, JSON.stringify(st.textures));
  const before = await page.evaluate(() => window.__scan({ red: [352, 14], blue: [208, 232] }));
  check('first texture shows red art', before.red.n > 3000 && before.blue.n === 0, JSON.stringify(before));
  const texturesBefore = (await state(page)).info.textures;
  await page.evaluate(() => {
    const c = window.__big;
    const g = c.getContext('2d');
    g.fillStyle = '#2563eb';
    g.fillRect(0, 0, c.width, c.height);
    window.__stage.setSideTexture(0, c);
    window.__stage.renderNow();
  });
  const after = await page.evaluate(() => window.__scan({ red: [352, 14], blue: [208, 232] }));
  check('redrawing the same canvas updates in place', after.blue.n > 3000 && after.red.n === 0, JSON.stringify(after));
  check('in place update does not allocate textures', (await state(page)).info.textures === texturesBefore, `${texturesBefore} -> ${(await state(page)).info.textures}`);
  await page.evaluate(() => { window.__stage.setSideTexture(0, null); window.__stage.renderNow(); });
  const white = await page.evaluate(() => window.__scan({ blue: [208, 232] }));
  check('null texture shows blank art', white.blue.n === 0);
  // base color on unprinted parts
  await page.evaluate(() => window.__apply('throw', { length: '6', style: '4' }, { noart: true }));
  await page.evaluate(() => { const s = window.__stage; s.setBaseColor('#d93a2f'); s.setCameraState({ azimuth: 60, elevation: 30 }); s.renderNow(); });
  const bc = await page.evaluate(() => window.__scan({ red: [352, 14] }));
  check('base color paints the unprinted throw parts', bc.red.n > 3000, JSON.stringify(bc));
  await page.evaluate(() => window.__apply('yard', { pack: '5', print: '1' }));
  await page.evaluate(() => { const s = window.__stage; s.setBaseColor('#2563eb'); s.setCameraState({ azimuth: 200, elevation: 10 }); s.renderNow(); });
  const yb = await page.evaluate(() => window.__scan({ blue: [208, 232] }));
  check('base color paints the back of a one sided yard sign', yb.blue.n > 3000, JSON.stringify(yb));
  await page.evaluate(() => { window.__stage.setBaseColor('#f2efe6'); });
  // sides that show the same canvas share one texture, and a burst of updates is one upload
  await page.evaluate(() => { window.__apply('canopy', { package: 'valance' }, { noart: true }); for (let i = 0; i < 4; i++) window.__stage.setSideTexture(i, null); window.__stage.renderNow(); });
  const t0n = (await state(page)).info.textures;
  await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 600; c.height = 424;
    const g = c.getContext('2d');
    g.fillStyle = '#d93a2f';
    g.fillRect(0, 0, 600, 424);
    window.__same = c;
    for (let i = 0; i < 4; i++) window.__stage.setSideTexture(i, c);
    window.__stage.renderNow();
  });
  const sameN = (await state(page)).info.textures;
  await page.evaluate(() => {
    for (let i = 0; i < 4; i++) {
      const c = document.createElement('canvas');
      c.width = 600; c.height = 424;
      const g = c.getContext('2d');
      g.fillStyle = ['#d93a2f', '#2563eb', '#16a34a', '#e8a317'][i];
      g.fillRect(0, 0, 600, 424);
      window.__stage.setSideTexture(i, c);
    }
    window.__stage.renderNow();
  });
  const diffN = (await state(page)).info.textures;
  check('the same canvas on four sides uses one texture', sameN === t0n + 1 && diffN === t0n + 4, `${t0n} ${sameN} ${diffN}`);
  await page.evaluate(() => { for (let i = 0; i < 4; i++) window.__stage.setSideTexture(i, window.__same); window.__stage.renderNow(); });
  check('replacing four textures with one releases the other three', (await state(page)).info.textures === t0n + 1, String((await state(page)).info.textures));
  await page.evaluate(() => {
    const c = window.__same;
    c.width = 900;
    c.height = 636;
    const g = c.getContext('2d');
    g.fillStyle = '#2563eb';
    g.fillRect(0, 0, 900, 636);
    for (let i = 0; i < 4; i++) window.__stage.setSideTexture(i, c);
    window.__stage.renderNow();
  });
  const resized = await state(page);
  check('a canvas that changed size gets a fresh texture on every side', resized.textures.every((t) => t && t[0] === 900 && t[1] === 636) && resized.info.textures === t0n + 1, JSON.stringify(resized.textures));
  // a product that prints fewer sides gives the unused textures back
  const pruned = await page.evaluate(() => {
    const s = window.__stage;
    const mk = () => { const c = document.createElement('canvas'); c.width = 300; c.height = 200; return c; };
    s.setProduct('canopy', { package: 'valance' });
    for (let i = 0; i < 4; i++) s.setSideTexture(i, mk());
    const canopy = s.getState().textures.map((t) => !!t);
    s.setProduct('feather', { height: '10.5', base: 'spike' });
    const feather = s.getState().textures.map((t) => !!t);
    s.setProduct('yard', { pack: '5', print: '2' });
    s.setSideTexture(1, mk());
    const two = s.getState().textures.map((t) => !!t);
    s.setProduct('yard', { pack: '5', print: '1' });
    const one = s.getState().textures.map((t) => !!t);
    return { canopy, feather, two, one };
  });
  check('product switch keeps textures for sides the product prints and drops the rest', JSON.stringify(pruned.canopy) === '[true,true,true,true]' && JSON.stringify(pruned.feather) === '[true,false,false,false]' && pruned.two[1] === true && pruned.one[1] === false, JSON.stringify(pruned));
  // setScene with the scene that is already showing does nothing
  const rebuilt = await page.evaluate(() => {
    const s = window.__stage;
    s.setScene('yard');
    const root = s._key().parent;
    const before = root.children.slice();
    s.setScene('yard');
    const same = root.children.length === before.length && root.children.every((c, i) => c === before[i]);
    s.setScene('studio');
    return same;
  });
  check('setScene with the current scene does not rebuild it', rebuilt === true);
  // label
  await page.evaluate(() => window.__stage.setLabel('Preview of your sign'));
  const lab = await page.evaluate(() => { const c = window.__stage.canvas; return [c.getAttribute('role'), c.getAttribute('aria-label'), c.tabIndex, getComputedStyle(c).touchAction]; });
  check('canvas has role img, label, tabindex and touch-action none', lab[0] === 'img' && lab[1] === 'Preview of your sign' && lab[2] === 0 && lab[3] === 'none', JSON.stringify(lab));
  // banner mount option
  await page.evaluate(() => window.__apply('banner', { size: '3x6' }));
  const mountA = await state(page);
  await page.evaluate(() => { window.__stage.setOptions({ mount: 'wall', bogus: 1 }); window.__stage.renderNow(); });
  const mountB = await state(page);
  check('setOptions mount switches the banner mount and ignores unknown keys', mountA.mount === 'fence' && mountB.mount === 'wall', `${mountA.mount} ${mountB.mount}`);
  // rebuilding must not leak
  await page.evaluate(() => window.__stage.setOptions({ mount: 'fence' }));
  await page.evaluate(() => { window.__apply('canopy', { package: 'valance' }); window.__stage.renderNow(); });
  const base = await state(page);
  for (let i = 0; i < 6; i++) {
    await page.evaluate((i) => {
      window.__apply(['feather', 'throw', 'banner', 'yard', 'canopy'][i % 5], i % 5 === 0 ? { height: '14', base: 'cross' } : i % 5 === 1 ? { length: '8', style: '3' } : i % 5 === 3 ? { pack: '25', print: '2' } : i % 5 === 4 ? { package: 'valance' } : {});
      window.__apply('canopy', { package: 'valance' });
      window.__stage.renderNow();
    }, i);
  }
  const end = await state(page);
  check('switching products does not leak geometries', end.info.geometries <= base.info.geometries + 1, `${base.info.geometries} -> ${end.info.geometries}`);
  check('switching products does not leak textures', end.info.textures <= base.info.textures + 1, `${base.info.textures} -> ${end.info.textures}`);
  // scene switching must not leak either
  const sceneBase = (await page.evaluate(() => { const s = window.__stage; s.setScene('studio'); s.renderNow(); return s.getState().info; }));
  for (let i = 0; i < 4; i++) await page.evaluate((i) => { const s = window.__stage; s.setScene(['yard', 'storefront', 'studio'][i % 3]); s.renderNow(); }, i);
  const sceneEnd = await page.evaluate(() => { const s = window.__stage; s.setScene('studio'); s.renderNow(); return s.getState().info; });
  check('switching scenes does not leak', sceneEnd.geometries <= sceneBase.geometries + 1 && sceneEnd.textures <= sceneBase.textures + 1, `${JSON.stringify(sceneBase)} -> ${JSON.stringify(sceneEnd)}`);
  await context.close();
}
}

// ---------------------------------------------------------------- resize and visibility
if (want('resize')) {
{
  const { page, context } = await open(1200, 800, 'product=feather&choices=height:18,base:spike&reduced=1');
  const fit = async () => page.evaluate(() => {
    const s = window.__stage;
    return { top: s._project([0, 216, 0]), base: s._project([0, 0, 0]), h: window.innerHeight, d: s.getCameraState().distance };
  });
  const wide = await fit();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const narrow = await fit();
  check('resizing to a phone keeps the 18 ft flag in view', narrow.top.y > 0 && narrow.base.y < narrow.h, JSON.stringify(narrow));
  check('the canvas follows the container size', await page.evaluate(() => { const c = window.__stage.canvas; return c.width === 390 && c.height === 844; }));
  await page.evaluate(() => window.__stage.setInsets({ bottom: 140 }));
  await page.waitForTimeout(200);
  const covered = await fit();
  check('insets keep the base of a tall flag above the covered strip', covered.base.y < covered.h - 140 && covered.top.y > 0, JSON.stringify(covered));
  await shot(page, 'phone-feather-18ft-insets');
  await page.evaluate(() => { window.__bar = 100; window.__stage.setInsets(() => ({ top: 20, bottom: window.__bar })); });
  const fnA = await fit();
  await page.evaluate(() => { window.__bar = 260; window.__stage.resize(); });
  const fnB = await fit();
  check('insets can be a function that resize() reads again', fnA.base.y < fnA.h - 100 && fnB.base.y < fnB.h - 260 && fnB.base.y < fnA.base.y - 50, JSON.stringify([fnA.base, fnB.base]));
  await page.evaluate(() => window.__stage.setInsets({}));
  await page.waitForTimeout(200);
  const free = await fit();
  check('clearing the insets restores the framing', Math.abs(free.base.y - narrow.base.y) < 3 && Math.abs(free.top.y - narrow.top.y) < 3, JSON.stringify([narrow, free]));
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.waitForTimeout(400);
  const back = await fit();
  check('resizing back restores the framing', Math.abs(back.d - wide.d) < wide.d * 0.02, `${wide.d} -> ${back.d}`);
  await page.evaluate(() => { window.__stage.setCameraState({ distance: 200 }); });
  const zoomed = (await fit()).d;
  await page.setViewportSize({ width: 800, height: 800 });
  await page.waitForTimeout(400);
  const keep = (await fit()).d;
  check('a zoomed in camera keeps its zoom relative to the fit when the container resizes', keep < wide.d * 0.9, `${zoomed} -> ${keep}`);
  await context.close();
}
{
  const { page, context } = await open(900, 700, 'product=feather&choices=height:10.5,base:spike');
  const frames = () => page.evaluate(() => window.__stage.getState().info.frames);
  const f0 = await frames();
  await page.waitForTimeout(600);
  const f1 = await frames();
  check('an animated flag keeps drawing while visible', f1 - f0 >= 2, `${f0} -> ${f1}`);
  await page.evaluate(() => { document.getElementById('stage').style.transform = 'translateY(-300vh)'; });
  await page.waitForTimeout(500);
  const f2 = await frames();
  await page.waitForTimeout(600);
  const f3 = await frames();
  check('drawing pauses while the container is off screen', f3 === f2, `${f2} -> ${f3}`);
  await page.evaluate(() => { document.getElementById('stage').style.transform = ''; });
  await page.waitForTimeout(700);
  const f4 = await frames();
  check('drawing resumes when the container comes back', f4 - f3 >= 2, `${f3} -> ${f4}`);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(500);
  const f5 = await frames();
  await page.waitForTimeout(600);
  const f6 = await frames();
  check('drawing pauses while the tab is hidden', f6 === f5, `${f5} -> ${f6}`);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(700);
  check('drawing resumes when the tab is shown', (await frames()) - f6 >= 2);
  await context.close();
}
}

{
  const { page, context } = await open(700, 500, 'product=canopy&reduced=1', { context: { deviceScaleFactor: 3 } });
  if (want('resize')) {
    const dims = await page.evaluate(() => { const c = window.__stage.canvas; return [c.width, c.height, c.clientWidth, c.clientHeight]; });
    check('pixel ratio is capped at 2', dims[0] === 1400 && dims[1] === 1000 && dims[2] === 700 && dims[3] === 500, JSON.stringify(dims));
    const p = await page.evaluate(() => window.__stage._project([0, 100, 39.6]));
    const hit = await page.evaluate(([x, y]) => window.__stage.pick(x, y), [p.x, p.y]);
    check('picking uses css pixels at a high pixel ratio', hit && hit.sideIndex === 0, JSON.stringify([p, hit]));
    const own = await page.evaluate(() => { const c = window.__stage.canvas; const s = getComputedStyle(c); return [s.position, s.touchAction, c.parentElement.style.position || getComputedStyle(c.parentElement).position]; });
    check('canvas is absolutely positioned inside a positioned container', own[0] === 'absolute' && own[1] === 'none' && own[2] !== 'static', JSON.stringify(own));
  }
  await context.close();
}

// ---------------------------------------------------------------- motion
if (want('motion')) {
{
  const a = await open(900, 700, 'product=feather&choices=height:14,base:spike');
  const first = await a.page.screenshot();
  await a.page.waitForTimeout(500);
  const second = await a.page.screenshot();
  check('flag sways while visible', !first.equals(second));
  await a.context.close();
  const r = await open(900, 700, 'product=feather&choices=height:14,base:spike&reduced=1');
  const f1 = await r.page.screenshot();
  await r.page.waitForTimeout(500);
  const f2 = await r.page.screenshot();
  check('reduced motion: flag is still', f1.equals(f2));
  await r.page.evaluate(() => window.__stage.setCameraPreset('side', { animate: true }));
  const sp = await state(r.page);
  check('reduced motion: presets jump without a tween', Math.abs(sp.camera.azimuth - 55) < 0.01, String(sp.camera.azimuth));
  await r.page.evaluate(() => window.__stage.focusSide(1));
  await r.context.close();
  const c = await open(900, 700, 'product=canopy');
  const c1 = await c.page.screenshot();
  await c.page.waitForTimeout(400);
  const c2 = await c.page.screenshot();
  check('render on demand: a still canopy does not redraw', c1.equals(c2));
  await c.context.close();
}
}

// ---------------------------------------------------------------- plates
if (want('plates')) {
{
  const gen = await open(400, 300, 'product=banner');
  for (const size of [1024, 2048]) {
    const b64 = await gen.page.evaluate(async (size) => {
      const w = size;
      const h = Math.round(size * 0.66);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = '#ff2a6a';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#8a8f98';
      g.fillRect(0, h * 0.6, w, h * 0.4);
      const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.8));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (const x of buf) s += String.fromCharCode(x);
      return btoa(s);
    }, size);
    writeFileSync(join(out, 'plates', `e2e-plate-${size}.webp`), Buffer.from(b64, 'base64'));
  }
  await gen.context.close();
  const { page, context } = await open(1000, 650, 'product=canopy&scene=yard&plateFor=yard&plateName=e2e-plate');
  await page.waitForFunction(() => window.__stage.getState().plate === true, null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => window.__stage.renderNow());
  const ps = await state(page);
  check('plate scene loads', ps.plate === true);
  const sky = await page.evaluate(() => window.__px(40, 40));
  const floor = await page.evaluate(() => window.__px(40, 620));
  check('plate fills the background (cover fit)', sky[0] > 200 && sky[1] < 90 && Math.abs(floor[0] - floor[2]) < 25 && floor[0] > 100 && floor[0] < 175, JSON.stringify([sky, floor]));
  await shot(page, 'plate-canopy-az0');
  const sky0 = sky;
  await page.evaluate(() => { window.__stage.setCameraState({ azimuth: 90, elevation: 12 }); window.__stage.renderNow(); });
  const sky1 = await page.evaluate(() => window.__px(40, 40));
  check('turntable keeps the photo fixed while the model turns', JSON.stringify(sky0) === JSON.stringify(sky1), JSON.stringify([sky0, sky1]));
  const side = await page.evaluate(() => window.__scan({ s1: [208, 232], s0: [352, 14] }));
  check('turntable shows side 1 at azimuth 90', side.s1.n > side.s0.n * 2, JSON.stringify(side));
  await shot(page, 'plate-canopy-az90');
  await page.evaluate(() => { window.__stage.setCameraState({ azimuth: 0, elevation: 60 }); });
  const el = (await state(page)).camera.elevation;
  check('plate mode limits the camera elevation', el <= 30.01, String(el));
  await page.evaluate(() => window.__stage.setScene('studio'));
  await page.evaluate(() => window.__stage.renderNow());
  check('leaving a plate scene restores the procedural scene', (await state(page)).plate === false);
  await context.close();
}
{
  // a plate that fails to load falls back to the procedural scene without throwing
  const { page, context } = await open(900, 600, 'product=yard&scene=yard&plateFor=yard&plateName=missing', {
    allow: /missing-/,
  });
  await page.waitForTimeout(800);
  const s = await state(page);
  check('failed plate falls back silently', s.plate === false && s.scene === 'yard');
  await page.evaluate(() => window.__stage.renderNow());
  await shot(page, 'plate-fallback-yard');
  await context.close();
}
}

// ---------------------------------------------------------------- context loss
if (want('context')) {
{
  const { page, context } = await open(900, 600, 'product=canopy');
  await page.evaluate(() => {
    const gl = window.__stage.canvas.getContext('webgl2') || window.__stage.canvas.getContext('webgl');
    window.__ext = gl.getExtension('WEBGL_lose_context');
    window.__ext.loseContext();
  });
  await page.waitForFunction(() => window.__lost >= 1, null, { timeout: 5000 }).catch(() => {});
  check('context loss calls onContextLost', (await page.evaluate(() => window.__lost)) >= 1);
  await page.evaluate(() => window.__ext.restoreContext());
  await page.waitForTimeout(600);
  await page.evaluate(() => { window.__stage.requestRender(); window.__stage.renderNow(); });
  const px = await page.evaluate(() => window.__scan({ s0: [352, 14] }));
  check('rendering resumes after the context is restored', px.s0.n > 500, JSON.stringify(px));
  await context.close();
}

{
  // the usual reaction to a lost context is to dispose the stage: that must be quiet too
  const { page, context } = await open(900, 600, 'product=feather');
  await page.evaluate(() => {
    const gl = window.__stage.canvas.getContext('webgl2') || window.__stage.canvas.getContext('webgl');
    gl.getExtension('WEBGL_lose_context').loseContext();
  });
  await page.waitForFunction(() => window.__lost >= 1, null, { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => window.__stage.dispose());
  await page.waitForTimeout(300);
  check('disposing a stage whose context was lost leaves no canvas', (await page.evaluate(() => document.querySelectorAll('canvas').length)) === 0);
  await context.close();
}
}

// ---------------------------------------------------------------- dispose and failure modes
if (want('failure')) {
{
  const { page, context } = await open(900, 600, 'product=canopy');
  const r = await page.evaluate(() => {
    const before = document.querySelectorAll('canvas').length;
    const s = window.__stage;
    s.dispose();
    s.dispose();
    s.setProduct('canopy', { package: 'valance' });
    s.requestRender();
    return { before, after: document.querySelectorAll('canvas').length, pick: s.pick(10, 10) };
  });
  check('dispose removes the canvas and is idempotent', r.before === 1 && r.after === 0 && r.pick === null, JSON.stringify(r));
  await page.waitForTimeout(200);
  await context.close();
}
{
  // a second stage on the same page after dispose still works (no stale global state)
  const { page, context } = await open(900, 600, 'product=canopy');
  const ok = await page.evaluate(async () => {
    const { createStage3D } = await import('/assets/design/three/stage3d.js');
    window.__stage.dispose();
    const h = window.__harness;
    const el = document.getElementById('stage');
    const s = await createStage3D(el, { specs: h.specs, catalog: h.catalog, maxTexture: 1024, reducedMotion: true, label: 'again' });
    s.setProduct('yard', { pack: '5', print: '1' });
    s.renderNow();
    const n = document.querySelectorAll('canvas').length;
    s.dispose();
    return [n, document.querySelectorAll('canvas').length];
  });
  check('a new stage works after dispose and leaves no canvas behind', ok[0] === 1 && ok[1] === 0, JSON.stringify(ok));
  await context.close();
}
{
  // WebGL turned off by the browser
  const b2 = await chromium.launch({ args: ['--disable-gpu', '--disable-webgl', '--disable-3d-apis', '--disable-software-rasterizer'] });
  const ctx = await b2.newContext({ viewport: { width: 800, height: 500 } });
  const page = await ctx.newPage();
  const msgs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') msgs.push(m.text()); });
  await page.goto(`${base}/.design-dev/harness/3d.html?product=canopy`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
  const f = await page.evaluate(() => window.__failure);
  check('WebGL disabled browser: createStage3D rejects with reason webgl', f && f.reason === 'webgl', JSON.stringify(f));
  const sup = await page.evaluate(async () => {
    const m = await import('/assets/design/three/support.js');
    return [m.webglAvailable(), m.lowMemoryDevice(), document.querySelectorAll('canvas').length];
  });
  check('WebGL disabled browser: webglAvailable is false and no canvas is left', sup[0] === false && sup[2] === 0, JSON.stringify(sup));
  check('WebGL disabled browser: no console errors from the stage', msgs.filter((m) => !KNOWN.test(m) && !/WebGL|GPU|context/i.test(m)).length === 0, msgs.join(' | '));
  await ctx.close();
  await b2.close();
}
{
  // getContext stubbed to fail
  const { page, context } = await open(800, 500, 'product=canopy', { init: () => { HTMLCanvasElement.prototype.getContext = function () { return null; }; } });
  const f = await page.evaluate(() => window.__failure);
  check('stubbed getContext: reason is webgl', f && f.reason === 'webgl', JSON.stringify(f));
  await context.close();
}
{
  const { page, context } = await open(800, 500, 'product=canopy&noart=1');
  const r = await page.evaluate(() => {
    const s = window.__stage;
    let msg = null;
    try { s.setProduct('nope', {}); } catch (e) { msg = e.message; }
    s.setProduct('yard', { pack: '5', print: '1' });
    s.renderNow();
    return { msg, product: s.getState().product };
  });
  check('unknown product throws a clear error without breaking the stage', /Unknown product/.test(r.msg || '') && r.product === 'yard', JSON.stringify(r));
  await context.close();
}
{
  const { page, context } = await open(800, 500, 'product=canopy', { context: {} });
  const low = await page.evaluate(async () => {
    const m = await import('/assets/design/three/support.js?probe=1');
    Object.defineProperty(navigator, 'deviceMemory', { value: 2, configurable: true });
    const a = m.lowMemoryDevice();
    Object.defineProperty(navigator, 'deviceMemory', { value: 8, configurable: true });
    return [a, m.lowMemoryDevice(), m.webglAvailable()];
  });
  check('support.js: lowMemoryDevice and webglAvailable', low[0] === true && low[1] === false && low[2] === true, JSON.stringify(low));
  await context.close();
}
}

// ---------------------------------------------------------------- network
const missing = seen.filter((r) => r.status === 404 && !r.path.includes('/plates/missing-'));
check('no request for a missing file', missing.length === 0, missing.map((m) => m.path).join(', '));
check('no 404 for design scene plates in procedural scenes', !seen.some((r) => r.path.includes('/assets/design/scenes/')));
check('no console errors or warnings', problems.length === 0, problems.slice(0, 6).join(' | '));

await browser.close();
server.close();

writeFileSync(join(out, 'summary.json'), JSON.stringify({ stats, checks: results.length, failed: results.filter((r) => !r.ok).map((r) => r.name) }, null, 1));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (problems.length) console.log('console problems:\n  ' + problems.slice(0, 20).join('\n  '));
for (const k of Object.keys(stats)) if (k.endsWith('/desktop')) console.log(k.padEnd(34), 'calls', String(stats[k].calls).padStart(3), 'tris', stats[k].triangles);
process.exit(failed.length ? 1 : 0);
