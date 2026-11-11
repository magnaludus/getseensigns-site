// Runs inside the Designer page (in-page.mjs imports it). The flat art of each piece as self-contained SVG figures for
// the proof sheet: the art as it prints, to scale, with the labels, dimension lines and close-ups the reference proofs
// have. A figure's SVG has its own viewBox in inches of the product, so it scales to whatever box the sheet gives it,
// and its logos are data URLs, so it needs nothing from this page. All sizes of lines and letters are worked out in
// paper inches (what a person sees on the 17 x 11 sheet) and turned into product inches with the figure's scale.
import { sideDisplay } from '/assets/design/render/displaylist.js';
import { innerArt } from '/assets/design/render/svg.js';
import { flatOf, baseColorOf } from '/assets/design/render/flat.js';
import { matrixAttr } from '/assets/design/model/throw-panels.js';
import { specForSide } from '/assets/design/model/specs.js';
import { resolveColor } from '/assets/design/model/color.js';
import { layoutOf } from '/assets/design/model/layout.js';
import { productOf, sideNamesFor, hasPanels } from '/assets/design/model/document.js';

// The area of the sheet the art gets, in paper inches (the left column between the description and the caption).
export const HERO = { w: 9.6, h: 6.75 };
const INK = '#14161A';
const GAP = 0.25;

const n = (v) => Math.round(v * 1000) / 1000;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (v) => (Math.abs(v - Math.round(v)) < 0.005 ? String(Math.round(v)) : String(Math.round(v * 100) / 100));
const poly = (pts) => pts.map((p) => n(p[0]) + ',' + n(p[1])).join(' ');
let ids = 0;

const FONT = `font-family="'Barlow',Arial,sans-serif"`;

function svgWrap(view, parts) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(view.x)} ${n(view.y)} ${n(view.w)} ${n(view.h)}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block;overflow:hidden">${parts.join('')}</svg>`;
}

// ---- annotation drawing, sized in paper inches through k (product inches per paper inch) ----
const stroke = (k) => `stroke="${INK}" stroke-width="${n(0.012 * k)}" fill="none"`;
const label = (k, x, y, text, { anchor = 'middle', size = 0.15, weight = 600, rotate = 0, fill = INK } = {}) => {
  const fs = size * k;
  const tr = rotate ? ` transform="rotate(${rotate} ${n(x)} ${n(y)})"` : '';
  return `<text x="${n(x)}" y="${n(y)}" text-anchor="${anchor}" ${FONT} font-weight="${weight}" font-size="${n(fs)}" fill="${fill}"${tr}>${esc(text)}</text>`;
};

// A dimension line along x from x1 to x2 at height y, with its words above it.
function dimH(k, x1, x2, y, text, above = true) {
  const t = 0.06 * k;
  return `<g ${stroke(k)}><line x1="${n(x1)}" y1="${n(y)}" x2="${n(x2)}" y2="${n(y)}"/><line x1="${n(x1)}" y1="${n(y - t)}" x2="${n(x1)}" y2="${n(y + t)}"/><line x1="${n(x2)}" y1="${n(y - t)}" x2="${n(x2)}" y2="${n(y + t)}"/></g>` +
    label(k, (x1 + x2) / 2, above ? y - 0.09 * k : y + 0.2 * k, text);
}

// A dimension line along y from y1 to y2 at x, with its words turned to run along it.
function dimV(k, y1, y2, x, text, left = true) {
  const t = 0.06 * k;
  const tx = left ? x - 0.09 * k : x + 0.2 * k;
  return `<g ${stroke(k)}><line x1="${n(x)}" y1="${n(y1)}" x2="${n(x)}" y2="${n(y2)}"/><line x1="${n(x - t)}" y1="${n(y1)}" x2="${n(x + t)}" y2="${n(y1)}"/><line x1="${n(x - t)}" y1="${n(y2)}" x2="${n(x + t)}" y2="${n(y2)}"/></g>` +
    label(k, tx, (y1 + y2) / 2, text, { rotate: -90 });
}

