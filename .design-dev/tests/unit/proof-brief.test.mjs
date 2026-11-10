// The proof brief the bot writes, checked against the catalog (scripts/proof-from-brief/brief.mjs): what passes, what is
// normalized, and that each kind of mistake is named with its path so the bot can fix it. No browser: the brief checker
// is pure. The made-up customers here are not real businesses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkBrief, loadData, USES, CHECK_KEYS } from '../../scripts/proof-from-brief/brief.mjs';

const data = loadData();
const example = JSON.parse(readFileSync(new URL('../../scripts/proof-from-brief/examples/honeydrop-throw.json', import.meta.url), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

const palette = { primary: { name: 'Gold', hex: '#f6c445' }, accent: { name: 'Charcoal', hex: '#1F1A17' }, ink: { name: 'Charcoal', hex: '#1F1A17' } };
// a small valid brief with one piece; `piece` overrides the piece, `top` the brief
function brief(piece, top = {}) {
  return {
    customer: 'Test Customer', proof_no: 1, date: '2026-11-10', palette, fields: { name: 'TESTCO', line2: 'WORKS', phone: '', web: '' },
    logos: [], pieces: [piece], ...top,
  };
}
const throwPiece = (over = {}) => ({
  product: 'throw', options: { length: '6', style: '4' }, qty: 1, template: 'bold-center', sides_mode: 'each',
  panels: [{ side: 'Front', use: 'template' }, { side: 'Top', use: 'plain' }, { side: 'Left end', use: 'text', lines: ['TESTCO'] }, { side: 'Right end', use: 'text', lines: ['TESTCO'] }, { side: 'Back', use: 'text', lines: ['TESTCO'] }],
  ...over,
});
const paths = (res) => res.errors.map((e) => e.path);
const failsAt = (input, path, fragment) => {
  const res = checkBrief(input, data);
  assert.equal(res.ok, false, `${path} should fail`);
  const hit = res.errors.find((e) => e.path === path);
  assert.ok(hit, `an error at ${path}; got ${JSON.stringify(res.errors)}`);
  if (fragment) assert.match(hit.message, fragment);
  return res;
};

test('the example from the bot prompt passes, whole reply or bare brief, and is normalized', () => {
  for (const input of [example, example.brief]) {
    const res = checkBrief(clone(input), data);
    assert.deepEqual(res.errors, []);
    assert.equal(res.ok, true);
    const b = res.brief;
    assert.equal(b.customer, 'Honeydrop Apiary');
    assert.equal(b.palette.primary.hex, '#F6C445');
    assert.deepEqual(b.fields, { name: 'HONEYDROP', line2: 'APIARY', phone: '', web: '' });
    assert.deepEqual(b.logos.map((l) => [l.file, l.type]), [['honeydrop-logo.svg', 'image/svg+xml']]);
    const piece = b.pieces[0];
    assert.equal(piece.sides_mode, 'each');
    assert.deepEqual(piece.panels.map((p) => p.side), ['Front', 'Top', 'Left end', 'Right end', 'Back']);
    assert.equal(piece.panels[1].logo_file, 'honeydrop-logo.svg', 'the only logo goes where a logo is wanted');
  }
});

test('a reply that is not ready has nothing to render', () => {
  for (const status of ['need_info', 'escalate']) {
    const res = checkBrief({ status, summary: 'x', questions: [], flags: [], checks: {}, brief: null }, data);
    assert.equal(res.ok, false);
    assert.equal(res.notReady, true);
    assert.equal(res.status, status);
    assert.match(res.errors[0].message, /nothing to render/);
  }
  assert.equal(checkBrief(null, data).ok, false);
  assert.equal(checkBrief({ status: 'ready', brief: null }, data).ok, false);
  assert.equal(checkBrief([], data).ok, false);
});

test('the check keys the tool reports are the ones the bot prompt lists', () => {
  assert.deepEqual(CHECK_KEYS, ['safe_area', 'min_text_size', 'logo_sharpness', 'contrast']);
  assert.deepEqual(USES, ['template', 'text', 'logo', 'logo_and_text', 'plain', 'custom']);
});

test('who, which proof and colors', () => {
  failsAt(brief(throwPiece(), { customer: '  ' }), 'customer');
  failsAt(brief(throwPiece(), { customer: 'x'.repeat(121) }), 'customer');
  failsAt(brief(throwPiece(), { proof_no: 0 }), 'proof_no');
  failsAt(brief(throwPiece(), { proof_no: 1.5 }), 'proof_no');
  failsAt(brief(throwPiece(), { date: '10 Nov 2026' }), 'date');
  failsAt(brief(throwPiece(), { date: '2026-13-45' }), 'date');
  const ok = checkBrief(brief(throwPiece(), { proof_no: undefined, date: null }), data);
  assert.equal(ok.ok, true);
  assert.equal(ok.brief.proof_no, 1);
  assert.ok(ok.warnings.some((w) => w.path === 'proof_no'), 'a missing proof number is a warning');
  assert.equal(ok.brief.date, null);
  failsAt(brief(throwPiece(), { palette: { ...palette, accent: { name: 'x', hex: 'red' } } }), 'palette.accent.hex');
  failsAt(brief(throwPiece(), { palette: { primary: palette.primary, ink: palette.ink } }), 'palette.accent');
  failsAt(brief(throwPiece(), { palette: undefined }), 'palette');
  failsAt(brief(throwPiece(), { extra_colors: [{ name: 'Red', hex: '#12' }] }), 'extra_colors[0].hex');
  const res = checkBrief(brief(throwPiece(), { extra_colors: [{ name: 'Red', hex: '#bf341f' }] }), data);
  assert.deepEqual(res.brief.extra_colors, [{ name: 'Red', hex: '#BF341F' }]);
});

test('words: every field is text of a sensible length, and the font is one of the four', () => {
  failsAt(brief(throwPiece(), { fields: { name: 'x'.repeat(121), line2: '', phone: '', web: '' } }), 'fields.name');
  failsAt(brief(throwPiece(), { fields: { name: 5 } }), 'fields.name');
  failsAt(brief(throwPiece(), { fields: undefined }), 'fields');
  const filled = checkBrief(brief(throwPiece(), { fields: { name: 'ONLY NAME' } }), data);
  assert.deepEqual(filled.brief.fields, { name: 'ONLY NAME', line2: '', phone: '', web: '' }, 'a missing field is empty text');
  failsAt(brief(throwPiece(), { font: 'comic' }), 'font', /condensed, barlow, oswald, archivo/);
  assert.equal(checkBrief(brief(throwPiece(), { font: 'oswald' }), data).brief.font, 'oswald');
});

test('logo files are plain names of image files, listed once, at most four', () => {
  const logo = (file) => ({ file, vector: false });
  failsAt(brief(throwPiece(), { logos: [logo('../secret.svg')] }), 'logos[0].file');
  failsAt(brief(throwPiece(), { logos: [logo('a/b.svg')] }), 'logos[0].file');
  failsAt(brief(throwPiece(), { logos: [logo('C:\\x.png')] }), 'logos[0].file');
  failsAt(brief(throwPiece(), { logos: [logo('notes.pdf')] }), 'logos[0].file', /PNG, JPG, WebP or SVG/);
  failsAt(brief(throwPiece(), { logos: [logo('a.svg'), logo('A.SVG')] }), 'logos[1].file', /twice/);
  failsAt(brief(throwPiece(), { logos: ['a.svg', 'b.svg', 'c.svg', 'd.svg', 'e.svg'].map(logo) }), 'logos', /up to 4/);
  failsAt(brief(throwPiece(), { logos: 'a.svg' }), 'logos');
  const res = checkBrief(brief(throwPiece(), { logos: [{ file: 'Mark (1).JPG', vector: false }, { file: 'x.webp' }] }), data);
  assert.deepEqual(res.brief.logos.map((l) => [l.file, l.type, l.claimed_vector]), [['Mark (1).JPG', 'image/jpeg', false], ['x.webp', 'image/webp', null]]);
});

test('a piece needs a real product, every option, a quantity in range and one of the product\'s templates', () => {
  failsAt(brief(throwPiece({ product: 'sign' })), 'pieces[0].product', /canopy, feather, yard, throw/);
  failsAt(brief(throwPiece({ options: { length: '6' } })), 'pieces[0].options.style');
  failsAt(brief(throwPiece({ options: { length: '7', style: '4' } })), 'pieces[0].options.length', /6, 8/);
  failsAt(brief(throwPiece({ options: undefined })), 'pieces[0].options');
  failsAt(brief(throwPiece({ qty: 0 })), 'pieces[0].qty');
  failsAt(brief(throwPiece({ qty: 21 })), 'pieces[0].qty');
  failsAt(brief(throwPiece({ template: 'fancy' })), 'pieces[0].template', /bold-center, split-field, band-stripe, badge-star/);
  const extra = checkBrief(brief(throwPiece({ options: { length: '6', style: '4', color: 'gold' } })), data);
  assert.equal(extra.ok, true);
  assert.ok(extra.warnings.some((w) => w.path === 'pieces[0].options.color'), 'an option the product does not have is ignored with a warning');
  assert.equal(checkBrief(brief(throwPiece({ qty: 20 })), data).ok, true);
  assert.equal(checkBrief({ ...brief(throwPiece()), pieces: [] }, data).ok, false);
  assert.equal(checkBrief({ ...brief(throwPiece()), pieces: Array(7).fill(throwPiece()) }, data).ok, false, 'at most 6 pieces');
  assert.equal(checkBrief({ ...brief(throwPiece()), pieces: Array(6).fill(throwPiece()) }, data).ok, true);
});

test('a product with no quantity (the pack sets it) is always 1', () => {
  const yard = (over = {}) => ({ product: 'yard', options: { pack: '25', print: '1' }, template: 'split-field', sides_mode: 'same', panels: [{ side: 'Front', use: 'template' }], ...over });
  const res = checkBrief(brief(yard()), data);
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.brief.pieces[0].qty, 1);
  assert.equal(checkBrief(brief(yard({ qty: 1 })), data).ok, true);
  failsAt(brief(yard({ qty: 5 })), 'pieces[0].qty', /the pack sets the count/);
});

test('table throw panels: all of them, in order, and the template is for the front only', () => {
  const res = checkBrief(brief(throwPiece()), data);
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  // any order in, catalog order out; any capitals in, the catalog's spelling out
  const shuffled = throwPiece({ panels: throwPiece().panels.slice().reverse().map((p) => ({ ...p, side: p.side.toUpperCase() })) });
  const ok = checkBrief(brief(shuffled), data);
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.deepEqual(ok.brief.pieces[0].panels.map((p) => p.side), ['Front', 'Top', 'Left end', 'Right end', 'Back']);
  // a 3-sided throw has no back panel, a fitted cover is the front only
  const three = { options: { length: '6', style: '3' } };
  failsAt(brief(throwPiece(three)), 'pieces[0].panels[4].side', /Front, Top, Left end, Right end/);
  const threeOk = throwPiece({ ...three, panels: throwPiece().panels.slice(0, 4) });
  assert.equal(checkBrief(brief(threeOk), data).ok, true);
  const fitted = throwPiece({ options: { length: '8', style: 'fitted' }, panels: [{ side: 'Front', use: 'template' }] });
  assert.equal(checkBrief(brief(fitted), data).ok, true);
  failsAt(brief(throwPiece({ options: { length: '8', style: 'fitted' } })), 'pieces[0].panels[1].side', /Its sides are: Front\./);
  // missing, repeated, unknown
  failsAt(brief(throwPiece({ panels: throwPiece().panels.slice(0, 3) })), 'pieces[0].panels', /Missing: Right end, Back/);
  failsAt(brief(throwPiece({ panels: [...throwPiece().panels, { side: 'Top', use: 'plain' }] })), 'pieces[0].panels', /Top is listed more than once/);
  failsAt(brief(throwPiece({ panels: [{ side: 'Roof', use: 'plain' }] })), 'pieces[0].panels[0].side');
  // the template is the front's
  const bad = throwPiece();
  bad.panels[1] = { side: 'Top', use: 'template' };
  failsAt(brief(bad), 'pieces[0].panels[1].use', /Only the Front uses the template/);
  // a throw is always "each"
  failsAt(brief(throwPiece({ sides_mode: 'same' })), 'pieces[0].sides_mode', /always "each"/);
  assert.equal(checkBrief(brief(throwPiece({ sides_mode: undefined })), data).ok, false);
});

test('sides of other products: "same" is the first side only, "each" is every side, and a one-sided product is just its side', () => {
  const canopy = (over = {}) => ({ product: 'canopy', options: { package: 'valance' }, qty: 2, template: 'split-field', sides_mode: 'same', panels: [{ side: 'Front', use: 'template' }], ...over });
  assert.equal(checkBrief(brief(canopy()), data).ok, true);
  failsAt(brief(canopy({ panels: [{ side: 'Front', use: 'template' }, { side: 'Right', use: 'plain' }] })), 'pieces[0].panels', /should not be listed in "same" mode/);
  const each = canopy({ sides_mode: 'each', panels: ['Front', 'Right', 'Back', 'Left'].map((side, i) => (i ? { side, use: 'plain' } : { side, use: 'template' })) });
  assert.equal(checkBrief(brief(each), data).ok, true);
  failsAt(brief({ ...each, panels: each.panels.slice(0, 2) }), 'pieces[0].panels', /Missing: Back, Left/);
  failsAt(brief(canopy({ sides_mode: 'sometimes' })), 'pieces[0].sides_mode');
  // a template can sit on any side of a product that is not a throw
  const tpl = canopy({ sides_mode: 'each', panels: ['Front', 'Right', 'Back', 'Left'].map((side) => ({ side, use: 'template' })) });
  assert.equal(checkBrief(brief(tpl), data).ok, true);
  // one side: "each" means the same as "same"
  const flag = { product: 'feather', options: { height: '14', base: 'spike' }, qty: 1, template: 'badge-star', sides_mode: 'each', panels: [{ side: 'Flag', use: 'template' }] };
  const res = checkBrief(brief(flag), data);
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.brief.pieces[0].sides_mode, 'same');
  // sides that depend on the options: a two-sided yard sign and a pack of five safety signs
  const yard2 = { product: 'yard', options: { pack: '10', print: '2' }, template: 'bold-center', sides_mode: 'each', panels: [{ side: 'Front', use: 'template' }, { side: 'Back', use: 'plain' }] };
  assert.equal(checkBrief(brief(yard2), data).ok, true);
  const safety = (n) => ({ product: 'safety', options: { pack: n === 10 ? '12x18_10' : '12x18_5', orient: 'landscape' }, template: 'bold-center', sides_mode: 'each', panels: Array.from({ length: n }, (_, i) => ({ side: `Sign ${i + 1}`, use: i ? 'plain' : 'template' })) });
  assert.equal(checkBrief(brief(safety(5)), data).ok, true);
  assert.equal(checkBrief(brief(safety(10)), data).ok, true);
  failsAt(brief({ ...safety(5), panels: safety(10).panels }), 'pieces[0].panels[5].side', /Sign 6/);
});

