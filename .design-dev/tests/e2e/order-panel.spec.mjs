// The "Start my order" panel in a real browser: options change the price, the artwork paths show the right fields,
// the designer link carries the choices, and a submit posts only a sku and a quantity (the answer is faked here).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, newPage } from './helpers.mjs';

test('order panel: price, paths, designer link and submit on a banner page', async () => {
  const server = await startServer();
  const browser = await launch();
  try {
    for (const kind of ['desktop', 'phone']) {
      const { page, problems } = await newPage(browser, kind);
      let posted = null;
      await page.route('**/api/order-request', async (route) => {
        posted = route.request().postDataBuffer().toString('latin1');
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ref: 'GS-TESTTEST', emailed: true, stored: true, order: { id: 'GS-TESTTEST', url: 'https://getseensignsco.com/order/x', subtotal: 16800 } }) });
      });
      await page.goto(server.base + '/vinyl-banners/');
      await page.locator('#order').scrollIntoViewIfNeeded();
      await page.locator('select[data-group="size"]').selectOption('3x6');
      await page.locator('select[data-group="material"]').selectOption('18oz');
      await page.locator('input[name="qty"]').fill('2');
      assert.match(await page.locator('#ord-total').innerText(), /\$168/i, kind + ' total');
      // mesh hides the pole pocket finish
      await page.locator('select[data-group="material"]').selectOption('mesh');
      assert.equal(await page.locator('select[data-option="finish"] option[value="pockets"]').evaluate((o) => o.disabled), true);
      await page.locator('select[data-group="material"]').selectOption('18oz');
      // designer path is the default and carries the options
      const link = await page.locator('#ord-design').getAttribute('href');
      assert.equal(link, '/design/vinyl-banner/?size=3x6&material=18oz&qty=2');
      assert.equal(await page.locator('.ord-details').isHidden(), true);
      // upload path needs a file
      await page.locator('input[name="path"][value="upload"]').check();
      await page.locator('input[name="name"]').fill('Pat Smith');
      await page.locator('input[name="email"]').fill('pat@example.com');
      await page.locator('#ord-submit').click();
      assert.match(await page.locator('#ord-status').innerText(), /Choose your artwork/);
      assert.equal(posted, null, 'nothing is sent without a file');
      await page.locator('#ord-files').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });
      await page.locator('#ord-submit').click();
      await page.locator('.ord-done').waitFor();
      assert.match(await page.locator('.ord-done').innerText(), /GS-TESTTEST/);
      assert.match(await page.locator('.ord-done').innerText(), /Nothing is charged/);
      assert.match(posted, /"sku":"banner-18oz-3x6","quantity":2/);
      assert.doesNotMatch(posted, /unit_amount|"price"|total/, 'the browser sends no amounts');
      assert.deepEqual(problems.filter((p) => !/api\/order-request/.test(p)), [], kind + ' console problems');
      await page.context().close();
    }
  } finally {
    await browser.close();
    server.stop();
  }
});

