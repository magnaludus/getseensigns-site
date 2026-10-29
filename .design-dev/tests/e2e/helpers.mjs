// Shared helpers for the browser tests: a static server for the built site, a Chromium launcher,
// touch gestures through the DevTools protocol, and a tiny PNG maker for logo uploads.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { get as httpGet } from 'node:http';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

export const root = fileURLToPath(new URL('../../../', import.meta.url));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

export async function startServer() {
  const port = await freePort();
  const proc = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  // node:http, not fetch: some Node 22 builds trip an undici assertion on python's HTTP/1.0 replies
  const up = () => new Promise((resolve) => {
    const req = httpGet(base + '/design/', (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
  });
  for (let i = 0; i < 50; i++) {
    if (await up()) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return { base, stop: () => proc.kill() };
}

export async function launch(opts = {}) {
  const args = ['--enable-unsafe-swiftshader', ...(opts.args || [])];
  return chromium.launch({ args });
}

export async function newPage(browser, kind = 'desktop', extra = {}) {
  let context;
  // 'phone' is the 390x844 touch viewport the acceptance checks name; 'pixel7' and 'iphone' are Playwright's
  // device profiles (the iPhone one is Chromium emulating its screen and user agent, not Safari).
  if (kind === 'phone') context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices['Pixel 7'].userAgent, ...extra });
  else if (kind === 'pixel7') context = await browser.newContext({ ...devices['Pixel 7'], ...extra });
  else if (kind === 'iphone') context = await browser.newContext({ ...devices['iPhone 14'], ...extra });
  else context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...extra });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => problems.push('requestfailed: ' + r.url()));
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().endsWith('/api/design-proof')) problems.push(`http ${r.status()}: ${r.url()}`);
  });
  return { page, context, problems };
}

export async function openDesigner(page, base, path) {
  await page.goto(base + path);
  await page.waitForFunction(() => window.GSSDesigner && window.GSSDesigner.ready, null, { timeout: 20000 });
  await page.waitForTimeout(250);
}

// ---- touch gestures (CDP) ----
export async function touchSession(page) {
  const cdp = await page.context().newCDPSession(page);
  const pt = (id, x, y) => ({ x, y, id, radiusX: 2, radiusY: 2, force: 1 });
  return {
    async drag(from, to, steps = 8) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(0, from.x, from.y)] });
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt(0, from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k)] });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    },
    async pinch(center, startDist, endDist, twistDeg = 0, steps = 8) {
      const at = (d, a) => [pt(0, center.x - (d / 2) * Math.cos(a), center.y - (d / 2) * Math.sin(a)), pt(1, center.x + (d / 2) * Math.cos(a), center.y + (d / 2) * Math.sin(a))];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(startDist, 0) });
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(startDist + (endDist - startDist) * k, ((twistDeg * k) * Math.PI) / 180) });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    },
  };
}

// Where a document point (inches) is on screen.
export function toClient(page, x, y) {
  return page.evaluate(([x, y]) => {
    const m = window.GSSDesigner.stage.svg.getScreenCTM();
    return { x: x * m.a + m.e, y: y * m.d + m.f };
  }, [x, y]);
}

export function sideState(page) {
  return page.evaluate(() => {
    const { store } = window.GSSDesigner;
    const side = store.side();
    return {
      selection: store.state.selection.slice(),
      history: store.history.size,
      editing: store.state.editing,
      fields: { ...store.state.doc.project.fields },
      templateId: store.piece().templateId,
      els: side.elements.map((e) => ({ id: e.id, type: e.type, name: e.name, x: e.x, y: e.y, w: e.w, h: e.h, size: e.size, rot: e.rot || 0, text: e.text, logoId: e.logoId })),
    };
  });
}

// ---- PNG maker: a solid or striped RGBA image, for logo uploads ----
function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
export function makePng(w, h, color = [200, 40, 40, 255], accent = [255, 209, 0, 255]) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const stripe = Math.floor(x / (w / 4)) % 2 === 1;
      const c = stripe ? accent : color;
      raw.set(c, y * (w * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
