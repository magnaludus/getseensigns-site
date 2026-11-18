// Runs inside the Designer page (cli.mjs imports it from the local test server). It builds the brief's design with the
// Designer's own functions and its real fonts, runs the Designer's own checks, and makes the same pictures the proof
// request would carry. Nothing here talks to a server.
//
// Imports are absolute paths on the site, so they resolve to the very modules the page is already running.
import {
  createDocument, setQty, setSidesMode, setBackground, clearSide, addElement, updateElement, placeLogo, validateDocument,
  getPiece, getSide, productOf, templateOf, sideNamesFor, hasPanels,
} from '/assets/design/model/document.js';
import { buildTemplateSide } from '/assets/design/model/templates.js';
import { specForSide, effectiveDpi, dpiLevel } from '/assets/design/model/specs.js';
import { collectWarnings } from '/assets/design/model/review.js';
import { capHeight } from '/assets/design/model/layout.js';
import { contrast, resolveColor } from '/assets/design/model/color.js';
import { previewPlan, describePieces, sideSummaryText } from '/assets/design/model/proof-plan.js';
import { addLogoFile } from '/assets/design/ui/logos.js';
import { buildSheets, dataUrls } from '/.design-dev/scripts/proof-from-brief/sheet-art.mjs';
import { fieldIsPrinted } from '/.design-dev/scripts/proof-from-brief/printed.mjs';

// The largest letter size (inches) a panel's words may grow to. The quick-fill buttons use the same for the ends.
const TEXT_MAX = 20;

const r2 = (n) => Math.round(n * 100) / 100;
const clip = (s, n = 60) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

// ---- what a panel plan becomes: element definitions in the same form the templates use (fractions of a named region) ----
// Most products take the safe area. A canopy side is a gable, so art goes in its "peak" block (the widest box that fits the
// safe gable), and a feather flag is cut away at the pole and the bottom, so art goes in its "body" band. The templates
// use the same regions.
const SPECIAL = {
  canopy: { logo: ['peak', [0.15, 0.03, 0.7, 0.94]], text: ['peak', [0.02, 0.1, 0.96, 0.8]], both: { logo: ['peak', [0.3, 0, 0.4, 0.46]], text: ['peak', [0, 0.5, 1, 0.46]] } },
  feather: { logo: ['body', [0.1, 0.03, 0.8, 0.5]], text: ['body', [0, 0.05, 1, 0.9]], both: { logo: ['body', [0.1, 0.03, 0.8, 0.42]], text: ['body', [0, 0.52, 1, 0.44]] } },
};

// {logo: [region, box], text: [region, box]} for a plan's use.
function placement(productId, use, spec) {
  const s = SPECIAL[productId];
  if (s && spec.regions[s.logo[0]]) return use === 'logo' ? { logo: s.logo } : use === 'text' ? { text: s.text } : s.both;
  if (use === 'logo') return { logo: ['safe', [0.1, 0.08, 0.8, 0.84]] };
  if (use === 'text') return { text: ['safe', [0.02, 0.1, 0.96, 0.8]] };
  // logo and text: side by side on a wide panel, stacked on a squarer one
  if (spec.safe.w / spec.safe.h >= 1.6) return { logo: ['safe', [0.02, 0.06, 0.28, 0.88]], text: ['safe', [0.34, 0.1, 0.64, 0.8]] };
  return { logo: ['safe', [0.15, 0.04, 0.7, 0.5]], text: ['safe', [0.04, 0.6, 0.92, 0.36]] };
}

// Each line is its own box, stacked, and each fits its own box: a longer line prints smaller, like a name and a line 2.
// A box much taller than wide (a flag) may wrap its line onto two.
function defsFor(place, lines, fill, spec) {
  const defs = [];
  if (place.logo) defs.push({ type: 'image', name: 'Logo', region: place.logo[0], box: place.logo[1], square: true });
  if (place.text) {
    const [region, [x, y, w, h]] = place.text;
    const r = spec.regions[region];
    const each = h / lines.length;
    const wrap = (r.w * w) / (r.h * each) < 0.75 ? 2 : 1;
    lines.forEach((line, k) => defs.push({
      type: 'text', name: 'Text', region, box: [x, y + k * each, w, each],
      fill, align: 'center', valign: 'middle', fit: { lines: wrap, max: TEXT_MAX }, text: line, bind: null,
    }));
  }
  return defs;
}

// The words are the ink color unless that does not read on the panel's background; then the palette color that reads best.
function textFill(doc, pi, si) {
  const palette = doc.project.palette;
  const bg = getSide(doc, pi, si).bg;
  const behind = resolveColor(bg.type === 'gradient' ? bg.from : bg.color, palette, '#FFFFFF');
  if (contrast(resolveColor('@ink', palette), behind) >= 4.5) return '@ink';
  const best = ['@ink', '@primary', '@accent'].map((t) => [t, contrast(resolveColor(t, palette), behind)]).sort((a, b) => b[1] - a[1])[0];
  return best[0];
}

