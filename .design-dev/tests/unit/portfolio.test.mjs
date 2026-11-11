// /portfolio/: one original customer photo, a neutral caption, nothing else claimed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const page = read('portfolio/index.html');
const main = /<main id="main">([\s\S]*?)<\/main>/.exec(page)[1];

test('portfolio page shows the Rhytec Industries tent with the neutral caption', () => {
  assert.match(main, /<figcaption[^>]*>Rhytec Industries — Custom Printed Event Tent<\/figcaption>/);
  assert.match(main, /<img src="\/assets\/portfolio\/rhytec-industries-event-tent\.jpg" alt="[^"]+" width="1200" height="1600" loading="lazy"/);
  for (const w of [480, 768, 1200]) {
    const f = `assets/portfolio/rhytec-industries-event-tent-${w}.webp`;
    assert.ok(fs.existsSync(path.join(ROOT, f)), f);
    assert.ok(main.includes(`/${f} ${w}w`), `srcset ${w}w`);
  }
});

test('portfolio fallback JPG is the untouched original (1200x1600 JPEG, no re-encode)', () => {
  const jpg = fs.readFileSync(path.join(ROOT, 'assets/portfolio/rhytec-industries-event-tent.jpg'));
  assert.deepEqual([...jpg.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  assert.equal(jpg.length, 996565);
});

test('portfolio page makes no quality, premium or testimonial claims', () => {
  const text = main.replace(/<[^>]+>/g, ' ').toLowerCase();
  for (const word of ['premium', 'best', 'quality', 'testimonial', 'review', 'satisf', 'choppy', 'cheap', 'feedback', '"']) {
    assert.ok(!text.includes(word), `page text must not contain ${word}`);
  }
});

test('portfolio is in the sitemap and the page has its canonical tag', () => {
  assert.match(read('sitemap.xml'), /<loc>https:\/\/getseensignsco\.com\/portfolio\/<\/loc>/);
  assert.match(page, /<link rel="canonical" href="https:\/\/getseensignsco\.com\/portfolio\/">/);
});
