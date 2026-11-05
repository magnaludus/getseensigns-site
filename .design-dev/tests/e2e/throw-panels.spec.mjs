// Table throw panels: art on the top, both ends and the back (not just the front), edited upright; the whole flat with
// its panel names and note; the same art on every panel in 3D, readable from outside; and every panel in the proof request.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { startServer, launch, newPage, openDesigner, root } from './helpers.mjs';

const specs = JSON.parse(readFileSync(new URL('assets/design/print-specs.json', 'file://' + root), 'utf8'));
const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core/axe.min.js');
const NOTE = 'Side and back art is turned on the flat so it reads right side up when the cover hangs.';

async function openReview(page) {
  await page.evaluate(() => { window.GSSDesigner.noNavigate = true; });
  await page.getByRole('button', { name: 'Get my free proof' }).first().click();
  await page.getByRole('heading', { name: 'Check your design' }).waitFor();
}

// width and height of the PNG in a multipart part that starts at `at`
function pngSize(body, at) {
  const start = body.indexOf('\r\n\r\n', at) + 4;
  assert.equal(body.slice(start + 1, start + 4), 'PNG', 'a PNG follows the headers');
  const u32 = (o) => ((body.charCodeAt(start + o) << 24) | (body.charCodeAt(start + o + 1) << 16) | (body.charCodeAt(start + o + 2) << 8) | body.charCodeAt(start + o + 3)) >>> 0;
  return { w: u32(16), h: u32(20) };
}