// A bracket "]" along y from y1 to y2 at x, with its name to the right.
function bracketV(k, y1, y2, x, lines) {
  const t = 0.07 * k;
  const mid = (y1 + y2) / 2;
  const fs = 0.15 * k;
  const first = mid - ((lines.length - 1) * fs * 1.1) / 2 + fs * 0.35;
  const text = lines.map((l, i) => `<tspan x="${n(x + 0.14 * k)}" dy="${i ? n(fs * 1.1) : 0}">${esc(l)}</tspan>`).join('');
  return `<path d="M${n(x - t)},${n(y1)} H${n(x)} V${n(y2)} H${n(x - t)}" ${stroke(k)}/>` +
    `<text x="${n(x + 0.14 * k)}" y="${n(first)}" ${FONT} font-weight="700" font-size="${n(fs)}" fill="${INK}">${text}</text>`;
}

// ---- the art of one side: the picture with its cut shape ----
function artParts(c, si, mode) {
  const spec = specForSide(c.env.specs, c.piece.productId, c.piece.choices, si);
  const display = sideDisplay(c.doc, c.pi, si, c.env, { region: 'trim', assets: c.assets });
  const W = spec.trim.w;
  const H = spec.trim.h;
  const id = ++ids;
  const shape = mode === 'canopy' && spec.cut ? spec.cut : mode === 'feather' && spec.outline ? spec.outline : null;
  const clip = shape ? `<polygon points="${poly(shape)}"/>` : `<rect width="${n(W)}" height="${n(H)}"/>`;
  return {
    spec, W, H, shape,
    defs: `<defs><clipPath id="sc${id}">${clip}</clipPath></defs>`,
    art: `<g clip-path="url(#sc${id})">${innerArt(display, { assetUrl: c.assetUrl })}</g>`,
    outline: (k) => (shape ? `<polygon points="${poly(shape)}" ${stroke(k)} stroke-linejoin="round"/>` : `<rect width="${n(W)}" height="${n(H)}" ${stroke(k)}/>`),
  };
}

// paper-inch scale that fits an area of w x h product inches, plus padding (paper inches), into a box
function scaleFor(w, h, box, pad) {
  return Math.min((box.w - pad.l - pad.r) / w, (box.h - pad.t - pad.b) / h);
}

function sized(view, s, parts) {
  return { svg: svgWrap(view, parts), w: view.w * s, h: view.h * s };
}

// ---- figures ----
function rectFigure(c, si, box, { dims = true, mode = 'rect' } = {}) {
  const a = artParts(c, si, mode);
  const pad = { l: dims ? 0.6 : 0.12, t: dims ? 0.6 : 0.12, r: 0.12, b: 0.12 };
  const s = scaleFor(a.W, a.H, box, pad);
  const k = 1 / s;
  const view = { x: -pad.l * k, y: -pad.t * k, w: a.W + (pad.l + pad.r) * k, h: a.H + (pad.t + pad.b) * k };
  const parts = [a.defs, a.art, a.outline(k)];
  if (dims) parts.push(dimH(k, 0, a.W, -0.2 * k, `${fmt(a.W)} in`), dimV(k, 0, a.H, -0.2 * k, `${fmt(a.H)} in`));
  return sized(view, s, parts);
}

