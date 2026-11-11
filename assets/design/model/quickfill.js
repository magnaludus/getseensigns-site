// One-click fills for the panels of a table throw: "Logo on top", "Business name on back and ends". Each one
// adds ordinary elements (a logo frame, text that follows the business name) to the panels it names, so the
// customer can move, resize or delete them like anything else. Pure functions on the document.
import { addElement, getPiece, getSide, placeLogo, templateOf, productOf, hasPanels } from './document.js';
import { buildTemplateSide } from './templates.js';
import { specForSide } from './specs.js';
import { PANEL_IDS, PANEL_NAMES } from './throw-panels.js';

// The side index of a panel in this piece, or -1 when the piece has no such panel (a 3-sided throw has no back).
export function panelIndex(piece, id) {
  const name = PANEL_NAMES[id];
  return piece.sides.findIndex((s) => s.name === name);
}

// [{id, label, targets: [side index], hint}] for a piece, or [] when the product has no panels.
export function quickFillOptions(doc, pi, env) {
  const piece = getPiece(doc, pi);
  if (!hasPanels(productOf(env, piece.productId)) || piece.sides.length < 2) return [];
  const ends = ['left', 'right', 'back'].map((id) => panelIndex(piece, id)).filter((i) => i >= 0);
  const hasBack = panelIndex(piece, 'back') >= 0;
  const out = [];
  const top = panelIndex(piece, 'top');
  if (top >= 0) out.push({ id: 'logo-top', label: 'Logo on top', targets: [top] });
  if (ends.length) out.push({ id: 'name-ends', label: hasBack ? 'Business name on back and ends' : 'Business name on both ends', targets: ends });
  return out;
}

const FILL = {
  logo: { type: 'image', name: 'Logo', region: 'safe', box: [0.1, 0.08, 0.8, 0.84], square: true },
  end: { type: 'text', name: 'Business name', region: 'safe', box: [0, 0.12, 1, 0.76], fill: '@ink', align: 'center', valign: 'middle', fit: { lines: 2, max: 20 }, bind: 'name' },
  back: { type: 'text', name: 'Business name', region: 'safe', box: [0.02, 0.1, 0.96, 0.8], fill: '@ink', align: 'center', valign: 'middle', fit: { lines: 1, max: 16 }, bind: 'name' },
};

// Elements for one panel, laid out in that panel's own safe area. The words follow the business name field.
function build(kind, doc, pi, si, env) {
  const piece = getPiece(doc, pi);
  const tpl = templateOf(env, piece.productId, piece.templateId);
  const synthetic = { id: 'quick-fill', font: tpl.font, sample: doc.project.fields, bg: getSide(doc, pi, 0).bg, elements: [FILL[kind]] };
  return buildTemplateSide(synthetic, specForSide(env.specs, piece.productId, piece.choices, si), doc.project.fields, env).elements;
}

const hasText = (side) => side.elements.some((e) => e.type === 'text' && e.bind === 'name');
const hasLogo = (side) => side.elements.some((e) => e.type === 'image');

// Returns {doc, changed: [side index], skipped: [side index]}. A panel that already has what the fill would add
// is left alone, so pressing a button twice does not stack copies.
export function quickFill(doc, pi, id, env) {
  const option = quickFillOptions(doc, pi, env).find((o) => o.id === id);
  if (!option) return { doc, changed: [], skipped: [] };
  const piece = getPiece(doc, pi);
  let next = doc;
  const changed = [];
  const skipped = [];
  for (const si of option.targets) {
    const side = getSide(next, pi, si);
    const panel = PANEL_IDS.find((p) => PANEL_NAMES[p] === piece.sides[si].name);
    if (id === 'logo-top') {
      if (hasLogo(side)) {
        skipped.push(si);
        continue;
      }
      for (const el of build('logo', next, pi, si, env)) next = addElement(next, pi, si, el);
      // a logo the customer already added goes straight in; otherwise the frame says where it will go
      const logo = next.project.logos[0];
      if (logo) next = placeLogo(next, pi, si, logo.id, env).doc;
    } else {
      if (hasText(side)) {
        skipped.push(si);
        continue;
      }
      for (const el of build(panel === 'back' ? 'back' : 'end', next, pi, si, env)) next = addElement(next, pi, si, el);
    }
    changed.push(si);
  }
  return { doc: next, changed, skipped };
}
