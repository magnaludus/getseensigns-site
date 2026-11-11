// What a designer proof request holds, in one place: which preview pictures there are and in what order, and a
// plain description of what is on each side. The page uses it to build the previews and the server uses it to
// label them and to write the request summary, so the two always agree. Pure functions that need only the catalog
// (no print specs, no DOM), so the Pages Function can load this file too.
//
// A table throw sends the whole flat first (every panel in its place on the printer's page, the ends and the back
// turned the way they print), then each panel as it reads when the cover hangs on the table.
import { sideNamesFor, hasPanels } from './document.js';
import { PANEL_NAMES, readsOnFlat } from './throw-panels.js';

export const MAX_PREVIEWS = 12;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

// The panel id ('left') of a side name ('Left end'), or null.
export function panelIdOf(name) {
  return Object.keys(PANEL_NAMES).find((id) => PANEL_NAMES[id] === name) || null;
}

const productIn = (env, piece) => env.catalog.products.find((p) => p.id === piece.productId) || null;

// [{n, pi, si, kind: 'flat' | 'side', file, label}] in the order the page sends them. `file` is the name the page
// gives the picture; the server stores it as preview-<n>.png and keeps `label` with it.
export function previewPlan(doc, env) {
  const out = [];
  const pieces = doc.project.pieces;
  pieces.forEach((piece, pi) => {
    const product = productIn(env, piece);
    if (!product) return;
    const names = sideNamesFor(product, piece.choices || {});
    const panels = hasPanels(product) && names.length > 1;
    const count = piece.sidesMode === 'same' ? 1 : names.length;
    const who = pieces.length > 1 ? `${product.short} ${pi + 1}` : product.short;
    const base = `preview-${pi + 1}-${slug(product.short)}`;
    if (panels && out.length < MAX_PREVIEWS) out.push({ pi, si: null, kind: 'flat', file: `${base}-flat.png`, label: `${who}: the whole flat as it prints (ends and back turned)` });
    for (let si = 0; si < count && out.length < MAX_PREVIEWS; si++) {
      const all = piece.sidesMode === 'same' && names.length > 1;
      const name = all ? 'all sides' : names[si];
      out.push({
        pi, si, kind: 'side', file: `${base}-${slug(all ? 'all-sides' : names[si])}.png`,
        label: panels ? `${who}: ${name} panel, as it reads on the table` : `${who}: ${name}`,
      });
    }
  });
  out.forEach((p, n) => { p.n = n; });
  return out;
}

// What is on one side: its words, logos and empty logo frames, or "plain" when it is just the background.
export function describeSide(side) {
  const els = (side.elements || []).filter((e) => !e.hidden);
  const text = els.filter((e) => e.type === 'text' && String(e.text).trim()).map((e) => clip(String(e.text).replace(/\s+/g, ' ').trim(), 60));
  const logos = els.filter((e) => e.type === 'image' && e.logoId).length;
  const frames = els.filter((e) => e.type === 'image' && !e.logoId).length;
  const shapes = els.filter((e) => e.type === 'shape').length;
  return { text, logos, frames, shapes, plain: !text.length && !logos && !frames && !shapes };
}

// For each piece: its sides (the panels, for a table throw) and what is on them, with how each panel is turned
// on the printer's flat. Used for the request summary and the admin view.
export function describePieces(doc, env) {
  return doc.project.pieces.map((piece, pi) => {
    const product = productIn(env, piece);
    if (!product) return { pi, productId: piece.productId, name: piece.productId, panels: false, sides: [] };
    const names = sideNamesFor(product, piece.choices || {});
    const panels = hasPanels(product) && names.length > 1;
    return {
      pi,
      productId: piece.productId,
      name: product.name,
      panels,
      sides: piece.sides.map((side, si) => {
        const id = panels ? panelIdOf(side.name || names[si]) : null;
        return { index: si, name: side.name || names[si], id, reads: id ? readsOnFlat(id) : null, ...describeSide(side) };
      }),
    };
  });
}

export function sideSummaryText(s) {
  if (s.plain) return 'background color only';
  const parts = [];
  if (s.text.length) parts.push(s.text.map((t) => `"${t}"`).join(', '));
  if (s.logos) parts.push(s.logos === 1 ? 'logo' : `${s.logos} logos`);
  if (s.frames) parts.push(s.frames === 1 ? 'empty logo frame (no logo yet)' : `${s.frames} empty logo frames`);
  if (!parts.length) parts.push('shapes only');
  return parts.join(' + ');
}
