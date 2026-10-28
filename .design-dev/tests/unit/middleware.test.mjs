// functions/_middleware.js: X-Robots-Tag: noindex on *.pages.dev and nothing else.
import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../../../functions/_middleware.js';

const run = (url, init, headers) => onRequest({ request: new Request(url), next: async () => new Response('<html>ok</html>', Object.assign({ status: 200, headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=300' } }, init, headers ? { headers } : {})) });

test('pages.dev hosts get X-Robots-Tag noindex and keep the rest of the response', async () => {
  for (const url of ['https://getseensigns.pages.dev/', 'https://abc123.getseensigns.pages.dev/custom-patches/', 'https://GETSEENSIGNS.PAGES.DEV/shop/']) {
    const res = await run(url);
    assert.equal(res.headers.get('X-Robots-Tag'), 'noindex', url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Type'), 'text/html');
    assert.equal(res.headers.get('Cache-Control'), 'public, max-age=300');
    assert.equal(await res.text(), '<html>ok</html>');
  }
});

test('the real domain and look-alike hosts are passed through untouched', async () => {
  for (const url of ['https://getseensignsco.com/', 'https://www.getseensignsco.com/shop/', 'https://pages.dev.example.com/', 'https://notpages.dev.evil.test/', 'https://getseensigns.pages.dev.example.com/']) {
    const res = await run(url);
    assert.equal(res.headers.get('X-Robots-Tag'), null, url);
    assert.equal(await res.text(), '<html>ok</html>');
  }
});

test('an existing noindex on a function page is kept, and status and redirects survive', async () => {
  const redirect = await run('https://getseensigns.pages.dev/old', { status: 301 }, { Location: '/new' });
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get('Location'), '/new');
  assert.equal(redirect.headers.get('X-Robots-Tag'), 'noindex');
  const own = await run('https://getseensignsco.com/proof/x', {}, { 'X-Robots-Tag': 'noindex, nofollow' });
  assert.equal(own.headers.get('X-Robots-Tag'), 'noindex, nofollow');
});