test('what goes on a panel: words, a logo, both, nothing, or a layout for Scott', () => {
  const logos = [{ file: 'mark.svg', vector: true }];
  const withPanel = (panel, top = {}) => brief(throwPiece({ panels: throwPiece().panels.map((p) => (p.side === 'Top' ? { side: 'Top', ...panel } : p)) }), top);
  // words
  failsAt(withPanel({ use: 'text' }), 'pieces[0].panels[1].lines', /at least one line/);
  failsAt(withPanel({ use: 'text', lines: ['  '] }), 'pieces[0].panels[1].lines');
  failsAt(withPanel({ use: 'text', lines: ['a', 'b', 'c', 'd'] }), 'pieces[0].panels[1].lines', /At most 3/);
  failsAt(withPanel({ use: 'text', lines: ['x'.repeat(121)] }), 'pieces[0].panels[1].lines');
  failsAt(withPanel({ use: 'text', lines: [5] }), 'pieces[0].panels[1].lines');
  failsAt(withPanel({ use: 'plain', lines: ['hello'] }), 'pieces[0].panels[1].lines', /only for text and logo_and_text/);
  failsAt(withPanel({ use: 'logo', lines: ['hello'], logo_file: 'mark.svg' }, { logos }), 'pieces[0].panels[1].lines');
  assert.deepEqual(checkBrief(withPanel({ use: 'text', lines: ['  ONE ', '', 'TWO'] }), data).brief.pieces[0].panels[1].lines, ['ONE', 'TWO'], 'lines are trimmed and blanks dropped');
  // a logo needs a file, and the file has to be listed
  failsAt(withPanel({ use: 'logo' }), 'pieces[0].panels[1].use', /logos list is empty/);
  failsAt(withPanel({ use: 'logo_and_text', lines: ['x'] }), 'pieces[0].panels[1].use');
  failsAt(withPanel({ use: 'logo', logo_file: 'other.svg' }, { logos }), 'pieces[0].panels[1].logo_file', /not in the brief's logos list/);
  const two = [...logos, { file: 'second.png', vector: false }];
  failsAt(withPanel({ use: 'logo' }, { logos: two }), 'pieces[0].panels[1].logo_file', /more than one logo/);
  assert.equal(checkBrief(withPanel({ use: 'logo', logo_file: 'second.png' }, { logos: two }), data).brief.pieces[0].panels[1].logo_file, 'second.png');
  assert.equal(checkBrief(withPanel({ use: 'logo_and_text', lines: ['HI'] }, { logos }), data).ok, true);
  // use must be one of the six
  failsAt(withPanel({ use: 'banner' }), 'pieces[0].panels[1].use', /template, text, logo, logo_and_text, plain, custom/);
  failsAt(withPanel({}), 'pieces[0].panels[1].use');
  // custom is allowed, and asks for a note
  const custom = checkBrief(withPanel({ use: 'custom' }), data);
  assert.equal(custom.ok, true);
  assert.ok(custom.warnings.some((w) => w.path === 'pieces[0].panels[1].note'));
  assert.equal(checkBrief(withPanel({ use: 'custom', note: 'Logo bottom left, tagline right' }), data).warnings.length, 0);
  // a background is a palette slot or a hex code
  assert.equal(checkBrief(withPanel({ use: 'plain', bg: 'accent' }), data).brief.pieces[0].panels[1].bg, '@accent');
  assert.equal(checkBrief(withPanel({ use: 'plain', bg: '#abcdef' }), data).brief.pieces[0].panels[1].bg, '#ABCDEF');
  failsAt(withPanel({ use: 'plain', bg: 'blue' }), 'pieces[0].panels[1].bg');
});

test('every mistake in one brief is reported at once, so the bot fixes them in one go', () => {
  const res = checkBrief({ status: 'ready', brief: { customer: '', palette: { primary: { hex: 'red' } }, fields: { name: 'x' }, pieces: [{ product: 'sign', options: {}, panels: [] }, throwPiece({ qty: 99, template: 'nope' })] } }, data);
  assert.equal(res.ok, false);
  const where = paths(res);
  for (const p of ['customer', 'palette.primary.hex', 'palette.accent', 'palette.ink', 'pieces[0].product', 'pieces[1].qty', 'pieces[1].template']) assert.ok(where.includes(p), `${p} in ${where}`);
  assert.ok(res.errors.every((e) => typeof e.message === 'string' && e.message.length > 10), 'every error says what to do');
  assert.equal(res.brief, undefined, 'no brief when it is not ok');
});

test('the checker reads only the Designer\'s own data, so a new product or option needs no change here', () => {
  // every product in the catalog can have a brief written for it with the first choice of every option
  for (const product of data.catalog.products) {
    const options = Object.fromEntries(product.groups.map((g) => [g.id, g.choices[0].id]));
    const names = product.sides.mode === 'by_choice' ? product.sides.names[options[product.sides.group]] : product.sides.names;
    const panelled = !!product.sides.panels;
    const piece = { product: product.id, options, qty: 1, template: product.templates[0], sides_mode: panelled ? 'each' : 'same', panels: [{ side: names[0], use: 'template' }] };
    if (panelled) piece.panels = names.map((side, i) => (i ? { side, use: 'plain' } : { side, use: 'template' }));
    const res = checkBrief(brief(piece), data);
    assert.equal(res.ok, true, `${product.id}: ${JSON.stringify(res.errors)}`);
  }
});