test('edit the back and both ends, and every panel reaches the proof request with the flat and a picture of each', async () => {
  const server = await startServer();
  const browser = await launch();
  try {
    const { page, problems } = await newPage(browser, 'desktop');
    let posted = null;
    await page.route('**/api/design-proof', async (route) => {
      posted = route.request().postDataBuffer().toString('latin1');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ref: 'GS-THROW001', emailed: true, stored: true }) });
    });
    await openDesigner(page, server.base, '/design/table-throw/?length=6&style=4');

    // the side switcher has all five panels, and the tools call them panels
    assert.equal(await page.locator('.dz-sidelabel').textContent(), 'Front panel (1 of 5)');
    assert.equal(await page.locator('#dz-tab-sides span').textContent(), 'Panels');
    await page.locator('#dz-tab-sides').click();
    assert.deepEqual(await page.locator('.dz-sidestrip .dz-side').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))), ['Front panel', 'Top panel', 'Left end panel', 'Right end panel', 'Back panel']);
    assert.equal(await page.getByRole('button', { name: 'Same on all 4 sides' }).count(), 0, 'no "same on every side" for a throw');

    // one click fills the top with a logo frame and the back and both ends with the business name
    await page.getByRole('button', { name: 'Logo on top' }).click();
    await page.getByRole('button', { name: 'Business name on back and ends' }).click();
    const sides = () => page.evaluate(() => window.GSSDesigner.store.piece().sides.map((s) => ({ name: s.name, els: s.elements.map((e) => ({ type: e.type, text: e.text, bind: e.bind, logoId: e.logoId })) })));
    let now = await sides();
    assert.equal(now[1].els.filter((e) => e.type === 'image').length, 1, 'the top has a logo frame');
    for (const si of [2, 3, 4]) assert.equal(now[si].els.filter((e) => e.type === 'text').length, 1, now[si].name);

    // choosing a panel in the Panels tab (the tools open the Text tab when a text is picked, so go back to Panels first)
    const goTo = async (panel) => {
      await page.locator('#dz-tab-sides').click();
      await page.getByRole('button', { name: panel, exact: true }).click();
    };
    // type new words onto the back and the left end, on the canvas, the way a customer does
    for (const [panel, words] of [['Back panel', 'SAMPLE BACK TEXT'], ['Left end panel', 'SAMPLE LEFT END']]) {
      await goTo(panel);
      const id = await page.evaluate(() => window.GSSDesigner.store.side().elements.find((e) => e.type === 'text').id);
      await page.evaluate((id) => window.GSSDesigner.stage.startEdit(id), id);
      await page.keyboard.press('Control+A');
      await page.keyboard.type(words);
      await page.locator('.dz-svg').click({ position: { x: 4, y: 4 } });
      await page.waitForTimeout(150);
      const text = await page.evaluate(() => window.GSSDesigner.store.side().elements.find((e) => e.type === 'text').text);
      assert.equal(text, words, panel);
    }
    // and the right end through the Text tab's own field for the business name
    await goTo('Right end panel');
    assert.equal(await page.locator('.dz-sidelabel').textContent(), 'Right end panel (4 of 5)');

    // the Flat view shows the whole flat: every panel in the cut shape, with names, safe areas and the note
    await goTo('Front panel');
    const map = page.locator('.dz-layout');
    await map.waitFor();
    assert.equal(await map.locator('[data-panel]').count(), 5);
    assert.equal(await map.locator('.flat-safe').count(), 5, 'a safe area on every panel');
    assert.equal(await map.locator('.flat-cut').count(), 1);
    const labels = (await map.locator('svg text').allTextContents()).join(' ');
    for (const word of ['FRONT', 'TOP', 'LEFT', 'RIGHT', 'END', 'BACK', 'CORNER', 'DRAPE']) assert.ok(labels.includes(word), `${word} is on the map: ${labels}`);
    assert.equal(await map.locator('.dz-layout-note').textContent(), NOTE);
    // the art is turned on the flat: the left end by 90 degrees, the right end by -90, the back by 180
    assert.equal(await map.locator('[data-panel="left"]').getAttribute('data-turn'), '90');
    assert.equal(await map.locator('[data-panel="right"]').getAttribute('data-turn'), '-90');
    assert.equal(await map.locator('[data-panel="back"]').getAttribute('data-turn'), '180');
    assert.equal(await map.locator('[data-panel="front"]').getAttribute('data-turn'), null);
    // tapping a panel on the map goes to it
    await map.locator('[data-panel="left"]').click();
    assert.equal(await page.locator('.dz-sidelabel').textContent(), 'Left end panel (3 of 5)');
    assert.equal(await map.locator('.flat-sel').count(), 2, 'the panel being edited is outlined');
    // the editing canvas is the upright panel: the left end is wider than tall (28.5 by 27.1 in), not the turned box on the flat
    const art = await page.evaluate(() => window.GSSDesigner.stage.svg.getAttribute('viewBox').split(' ').map(Number));
    assert.ok(art[2] > art[3], `upright: ${art}`);

    // send it
    await openReview(page);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('dialog input[autocomplete="name"]').fill('Test Customer');
    await page.locator('dialog input[type="email"]').fill('customer@example.com');
    await page.getByRole('button', { name: 'Send my design' }).click();
    await page.getByRole('heading', { name: /Your proof is on the way/ }).waitFor({ timeout: 15000 });
    assert.ok(posted, 'the request was posted');

    // the design carries every panel's art
    const design = JSON.parse(posted.split('name="design"')[1].split('\r\n\r\n')[1].split('\r\n--')[0]);
    const piece = design.project.pieces[0];
    assert.deepEqual(piece.sides.map((s) => s.name), ['Front', 'Top', 'Left end', 'Right end', 'Back']);
    assert.equal(piece.sidesMode, 'each');
    const words = (si) => piece.sides[si].elements.filter((e) => e.type === 'text').map((e) => e.text);
    assert.deepEqual(words(4), ['SAMPLE BACK TEXT'], 'the back');
    assert.deepEqual(words(2), ['SAMPLE LEFT END'], 'the left end');
    assert.deepEqual(words(3), [design.project.fields.name], 'the right end follows the business name');
    assert.equal(piece.sides[1].elements.filter((e) => e.type === 'image').length, 1, 'the top logo frame');

    // and the pictures: the whole flat first, then each panel as it reads on the table
    const names = [...posted.matchAll(/name="preview-(\d+)"; filename="([^"]+)"/g)].map((m) => [Number(m[1]), m[2]]);
    assert.deepEqual(names, [
      [0, 'preview-1-table-throw-flat.png'], [1, 'preview-1-table-throw-front.png'], [2, 'preview-1-table-throw-top.png'],
      [3, 'preview-1-table-throw-left-end.png'], [4, 'preview-1-table-throw-right-end.png'], [5, 'preview-1-table-throw-back.png'],
    ]);
    const sizeOf = (n) => pngSize(posted, posted.indexOf(`name="preview-${n}"`));
    const flat = sizeOf(0);
    const v = specs.products.throw.variants['6-4'];
    const b = { w: 126.49, h: 83.97 };
    assert.ok(Math.abs(flat.w / flat.h - (b.w + 3) / (b.h + 3)) < 0.01, `the flat picture has the cut shape's proportions: ${flat.w} x ${flat.h}`);
    assert.ok(Math.max(flat.w, flat.h) >= 1700);
    // each panel picture is the panel upright, with the panel's own proportions (the ends are not the turned boxes of the flat)
    const panels = [['front', 0], ['top', 1], ['left', 2], ['right', 3]];
    for (const [id, n] of panels.map(([id, i]) => [id, i + 1])) {
      const box = v.panels_in_template[id];
      const size = id === 'left' || id === 'right' ? { w: box.h, h: box.w } : { w: box.w, h: box.h };
      const got = sizeOf(n);
      assert.ok(Math.abs(got.w / got.h - size.w / size.h) < 0.01, `${id}: ${got.w} x ${got.h} vs ${size.w} x ${size.h}`);
    }
    const back = sizeOf(5);
    assert.ok(Math.abs(back.w / back.h - v.panels_in_template.top.w / v.panels_in_template.back.h) < 0.01, 'the back is the part in line with the top, upright');
    assert.deepEqual(problems.filter((p) => !/swiftshader|GPU stall|GL Driver/i.test(p)), []);
    await page.context().close();
  } finally {
    await browser.close();
    server.stop();
  }
});

