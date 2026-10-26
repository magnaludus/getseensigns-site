// Every option combination of every product shows the catalog price in the page (and the catalog
// is built from seo_products.py, which the unit test cross-checks).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startServer, launch, newPage, openDesigner, root } from './helpers.mjs';

const catalog = JSON.parse(readFileSync(root + 'assets/design/catalog.json', 'utf8'));

function combos(groups) {
  let out = [{}];
  for (const g of groups) out = out.flatMap((o) => g.choices.map((c) => ({ ...o, [g.id]: c })));
  return out;
}

test('prices in the page match the catalog for every option', async () => {
  const server = await startServer();
  const browser = await launch();
  try {
    let checked = 0;
    for (const product of catalog.products) {
      const { page, problems } = await newPage(browser, 'desktop');
      await openDesigner(page, server.base, `/design/${product.slug}/`);
      await page.locator('#dz-tab-options').click();
      for (const combo of combos(product.groups)) {
        for (const g of product.groups) {
          await page.locator('.dz-fieldset', { has: page.locator('legend', { hasText: g.label }) }).getByRole('button', { name: combo[g.id].label, exact: true }).click();
        }
        const row = product.prices.find((r) => product.groups.every((g) => r.when[g.id] === combo[g.id].id));
        await page.waitForFunction((want) => (document.querySelector('.dz-price') || {}).textContent.startsWith(want), '$' + row.price.toLocaleString('en-US'));
        const shown = await page.locator('.dz-aside .dz-total b').innerText();
        assert.equal(shown, '$' + row.price.toLocaleString('en-US'), `${product.id} ${JSON.stringify(combo)}`);
        checked += 1;
      }
      assert.deepEqual(problems, [], product.id + ' console problems');
      await page.context().close();
    }
    assert.equal(checked, 27);
  } finally {
    await browser.close();
    server.stop();
  }
});
