// The proof brief the bot writes (see the bot prompt), checked against the catalog. A bad brief fails here with exact
// paths and plain messages, so the bot can fix it, instead of turning into a wrong proof. Pure: no browser, no
// network, no clock, so the unit tests run it directly.
import { readFileSync } from 'node:fs';
import { sideNamesFor, hasPanels } from '../../../assets/design/model/document.js';

const ROOT = new URL('../../../', import.meta.url);

export const USES = ['template', 'text', 'logo', 'logo_and_text', 'plain', 'custom'];
export const LOGO_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' };
export const MAX_LOGOS = 4; // the Designer's own limit (assets/design/ui/logos.js)
export const MAX_PIECES = 6; // the document's own limit (model/document.js)
export const MAX_LINES = 3;
export const CHECK_KEYS = ['safe_area', 'min_text_size', 'logo_sharpness', 'contrast'];

const FIELD_KEYS = ['name', 'line2', 'phone', 'web'];
const ROLES = ['primary', 'accent', 'ink'];
const HEX = /^#[0-9a-f]{6}$/i;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,100}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// The data files the Designer itself loads (generated from src/ by src/site-src-pages.py).
export function loadData(root = ROOT) {
  const read = (name) => JSON.parse(readFileSync(new URL(`assets/design/${name}.json`, root), 'utf8'));
  return { catalog: read('catalog'), specs: read('print-specs'), templates: read('templates') };
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : null);

export function logoTypeOf(file) {
  const ext = String(file).split('.').pop().toLowerCase();
  return LOGO_TYPES[ext] || null;
}

// input: the bot's whole reply ({status:'ready', brief:{...}}) or just the brief.
// Returns {ok, errors:[{path, message}], warnings:[{path, message}], brief} where `brief` is normalized (defaults filled,
// hex codes in capitals, side names spelled as the catalog spells them) and only present when ok.
export function checkBrief(input, data) {
  const errors = [];
  const warnings = [];
  const err = (path, message) => errors.push({ path, message });
  const warn = (path, message) => warnings.push({ path, message });
  const { catalog } = data;

  let raw = input;
  if (isObj(raw) && 'status' in raw) {
    if (raw.status !== 'ready') {
      return { ok: false, notReady: true, status: raw.status, errors: [{ path: 'status', message: `The reply status is "${raw.status}", so there is nothing to render. Only a "ready" reply has a brief.` }], warnings };
    }
    raw = raw.brief;
  }
  if (!isObj(raw)) return { ok: false, errors: [{ path: 'brief', message: 'The brief is missing or is not an object.' }], warnings };

  const out = {};

  // ---- who and which proof ----
  const customer = str(raw.customer);
  if (!customer || !customer.trim()) err('customer', 'A customer name is needed for the proof header.');
  else if (customer.length > 120) err('customer', 'The customer name is over 120 characters.');
  out.customer = customer ? customer.trim() : '';
  if (raw.proof_no == null) {
    out.proof_no = 1;
    warn('proof_no', 'No proof number given, so this is proof 1.');
  } else if (!Number.isInteger(raw.proof_no) || raw.proof_no < 1 || raw.proof_no > 99) {
    err('proof_no', 'The proof number must be a whole number from 1 up.');
  } else out.proof_no = raw.proof_no;
  if (raw.date == null) out.date = null;
  else if (typeof raw.date !== 'string' || !DATE.test(raw.date) || Number.isNaN(Date.parse(raw.date))) err('date', 'The date must be YYYY-MM-DD, or null.');
  else out.date = raw.date;

  // ---- colors ----
  out.palette = {};
  if (!isObj(raw.palette)) err('palette', 'The palette is missing. It needs primary, accent and ink, each with a hex code.');
  else {
    for (const role of ROLES) {
      const c = raw.palette[role];
      if (!isObj(c)) err(`palette.${role}`, `The ${role} color is missing.`);
      else if (typeof c.hex !== 'string' || !HEX.test(c.hex)) err(`palette.${role}.hex`, `The ${role} hex code must look like #1F1A17.`);
      else out.palette[role] = { name: str(c.name) || role, hex: c.hex.toUpperCase() };
    }
  }
  out.extra_colors = [];
  if (raw.extra_colors != null) {
    if (!Array.isArray(raw.extra_colors)) err('extra_colors', 'extra_colors must be a list.');
    else raw.extra_colors.forEach((c, i) => {
      if (!isObj(c) || typeof c.hex !== 'string' || !HEX.test(c.hex)) err(`extra_colors[${i}].hex`, 'Each extra color needs a hex code like #1F1A17.');
      else out.extra_colors.push({ name: str(c.name) || c.hex.toUpperCase(), hex: c.hex.toUpperCase() });
    });
  }

  // ---- words ----
  out.fields = {};
  if (!isObj(raw.fields)) err('fields', 'The fields are missing. They need name, line2, phone and web ("" when there is none).');
  else {
    for (const k of FIELD_KEYS) {
      const v = raw.fields[k] == null ? '' : raw.fields[k];
      if (typeof v !== 'string') err(`fields.${k}`, `${k} must be text.`);
      else if (v.length > 120) err(`fields.${k}`, `${k} is over 120 characters.`);
      else out.fields[k] = v;
    }
  }
  const fonts = catalog.fonts.map((f) => f.id);
  if (raw.font == null) out.font = null;
  else if (!fonts.includes(raw.font)) err('font', `font must be null or one of: ${fonts.join(', ')}.`);
  else out.font = raw.font;

  // ---- logo files ----
  out.logos = [];
  if (raw.logos != null) {
    if (!Array.isArray(raw.logos)) err('logos', 'logos must be a list.');
    else if (raw.logos.length > MAX_LOGOS) err('logos', `The Designer takes up to ${MAX_LOGOS} logos.`);
    else {
      const seen = new Set();
      raw.logos.forEach((l, i) => {
        const file = isObj(l) ? l.file : null;
        if (typeof file !== 'string' || !FILE_NAME.test(file) || file.includes('..')) err(`logos[${i}].file`, 'Each logo needs a plain file name, with no folders (for example "logo.svg").');
        else if (!logoTypeOf(file)) err(`logos[${i}].file`, `${file} is not a PNG, JPG, WebP or SVG file.`);
        else if (seen.has(file.toLowerCase())) err(`logos[${i}].file`, `${file} is listed twice.`);
        else {
          seen.add(file.toLowerCase());
          out.logos.push({ file, type: logoTypeOf(file), claimed_vector: typeof l.vector === 'boolean' ? l.vector : null });
        }
      });
    }
  }

  // ---- pieces ----
  out.pieces = [];
  if (!Array.isArray(raw.pieces) || !raw.pieces.length) err('pieces', 'The brief needs at least one piece.');
  else if (raw.pieces.length > MAX_PIECES) err('pieces', `A brief can have up to ${MAX_PIECES} pieces.`);
  else raw.pieces.forEach((p, i) => out.pieces.push(checkPiece(p, i, out, catalog, err, warn)));

  out.notes = Array.isArray(raw.notes) ? raw.notes.filter((n) => typeof n === 'string') : [];
  out.not_included = Array.isArray(raw.not_included) ? raw.not_included.filter((n) => typeof n === 'string') : [];

  return errors.length ? { ok: false, errors, warnings } : { ok: true, errors, warnings, brief: out };
}