// A red block on the left and a blue one on the right of an upright panel. Seen from outside, each panel must put red
// to the viewer's left of blue: that is what "reads right side up and not mirrored" means for the front, the top,
// both ends and the back. (The top is marked on its own, so its markers do not show on the sides from above.)
test('3D: every panel shows on its own face and reads left to right from outside', async () => {
  const server = await startServer();
  const browser = await launch();
  try {
    const { page, problems } = await newPage(browser, 'desktop', { reducedMotion: 'reduce' });
    await openDesigner(page, server.base, '/design/table-throw/?length=6&style=4');
    const mark = (marked) => page.evaluate(async (marked) => {
      const { addElement, setBackground, removeElements, getSide } = await import('/assets/design/model/document.js');
      const { specForSide } = await import('/assets/design/model/specs.js');
      const { store, env } = window.GSSDesigner;
      let doc = store.state.doc;
      const piece = doc.project.pieces[0];
      piece.sides.forEach((_, si) => {
        const spec = specForSide(env.specs, 'throw', piece.choices, si);
        doc = setBackground(doc, 0, si, { type: 'solid', color: '#DDDDDD' });
        doc = removeElements(doc, 0, si, getSide(doc, 0, si).elements.map((e) => e.id));
        if (!marked.includes(si)) return;
        const w = spec.trim.w * 0.22;
        const h = spec.trim.h - 6;
        doc = addElement(doc, 0, si, { type: 'shape', kind: 'rect', name: 'Left', x: 3, y: 3, w, h, fill: '#E00000', stroke: null, rx: 0 });
        doc = addElement(doc, 0, si, { type: 'shape', kind: 'rect', name: 'Right', x: spec.trim.w - 3 - w, y: 3, w, h, fill: '#0000E0', stroke: null, rx: 0 });
      });
      store.commit(doc);
    }, marked);
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await page.waitForFunction(() => window.GSSDesigner.view3d.stage, null, { timeout: 20000 });
    const look = async (i) => {
      await page.evaluate((i) => window.GSSDesigner.view3d.stage.focusSide(i, { animate: false }), i);
      await page.waitForTimeout(900);
      return page.evaluate(() => {
        const stage = window.GSSDesigner.view3d.stage;
        const c = stage.screenshot();
        const tmp = document.createElement('canvas');
        tmp.width = c.width;
        tmp.height = c.height;
        const g = tmp.getContext('2d', { willReadFrequently: true });
        g.drawImage(c, 0, 0);
        const px = g.getImageData(0, 0, c.width, c.height).data;
        const red = { n: 0, x: 0 };
        const blue = { n: 0, x: 0 };
        for (let y = 0; y < c.height; y++) {
          for (let x = 0; x < c.width; x++) {
            const k = (y * c.width + x) * 4;
            if (px[k] > 150 && px[k + 1] < 70 && px[k + 2] < 70) { red.n++; red.x += x; }
            else if (px[k + 2] > 150 && px[k] < 70 && px[k + 1] < 70) { blue.n++; blue.x += x; }
          }
        }
        return { red: red.n, blue: blue.n, redX: red.n ? red.x / red.n : null, blueX: blue.n ? blue.x / blue.n : null };
      });
    };
    const faces = ['front', 'top', 'left end', 'right end', 'back'];
    const check = async (i) => {
      const s = await look(i);
      assert.ok(s.red > 200 && s.blue > 200, `${faces[i]}: both markers are visible (${s.red} red, ${s.blue} blue pixels)`);
      assert.ok(s.redX < s.blueX - 10, `${faces[i]}: red at ${Math.round(s.redX)} is left of blue at ${Math.round(s.blueX)}, so it is not mirrored`);
    };
    await mark([0, 2, 3, 4]);
    for (const i of [0, 2, 3, 4]) await check(i);
    await page.getByRole('button', { name: 'Flat', exact: true }).click();
    await mark([1]);
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await page.waitForTimeout(400);
    await check(1);
    // a tap on a panel in 3D picks that panel
    for (let i = 0; i < 5; i++) {
      await page.evaluate((i) => window.GSSDesigner.view3d.stage.focusSide(i, { animate: false }), i);
      await page.waitForTimeout(500);
      const picked = await page.evaluate(() => {
        const stage = window.GSSDesigner.view3d.stage;
        const r = stage.canvas.getBoundingClientRect();
        // a few points around the middle of the cloth: the first one that hits a printed panel
        for (const [fx, fy] of [[0.5, 0.5], [0.5, 0.45], [0.45, 0.5], [0.55, 0.5], [0.5, 0.55], [0.4, 0.45]]) {
          const hit = stage.pick(r.left + r.width * fx, r.top + r.height * fy);
          if (hit) return hit.sideIndex;
        }
        return null;
      });
      assert.equal(picked, i, `${faces[i]}: tapping it in 3D picks it`);
    }
    assert.deepEqual(problems.filter((p) => !/swiftshader|GPU stall|GL Driver/i.test(p)), []);
    await page.context().close();
  } finally {
    await browser.close();
    server.stop();
  }
});