function canopyFigure(c, si, box, { dims = true } = {}) {
  const a = artParts(c, si, 'canopy');
  const seam = a.spec.valanceLine;
  const pad = { l: dims ? 0.6 : 0.12, t: 0.12, r: 1.35, b: dims ? 0.55 : 0.12 };
  const s = scaleFor(a.W, a.H, box, pad);
  const k = 1 / s;
  const view = { x: -pad.l * k, y: -pad.t * k, w: a.W + (pad.l + pad.r) * k, h: a.H + (pad.t + pad.b) * k };
  const parts = [a.defs, a.art, a.outline(k)];
  if (seam != null) {
    parts.push(`<line x1="0" y1="${n(seam)}" x2="${n(a.W)}" y2="${n(seam)}" stroke="${INK}" stroke-width="${n(0.012 * k)}" stroke-dasharray="${n(0.07 * k)} ${n(0.05 * k)}"/>`);
    parts.push(bracketV(k, 0, seam, a.W + 0.22 * k, ['ROOF', 'PANEL']), bracketV(k, seam, a.H, a.W + 0.22 * k, ['VALANCE']));
  }
  if (dims) parts.push(dimV(k, 0, a.H, -0.2 * k, `${fmt(a.H)} in`), dimH(k, 0, a.W, a.H + 0.22 * k, `${fmt(a.W)} in`, false));
  return sized(view, s, parts);
}

function featherFigure(c, si, box) {
  const a = artParts(c, si, 'feather');
  const pad = { l: 0.5, t: 0.4, r: 0.55, b: 0.6 };
  const s = scaleFor(a.W, a.H, box, pad);
  const k = 1 / s;
  const view = { x: -pad.l * k, y: -pad.t * k, w: a.W + (pad.l + pad.r) * k, h: a.H + (pad.t + pad.b) * k };
  const poleTop = a.shape ? Math.min(...a.shape.filter((p) => p[0] < 0.01).map((p) => p[1])) : 0;
  const parts = [a.defs, a.art, a.outline(k)];
  parts.push(label(k, -0.16 * k, (poleTop + a.H) / 2, 'POLE SIDE (sleeve sewn on, not printed)', { rotate: -90, size: 0.13 }));
  parts.push(label(k, a.W / 2, -0.12 * k, 'TOP', { weight: 700 }), label(k, a.W / 2, a.H + 0.2 * k, `BOTTOM  ·  ${fmt(a.W)} in wide`, { weight: 700 }));
  parts.push(dimV(k, 0, a.H, a.W + 0.16 * k, `${fmt(a.H)} in tall`, false));
  return { ...sized(view, s, parts), shape: a.shape, W: a.W, H: a.H };
}

// A close-up of part of a side: the same art, only `region` of it showing, in its own box.
function closeupFigure(c, si, region, box, mode) {
  const a = artParts(c, si, mode);
  const pad = 0.1;
  const s = Math.min((box.w - 2 * pad) / region.w, (box.h - 2 * pad) / region.h);
  const k = 1 / s;
  const view = { x: region.x - pad * k, y: region.y - pad * k, w: region.w + 2 * pad * k, h: region.h + 2 * pad * k };
  const frame = `<rect x="${n(region.x)}" y="${n(region.y)}" width="${n(region.w)}" height="${n(region.h)}" ${stroke(k)} stroke-dasharray="${n(0.05 * k)} ${n(0.04 * k)}"/>`;
  return sized(view, s, [a.defs, a.art, a.outline(k), frame]);
}

