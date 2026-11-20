// The proof bot's prompt is built from the catalog, so it must be rebuilt when the catalog or the brief format changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build, problems } from '../../scripts/proof-from-brief/prompt/build.mjs';
import { loadData } from '../../scripts/proof-from-brief/brief.mjs';

const saved = readFileSync(new URL('../../scripts/proof-from-brief/prompt/proof-bot-prompt.md', import.meta.url), 'utf8');

test('the saved proof bot prompt is what build.mjs makes today', () => {
  assert.equal(saved, build(), 'run: node scripts/proof-from-brief/prompt/build.mjs');
});

test('the prompt is plain ASCII and its example replies pass the brief checker', () => {
  assert.deepEqual(problems(saved), []);
});

test('the prompt names every product, template and font in the catalog, and the brief fields the tool reads', () => {
  const { catalog } = loadData();
  for (const p of catalog.products) assert.ok(saved.includes(`### ${p.id} (`), p.id);
  for (const id of catalog.products[0].templates) assert.ok(saved.includes(`"${id}"`), id);
  for (const f of catalog.fonts) assert.ok(saved.includes(`"${f.id}"`), f.id);
  for (const word of ['valance', 'has_name', 'extra_colors', 'sides_mode', 'not_included', 'mockup_prompt', 'TOOL REPORT']) assert.ok(saved.includes(word), word);
  assert.ok(!/supplier name|B2Sign|CFM/i.test(saved), 'no supplier names');
});