function checkPiece(p, i, out, catalog, err, warn) {
  const at = `pieces[${i}]`;
  const piece = { product: null, options: {}, qty: 1, template: null, sides_mode: 'same', panels: [], title: '', description: '', mockup_prompt: '' };
  if (!isObj(p)) {
    err(at, 'Each piece must be an object.');
    return piece;
  }
  const product = catalog.products.find((x) => x.id === p.product);
  if (!product) {
    err(`${at}.product`, `Unknown product "${p.product}". Use one of: ${catalog.products.map((x) => x.id).join(', ')}.`);
    return piece;
  }
  piece.product = product.id;

  // options: every group needs one of its choices
  const options = isObj(p.options) ? p.options : {};
  if (!isObj(p.options)) err(`${at}.options`, `options is missing. ${product.id} needs: ${product.groups.map((g) => g.id).join(', ')}.`);
  for (const g of product.groups) {
    const v = options[g.id];
    if (typeof v !== 'string' || !g.choices.some((c) => c.id === v)) err(`${at}.options.${g.id}`, `${g.id} must be one of: ${g.choices.map((c) => c.id).join(', ')}.`);
    else piece.options[g.id] = v;
  }
  for (const k of Object.keys(options)) if (!product.groups.some((g) => g.id === k)) warn(`${at}.options.${k}`, `${k} is not an option of ${product.id}, so it is ignored.`);

  // quantity: a product with no quantity (the pack sets it) is always 1
  const max = product.qty ? product.qty.max : 1;
  if (p.qty == null && !product.qty) piece.qty = 1;
  else if (!Number.isInteger(p.qty) || p.qty < 1 || p.qty > max) err(`${at}.qty`, `qty must be a whole number from 1 to ${max}${product.qty ? '' : ' (the pack sets the count)'}.`);
  else piece.qty = p.qty;

  if (typeof p.template !== 'string' || !product.templates.includes(p.template)) err(`${at}.template`, `template must be one of: ${product.templates.join(', ')}.`);
  else piece.template = p.template;

  piece.title = str(p.title) || '';
  piece.description = str(p.description) || '';
  piece.mockup_prompt = str(p.mockup_prompt) || '';

  // sides
  const complete = Object.keys(piece.options).length === product.groups.length;
  if (!complete) return piece; // the side names depend on the options
  const names = sideNamesFor(product, piece.options);
  const panelled = hasPanels(product);
  if (panelled) {
    if (p.sides_mode !== 'each') err(`${at}.sides_mode`, 'A table throw is always "each": its panels are different pieces.');
    piece.sides_mode = 'each';
  } else if (names.length === 1) {
    piece.sides_mode = 'same'; // one side, so "same" and "each" mean the same thing
  } else if (p.sides_mode !== 'same' && p.sides_mode !== 'each') {
    err(`${at}.sides_mode`, 'sides_mode must be "same" or "each".');
  } else piece.sides_mode = p.sides_mode;

  if (!Array.isArray(p.panels) || !p.panels.length) {
    err(`${at}.panels`, `panels is missing. Give one entry for each of: ${names.join(', ')}.`);
    return piece;
  }
  const want = piece.sides_mode === 'same' ? [names[0]] : names;
  const byName = new Map(names.map((n) => [n.toLowerCase(), n]));
  const got = [];
  p.panels.forEach((panel, k) => {
    const pat = `${at}.panels[${k}]`;
    if (!isObj(panel)) {
      err(pat, 'Each panel must be an object.');
      return;
    }
    const side = typeof panel.side === 'string' ? byName.get(panel.side.trim().toLowerCase()) : null;
    if (!side) {
      err(`${pat}.side`, `"${panel.side}" is not a side of this ${product.id}. Its sides are: ${names.join(', ')}.`);
      return;
    }
    got.push(side);
    const norm = { side, use: null, lines: [], logo_file: null, bg: null, note: '' };
    if (!USES.includes(panel.use)) err(`${pat}.use`, `use must be one of: ${USES.join(', ')}.`);
    else norm.use = panel.use;
    if (norm.use === 'template' && panelled && names.indexOf(side) > 0) {
      err(`${pat}.use`, 'Only the Front uses the template. Give this panel text, a logo or plain.');
    }
    // words
    const lines = panel.lines == null ? [] : panel.lines;
    if (!Array.isArray(lines) || lines.some((l) => typeof l !== 'string')) err(`${pat}.lines`, 'lines must be a list of text lines.');
    else if (norm.use === 'text' || norm.use === 'logo_and_text') {
      const clean = lines.map((l) => l.trim()).filter(Boolean);
      if (!clean.length) err(`${pat}.lines`, `${norm.use} needs at least one line.`);
      else if (clean.length > MAX_LINES) err(`${pat}.lines`, `At most ${MAX_LINES} lines on a panel. Use "custom" for more.`);
      else if (clean.some((l) => l.length > 120)) err(`${pat}.lines`, 'A line is over 120 characters.');
      else norm.lines = clean;
    } else if (lines.length) err(`${pat}.lines`, 'lines is only for text and logo_and_text.');
    // logo
    const wantsLogo = norm.use === 'logo' || norm.use === 'logo_and_text';
    if (panel.logo_file != null) {
      if (!out.logos.some((l) => l.file === panel.logo_file)) err(`${pat}.logo_file`, `${panel.logo_file} is not in the brief's logos list.`);
      else norm.logo_file = panel.logo_file;
    } else if (wantsLogo) {
      if (!out.logos.length) err(`${pat}.use`, `${norm.use} needs a logo file, and the brief's logos list is empty.`);
      else if (out.logos.length > 1) err(`${pat}.logo_file`, 'There is more than one logo, so say which file goes here.');
      else norm.logo_file = out.logos[0].file;
    }
    // background
    if (panel.bg != null) {
      if (['primary', 'accent', 'ink'].includes(panel.bg)) norm.bg = '@' + panel.bg;
      else if (typeof panel.bg === 'string' && HEX.test(panel.bg)) norm.bg = panel.bg.toUpperCase();
      else err(`${pat}.bg`, 'bg must be "primary", "accent", "ink" or a hex code.');
    }
    norm.note = str(panel.note) || '';
    if (norm.use === 'custom' && !norm.note) warn(`${pat}.note`, 'A custom panel should say what the customer wants, so Scott can design it.');
    piece.panels.push(norm);
  });
  // every side once, in order (a "same" piece is just its first side)
  const dupes = got.filter((n, k) => got.indexOf(n) !== k);
  if (dupes.length) err(`${at}.panels`, `${[...new Set(dupes)].join(', ')} is listed more than once.`);
  const missing = want.filter((n) => !got.includes(n));
  if (missing.length) err(`${at}.panels`, `Missing: ${missing.join(', ')}. ${piece.sides_mode === 'same' ? 'In "same" mode give the first side only.' : 'Every side needs a plan.'}`);
  const extra = got.filter((n) => !want.includes(n));
  if (extra.length) err(`${at}.panels`, `${[...new Set(extra)].join(', ')} should not be listed${piece.sides_mode === 'same' ? ' in "same" mode (the first side applies to every side)' : ''}.`);
  if (!dupes.length && !missing.length && !extra.length) piece.panels.sort((a, b) => names.indexOf(a.side) - names.indexOf(b.side));
  return piece;
}
