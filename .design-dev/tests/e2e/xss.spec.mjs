// Whatever a customer types (or a shared link carries) is shown as plain text, never run as markup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, newPage, openDesigner } from './helpers.mjs';

const PAYLOADS = [
  '"><img src=x onerror="window.__xss=1">',
  '</text><script>window.__xss=2</script>',
  "'><svg onload=window.__xss=3>",
  '<style>*{display:none}</style>',
  '&lt;b&gt; &amp;',
];

async function nothingRan(page) {
  assert.equal(await page.evaluate(() => window.__xss), undefined, 'a payload ran');
  assert.equal(await page.locator('img[src="x"]').count(), 0, 'an injected image exists');
  assert.equal(await page.locator('svg[onload]').count(), 0, 'an injected svg exists');
  assert.equal(await page.locator('.dz-app style, .dz-app script').count(), 0, 'an injected style or script exists');
  assert.equal(await page.locator('.dz-stage').isVisible(), true, 'the stage is still visible');
}

test('typed words, layer names and shared links are shown as text only', async () => {
  const server = await startServer();
  const browser = await launch();
  try {
    const { page, problems } = await newPage(browser, 'desktop');
    page.on('dialog', (d) => d.dismiss());
    await openDesigner(page, server.base, '/design/canopy-tent/');
    await page.evaluate(async (payloads) => {
      const { setField } = await import('/assets/design/model/document.js');
      const { store, actions, env } = window.GSSDesigner;
      let doc = store.state.doc;
      ['name', 'line2', 'phone', 'web'].forEach((f, i) => { doc = setField(doc, f, payloads[i], env); });
      store.commit(doc);
      const side = store.state.doc.project.pieces[0].sides[0];
      side.elements.forEach((el, i) => actions.rename(el.id, payloads[i % payloads.length]));
    }, PAYLOADS);
    for (const tab of ['templates', 'text', 'logo', 'colors', 'options', 'sides', 'layers']) {
      await page.locator(`#dz-tab-${tab}`).click();
      await page.waitForTimeout(80);
    }
    // the words really are on the stage, as text
    const stageText = await page.locator('.dz-stage svg text').allTextContents();
    assert.ok(stageText.some((t) => t.includes('<img src=x') || t.includes('<script>') || t.includes('<svg onload')), 'the payload shows literally: ' + JSON.stringify(stageText));
    await page.getByRole('button', { name: 'Get my free proof' }).first().click();
    await page.getByRole('heading', { name: 'Check your design' }).waitFor();
    await nothingRan(page);
    await page.keyboard.press('Escape');
    // a shared link that carries the payloads
    const hash = await page.evaluate(async () => (await import('/assets/design/model/share.js')).encodeDoc(window.GSSDesigner.store.state.doc));
    await page.goto(`${server.base}/design/canopy-tent/#d=${hash}`);
    await page.reload();
    await page.waitForFunction(() => window.GSSDesigner && window.GSSDesigner.ready, null, { timeout: 20000 });
    await page.waitForTimeout(400);
    await nothingRan(page);
    assert.deepEqual(problems.filter((p) => !/swiftshader|GPU stall|GL Driver/i.test(p)), []);
    await page.context().close();
  } finally {
    await browser.close();
    server.stop();
  }
});
