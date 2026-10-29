// The "Get a quote" form in a real browser (home page, /quote and /contact). It posts to /api/quote-request,
// shows the reference on success, shows messages for validation errors, and on a failure (server error, 503,
// network) it NEVER opens the visitor's email app: the typed answers stay in the form and in localStorage, the page
// retries by itself, and then offers Try again and the phone and text links.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, newPage } from './helpers.mjs';

const OK = { ok: true, ref: 'QR-TESTTEST', emailed: true, stored: true, confirmed: true };

async function fill(page) {
  await page.locator('#quote-form').scrollIntoViewIfNeeded();
  await page.locator('#quote-form input[name="name"]').fill('Pat Smith');
  await page.locator('#quote-form input[name="email"]').fill('pat@example.com');
  await page.locator('#quote-form select[name="product"]').selectOption({ label: 'Vinyl Banner' });
  await page.locator('#quote-form input[name="quantity"]').fill('4');
  await page.locator('#quote-form textarea[name="details"]').fill('Grand opening');
}

// Records every navigation and every mailto request so a test can prove the email app never opens.
function watchNavigation(page) {
  const seen = [];
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) seen.push(frame.url()); });
  page.on('request', (req) => { if (req.url().startsWith('mailto:')) seen.push(req.url()); });
  return seen;
}
const nothingOpened = (seen, base) => assert.ok(seen.every((u) => !u.startsWith('mailto:') && u.startsWith(base)), 'no mailto, no navigation away: ' + seen.join(', '));

async function withPage(fn, kind = 'desktop') {
  const server = await startServer();
  const browser = await launch();
  try {
    const { page, problems } = await newPage(browser, kind);
    await fn({ page, server, problems });
    await page.context().close();
  } finally {
    await browser.close();
    server.stop();
  }
}

test('success shows the reference and clears the form; validation errors and rate limits show messages and keep the typed answers', async () => {
  await withPage(async ({ page, server }) => {
    let answer = { status: 200, body: OK };
    let posted = null;
    await page.route('**/api/quote-request', async (route) => {
      posted = route.request().postData() || '';
      await route.fulfill({ status: answer.status, contentType: 'application/json', body: JSON.stringify(answer.body) });
    });
    await page.goto(server.base + '/');
    const seen = watchNavigation(page);
    await fill(page);
    await page.locator('#quote-form button[type="submit"]').click();
    await page.locator('.form-status', { hasText: 'QR-TESTTEST' }).waitFor();
    assert.match(await page.locator('.form-status').innerText(), /Thanks! We got your request \(reference QR-TESTTEST\)/);
    assert.match(posted, /name="elapsedMs"/);
    assert.match(posted, /name="attempt"\r\n\r\n[0-9a-f]{24}\r\n/, 'an attempt id travels with the request');
    assert.match(posted, /Vinyl Banner/);
    assert.match(posted, /name="_gotcha"\r\n\r\n\r\n/, 'the honeypot is posted empty');
    assert.equal(await page.locator('#quote-form input[name="name"]').inputValue(), '', 'the form is cleared');
    assert.equal(await page.evaluate(() => localStorage.getItem('gss-quote-draft')), null, 'the saved draft is cleared on success');

    answer = { status: 400, body: { ok: false, error: 'fields', fields: ['email'] } };
    await fill(page);
    await page.locator('#quote-form button[type="submit"]').click();
    await page.locator('.form-status', { hasText: 'a valid email' }).waitFor();
    assert.equal(await page.locator('#quote-form input[name="name"]').inputValue(), 'Pat Smith', 'what was typed is kept');

    answer = { status: 429, body: { ok: false, error: 'rate' } };
    await page.locator('#quote-form button[type="submit"]').click();
    await page.locator('.form-status', { hasText: 'try again later' }).waitFor();
    assert.equal(await page.locator('#quote-form input[name="name"]').inputValue(), 'Pat Smith');
    nothingOpened(seen, server.base);
  });
});

test('503 (online requests off): no email app, no retries, answers kept, Try again, call and text links', async () => {
  await withPage(async ({ page, server }) => {
    let posts = 0;
    await page.route('**/api/quote-request', async (route) => {
      posts += 1;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, enabled: false }) });
    });
    await page.goto(server.base + '/');
    const seen = watchNavigation(page);
    await fill(page);
    await page.locator('#quote-form button[type="submit"]').click();
    await page.locator('.form-status.err', { hasText: 'Online requests are paused' }).waitFor();
    assert.equal(posts, 1, 'a switched-off endpoint is not hammered');
    const status = page.locator('.form-status');
    assert.equal(await status.locator('a[href="tel:+13342329003"]').count(), 1);
    assert.equal(await status.locator('a[href^="sms:+13342329003"]').count(), 1);
    assert.equal(await status.locator('a[href^="mailto:"]').count(), 0);
    assert.match(await page.locator('#quote-form button[type="submit"]').innerText(), /try again/i);
    assert.equal(await page.locator('#quote-form button[type="submit"]').isDisabled(), false);
    assert.equal(await page.locator('#quote-form input[name="name"]').inputValue(), 'Pat Smith');
    assert.equal(await page.locator('#quote-form textarea[name="details"]').inputValue(), 'Grand opening');
    nothingOpened(seen, server.base);
  });
});