// The throw's whole flat: every panel turned the way it prints, a name tag on each, the cut line.
function throwFigure(c, box) {
  const layout = flatOf(c.doc, c.pi, c.env);
  const b = layout.bounds;
  const pad = 0.12;
  const s = Math.min((box.w - 2 * pad) / b.w, (box.h - 2 * pad) / b.h);
  const k = 1 / s;
  const view = { x: b.x - pad * k, y: b.y - pad * k, w: b.w + 2 * pad * k, h: b.h + 2 * pad * k };
  const id = ++ids;
  const base = baseColorOf(c.doc, c.pi);
  const defs = [`<pattern id="sh${id}" width="${n(0.2 * k)}" height="${n(0.2 * k)}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="${n(0.2 * k)}" stroke="rgba(20,22,26,.4)" stroke-width="${n(0.02 * k)}"/></pattern>`];
  const body = [`<polygon points="${poly(layout.outline)}" fill="${base}"/>`];
  const tags = [];
  const tag = (box2, text) => {
    const fs = 0.13 * k;
    const w = text.length * fs * 0.66 + fs * 1.1;
    tags.push(`<g><rect x="${n(box2.x + 0.35 * k * 0.15)}" y="${n(box2.y + 0.35 * k * 0.15)}" width="${n(w)}" height="${n(fs * 1.55)}" rx="${n(fs * 0.25)}" fill="rgba(255,255,255,.9)" stroke="${INK}" stroke-width="${n(0.008 * k)}"/>` +
      `<text x="${n(box2.x + 0.35 * k * 0.15 + fs * 0.55)}" y="${n(box2.y + 0.35 * k * 0.15 + fs * 1.12)}" ${FONT} font-weight="700" font-size="${n(fs)}" fill="${INK}">${esc(text)}</text></g>`);
  };
  for (const d of layout.drape) {
    body.push(`<rect x="${n(d.box.x)}" y="${n(d.box.y)}" width="${n(d.box.w)}" height="${n(d.box.h)}" fill="url(#sh${id})"/>`);
    tag(d.box, 'CORNER DRAPE');
  }
  for (const st of layout.strips) tag(st.box, 'BACK STRIP (plain)');
  for (const p of layout.panels) {
    const display = sideDisplay(c.doc, c.pi, p.index, c.env, { region: 'trim', assets: c.assets });
    defs.push(`<clipPath id="fc${id}-${p.id}"><rect width="${n(p.size.w)}" height="${n(p.size.h)}"/></clipPath>`);
    body.push(`<g transform="${matrixAttr(p.matrix)}" clip-path="url(#fc${id}-${p.id})">${innerArt(display, { assetUrl: c.assetUrl })}</g>`);
    body.push(`<rect x="${n(p.box.x)}" y="${n(p.box.y)}" width="${n(p.box.w)}" height="${n(p.box.h)}" fill="none" stroke="rgba(20,22,26,.45)" stroke-width="${n(0.01 * k)}"/>`);
    tag(p.box, p.label);
  }
  body.push(`<polygon points="${poly(layout.outline)}" ${stroke(k)} stroke-width="${n(0.02 * k)}" stroke-linejoin="round"/>`);
  return { ...sized(view, s, [`<defs>${defs.join('')}</defs>`, ...body, ...tags]), layout };
}

// ---- placing figures in the hero area ----
const center = (fig, area) => ({ ...fig, x: area.x + (area.w - fig.w) / 2, y: area.y + (area.h - fig.h) / 2 });

// n cells in a box, the grid that gives the biggest picture to a side of aspect w:h
function gridCells(count, aspect, box, labelH) {
  let best = null;
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const cw = (box.w - (cols - 1) * GAP) / cols;
    const ch = (box.h - (rows - 1) * GAP) / rows - labelH;
    const w = Math.min(cw, ch * aspect);
    if (!best || w > best.w) best = { cols, rows, cw, ch, w };
  }
  const cells = [];
  for (let i = 0; i < count; i++) {
    const col = i % best.cols;
    const row = Math.floor(i / best.cols);
    cells.push({ x: box.x + col * (best.cw + GAP), y: box.y + row * (best.ch + labelH + GAP), w: best.cw, h: best.ch });
  }
  return cells;
}

function sidesOf(piece) {
  return piece.sidesMode === 'same' ? [0] : piece.sides.map((_, i) => i);
}

// Where to cut a tall side into close-ups: [[y0, y1], ...] covering the whole side, cut in the gaps between things.
function closeupSplits(items, H) {
  const spans = items.filter((it) => it.h < H * 0.6).map((it) => [it.y, it.y + it.h]).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const sp of spans) {
    const last = merged[merged.length - 1];
    if (last && sp[0] <= last[1] + 0.3) last[1] = Math.max(last[1], sp[1]);
    else merged.push([sp[0], sp[1]]);
  }
  if (!merged.length) return [[0, H]];
  const top = merged[0][0];
  const bottom = merged[merged.length - 1][1];
  const extent = bottom - top;
  const count = extent <= H * 0.45 ? 1 : extent <= H * 0.8 ? 2 : 3;
  const gaps = merged.slice(1).map((m, i) => (merged[i][1] + m[0]) / 2);
  const cuts = [0];
  for (let i = 1; i < count; i++) {
    const want = top + (extent * i) / count;
    const near = gaps.filter((g) => g > cuts[cuts.length - 1] + H * 0.05).sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0];
    cuts.push(near == null ? want : near);
  }
  cuts.push(H);
  return cuts.slice(1).map((y, i) => [cuts[i], y]);
}