test('shop page and nav: Shop is in the desktop nav and the phone header, and every product has an order link', async () => {
  const server = await startServer();
  const browser = await launch();
  try {
    const desktop = await newPage(browser, 'desktop');
    await desktop.page.goto(server.base + '/shop/');
    assert.equal(await desktop.page.locator('.nav-links a', { hasText: 'Shop' }).first().isVisible(), true);
    assert.equal(await desktop.page.locator('.shop-card').count(), 17, '16 product pages, the holiday page shows its Christmas and Thanksgiving items separately');
    assert.equal(await desktop.page.locator('.shop-card a.btn', { hasText: 'Start my order' }).count(), 17);
    await desktop.page.locator('.shop-card a.btn').first().click();
    assert.match(desktop.page.url(), /\/bulk-campaign-signs\/#order$/);
    await desktop.context.close();
    const phone = await newPage(browser, 'phone');
    await phone.page.goto(server.base + '/shop/');
    assert.equal(await phone.page.locator('.nav-shop').isVisible(), true);
    assert.equal(await phone.page.locator('.nav-links').isVisible(), false);
    const noOverflow = await phone.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    assert.equal(noOverflow, true, 'no sideways scroll on a phone');
    await phone.page.locator('.nav-shop').click();
    assert.match(phone.page.url(), /\/shop\/$/);
    await phone.context.close();
  } finally {
    await browser.close();
    server.stop();
  }
});

test('designer opens with the choices from the order panel link', async () => {
  const server = await startServer();
  const browser = await launch();
  try {
    const { page, problems } = await newPage(browser, 'desktop');
    await page.goto(server.base + '/design/vinyl-banner/?size=3x6&material=18oz&qty=2');
    await page.waitForFunction(() => window.GSSDesigner && window.GSSDesigner.ready, null, { timeout: 20000 });
    const piece = await page.evaluate(() => window.GSSDesigner.store.piece());
    assert.equal(piece.choices.size, '3x6');
    assert.equal(piece.choices.material, '18oz');
    assert.equal(piece.qty, 2);
    assert.match(await page.locator('.dz-aside .dz-total b').innerText(), /^\$168$/);
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
    server.stop();
  }
});

test('a fitted table cover has a designer path too, with its own price in the designer', async () => {
  const server = await startServer();
  const browser = await launch();
  try {
    const { page, problems } = await newPage(browser, 'desktop');
    await page.goto(server.base + '/table-throws/');
    await page.locator('#order').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#ord-path-designer').isVisible(), true);
    await page.locator('select[data-group="style"]').selectOption('fitted');
    assert.match(await page.locator('#ord-total').innerText(), /\$159/);
    assert.equal(await page.locator('#ord-path-designer').isVisible(), true, 'fitted covers can be designed online');
    assert.equal(await page.locator('#ord-design-off').isVisible(), false);
    assert.equal(await page.locator('#ord-design').getAttribute('href'), '/design/table-throw/?length=6&style=fitted');
    await page.locator('select[data-group="length"]').selectOption('8');
    assert.match(await page.locator('#ord-total').innerText(), /\$179/);
    assert.equal(await page.locator('#ord-design').getAttribute('href'), '/design/table-throw/?length=8&style=fitted');
    await page.locator('select[data-group="style"]').selectOption('4');
    assert.match(await page.locator('#ord-total').innerText(), /\$189/);
    assert.equal(await page.locator('#ord-path-designer').isVisible(), true);

    await page.goto(server.base + '/design/table-throw/?length=8&style=fitted');
    await page.waitForFunction(() => window.GSSDesigner && window.GSSDesigner.ready, null, { timeout: 20000 });
    const piece = await page.evaluate(() => window.GSSDesigner.store.piece());
    assert.equal(piece.choices.length, '8');
    assert.equal(piece.choices.style, 'fitted');
    assert.match(await page.locator('.dz-aside .dz-total b').innerText(), /^\$179$/);
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
    server.stop();
  }
});

test('custom patches: three priced choices, upload or "we design it" only, no Etsy link, sends the patch sku', async () => {
  const server = await startServer();
  const browser = await launch();
  try {
    for (const kind of ['desktop', 'phone']) {
      const { page, problems } = await newPage(browser, kind);
      let posted = null;
      await page.route('**/api/order-request', async (route) => {
        posted = route.request().postDataBuffer().toString('latin1');
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ref: 'GS-TESTTEST', emailed: true, stored: true, order: { id: 'GS-TESTTEST', url: 'https://getseensignsco.com/order/x', subtotal: 23900 } }) });
      });
      await page.goto(server.base + '/custom-patches/');
      await page.locator('#order').scrollIntoViewIfNeeded();
      const sel = page.locator('select[data-group="pack"]');
      for (const [value, price] of [['pvc50', /\$329/], ['emb50', /\$239/], ['emb100', /\$309/]]) {
        await sel.selectOption(value);
        assert.match(await page.locator('#ord-total').innerText(), price, kind + ' ' + value);
      }
      assert.equal(await page.locator('#ord-path-designer').count(), 0, 'no designer path');
      assert.equal(await page.locator('input[name="path"][value="upload"]').isChecked(), true);
      assert.equal(await page.locator('a[href*="etsy.com/listing"]').count(), 0, 'no Etsy listing link');
      assert.equal(await page.locator('a.btn', { hasText: 'Order on Etsy' }).count(), 0);
      await sel.selectOption('emb50');
      await page.locator('input[name="name"]').fill('Pat Smith');
      await page.locator('input[name="email"]').fill('pat@example.com');
      await page.locator('#ord-files').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });
      await page.locator('#ord-submit').click();
      await page.locator('.ord-done').waitFor();
      assert.match(posted, /"sku":"patch-emb-50","quantity":1/);
      assert.doesNotMatch(posted, /unit_amount|"price"|total/, 'the browser sends no amounts');
      assert.deepEqual(problems.filter((p) => !/api\/order-request/.test(p)), [], kind + ' console problems');
      await page.context().close();
    }
  } finally {
    await browser.close();
    server.stop();
  }
});

test('real estate add-ons are priced and sent as their own lines', async () => {
  const server = await startServer();
  const browser = await launch();
  try {
    const { page } = await newPage(browser, 'desktop');
    let posted = '';
    await page.route('**/api/order-request', async (route) => {
      posted = route.request().postDataBuffer().toString('latin1');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ref: 'GS-TESTTEST', emailed: true, stored: true, order: { id: 'GS-TESTTEST', url: 'https://getseensignsco.com/order/x', subtotal: 10300 } }) });
    });
    await page.goto(server.base + '/real-estate-signs/');
    await page.locator('#order').scrollIntoViewIfNeeded();
    assert.match(await page.locator('#ord-total').innerText(), /\$44/);
    await page.locator('input[data-addon="rider"]').check();
    await page.locator('input[data-addon="post"]').check();
    assert.match(await page.locator('#ord-total').innerText(), /\$103/);
    await page.locator('input[name="path"][value="dfm"]').check();
    await page.locator('textarea[name="wording"]').fill('Lionheart Realty, open house Sunday');
    await page.locator('input[name="name"]').fill('Pat Smith');
    await page.locator('input[name="email"]').fill('pat@example.com');
    await page.locator('#ord-submit').click();
    await page.locator('.ord-done').waitFor();
    for (const sku of ['re-coroplast', 're-rider', 're-post']) assert.ok(posted.includes(`"sku":"${sku}","quantity":1`), sku);
  } finally {
    await browser.close();
    server.stop();
  }
});
