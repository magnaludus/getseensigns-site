import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadEnv, root } from './helpers.mjs';
import { priceRow, piecePrice, projectTotal, productionText, money } from '../../../assets/design/model/pricing.js';
import { createDocument, setQty, setChoices } from '../../../assets/design/model/document.js';

const env = loadEnv();

// Ask seo_products.py (the only price source) for every offer string and price.
function sourcePrices() {
  const code = `
import json, sys
sys.path.insert(0, 'src')
from seo_products import BY
print(json.dumps({slug: [[p, t] for p, t in (v.get('offer_rows') or [])] for slug, v in BY.items()}))
`;
  const out = execFileSync('python3', ['-I', '-c', code], { cwd: fileURLToPath(root), encoding: 'utf8', env: { ...process.env, PYTHONPATH: fileURLToPath(new URL('src', root)) } });
  return JSON.parse(out);
}

function combos(groups) {
  let out = [{}];
  for (const g of groups) out = out.flatMap((o) => g.choices.map((c) => ({ ...o, [g.id]: c.id })));
  return out;
}

test('every option combination of every product is priced exactly as seo_products.py', () => {
  const source = sourcePrices();
  let count = 0;
  for (const product of env.catalog.products) {
    for (const choices of combos(product.groups)) {
      const row = priceRow(env.catalog, product.id, choices);
      assert.ok(row, `${product.id} ${JSON.stringify(choices)} has a price row`);
      const hits = source[row.source].filter(([, text]) => text === row.offer);
      assert.equal(hits.length, 1, `${product.id} ${row.offer} matches one offer string`);
      assert.equal(row.price, hits[0][0], `${product.id} ${row.offer} price`);
      count += 1;
    }
  }
  assert.equal(count, 3 + 6 + 10 + 4 + 4, 'all combinations were checked');
});

test('totals are price times quantity, whole dollars, free shipping', () => {
  let doc = createDocument(env, 'canopy');
  const one = projectTotal(env.catalog, doc);
  assert.equal(one.total, 649);
  assert.equal(one.shipping, 'free');
  doc = setQty(doc, 0, 3);
  assert.equal(projectTotal(env.catalog, doc).total, 649 * 3);
  doc = setChoices(doc, 0, { package: 'kit' }, env);
  assert.equal(projectTotal(env.catalog, doc).total, 1459 * 3);
  assert.equal(money(1459), '$1,459');
});

test('yard sign packs ignore quantity', () => {
  let doc = createDocument(env, 'yard');
  doc = setChoices(doc, 0, { pack: '25', print: '2' }, env);
  assert.equal(projectTotal(env.catalog, doc).total, 209);
  doc.project.pieces[0].qty = 7;
  assert.equal(piecePrice(env.catalog, doc.project.pieces[0]).total, 209);
});

test('production text comes from the product days', () => {
  const canopy = env.catalog.products.find((p) => p.id === 'canopy');
  const yard = env.catalog.products.find((p) => p.id === 'yard');
  assert.equal(productionText(canopy), '5 to 10 business days after you approve the proof');
  assert.equal(productionText(yard), '3 to 5 business days after you approve the proof');
});

test('an unknown choice has no price', () => {
  assert.equal(priceRow(env.catalog, 'banner', { size: '9x9' }), null);
});