// the figures of one piece, placed in a HERO-sized area: [{svg, x, y, w, h, label}]
function figuresFor(c) {
  const area = { x: 0, y: 0, w: HERO.w, h: HERO.h };
  const id = c.piece.productId;
  if (hasPanels(c.product) && flatOf(c.doc, c.pi, c.env)) {
    const fig = throwFigure(c, area);
    return { figures: [{ ...center(fig, area), label: null }], layout: fig.layout };
  }
  const sides = sidesOf(c.piece);
  const names = c.piece.sides.map((s) => s.name);
  const labelFor = (si) => (c.piece.sidesMode === 'same' ? (c.piece.sides.length > 1 ? `EACH SIDE (x${c.piece.sides.length})` : null) : names[si].toUpperCase());

  if (sides.length > 1) {
    const spec0 = specForSide(c.env.specs, c.piece.productId, c.piece.choices, 0);
    const cells = gridCells(sides.length, spec0.trim.w / spec0.trim.h, area, 0.3);
    const figures = sides.map((si, i) => {
      const cell = cells[i];
      const fig = id === 'canopy' ? canopyFigure(c, si, cell, { dims: false }) : rectFigure(c, si, cell, { dims: false, mode: id === 'feather' ? 'feather' : 'rect' });
      return { ...center(fig, cell), label: labelFor(si), labelH: 0.3 };
    });
    return { figures };
  }

  const si = sides[0];
  const label0 = labelFor(si);
  if (id === 'canopy') {
    const a = specForSide(c.env.specs, c.piece.productId, c.piece.choices, si);
    const stripH = 1.25;
    const main = canopyFigure(c, si, { w: area.w, h: area.h - stripH - 0.35 });
    const figures = [{ ...center(main, { x: 0, y: 0, w: area.w, h: area.h - stripH - 0.35 }), label: null }];
    if (a.valanceLine != null) {
      const region = { x: 0, y: a.valanceLine, w: a.trim.w, h: a.trim.h - a.valanceLine };
      const strip = closeupFigure(c, si, region, { w: area.w - 1.2, h: stripH }, 'canopy');
      figures.push({ ...center(strip, { x: 0.6, y: area.h - stripH, w: area.w - 1.2, h: stripH }), label: c.piece.sidesMode === 'same' && c.piece.sides.length > 1 ? `VALANCE close-up (all ${c.piece.sides.length} sides)` : 'VALANCE close-up', labelAbove: true });
    }
    return { figures };
  }
  if (id === 'feather') {
    const hero = featherFigure(c, si, { w: area.w * 0.28, h: area.h });
    const figures = [{ ...hero, x: 0, y: (area.h - hero.h) / 2, label: null }];
    // close-ups: the flag's art split where nothing is, so no letter or logo is cut, until all of it is shown
    const { W, H } = hero;
    const display = sideDisplay(c.doc, c.pi, si, c.env, { region: 'trim', assets: c.assets });
    const crops = closeupSplits(display.items, H).map(([y0, y1]) => ({ x: 0, y: y0, w: W, h: y1 - y0 }));
    const rest = area.w - hero.w - GAP;
    const names2 = crops.length === 1 ? ['flag art'] : crops.length === 2 ? ['top of flag', 'bottom of flag'] : ['top of flag', 'middle of flag', 'bottom of flag'];
    crops.forEach((r, i) => {
      const cell = { w: (rest - (crops.length - 1) * GAP) / crops.length, h: area.h - 0.4 };
      const fig = closeupFigure(c, si, r, cell, 'feather');
      figures.push({ ...fig, x: hero.w + GAP + i * (cell.w + GAP) + (cell.w - fig.w) / 2, y: 0.4 + (cell.h - fig.h) / 2, label: `CLOSE-UP: ${names2[i]}`, labelAbove: true });
    });
    return { figures };
  }
  const fig = rectFigure(c, si, area);
  return { figures: [{ ...center(fig, area), label: label0 }] };
}

