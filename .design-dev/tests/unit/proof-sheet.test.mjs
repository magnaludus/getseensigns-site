// The proof sheet's words and layout (scripts/proof-from-brief/sheet.mjs): the fixed lines of the reference proofs, the date
// the way they write it, the colors table, the line of sizes, and that nothing a customer or a bot writes can change the
// page. Pure: no browser. The made-up customers here are not real businesses.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDate, esc, colorRows, captionLines, buildSheetHtml, revisionLine,
  FOOTER_NOTE, MOCKUP_CAPTION, MOCKUP_HEADING, MOCKUP_MISSING, FLAT_NOTE, DRAPE_NOTE, STRIP_NOTE, SEAM_NOTE,
} from '../../scripts/proof-from-brief/sheet.mjs';
import { FLAT_NOTE as DESIGNER_FLAT_NOTE } from '../../../assets/design/model/throw-panels.js';

const base = (over = {}) => ({
  customer: 'Honeydrop Apiary', proofNo: 1, date: '2026-11-10', title: '6 ft 4-sided table throw', qty: 1, description: 'Gold table throw with the logo on top.',
  figures: [{ svg: '<svg viewBox="0 0 10 10"></svg>', x: 0.2, y: 0.3, w: 9, h: 6, label: null }], caption: ['About 72 x 28 in | To scale'],
  colors: [{ hex: '#F6C445', name: 'Honey gold', where: ['background'] }], notes: ['Logo is the customer\'s file, not redrawn.'], mockup: null, ...over,
});

test('the fixed lines are the reference proofs\' words, letter for letter', () => {
  assert.equal(FOOTER_NOTE, 'Colors on screen may vary slightly from print. Please review spelling and layout.');
  assert.equal(MOCKUP_CAPTION, 'Mockup for feel only. The flat art is what prints.');
  assert.equal(MOCKUP_HEADING, 'How it looks set up');
  assert.equal(revisionLine(1), 'Proof 1 of up to 3 free revisions. Reply "Approved" or send any changes.');
  assert.equal(revisionLine(3), 'Proof 3 of up to 3 free revisions. Reply "Approved" or send any changes.');
  assert.equal(FLAT_NOTE, DESIGNER_FLAT_NOTE, 'the throw note is the Designer\'s own words');
  assert.equal(SEAM_NOTE, 'Dashed line = roof/valance seam (proof only, does not print).');
});

test('dates are written like the reference proofs: Oct 28, 2026', () => {
  assert.equal(formatDate('2026-10-28'), 'Oct 28, 2026');
  assert.equal(formatDate('2026-11-05'), 'Nov 5, 2026');
  assert.equal(formatDate('2027-01-01'), 'Jan 1, 2027');
  for (const bad of [null, undefined, '', 'Nov 10', '2026-13-01', '2026-1-1', 20261110]) assert.equal(formatDate(bad), '', String(bad));
});

