// The home page "Get a quote" form in a real browser: it posts to /api/quote-request, shows the reference on success,
// shows messages for validation errors, and only opens the email fallback for a server error or a 503.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, newPage } from './helpers.mjs';

async function fill(page) {
  await page.locator('#quote').scrollIntoViewIfNeeded();
  await page.locator('#quote-form input[name="name"]').fill('Pat Smith');
  await page.locator('#quote-form input[name="email"]').fill('pat@example.com');
  await page.locator('#quote-form select[name="product"]').selectOption({ label: 'Vinyl Banner' });
  await page.locator('#quote-form input[name="quantity"]').fill('4');
  await page.locator('#quote-form textarea[name="details"]').fill('Grand opening');
}

test('quote form: success shows the reference, validation errors show messages, only errors fall back to email', async () => {
  const server = await startServer();
  const browser = await launch();
  try {
    const { page } = await newPage(browser, 'desktop');
    let answer = { status: 200, body: { ok: true, ref: 'QR-TESTTEST', emailed: true, stored: true, confirmed: true } };
    let posted = null;
    await page.route('**/api/quote-request', async (route) => {
      posted = route.request().postData() || '';
      await route.fulfill({ status: answer.status, contentType: 'application/json', body: JSON.stringify(answer.body) });
    });
    const opened = () => page.locator('#quote-form').getAttribute('data-fallback').then((v) => Number(v || 0));

    await page.goto(server.base + '/');
    await fill(page);
    await page.locator('#quote-form button[type="submit"]').click();
    await page.locator('.form-status', { hasText: 'QR-TESTTEST' }).waitFor();
    assert.match(await page.locator('.form-status').innerText(), /Thanks! We got your request \(reference QR-TESTTEST\)/);
    assert.match(posted, /name="elapsedMs"/);
    assert.match(posted, /Vinyl Banner/);
    assert.match(posted, /name="_gotcha"\r\n\r\n\r\n/, 'the honeypot is posted empty');
    assert.equal(await page.locator('#quote-form input[name="name"]').inputValue(), '', 'the form is cleared');
    assert.equal(await opened(), 0, 'success does not open the email app');

    // validation errors from the server: a message, no email fallback
    answer = { status: 400, body: { ok: false, error: 'fields', fields: ['email'] } };
    await fill(page);
    await page.locator('#quote-form button[type="submit"]').click();
    await page.locator('.form-status', { hasText: 'a valid email' }).waitFor();
    assert.equal(await opened(), 0, 'a validation error does not open the email app');
    assert.equal(await page.locator('#quote-form input[name="name"]').inputValue(), 'Pat Smith', 'what was typed is kept');

    // too many requests: a message, no email fallback
    answer = { status: 429, body: { ok: false, error: 'rate' } };
    await page.locator('#quote-form button[type="submit"]').click();
    await page.locator('.form-status', { hasText: 'try again later' }).waitFor();
    assert.equal(await opened(), 0);

    // 503 (online requests off): the email fallback
    answer = { status: 503, body: { ok: false, enabled: false } };
    await page.locator('#quote-form button[type="submit"]').click();
    await page.locator('.form-status', { hasText: 'email app' }).waitFor();
    assert.match(await page.locator('.form-status').innerText(), /Online requests are not available right now/);
    assert.equal(await opened(), 1, 'the email fallback opened once');

    // a real server error: the email fallback
    answer = { status: 500, body: { ok: false, error: 'storage' } };
    await page.locator('#quote-form button[type="submit"]').click();
    await page.waitForFunction(() => document.getElementById('quote-form').dataset.fallback === '2');
  } finally {
    await browser.close();
    server.stop();
  }
});