function addDefs(doc, pi, si, defs, env) {
  const piece = getPiece(doc, pi);
  const tpl = templateOf(env, piece.productId, piece.templateId);
  const spec = specForSide(env.specs, piece.productId, piece.choices, si);
  const synthetic = { id: 'brief', font: tpl.font, sample: doc.project.fields, bg: getSide(doc, pi, 0).bg, elements: defs };
  let next = doc;
  for (const el of buildTemplateSide(synthetic, spec, doc.project.fields, env).elements) next = addElement(next, pi, si, el);
  return next;
}

// Every empty logo frame on a side gets the logo (a backdrop template repeats the logo across the whole sheet).
function fillFrames(doc, pi, si, logoId, env) {
  let next = doc;
  for (let guard = 0; guard < 60; guard++) {
    if (!getSide(next, pi, si).elements.some((e) => e.type === 'image' && !e.logoId && !e.locked)) break;
    const res = placeLogo(next, pi, si, logoId, env);
    if (!res.id) break;
    next = res.doc;
  }
  return next;
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

const panelName = (piece, si) => (piece.sidesMode === 'same' && piece.sides.length > 1 ? 'All sides' : piece.sides[si].name);

// brief: the normalized brief from brief.mjs. logoFiles: [{file, type, base64}].
export async function run(brief, logoFiles) {
  const D = window.GSSDesigner;
  if (!D || !D.store || !D.proof) throw new Error('This page does not expose the Designer (store and proof). Is it a Designer page?');
  const { store, env, ctx, proof } = D;

  // Real letter widths: every font is loaded before anything is laid out.
  await ctx.ensureFonts(env.fonts.map((f) => f.id));

  // ---- the document: one piece per brief piece, the project's colors and words shared ----
  const palette = { primary: brief.palette.primary.hex, accent: brief.palette.accent.hex, ink: brief.palette.ink.hex };
  let doc = null;
  for (const bp of brief.pieces) {
    const one = createDocument(env, bp.product, { choices: bp.options, templateId: bp.template, palette, fields: brief.fields });
    doc = doc ? { ...doc, project: { ...doc.project, pieces: doc.project.pieces.concat(one.project.pieces) } } : one;
  }
  doc = { ...doc, project: { ...doc.project, touched: { palette: true, fields: true } } };
  brief.pieces.forEach((bp, pi) => { doc = setQty(doc, pi, bp.qty); });
  store.replaceDoc(doc);

  // ---- logos: the customer's real files, through the Designer's own upload code (SVG is cleaned the same way) ----
  const logoIds = {};
  for (const lf of logoFiles) {
    const bytes = Uint8Array.from(atob(lf.base64), (c) => c.charCodeAt(0));
    const res = await addLogoFile(ctx, new File([bytes], lf.file, { type: lf.type }));
    if (!res.ok) throw new Error(`${lf.file}: ${res.message}`);
    logoIds[lf.file] = res.id;
  }
  doc = store.state.doc;
  const firstLogo = brief.logos[0] ? logoIds[brief.logos[0].file] : null;

  // ---- every panel's plan ----
  const manual = [];
  brief.pieces.forEach((bp, pi) => {
    const product = productOf(env, bp.product);
    const names = sideNamesFor(product, bp.options);
    if (!hasPanels(product) && bp.sides_mode === 'each' && names.length > 1) doc = setSidesMode(doc, pi, 'each', env);
    for (const plan of bp.panels) {
      const si = names.indexOf(plan.side);
      const logoId = plan.logo_file ? logoIds[plan.logo_file] : firstLogo;
      if (plan.use !== 'template') doc = clearSide(doc, pi, si);
      // the background first, so the words can be given a color that reads on it
      if (plan.bg) doc = setBackground(doc, pi, si, { type: 'solid', color: plan.bg }, env);
      if (plan.use === 'template') {
        if (logoId) doc = fillFrames(doc, pi, si, logoId, env);
      } else if (plan.use === 'custom') {
        manual.push({ piece: pi, panel: plan.side, note: plan.note });
      } else if (plan.use !== 'plain') {
        const spec = specForSide(env.specs, bp.product, bp.options, si);
        doc = addDefs(doc, pi, si, defsFor(placement(bp.product, plan.use, spec), plan.lines, textFill(doc, pi, si), spec), env);
        if (plan.use !== 'text') doc = fillFrames(doc, pi, si, logoId, env);
      }
    }
  });

  // a font the brief names goes on every word (the words refit to it)
  if (brief.font) {
    doc.project.pieces.forEach((piece, pi) => piece.sides.forEach((side, si) => {
      for (const el of side.elements) if (el.type === 'text' && el.font !== brief.font) doc = updateElement(doc, pi, si, el.id, { font: brief.font }, env);
    }));
  }
  store.replaceDoc(doc);
  doc = store.state.doc;
  const assets = store.state.assets;

  // ---- the Designer's own checks, plus the numbers behind them ----
  const warnings = collectWarnings(doc, env, assets).map((w) => {
    const piece = doc.project.pieces[w.pi];
    return { kind: w.kind, piece: w.pi, panel: panelName(piece, w.si), message: w.message };
  });
  const textSizes = [];
  const logos = [];
  const emptyFrames = [];
  const printedLines = [];
  doc.project.pieces.forEach((piece, pi) => {
    const ids = piece.sidesMode === 'same' ? [0] : piece.sides.map((_, i) => i);
    for (const si of ids) {
      const spec = specForSide(env.specs, piece.productId, piece.choices, si);
      const panel = panelName(piece, si);
      for (const el of piece.sides[si].elements) {
        if (el.hidden) continue;
        if (el.type === 'text' && String(el.text).trim()) {
          printedLines.push(String(el.text).trim());
          const cap = capHeight(el, env.fonts);
          textSizes.push({ piece: pi, panel, text: clip(el.text), cap_in: r2(cap), min_cap_in: spec.minCapIn, read_ft: Math.round(spec.readFt), ok: cap + 1e-9 >= spec.minCapIn });
        } else if (el.type === 'image') {
          if (!el.logoId) {
            emptyFrames.push({ piece: pi, panel });
            continue;
          }
          const asset = assets.get(el.logoId);
          const vector = !!(asset && asset.vector);
          const dpi = vector || !asset ? null : effectiveDpi(asset.w, el.w);
          logos.push({
            piece: pi, panel, file: asset ? asset.name : el.logoId, vector, pixels_w: vector || !asset ? null : asset.w, placed_in_w: r2(el.w),
            dpi: dpi == null ? null : Math.round(dpi), level: vector ? 'vector' : dpiLevel(dpi, spec.dpi), green_min: spec.dpi.greenMin, amber_min: spec.dpi.amberMin,
          });
        }
      }
    }
  });
  const kinds = new Set(warnings.map((w) => w.kind));
  const raster = logos.filter((l) => !l.vector);
  const checks = {
    safe_area: kinds.has('safe') ? 'fail' : 'pass',
    min_text_size: kinds.has('small') ? 'fail' : 'pass',
    logo_sharpness: !raster.length ? 'n/a' : raster.some((l) => l.level === 'red') ? 'fail' : 'pass',
    contrast: kinds.has('contrast') ? 'fail' : 'pass',
  };
  const unplacedFields = Object.entries(doc.project.fields)
    .filter(([, v]) => !fieldIsPrinted(v, printedLines))
    .map(([field, value]) => ({ field, value }));
  const unusedLogos = brief.logos.filter((l) => !logos.some((x) => x.file === l.file)).map((l) => l.file);
  const logoFacts = brief.logos.map((l) => {
    const a = [...assets.values()].find((x) => x.name === l.file);
    return { file: l.file, vector: a ? !!a.vector : null, pixels_w: a && !a.vector ? a.w : null, pixels_h: a && !a.vector ? a.h : null, claimed_vector: l.claimed_vector };
  });

  // ---- what is on each panel, in the words the proof email uses ----
  const summary = describePieces(doc, env).map((p) => ({
    piece: p.pi, product: p.name,
    sides: p.sides.map((s) => ({ name: s.name, reads: s.reads, text: sideSummaryText(s) })),
  }));

  // ---- the pictures the proof request would carry: the flat first (a throw), then each panel ----
  const plan = previewPlan(doc, env);
  const previews = [];
  for (const item of await proof.buildPreviews()) {
    const meta = plan.find((p) => p.file === item.name);
    previews.push({ file: item.name, label: meta ? meta.label : item.name, kind: item.kind, piece: item.pi, side: item.si, base64: await toBase64(item.blob) });
  }

  // the same validator the proof request goes through on the server: a design it would refuse is a bug in this tool
  const valid = validateDocument(doc, env);

  // the art for the proof sheets: figures as SVG with their logos inlined, and what the sheets say about them
  const sheets = valid.ok ? buildSheets(doc, env, assets, await dataUrls(assets)) : [];

  return { doc, previews, sheets, report: { doc_valid: valid, checks, warnings, text_sizes: textSizes, logos, logo_files: logoFacts, empty_logo_frames: emptyFrames, unplaced_fields: unplacedFields, unused_logos: unusedLogos, manual, summary } };
}