// ---- what the sheet says about the art ----
function colorsUsed(c) {
  const palette = c.doc.project.palette;
  const roles = new Map();
  const add = (token, role) => {
    if (!token) return;
    const hex = resolveColor(token, palette, null);
    if (!hex) return;
    if (!roles.has(hex)) roles.set(hex, []);
    if (!roles.get(hex).includes(role)) roles.get(hex).push(role);
  };
  for (const si of sidesOf(c.piece)) {
    const side = c.piece.sides[si];
    add(side.bg.type === 'gradient' ? side.bg.from : side.bg.color, 'background');
    if (side.bg.type === 'gradient') add(side.bg.to, 'background');
    for (const e of side.elements) {
      if (e.hidden) continue;
      if (e.type === 'shape') {
        add(e.fill, 'bars and blocks');
        if (e.stroke) add(e.stroke.color, 'bars and blocks');
      } else if (e.type === 'text' && String(e.text).trim()) {
        add(e.fill, 'text');
        if (e.stroke) add(e.stroke.color, 'text');
      }
    }
  }
  return [...roles].map(([hex, where]) => ({ hex, where }));
}

function factsFor(c, extra) {
  const spec = specForSide(c.env.specs, c.piece.productId, c.piece.choices, 0);
  const logos = [];
  const words = [];
  for (const si of sidesOf(c.piece)) {
    for (const e of c.piece.sides[si].elements) {
      if (e.hidden) continue;
      if (e.type === 'image' && e.logoId) logos.push({ panel: c.piece.sides[si].name, in_w: e.w });
      if (e.type === 'text' && String(e.text).trim()) words.push({ text: String(e.text).trim(), size: e.size, in_w: layoutOf(e, c.env.measure, c.env.fonts).widest });
    }
  }
  words.sort((a, b) => b.size - a.size);
  const layout = extra && extra.layout;
  return {
    product: c.piece.productId,
    sides: c.piece.sides.length,
    same: c.piece.sidesMode === 'same',
    size: layout ? null : { w: spec.trim.w, h: spec.trim.h },
    flat: layout ? { w: layout.template.w, h: layout.template.h } : null,
    panels: layout ? layout.panels.map((p) => ({ name: p.name, w: p.size.w, h: p.size.h, turn: p.turn })) : null,
    drape: !!(layout && layout.drape.length),
    strip: !!(layout && layout.strips.length),
    valance_in: spec.valanceLine != null ? spec.trim.h - spec.valanceLine : null,
    logos,
    words: words.slice(0, 2),
  };
}

// asset ids to data URLs, so the figures need nothing from this page
export async function dataUrls(assets) {
  const out = new Map();
  for (const [id, a] of assets) {
    try {
      const blob = await (await fetch(a.url)).blob();
      out.set(id, await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      }));
    } catch (_) {
      out.set(id, '');
    }
  }
  return out;
}

// One entry per piece: {piece, hero: {w, h, figures}, facts, used_colors}
export function buildSheets(doc, env, assets, urls) {
  return doc.project.pieces.map((piece, pi) => {
    const c = { doc, env, assets, piece, pi, product: productOf(env, piece.productId), assetUrl: (id) => urls.get(id) || '' };
    const placed = figuresFor(c);
    return {
      piece: pi,
      hero: { w: HERO.w, h: HERO.h, figures: placed.figures },
      facts: factsFor(c, placed),
      used_colors: colorsUsed(c),
    };
  });
}

export { sideNamesFor };