test('a server error is retried by itself with the same attempt id, then succeeds without opening email', async () => {
  await withPage(async ({ page, server }) => {
    const attempts = [];
    await page.route('**/api/quote-request', async (route) => {
      attempts.push((route.request().postData() || '').match(/name="attempt"\r\n\r\n([0-9a-f]+)/)[1]);
      if (attempts.length < 3) await route.fulfill({ status: attempts.length === 1 ? 500 : 502, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'server' }) });
      else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OK) });
    });
    await page.goto(server.base + '/');
    const seen = watchNavigation(page);
    await fill(page);
    await page.locator('#quote-form button[type="submit"]').click();
    await page.locator('.form-status', { hasText: 'still trying' }).waitFor();
    await page.locator('.form-status', { hasText: 'QR-TESTTEST' }).waitFor({ timeout: 15000 });
    assert.equal(attempts.length, 3);
    assert.equal(new Set(attempts).size, 1, 'every try of the same answers carries the same attempt id');
    assert.equal(await page.locator('#quote-form input[name="name"]').inputValue(), '');
    nothingOpened(seen, server.base);
  });
});

test('network failure: three tries, a friendly message, answers kept, saved on this device and restored after a reload, a new attempt after an edit', async () => {
  await withPage(async ({ page, server }) => {
    const attempts = [];
    let mode = 'abort';
    await page.route('**/api/quote-request', async (route) => {
      attempts.push((route.request().postData() || '').match(/name="attempt"\r\n\r\n([0-9a-f]+)/)[1]);
      if (mode === 'abort') await route.abort('connectionfailed');
      else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OK) });
    });
    await page.goto(server.base + '/');
    const seen = watchNavigation(page);
    await fill(page);
    await page.locator('#quote-form button[type="submit"]').click();
    await page.locator('.form-status.err', { hasText: 'That did not go through' }).waitFor({ timeout: 15000 });
    assert.equal(attempts.length, 3, 'one try and two automatic retries');
    assert.match(await page.locator('.form-status').innerText(), /What you typed is still here/);
    assert.equal(await page.locator('.form-status a[href="tel:+13342329003"]').count(), 1);
    assert.equal(await page.locator('#quote-form input[name="email"]').inputValue(), 'pat@example.com');

    const draft = JSON.parse(await page.evaluate(() => localStorage.getItem('gss-quote-draft')));
    assert.equal(draft.v.name, 'Pat Smith');
    assert.equal(draft.v.details, 'Grand opening');

    await page.reload();
    assert.equal(await page.locator('#quote-form input[name="name"]').inputValue(), 'Pat Smith', 'the draft comes back after a reload');
    assert.equal(await page.locator('#quote-form select[name="product"]').inputValue(), 'Vinyl Banner');
    await page.locator('.form-status', { hasText: 'We kept what you typed' }).waitFor();

    mode = 'ok';
    attempts.length = 0;
    await page.locator('#quote-form input[name="quantity"]').fill('9');
    await page.locator('#quote-form button[type="submit"]').click();
    await page.locator('.form-status', { hasText: 'QR-TESTTEST' }).waitFor({ timeout: 15000 });
    assert.equal(attempts.length, 1);
    assert.equal(await page.evaluate(() => localStorage.getItem('gss-quote-draft')), null);
    nothingOpened(seen, server.base);
  });
});

test('saved but the shop email failed: the page shows the reference and says to call or text, not an error and not an email app', async () => {
  await withPage(async ({ page, server }) => {
    await page.route('**/api/quote-request', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ref: 'QR-SAVED999', emailed: false, stored: true, confirmed: false }) }));
    await page.goto(server.base + '/');
    const seen = watchNavigation(page);
    await fill(page);
    await page.locator('#quote-form button[type="submit"]').click();
    await page.locator('.form-status', { hasText: 'QR-SAVED999' }).waitFor();
    const text = await page.locator('.form-status').innerText();
    assert.match(text, /Your request is saved/);
    assert.match(text, /call or text \(334\) 232-9003/);
    assert.equal(await page.locator('.form-status.err').count(), 0);
    nothingOpened(seen, server.base);
  });
});

test('/quote and /contact carry the same working form and the "Email us" buttons are gone', async () => {
  await withPage(async ({ page, server }) => {
    let posted = 0;
    await page.route('**/api/quote-request', async (route) => {
      posted += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OK) });
    });
    for (const path of ['/quote.html?product=Feather+Flag+Kit', '/contact.html']) {
      await page.goto(server.base + path);
      assert.equal(await page.locator('a[href^="mailto:"]').count(), 0, path + ' has no mailto link');
      assert.equal(await page.locator('#quote-form[data-endpoint="/api/quote-request"]').count(), 1, path + ' has the form');
      await page.locator('#quote-form input[name="name"]').fill('Pat Smith');
      await page.locator('#quote-form input[name="email"]').fill('pat@example.com');
      if (path.startsWith('/quote')) assert.equal(await page.locator('#quote-form select[name="product"]').inputValue(), 'Feather Flag Kit', 'the product link preselects the product');
      else assert.equal(await page.locator('#quote-form select[name="product"]').inputValue(), 'Something else');
      await page.waitForTimeout(3100);
      await page.locator('#quote-form button[type="submit"]').click();
      await page.locator('.form-status', { hasText: 'QR-TESTTEST' }).waitFor();
    }
    assert.equal(posted, 2);
  });
});