test('phone: the whole flat takes the place of the editor, and nothing overflows', async () => {
  const server = await startServer();
  const browser = await launch();
  try {
    const { page, problems } = await newPage(browser, 'phone', { reducedMotion: 'reduce' });
    await openDesigner(page, server.base, '/design/table-throw/?length=8&style=3');
    assert.equal(await page.locator('.dz-sidelabel').textContent(), 'Front panel (1 of 4)', '3-sided: four panels');
    const visible = (sel) => page.locator(sel).evaluate((el) => !!(el.offsetWidth || el.offsetHeight));
    assert.equal(await visible('.dz-stage'), true);
    assert.equal(await visible('.dz-layout'), false, 'the editor has the room');
    await page.getByRole('button', { name: 'Whole flat' }).tap();
    await page.waitForSelector('.dz-flat[data-map="map"] .dz-layout [data-panel]');
    assert.equal(await visible('.dz-layout'), true);
    assert.equal(await visible('.dz-stage'), false);
    assert.equal(await page.locator('.dz-layout [data-panel]').count(), 4);
    assert.ok((await page.locator('.dz-layout').textContent()).includes('BACK STRIP (PLAIN)'), 'the open back strip is named and plain');
    assert.equal(await page.locator('.dz-layout-note').textContent(), NOTE);
    // the whole flat fits the screen
    const fit = await page.evaluate(() => {
      const r = document.querySelector('.dz-layout-svg').getBoundingClientRect();
      return { w: r.width, inside: r.left >= 0 && r.right <= window.innerWidth, overflow: document.documentElement.scrollWidth <= window.innerWidth };
    });
    assert.ok(fit.inside && fit.overflow, JSON.stringify(fit));
    // tap the right end: back to the editor, on that panel
    await page.locator('.dz-layout [data-panel="right"]').tap();
    await page.waitForSelector('.dz-flat[data-map="edit"]');
    assert.equal(await page.locator('.dz-sidelabel').textContent(), 'Right end panel (4 of 4)');
    assert.equal(await visible('.dz-stage'), true);
    assert.equal(await visible('.dz-layout'), false);
    // 3-sided has no back panel, and switching to 4-sided adds it (plain)
    // the first touch on the tools slides the editor up, so do that first and the next tap lands where it aims
    await page.evaluate(() => document.querySelector('.dz-app').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(400);
    await page.locator('#dz-tab-options').tap();
    await page.getByRole('button', { name: '4-sided', exact: true }).tap();
    await page.waitForFunction(() => window.GSSDesigner.store.piece().sides.length === 5);
    assert.equal(await page.locator('.dz-sidelabel').textContent(), 'Right end panel (4 of 5)');
    assert.deepEqual(await page.evaluate(() => window.GSSDesigner.store.piece().sides[4].elements), []);
    assert.deepEqual(problems.filter((p) => !/swiftshader|GPU stall|GL Driver/i.test(p)), []);
    await page.context().close();
  } finally {
    await browser.close();
    server.stop();
  }
});

async function scan(page, label, context) {
  await page.addScriptTag({ path: axePath });
  const result = await page.evaluate(async (ctx) => {
    const res = await window.axe.run(ctx ? document.querySelector(ctx) : document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
    return res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 4).map((n) => n.target.join(' ') + ' :: ' + (n.failureSummary || '').split('\n').slice(1, 3).join(' ')) }));
  }, context || null);
  const bad = result.filter((v) => v.impact === 'serious' || v.impact === 'critical' || v.impact === 'moderate');
  if (bad.length) console.log(`axe ${label}:`, JSON.stringify(bad, null, 1));
  return bad;
}

