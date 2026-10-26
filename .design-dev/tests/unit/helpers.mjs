// Shared setup for the unit tests: the built JSON files plus a text measurer that uses the real
// advance widths of the designer fonts (no kerning), so size checks are close to the browser.
import { readFileSync } from 'node:fs';
import { setIdSeed } from '../../../assets/design/model/ids.js';

const root = new URL('../../../', import.meta.url);
const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, root), 'utf8'));
const advances = JSON.parse(readFileSync(new URL('./fixtures/font-advances.json', import.meta.url), 'utf8'));

export function makeMeasure() {
  const measure = (fontId, text) => {
    const f = advances[fontId];
    let w = 0;
    for (const ch of text) w += f.adv[ch] == null ? f.fallback : f.adv[ch];
    return w;
  };
  measure.version = 0;
  return measure;
}

export function loadEnv() {
  setIdSeed(1000);
  const catalog = readJson('assets/design/catalog.json');
  return {
    catalog,
    specs: readJson('assets/design/print-specs.json'),
    templates: readJson('assets/design/templates.json'),
    fonts: catalog.fonts,
    measure: makeMeasure(),
  };
}

export { root, readJson };
