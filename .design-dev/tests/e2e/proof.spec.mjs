// The proof request: what the page sends when the function is on, and the fallback (a zip of
// previews plus a prefilled email with a reference) when it answers 503 or fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('server off (503): downloads a zip of previews and opens a prefilled email with a reference', async () => {
  const server = await startServer();
  const browser = await launch();
  const dir = mkdtempSync(join(tmpdir(), 'proof-'));
  try {
    const { page, problems } = await newPage(browser, 'phone', { acceptDownloads: true });
    await page.route('**/api/design-proof', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, enabled: false }) }));
    await openDesigner(page, server.base, '/design/canopy-tent/');
    const dl = page.waitForEvent('download');
    await fillAndSend(page);
    const download = await dl;
    assert.match(download.suggestedFilename(), /^getseen-design-GS-[0-9A-Z]{8}\.zip$/);
    const path = join(dir, download.suggestedFilename());
    await download.saveAs(path);
    const listing = JSON.parse(execFileSync('python3', ['-I', '-c', 'import zipfile,sys,json; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps({n: z.getinfo(n).file_size for n in z.namelist()}))', path], { encoding: 'utf8' }));
    const names = Object.keys(listing);
    assert.ok(names.some((n) => /^preview-1-.*\.png$/.test(n)), 'preview PNG in the zip: ' + names.join(', '));
    assert.ok(names.includes('summary.txt') && names.includes('design.json'));
    await page.getByRole('heading', { name: 'One more step to send it' }).waitFor();
    await page.waitForFunction(() => window.GSSDesigner.lastMailto, null, { timeout: 5000 });
    const mailto = await page.evaluate(() => window.GSSDesigner.lastMailto);
    assert.ok(mailto.startsWith('mailto:sales@getseensignsco.com?subject='));
    const body = decodeURIComponent(mailto.split('body=')[1]);
    const ref = download.suggestedFilename().match(/GS-[0-9A-Z]{8}/)[0];
    assert.ok(body.includes('Reference: ' + ref), 'ref is in the email');
    for (const line of ['Name: Test Customer', 'Email: customer@example.com', 'Product: 10×10 pop-up canopy tent', 'Price shown: $589']) assert.ok(body.includes(line), line);
    // the browser logs the expected 503 itself; nothing else may be reported
    assert.deepEqual(problems.filter((p) => !/status of 503/.test(p)), []);
    await page.context().close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await browser.close();
    server.stop();
  }
});

test('stored but not emailed: shows the fallback with the server reference', async () => {
  const server = await startServer();
  const browser = await launch();
  try {
    const { page } = await newPage(browser, 'desktop', { acceptDownloads: true });
    await page.route('**/api/design-proof', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ref: 'GS-STORED99', emailed: false, stored: true }) }));
    await openDesigner(page, server.base, '/design/table-throw/');
    const dl = page.waitForEvent('download');
    await fillAndSend(page);
    const download = await dl;
    assert.match(download.suggestedFilename(), /GS-STORED99\.zip$/);
    await page.getByRole('heading', { name: 'One more step to send it' }).waitFor();
    assert.match(await page.locator('.dz-dlg-body').innerText(), /We saved your design, but our email did not go out/);
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