test('escaping covers every character that can change HTML', () => {
  assert.equal(esc('<img src=x onerror="a()"> & \'q\''), '&lt;img src=x onerror=&quot;a()&quot;&gt; &amp; &#39;q&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(5), '5');
});

test('every printed color is listed once, named from the brief, with where it is used', () => {
  const palette = { primary: { name: 'Honey gold', hex: '#F6C445' }, accent: { name: 'Charcoal', hex: '#1F1A17' }, ink: { name: 'Charcoal', hex: '#1F1A17' } };
  const used = [{ hex: '#F6C445', where: ['background'] }, { hex: '#1F1A17', where: ['text', 'bars and blocks'] }, { hex: '#f6c445', where: ['bars and blocks'] }, { hex: '#ABCDEF', where: ['text'] }];
  const rows = colorRows(used, palette, [{ name: 'Sky', hex: '#6ec1e4' }, { name: 'Charcoal', hex: '#1F1A17' }]);
  assert.deepEqual(rows.map((r) => r.hex), ['#F6C445', '#1F1A17', '#ABCDEF', '#6EC1E4']);
  assert.deepEqual(rows[0], { hex: '#F6C445', name: 'Honey gold', where: ['background', 'bars and blocks'] }, 'one row for a color used twice, in the reference order');
  assert.deepEqual(rows[1].where, ['bars and blocks', 'text', 'logo'], 'a logo color that is also printed elsewhere says so too');
  assert.equal(rows[2].name, 'Color', 'a color the brief does not name has no invented name');
  assert.deepEqual(rows[3], { hex: '#6EC1E4', name: 'Sky', where: ['logo'] });
  assert.deepEqual(colorRows([], palette, []), []);
  assert.deepEqual(colorRows(undefined, undefined, undefined), []);
});

test('the line of sizes under the art', () => {
  const panels = [{ name: 'Front', w: 72.66, h: 27.65 }, { name: 'Left end', w: 28.51, h: 26.95 }];
  assert.deepEqual(captionLines({ panels, flat: { w: 127.51, h: 85.01 } }), [
    'Panels as they read on the table: Front 72.66 x 27.65 in | Left end 28.51 x 26.95 in',
    'Flat page 127.51 x 85.01 in | To scale',
  ]);
  assert.deepEqual(captionLines({ size: { w: 24, h: 18 }, sides: 1, logos: [], words: [] }), ['About 24 x 18 in | To scale']);
  assert.deepEqual(captionLines({ size: { w: 119, h: 84.28 }, sides: 4, same: true, valance_in: 13.04, logos: [{ in_w: 60.2 }], words: [{ text: 'RHYTEC', in_w: 52.4 }], closeups: true }), [
    'About 119 x 84.28 in per side | Valance 13.04 in tall | Logo about 60 in wide | RHYTEC about 52 in wide | Close-ups not to scale',
  ]);
  assert.match(captionLines({ size: { w: 18, h: 12 }, sides: 5, same: false, logos: [{ in_w: 1.44 }], words: [] })[0], /^About 18 x 12 in each \| Logo about 1\.4 in wide \| To scale$/);
  assert.match(captionLines({ size: { w: 24, h: 18 }, sides: 1, logos: [], words: [{ text: 'A VERY LONG BUSINESS NAME THAT GOES ON', in_w: 22 }] })[0], /A VERY LONG BUSINESS NAME T… about 22 in wide/);
});

test('the page has the reference proof\'s parts, in its words, with this proof\'s numbers', () => {
  const html = buildSheetHtml(base({ proofNo: 2, mockup: null }));
  for (const text of [
    'Get Seen Signs - Proof for Honeydrop Apiary', '6 ft 4-sided table throw | Proof 2 | Nov 10, 2026', 'GET SEEN SIGNS', '6 ft 4-sided table throw (Qty 1)',
    'Gold table throw with the logo on top.', 'How it looks set up', 'Mockup for feel only. The flat art is what prints.', 'COLORS', 'NOTES',
    'Colors on screen may vary slightly from print. Please review spelling and layout.', 'Proof 2 of up to 3 free revisions. Reply &quot;Approved&quot; or send any changes.',
    'Honey gold (background) <b>#F6C445</b>', 'About 72 x 28 in | To scale', 'Logo is the customer&#39;s file, not redrawn.',
  ]) assert.ok(html.includes(text), text);
  assert.match(html, /@page\{size:17in 11in;margin:0\}/);
  assert.ok(html.includes(`<div class="ph">${MOCKUP_MISSING}</div>`), 'no photo, a plainly marked empty box');
  assert.ok(html.includes('<svg viewBox="0 0 10 10"></svg>'), 'the art goes in as it is');
  assert.match(html, /class="fig" style="left:0\.2in;top:0\.3in;width:9in;height:6in"/);
  assert.equal(buildSheetHtml(base({ date: null })).includes('Proof 1 | Nov'), false);
  assert.ok(buildSheetHtml(base({ date: null })).includes('>6 ft 4-sided table throw | Proof 1</div>'), 'no date, no dangling bar');
});

test('a mockup photo goes in the box, and a figure label goes under or over its figure', () => {
  const html = buildSheetHtml(base({
    mockup: { dataUrl: 'data:image/png;base64,AAAA' },
    figures: [
      { svg: '<svg></svg>', x: 1, y: 1, w: 4, h: 2, label: 'FRONT' },
      { svg: '<svg></svg>', x: 1, y: 5, w: 4, h: 1, label: 'VALANCE close-up (all 4 sides)', labelAbove: true },
    ],
  }));
  assert.ok(html.includes('<img alt="Mockup" src="data:image/png;base64,AAAA">'));
  assert.equal(html.includes(MOCKUP_MISSING + '</div>'), false);
  assert.match(html, /class="figlabel" style="left:1in;width:4in;top:3\.02in">FRONT</);
  assert.match(html, /class="figlabel" style="left:1in;width:4in;top:4\.72in">VALANCE close-up \(all 4 sides\)</);
});

test('more than five colors go in two columns, and every note is a list item', () => {
  const six = Array.from({ length: 6 }, (_, i) => ({ hex: '#00000' + i, name: 'C' + i, where: [] }));
  const html = buildSheetHtml(base({ colors: six, notes: ['one', 'two', 'three'] }));
  assert.ok(html.includes('class="colors two"'));
  assert.equal(buildSheetHtml(base()).includes('class="colors two"'), false);
  assert.equal((html.match(/<li>/g) || []).length, 3);
  assert.ok(html.includes('<span class="sw" style="background:#000000"></span>'));
});

test('nothing a customer or a bot writes can change the page', () => {
  const evil = '<script>alert(1)</script><img src=x onerror=alert(2)> "quoted" \'single\' &amp;';
  const html = buildSheetHtml(base({
    customer: evil, title: evil, description: evil, caption: [evil], notes: [evil],
    colors: [{ hex: '#F6C445', name: evil, where: [evil] }], figures: [{ svg: '<svg></svg>', x: 0, y: 0, w: 1, h: 1, label: evil }],
  }));
  // the only script is the page's own fitting script, and no tag came from the text
  assert.equal((html.match(/<script>/g) || []).length, 1);
  assert.equal(html.includes('<img src=x'), false);
  assert.equal(html.includes('alert(1)</script>'), false);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('&amp;amp;'), 'an ampersand in the text stays text');
  // a hex that is not a color cannot break out of the style attribute
  const odd = buildSheetHtml(base({ colors: [{ hex: '#000"><script>x</script>', name: 'n', where: [] }] }));
  assert.equal((odd.match(/<script>/g) || []).length, 1);
  // and the page reaches nothing outside the site: its fonts are the only links
  const links = [...html.matchAll(/url\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(links.length >= 7 && links.every((u) => u.startsWith('/assets/fonts/')), links.join(' '));
  assert.equal(/https?:\/\//.test(html), false, 'no web address anywhere');
});

test('the notes the tool adds for the drawing are in the reference words', () => {
  assert.equal(DRAPE_NOTE, 'Hatched corners wrap the table corners and carry no art.');
  assert.equal(STRIP_NOTE, 'The short back strip is plain: a 3-sided throw is open at the back.');
});
