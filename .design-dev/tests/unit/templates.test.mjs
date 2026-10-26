import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv } from './helpers.mjs';
import { createDocument, setChoices, productOf } from '../../../assets/design/model/document.js';
import { specFor } from '../../../assets/design/model/specs.js';
import { buildTemplateSide } from '../../../assets/design/model/templates.js';
import { layoutText, capHeight } from '../../../assets/design/model/layout.js';
import { aabb } from '../../../assets/design/model/geometry.js';

const env = loadEnv();

function variantChoices(product) {
  let out = [{}];
  for (const g of product.groups) out = out.flatMap((o) => g.choices.map((c) => ({ ...o, [g.id]: c.id })));
  return out;
}

test('every template builds on every option of every product, inside the art and the safe area', () => {
  let built = 0;
  const problems = [];
  for (const product of env.catalog.products) {
    const seen = new Set();
    for (const choices of variantChoices(product)) {
      const spec = specFor(env.specs, product.id, choices);
      if (seen.has(spec.variant)) continue;
      seen.add(spec.variant);
      for (const tpl of env.templates[product.id]) {
        const side = buildTemplateSide(tpl, spec, tpl.sample, env);
        built += 1;
        for (const el of side.elements) {
          const label = `${product.id}/${spec.variant}/${tpl.id}/${el.name}`;
          if (el.type === 'text') {
            const lay = layoutText(el, env.measure, env.fonts);
            if (lay.widest > el.w + 1e-6) problems.push(label + ' text wider than its box');
            if (lay.lines.length > (el.fit ? el.fit.lines : 99)) problems.push(label + ' too many lines');
          }
          const box = el.type === 'text' ? { x: el.x, y: el.y, w: el.w, h: layoutText(el, env.measure, env.fonts).blockH, rot: el.rot } : el;
          const b = aabb({ x: box.x, y: box.y, w: box.w, h: box.h, rot: box.rot || 0 });
          const a = spec.art;
          const slack = 0.5;
          if (b.x < a.x - slack || b.y < a.y - slack || b.x + b.w > a.x + a.w + slack || b.y + b.h > a.y + a.h + slack) problems.push(label + ' leaves the artboard');
        }
      }
    }
  }
  assert.deepEqual(problems, []);
  assert.ok(built >= 20);
});

test('headline text meets the readability minimum at every size', () => {
  const problems = [];
  for (const product of env.catalog.products) {
    const seen = new Set();
    for (const choices of variantChoices(product)) {
      const spec = specFor(env.specs, product.id, choices);
      if (seen.has(spec.variant)) continue;
      seen.add(spec.variant);
      for (const tpl of env.templates[product.id]) {
        const side = buildTemplateSide(tpl, spec, tpl.sample, env);
        const name = side.elements.find((e) => e.type === 'text' && e.bind === 'name' && e.name === 'Name');
        if (!name) continue;
        const cap = capHeight(name, env.fonts);
        if (cap + 1e-6 < spec.minCapIn) problems.push(`${product.id}/${spec.variant}/${tpl.id}: cap ${cap.toFixed(2)} < ${spec.minCapIn}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('sample content is fictional: 555-01xx numbers and .example sites', () => {
  for (const list of Object.values(env.templates)) {
    for (const tpl of list) {
      assert.match(tpl.sample.phone, /^\d{3}-555-01\d\d$/, tpl.id);
      assert.match(tpl.sample.web, /\.example$/, tpl.id);
    }
  }
});

test('a long business name still fits the headline box', () => {
  const doc = createDocument(env, 'feather');
  const spec = specFor(env.specs, 'feather', doc.project.pieces[0].choices);
  const tpl = env.templates.feather[0];
  const side = buildTemplateSide(tpl, spec, { ...tpl.sample, name: 'THE GREATER LEE COUNTY HARDWARE AND SUPPLY COMPANY' }, env);
  const name = side.elements.find((e) => e.bind === 'name');
  const lay = layoutText(name, env.measure, env.fonts);
  assert.ok(lay.widest <= name.w + 1e-6);
  assert.ok(lay.lines.length <= name.fit.lines);
});
