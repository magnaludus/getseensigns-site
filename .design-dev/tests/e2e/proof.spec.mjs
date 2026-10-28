// The proof request: what the page sends when the function is on, and what it does when the function answers 503
// or fails: it never opens the visitor's email app. The form stays open with everything typed, says so, and offers
// Try again plus call and text links.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, newPage, openDesigner, makePng } from './helpers.mjs';

async function fillAndSend(page, { skipHoney = true } = {}) {
  await page.evaluate(() => { window.GSSDesigner.noNavigate = true; });
  await page.getByRole('button', { name: 'Get my free proof' }).first().click();
  await page.getByRole('heading', { name: 'Check your design' }).waitFor();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('input[autocomplete="name"]').fill('Test Customer');
  await page.locator('input[type="email"]').fill('customer@example.com');
  await page.locator('input[type="tel"]').fill('334-555-0100');
  await page.locator('textarea').fill('Please make the name bigger.');
  await page.getByRole('button', { name: 'Send my design' }).click();
}

test('server on: posts design, request, previews and logo, then shows the reference', async () => {
  const server = await startServer();
  const browser = await launch();
  try {
    const { page, problems } = await newPage(browser, 'desktop');
    let posted = null;
    await page.route('**/api/design-proof', async (route) => {
      posted = route.request().postDataBuffer().toString('latin1');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ref: 'GS-TEST1234', emailed: true, stored: true }) });
    });
    await openDesigner(page, server.base, '/design/yard-signs/');
    await page.locator('#dz-tab-logo').click();
    await page.locator('.dz-file').setInputFiles({ name: 'mark.png', mimeType: 'image/png', buffer: makePng(300, 300) });
    await page.waitForTimeout(400);
    await fillAndSend(page);
    await page.getByRole('heading', { name: /Your proof is on the way/ }).waitFor({ timeout: 15000 });
    assert.match(await page.locator('.dz-ref').innerText(), /GS-TEST1234/);
    assert.ok(posted, 'request was posted');
    for (const name of ['design', 'request', '_gotcha', 'preview-0', 'logo-0']) assert.ok(posted.includes(`name="${name}"`), `${name} field is in the form`);
    const request = JSON.parse(posted.split('name="request"')[1].split('\r\n\r\n')[1].split('\r\n--')[0]);
    assert.equal(request.mode, 'self');
    assert.equal(request.name, 'Test Customer');
    assert.equal(request.clientTotal, 74);
    assert.ok(request.elapsedMs > 0);
    const design = JSON.parse(posted.split('name="design"')[1].split('\r\n\r\n')[1].split('\r\n--')[0]);
    assert.equal(design.v, 2);
    assert.equal(design.project.pieces[0].productId, 'yard');
    assert.ok(!JSON.stringify(design).includes('customer@example.com'), 'contact details are not in the design');
    assert.deepEqual(problems, []);
    await page.context().close();
  } finally {
    await browser.close();
    server.stop();
  }
});

test('server off (503): no email app, no download, the form stays open with the answers, Try again, call and text', async () => {
  const server = await startServer();
  const browser = await launch();
  try {
    const { page, problems } = await newPage(browser, 'phone', { acceptDownloads: true });
    let posts = 0;
    await page.route('**/api/design-proof', (route) => { posts += 1; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, enabled: false }) }); });
    await openDesigner(page, server.base, '/design/canopy-tent/');
    const opened = [];
    page.on('download', (d) => opened.push('download ' + d.suggestedFilename()));
    page.on('request', (req) => { if (req.url().startsWith('mailto:')) opened.push(req.url()); });
    await fillAndSend(page);
    await page.locator('dialog .dz-warn', { hasText: 'Online requests are paused' }).waitFor();
    const note = page.locator('dialog .dz-warn');
    assert.match(await note.innerText(), /What you typed is still here/);
    assert.equal(await note.locator('a[href="tel:+13342329003"]').count(), 1);
    assert.equal(await note.locator('a[href^="sms:+13342329003"]').count(), 1);
    assert.equal(await page.locator('dialog a[href^="mailto:"]').count(), 0);
    assert.equal(await page.locator('dialog input[autocomplete="name"]').inputValue(), 'Test Customer');
    assert.equal(await page.locator('dialog input[type="email"]').inputValue(), 'customer@example.com');
    const again = page.getByRole('button', { name: 'Try again' });
    assert.equal(await again.isDisabled(), false);
    await page.waitForTimeout(1500);
    assert.deepEqual(opened, [], 'nothing opened and nothing downloaded');
    assert.equal(posts, 1);
    // the second try goes through
    await page.unroute('**/api/design-proof');
    await page.route('**/api/design-proof', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ref: 'GS-RETRY001', emailed: true, stored: true }) }));
    await again.click();
    await page.getByRole('heading', { name: /Your proof is on the way/ }).waitFor({ timeout: 15000 });
    assert.match(await page.locator('.dz-ref').innerText(), /GS-RETRY001/);
    // the browser logs the expected 503 itself; nothing else may be reported
    assert.deepEqual(problems.filter((p) => !/status of 503/.test(p)), []);
    await page.context().close();
  } finally {
    await browser.close();
    server.stop();
  }
});

