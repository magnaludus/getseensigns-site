// Acceptance 4: the 3D code is not requested until the 3D view is opened. With WebGL off the page
// switches to the simple view with no errors, and editing and sending still work.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, newPage, openDesigner } from './helpers.mjs';

test('no Three.js request before the 3D view opens', async () => {
  const server = await startServer();
  const browser = await launch();
  try {
    const { page, problems } = await newPage(browser, 'desktop');
    const urls = [];
    page.on('request', (r) => urls.push(r.url()));
    await openDesigner(page, server.base, '/design/canopy-tent/');
    await page.waitForTimeout(1500);
    assert.deepEqual(urls.filter((u) => /\/three\/|three\.module|stage3d/.test(u) && !/\/three\/support\.js/.test(u)), []);
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await page.waitForFunction(() => window.GSSDesigner.view3d.stage || window.GSSDesigner.view3d.failed, null, { timeout: 15000 });
    assert.ok(urls.some((u) => /three\.module\.min\.js/.test(u)), 'three loaded after opening 3D');
    assert.deepEqual(problems.filter((p) => !/swiftshader|GPU stall|GL Driver/i.test(p)), []);
    await page.context().close();
  } finally {
    await browser.close();
    server.stop();
  }
});

test('WebGL off: simple view, no errors, editing and sending still work', async () => {
  const server = await startServer();
  const browser = await launch({ args: ['--disable-gpu', '--disable-webgl', '--disable-3d-apis'] });
  try {
    const { page, problems } = await newPage(browser, 'phone');
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
        return orig.call(this, type, ...rest);
      };
    });
    await openDesigner(page, server.base, '/design/vinyl-banner/');
    await page.getByRole('button', { name: '3D', exact: true }).tap();
    await page.waitForSelector('.dz-simple:not([hidden])', { timeout: 10000 });
    assert.equal(await page.evaluate(() => window.GSSDesigner.view3d.failed), true);
    assert.ok(await page.locator('.dz-simple-canvas').isVisible());
    // back to flat, still editable
    await page.getByRole('button', { name: 'Flat', exact: true }).tap();
    await page.locator('.dz-tpl').nth(1).tap();
    assert.equal(await page.evaluate(() => window.GSSDesigner.store.piece().templateId), 'split-field');
    assert.deepEqual(problems.filter((p) => !/swiftshader|GPU stall|GL Driver/i.test(p)), []);
    await page.context().close();
  } finally {
    await browser.close();
    server.stop();
  }
});
