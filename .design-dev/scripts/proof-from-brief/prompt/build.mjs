// Builds the proof bot's system prompt (proof-bot-prompt.md) from template.md and the Designer's own data, so every
// product, option, side, size, template and palette in the prompt is read from the catalog and never retyped by hand.
//   node .design-dev/scripts/proof-from-brief/prompt/build.mjs          writes proof-bot-prompt.md
//   node .design-dev/scripts/proof-from-brief/prompt/build.mjs --check  exits 1 if the file is out of date
import { readFileSync, writeFileSync } from 'node:fs';
import { sideNamesFor } from '../../../../assets/design/model/document.js';
import { specForSide } from '../../../../assets/design/model/specs.js';
import { loadData, checkBrief, MAX_LOGOS, MAX_PIECES, MAX_LINES } from '../brief.mjs';

const HERE = new URL('./', import.meta.url);
const n = (x) => String(+Number(x).toFixed(2));
const plain = (s) => String(s).replace(/×/g, 'x').replace(/[–—]/g, '-');

function combos(product) {
  const out = [];
  const rec = (i, o) => {
    if (i === product.groups.length) return out.push(o);
    for (const c of product.groups[i].choices) rec(i + 1, { ...o, [product.groups[i].id]: c.id });
  };
  rec(0, {});
  return out;
}

export function productsBlock({ catalog, specs }) {
  const lines = [];
  for (const p of catalog.products) {
    lines.push(`### ${p.id} (${plain(p.name)})`);
    for (const g of p.groups) lines.push(`- option "${g.id}": ${g.choices.map((c) => `"${c.id}" (${plain(c.label || c.name)})`).join(', ')}`);
    lines.push(p.qty ? `- qty: 1 to ${p.qty.max}` : '- qty: always 1 (the pack sets the count)');
    // sides and sizes: one line per group of option choices that share the same sides and sizes
    const seen = new Map();
    let dpi = null;
    let cap = null;
    for (const o of combos(p)) {
      const names = sideNamesFor(p, o);
      const sizes = names.map((_, si) => {
        const s = specForSide(specs, p.id, o, si);
        dpi = s.dpi;
        cap = s.minCapIn;
        return `${n(s.artboard.w)} x ${n(s.artboard.h)} in, safe ${n(s.safe.w)} x ${n(s.safe.h)}`;
      });
      // collapse sides that are all the same size ("Sign 1 to Sign 5")
      const same = sizes.every((z) => z === sizes[0]);
      const text = same && names.length > 1 ? `${names[0]} to ${names[names.length - 1]} (${names.length} sides), each ${sizes[0]}` : names.map((nm, i) => `${nm} ${sizes[i]}`).join('; ');
      if (!seen.has(text)) seen.set(text, []);
      seen.get(text).push(o);
    }
    for (const [text, list] of seen) {
      // say which options give these sides: only the groups whose choice matters
      const keys = p.groups.filter((g) => new Set(list.map((o) => o[g.id])).size < g.choices.length).map((g) => g.id);
      const when = keys.length ? [...new Set(list.map((o) => keys.map((k) => `${k} ${o[k]}`).join(', ')))].join(' or ') : 'every option';
      lines.push(`- sides (${when}): ${text}`);
    }
    lines.push(`- smallest letter height: ${n(cap)} in (read from about ${n(cap * specs.read_rule.ft_per_cap_inch)} ft). Logo dpi: green ${dpi.greenMin}+, amber ${dpi.amberMin}+.`);
    lines.push('');
  }
  return lines.join('\n').trim();
}

export function templatesBlock({ catalog, templates }) {
  const lines = [];
  for (const p of catalog.products) {
    lines.push(`### ${p.id}`);
    for (const t of templates[p.id]) {
      const fields = [...new Set(t.elements.filter((e) => e.type === 'text' && e.bind).map((e) => e.bind))];
      const fixed = [...new Set(t.elements.filter((e) => e.type === 'text' && e.text).map((e) => e.text))];
      const logo = t.elements.some((e) => e.type === 'image');
      lines.push(`- "${t.id}" (${plain(t.name)}): prints ${fields.join(', ') || 'no fields'}${fixed.length ? `, plus the fixed word ${fixed.map((w) => `"${w}"`).join(', ')}` : ''}. ${logo ? 'Has a logo slot.' : 'No logo slot.'}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

export function build() {
  const data = loadData();
  let text = readFileSync(new URL('template.md', HERE), 'utf8');
  const blocks = {
    PRODUCTS: productsBlock(data),
    TEMPLATES: templatesBlock(data),
    PALETTES: data.catalog.palettes.map((p) => `- ${plain(p.name)}: primary ${p.primary}, accent ${p.accent}, ink ${p.ink}`).join('\n'),
    FONTS: data.catalog.fonts.map((f) => `"${f.id}" (${f.label})`).join(', '),
    PRODUCT_NAMES: data.catalog.products.map((p) => plain(p.name).toLowerCase()).join(', '),
    MAX_LOGOS, MAX_PIECES, MAX_LINES,
  };
  for (const [k, v] of Object.entries(blocks)) text = text.split(`{{${k}}}`).join(String(v));
  const left = text.match(/\{\{[A-Z_]+\}\}/);
  if (left) throw new Error(`template.md has an unknown placeholder ${left[0]}`);
  return text;
}

// What a built prompt must pass: plain characters only, and every JSON example parses and (when ready) passes the brief checker.
export function problems(text) {
  const out = [];
  const odd = text.match(/[^\x09\x0A\x20-\x7E]/g);
  if (odd) out.push(`characters outside plain ASCII: ${[...new Set(odd)].join(' ')}`);
  const data = loadData();
  const blocks = [...text.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
  if (blocks.length < 2) out.push('expected at least two JSON examples');
  blocks.forEach((b, i) => {
    let j;
    try { j = JSON.parse(b); } catch (e) { return out.push(`JSON example ${i + 1} does not parse: ${e.message}`); }
    if (j.status === 'ready') {
      const res = checkBrief(j, data);
      if (!res.ok) out.push(`JSON example ${i + 1} fails the brief checker: ${res.errors.map((e) => `${e.path}: ${e.message}`).join(' | ')}`);
      else if (res.warnings.length) out.push(`JSON example ${i + 1} has warnings: ${res.warnings.map((e) => e.path).join(', ')}`);
    }
  });
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const text = build();
  const bad = problems(text);
  if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
  const file = new URL('proof-bot-prompt.md', HERE);
  if (process.argv.includes('--check')) {
    let now = '';
    try { now = readFileSync(file, 'utf8'); } catch {}
    if (now !== text) { console.error('proof-bot-prompt.md is out of date. Run build.mjs.'); process.exit(1); }
    console.log('proof-bot-prompt.md is up to date');
  } else {
    writeFileSync(file, text);
    console.log(`wrote proof-bot-prompt.md, ${text.split(/\s+/).length} words`);
  }
}
