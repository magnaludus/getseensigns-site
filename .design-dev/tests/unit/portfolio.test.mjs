// /portfolio/: original customer photos, neutral captions, nothing else claimed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const page = read('portfolio/index.html');
const main = /<main id="main">([\s\S]*?)<\/main>/.exec(page)[1];

test('portfolio page shows the black event tent with the neutral caption', () => {
  assert.match(main, /<figcaption[^>]*>Custom Printed Event Tent, Black<\/figcaption>/);
  assert.match(main, /<img src="\/assets\/portfolio\/event-tent-black-outdoor\.jpg" alt="[^"]+" width="1200" height="1600" loading="lazy"/);
  for (const w of [480, 768, 1200]) {
    const f = `assets/portfolio/event-tent-black-outdoor-${w}.webp`;
    assert.ok(fs.existsSync(path.join(ROOT, f)), f);
    assert.ok(main.includes(`/${f} ${w}w`), `srcset ${w}w`);
  }
});

test('portfolio also shows the navy and red tent and the second black tent photo, and the home page band links to it', () => {
  for (const [base, caption] of [['event-tent-navy-red', 'Custom Printed Event Tent, Navy and Red'], ['event-tent-black-indoor', 'Custom Printed Event Tent, Roof and Valance']]) {
    assert.ok(main.includes(`>${caption}</figcaption>`), caption);
    assert.ok(main.includes(`<img src="/assets/portfolio/${base}.jpg"`), base);
    for (const w of [480, 768]) assert.ok(fs.existsSync(path.join(ROOT, `assets/portfolio/${base}-${w}.webp`)), `${base}-${w}.webp`);
    assert.ok(!main.includes(`${base}-1200.webp`), 'a 768 px photo is never enlarged');
  }
  assert.equal((main.match(/<figure/g) || []).length, 3);
  const home = read('index.html');
  const band = /<section class="work"[\s\S]*?<\/section>/.exec(home)[0];
  assert.equal((band.match(/<img /g) || []).length, 3);
  assert.ok(band.includes('href="/portfolio/"'));
  assert.ok(!/review|testimonial|"[^"<>]*"<\/p>/i.test(band.replace(/<[^>]+>/g, ' ')), 'no quotes or review claims in the band');
});

test('portfolio fallback JPG is the untouched original (1200x1600 JPEG, no re-encode)', () => {
  const jpg = fs.readFileSync(path.join(ROOT, 'assets/portfolio/event-tent-black-outdoor.jpg'));
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
