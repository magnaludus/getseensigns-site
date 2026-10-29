// Acceptance 2: on a 390x844 touch phone a customer can pick a template, edit the headline in place,
// move and resize it, upload a logo, rotate it, undo twice and redo once, switch to 3D, orbit to the
// back of the tent and see that side's art, then send a proof request. No horizontal scroll.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, newPage, openDesigner, touchSession, toClient, sideState, makePng } from './helpers.mjs';

async function noHorizontalScroll(page, label) {
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  assert.ok(sw <= cw, `${label}: horizontal scroll ${sw} > ${cw}`);
}

// Share of the 3D picture that is strongly magenta (side C was painted #FF00FF; lighting softens it).
async function magentaShare(page) {
  return page.evaluate(() => {
    const c = window.GSSDesigner.view3d.stage.screenshot();
    const tmp = document.createElement('canvas');
    tmp.width = c.width;
    tmp.height = c.height;
    const g = tmp.getContext('2d', { willReadFrequently: true });
    g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let hit = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4 * 7) {
      n += 1;
      if (d[i] - d[i + 1] > 60 && d[i + 2] - d[i + 1] > 40) hit += 1;
    }
    return hit / n;
  });
}

test('touch flow on a phone, from template to proof request', async () => {
  const server = await startServer();
  const browser = await launch();
  try {
    const { page, problems } = await newPage(browser, 'phone', { acceptDownloads: true });
    await page.route('**/api/design-proof', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"enabled":false}' }));
    await openDesigner(page, server.base, '/design/canopy-tent/');
    await noHorizontalScroll(page, 'start');
    const touch = await touchSession(page);

    // 1. pick a template
    await page.locator('.dz-tpl').nth(1).tap();
    assert.equal((await sideState(page)).templateId, 'split-field');
    await page.evaluate(() => document.querySelector('.dz-app').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(250);

    // 2. edit the headline in place
    let st = await sideState(page);
    const name = st.els.find((e) => e.name === 'Name');
    const c = await toClient(page, name.x + name.w / 2, name.y + 3);
    await page.touchscreen.tap(c.x, c.y);
    await page.waitForTimeout(120);
    await page.touchscreen.tap(c.x, c.y);
    await page.waitForSelector('.dz-textedit');
    await page.keyboard.press('Control+a');
    await page.keyboard.type('RIVER CITY');
    const box = await page.locator('.dz-stage').boundingBox();
    await page.touchscreen.tap(box.x + 8, box.y + box.height - 8);
    await page.waitForTimeout(250);
    st = await sideState(page);
    assert.equal(st.fields.name, 'RIVER CITY');
    assert.equal(st.editing, null);

    // 3. move it with a finger
    const n2 = st.els.find((e) => e.name === 'Name');
    const c2 = await toClient(page, n2.x + n2.w / 2, n2.y + 3);
    await page.touchscreen.tap(c2.x, c2.y);
    await touch.drag(c2, { x: c2.x + 30, y: c2.y + 18 });
    await page.waitForTimeout(150);
    st = await sideState(page);
    const moved = st.els.find((e) => e.id === n2.id);
    assert.ok(moved.x > n2.x + 2 && moved.y > n2.y + 1, 'moved with a finger');

    // 4. resize it with the corner handle
    await page.waitForTimeout(100);
    const handles = await page.evaluate(() => [...document.querySelectorAll('.dz-svg .sel rect')].map((r) => {
      const m = document.querySelector('.dz-svg').getScreenCTM();
      return { x: (+r.getAttribute('x') + +r.getAttribute('width') / 2) * m.a + m.e, y: (+r.getAttribute('y') + +r.getAttribute('height') / 2) * m.d + m.f };
    }));
    await touch.drag(handles[2], { x: handles[2].x + 25, y: handles[2].y + 10 });
    await page.waitForTimeout(150);
    st = await sideState(page);
    assert.ok(st.els.find((e) => e.id === n2.id).size > n2.size * 1.1, 'resized');

    // 5. upload a logo
    await page.locator('#dz-tab-logo').tap();
    await page.locator('.dz-file').setInputFiles({ name: 'mark.png', mimeType: 'image/png', buffer: makePng(600, 300) });
    await page.waitForFunction(() => window.GSSDesigner.store.side().elements.some((e) => e.type === 'image' && e.logoId));
    await page.waitForTimeout(200);

    // 6. rotate it
    const rot = await page.evaluate(() => {
      const circle = document.querySelector('.dz-svg .sel circle');
      const m = document.querySelector('.dz-svg').getScreenCTM();
      return { x: +circle.getAttribute('cx') * m.a + m.e, y: +circle.getAttribute('cy') * m.d + m.f };
    });
    await touch.drag(rot, { x: rot.x + 60, y: rot.y + 30 });
    await page.waitForTimeout(150);
    st = await sideState(page);
    assert.ok(Math.abs(st.els.find((e) => e.type === 'image').rot) > 20, 'rotated');

    // 7. undo twice, redo once
    await page.locator('button[aria-label="Undo"]').tap();
    await page.locator('button[aria-label="Undo"]').tap();
    st = await sideState(page);
    assert.ok(!st.els.some((e) => e.type === 'image' && e.logoId), 'logo placement undone');
    await page.locator('button[aria-label="Redo"]').tap();
    st = await sideState(page);
    const img = st.els.find((e) => e.type === 'image');
    assert.ok(img.logoId && Math.abs(img.rot) < 1, 'logo back, not rotated');
    await noHorizontalScroll(page, 'after edits');

    // 8. each side different: make the back side magenta, then look at it in 3D
    await page.locator('#dz-tab-sides').tap();
    await page.getByRole('button', { name: 'Each side different' }).tap();
    await page.getByRole('button', { name: 'Back side' }).tap();
    await page.evaluate(async () => {
      const { setBackground, getSide } = await import('/assets/design/model/document.js');
      const { store } = window.GSSDesigner;
      const back = getSide(store.state.doc, 0, 2);
      const doc = back.elements.reduce((d, el) => d, store.state.doc);
      let next = setBackground(doc, 0, 2, { type: 'solid', color: '#FF00FF' });
      // clear the shapes on that side so the roof shows the plain color
      const ids = getSide(next, 0, 2).elements.filter((e) => e.type === 'shape').map((e) => e.id);
      const { removeElements } = await import('/assets/design/model/document.js');
      next = removeElements(next, 0, 2, ids);
      store.commit(next);
    });
    await page.getByRole('button', { name: '3D', exact: true }).tap();
    await page.waitForFunction(() => window.GSSDesigner.view3d.stage, null, { timeout: 15000 });
    await page.getByRole('button', { name: 'Back', exact: true }).tap();
    await page.waitForTimeout(1200);
    const back = await magentaShare(page);
    assert.ok(back > 0.03, 'the back of the tent shows the magenta side C art, share ' + back.toFixed(3));
    await page.getByRole('button', { name: 'Front', exact: true }).tap();
    await page.waitForTimeout(1200);
    const front = await magentaShare(page);
    assert.ok(front < 0.005, 'the front is not magenta, share ' + front.toFixed(3));
    // turn the tent with a finger until the back comes round
    const canvas = await page.locator('.dz-3d-host canvas').boundingBox();
    const row = canvas.y + canvas.height * 0.5;
    let drags = 0;
    while ((await magentaShare(page)) <= 0.03 && drags < 8) {
      await touch.drag({ x: canvas.x + canvas.width * 0.2, y: row }, { x: canvas.x + canvas.width * 0.8, y: row }, 10);
      drags += 1;
      await page.waitForTimeout(900);
    }
    assert.ok(drags > 0 && drags < 8, `a finger drag should bring the back round (${drags} drags)`);
    assert.ok((await magentaShare(page)) > 0.03, 'the back of the tent shows after turning it with a finger');
    await noHorizontalScroll(page, '3D');

    // 9. send the request (server off: the form stays open, Try again, call and text)
    await page.evaluate(() => { window.GSSDesigner.noNavigate = true; });
    await page.getByRole('button', { name: 'Flat', exact: true }).tap();
    await page.getByRole('button', { name: 'Get my free proof' }).first().tap();
    await page.getByRole('heading', { name: 'Check your design' }).waitFor();
    await noHorizontalScroll(page, 'review dialog');
    await page.getByRole('button', { name: 'Continue' }).tap();
    await page.locator('input[autocomplete="name"]').fill('Phone Customer');
    await page.locator('input[type="email"]').fill('phone@example.com');
    await page.getByRole('button', { name: 'Send my design' }).tap();
    await page.locator('dialog .dz-warn', { hasText: 'Online requests are paused' }).waitFor();
    assert.equal(await page.locator('dialog .dz-warn a[href="tel:+13342329003"]').count(), 1);
    await noHorizontalScroll(page, 'failure dialog');
    assert.deepEqual(problems.filter((p) => !/status of 503|swiftshader|GPU stall|GL Driver/i.test(p)), []);
    await page.context().close();
  } finally {
    await browser.close();
    server.stop();
  }
});