test('axe: the table throw editor with the flat map, the Panels tab and the review dialog', async () => {
  const server = await startServer();
  const browser = await launch();
  try {
    const { page } = await newPage(browser, 'desktop');
    await openDesigner(page, server.base, '/design/table-throw/?length=6&style=4');
    await page.locator('#dz-tab-sides').click();
    await page.getByRole('button', { name: 'Logo on top' }).click();
    await page.getByRole('button', { name: 'Business name on back and ends' }).click();
    await page.locator('.dz-layout [data-panel]').first().waitFor();
    assert.deepEqual(await scan(page, 'throw editor and flat map', '.dz-app'), []);
    await page.getByRole('button', { name: 'Get my free proof' }).first().click();
    await page.getByRole('heading', { name: 'Check your design' }).waitFor();
    assert.equal(await page.locator('dialog .dz-review-flat').count(), 1, 'the review shows the whole flat');
    assert.equal(await page.locator('dialog .dz-review-fig').count(), 6, 'the flat and five panels');
    assert.deepEqual(await scan(page, 'throw review dialog', 'dialog'), []);
    await page.context().close();
    const phone = await newPage(browser, 'phone');
    await openDesigner(phone.page, server.base, '/design/table-throw/?length=6&style=3');
    await phone.page.getByRole('button', { name: 'Whole flat' }).tap();
    assert.deepEqual(await scan(phone.page, 'throw whole flat on a phone', '.dz-app'), []);
    await phone.context.close();
  } finally {
    await browser.close();
    server.stop();
  }
});
