// A lost WebGL context (a busy phone) must not break the page: the 3D view waits for the browser to
// give it back and rebuilds itself; if it never returns the page switches to the simple view.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, newPage, openDesigner } from './helpers.mjs';

const BENIGN = /swiftshader|GPU stall|GL Driver|WebGL: CONTEXT_LOST|CONTEXT_LOST_WEBGL|Context Lost/i;

async function openIn3d(page, base) {
  await openDesigner(page, base, '/design/canopy-tent/');
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForFunction(() => window.GSSDesigner.view3d.stage, null, { timeout: 15000 });
  await page.waitForTimeout(500);
}

const colours = (page) => page.evaluate(() => {
  const c = window.GSSDesigner.view3d.stage.screenshot();
  const tmp = document.createElement('canvas');
  tmp.width = 64;
  tmp.height = 40;
  const g = tmp.getContext('2d', { willReadFrequently: true });
  g.drawImage(c, 0, 0, 64, 40);
  const seen = new Set();
  const d = g.getImageData(0, 0, 64, 40).data;
  for (let i = 0; i < d.length; i += 4) seen.add(`${d[i] >> 4}-${d[i + 1] >> 4}-${d[i + 2] >> 4}`);
  return seen.size;
});

test('a context that comes back is rebuilt and the 3D view keeps working', async () => {
  const server = await startServer();
  const browser = await launch();
  try {
    const { page, problems } = await newPage(browser, 'desktop');
    await openIn3d(page, server.base);
    const before = await colours(page);
    assert.ok(before > 8, `the tent should draw more than a flat colour (${before})`);
    // getExtension returns null once the context is lost, so keep the handle
    await page.evaluate(() => {
      window.__lose = window.GSSDesigner.view3d.stage.canvas.getContext('webgl2').getExtension('WEBGL_lose_context');
      window.__lose.loseContext();
    });
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.dz-3d-note').isVisible(), true, 'the customer is told 3D is paused');
    assert.match(await page.locator('.dz-3d-note').innerText(), /3D paused/);
    await page.evaluate(() => window.__lose.restoreContext());
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('.dz-3d-note').isVisible(), false, 'the note goes away once 3D is back');
    assert.equal(await page.evaluate(() => window.GSSDesigner.view3d.failed), false);
    assert.ok((await colours(page)) > 8, 'the tent is drawn again after the context came back');
    assert.deepEqual(problems.filter((p) => !BENIGN.test(p)), []);
    await page.context().close();
  } finally {
    await browser.close();
    server.stop();
  }
});

test('a context that never comes back switches to the simple view', async () => {
  const server = await startServer();
  const browser = await launch();
  try {
    const { page, problems } = await newPage(browser, 'desktop');
    await openIn3d(page, server.base);
    await page.evaluate(() => window.GSSDesigner.view3d.stage.canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
    await page.waitForFunction(() => window.GSSDesigner.view3d.failed, null, { timeout: 9000 });
    assert.equal(await page.locator('.dz-simple').isVisible(), true);
    assert.equal(await page.locator('.dz-3d-host canvas').count(), 0, 'the dropped stage removes its canvas');
    // editing and sending still work from the flat view
    await page.getByRole('button', { name: 'Flat', exact: true }).click();
    assert.equal(await page.locator('.dz-stage svg').first().isVisible(), true);
    assert.deepEqual(problems.filter((p) => !BENIGN.test(p)), []);
    await page.context().close();
  } finally {
    await browser.close();
    server.stop();
  }
});