test('stored but not emailed: shows the reference and says to call or text if no reply, no email app', async () => {
  const server = await startServer();
  const browser = await launch();
  try {
    const { page } = await newPage(browser, 'desktop', { acceptDownloads: true });
    await page.route('**/api/design-proof', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ref: 'GS-STORED99', emailed: false, stored: true }) }));
    await openDesigner(page, server.base, '/design/table-throw/');
    const opened = [];
    page.on('download', (d) => opened.push(d.suggestedFilename()));
    page.on('request', (req) => { if (req.url().startsWith('mailto:')) opened.push(req.url()); });
    await fillAndSend(page);
    await page.getByRole('heading', { name: /Your proof is on the way/ }).waitFor();
    const text = await page.locator('.dz-dlg-body').innerText();
    assert.match(text, /GS-STORED99/);
    assert.match(text, /Our email hiccuped on this one, but your design is saved/);
    assert.equal(await page.locator('dialog a[href^="mailto:"]').count(), 0);
    await page.waitForTimeout(1500);
    assert.deepEqual(opened, []);
    await page.context().close();
  } finally {
    await browser.close();
    server.stop();
  }
});

test('"Rather we design it" on a failure keeps the form, says so and offers Try again, with no email app', async () => {
  const server = await startServer();
  const browser = await launch();
  try {
    const { page } = await newPage(browser, 'desktop');
    await page.route('**/api/design-proof', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'server' }) }));
    await openDesigner(page, server.base, '/design/vinyl-banner/');
    const opened = [];
    page.on('request', (req) => { if (req.url().startsWith('mailto:')) opened.push(req.url()); });
    await page.getByRole('button', { name: "Rather we design it? It's free." }).first().click();
    await page.locator('dialog input[autocomplete="name"]').fill('Help Customer');
    await page.locator('dialog input[type="email"]').fill('help@example.com');
    await page.locator('dialog textarea').first().fill('GRAND OPENING SATURDAY');
    await page.getByRole('button', { name: 'Send it to us' }).click();
    await page.locator('dialog .dz-warn', { hasText: 'That did not go through' }).waitFor();
    assert.equal(await page.locator('dialog textarea').first().inputValue(), 'GRAND OPENING SATURDAY');
    assert.equal(await page.locator('dialog .dz-warn a[href="tel:+13342329003"]').count(), 1);
    assert.equal(await page.locator('dialog a[href^="mailto:"]').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Try again' }).isDisabled(), false);
    assert.deepEqual(opened, []);
    await page.context().close();
  } finally {
    await browser.close();
    server.stop();
  }
});

test('"Rather we design it" sends the short form as design_for_me', async () => {
  const server = await startServer();
  const browser = await launch();
  try {
    const { page, problems } = await newPage(browser, 'desktop');
    let posted = null;
    await page.route('**/api/design-proof', async (route) => {
      posted = route.request().postDataBuffer().toString('latin1');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ref: 'GS-HELP0001', emailed: true, stored: true }) });
    });
    await openDesigner(page, server.base, '/design/vinyl-banner/');
    await page.getByRole('button', { name: "Rather we design it? It's free." }).first().click();
    await page.locator('dialog input[autocomplete="name"]').fill('Help Customer');
    await page.locator('dialog input[type="email"]').fill('help@example.com');
    await page.locator('dialog textarea').first().fill('GRAND OPENING SATURDAY');
    await page.getByRole('button', { name: 'Send it to us' }).click();
    await page.getByRole('heading', { name: 'Got it.' }).waitFor({ timeout: 15000 });
    const request = JSON.parse(posted.split('name="request"')[1].split('\r\n\r\n')[1].split('\r\n--')[0]);
    assert.equal(request.mode, 'design_for_me');
    assert.equal(request.designForMe.wording, 'GRAND OPENING SATURDAY');
    assert.deepEqual(request.designForMe.products, ['banner']);
    assert.ok(!posted.includes('name="design"'), 'no design attached');
    assert.deepEqual(problems, []);
    await page.context().close();
  } finally {
    await browser.close();
    server.stop();
  }
});
