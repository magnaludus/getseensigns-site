// The whole flat of a table throw: every panel in its place on the printer's page, turned the way it prints,
// inside the cut shape. Two backends, like the rest of the renderer: SVG for the Flat view's map and canvas for
// the proof request's picture of the flat. The panels themselves are drawn from the same display lists the
// editor uses (see render/displaylist.js), so what the map shows is what the editor and the proof show.
import { sideDisplay } from './displaylist.js';
import { innerArt } from './svg.js';
import { paintDisplay } from './canvas.js';
import { specFor } from '../model/specs.js';
import { resolveColor } from '../model/color.js';
import { matrixAttr } from '../model/throw-panels.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v) => Math.round(v * 1000) / 1000;
const TRIM = '#00B3FF';
const SAFE = '#2BD67B';
const SEL = '#FFD100';
let count = 0;

// The layout of piece `pi` (see model/throw-panels.js), or null when the piece is not a table throw with a printer flat.
export function flatOf(doc, pi, env) {
  const piece = doc.project.pieces[pi];
  return piece ? specFor(env.specs, piece.productId, piece.choices).flat || null : null;
}

// The color of the pieces nobody designs (the back strip, the corner drape): the front's background.
export function baseColorOf(doc, pi) {
  const bg = doc.project.pieces[pi].sides[0].bg;
  return resolveColor(bg.type === 'gradient' ? bg.from : bg.color, doc.project.palette);
}

function lines(label) {
  return label.split(' ').length > 1 && label.length > 7 ? label.split(' ') : [label];
}

// The area a picture of the flat covers: the cut shape with a margin.
export function flatArea(layout, pad = 1.5, extraTop = 0) {
  const b = layout.bounds;
  return { x: b.x - pad, y: b.y - pad - extraTop, w: b.w + 2 * pad, h: b.h + 2 * pad + extraTop };
}

// opts: {assets, assetUrl, selected: panel id, fontIn: label size in inches, safe: bool, className, label}
export function flatSvg(doc, pi, env, opts = {}) {
  const layout = flatOf(doc, pi, env);
  if (!layout) return '';
  const id = ++count;
  const fs = opts.fontIn || 3.4;
  const base = baseColorOf(doc, pi);
  const area = flatArea(layout, 1.5, layout.strips.length ? fs * 1.7 : 0);
  const defs = [];
  const body = [];
  const poly = (pts) => pts.map((p) => n(p[0]) + ',' + n(p[1])).join(' ');
  const text = (x, y, label, anchor = 'middle', size = fs, plain = false, one = false) => {
    const ls = one ? [label] : lines(label);
    const y0 = y - ((ls.length - 1) * size * 1.05) / 2 + size * 0.35;
    const style = plain ? 'fill="#14161A"' : `fill="#fff" stroke="rgba(20,22,26,.85)" stroke-width="${n(size * 0.28)}" paint-order="stroke" stroke-linejoin="round"`;
    const spans = ls.map((l, i) => `<tspan x="${n(x)}" dy="${i ? n(size * 1.05) : 0}">${esc(l)}</tspan>`).join('');
    return `<text x="${n(x)}" y="${n(y0)}" text-anchor="${anchor}" font-family="'Barlow',sans-serif" font-weight="700" font-size="${n(size)}" ${style} pointer-events="none">${spans}</text>`;
  };
  defs.push(`<pattern id="fh${id}" width="2.2" height="2.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="2.2" stroke="rgba(20,22,26,.4)" stroke-width="0.45"/></pattern>`);

  // the cut shape, filled with the plain color, then the pieces nobody designs
  body.push(`<polygon points="${poly(layout.outline)}" fill="${base}"/>`);
  for (const d of layout.drape) {
    body.push(`<rect x="${n(d.box.x)}" y="${n(d.box.y)}" width="${n(d.box.w)}" height="${n(d.box.h)}" fill="url(#fh${id})"/>`);
    body.push(text(d.box.x + d.box.w / 2, d.box.y + d.box.h / 2, d.label));
  }
  for (const s of layout.strips) {
    body.push(text(s.box.x + s.box.w / 2, s.box.y - fs * 0.55, s.label + ' (PLAIN)', 'middle', fs * 0.85, true, true));
  }

  // every panel, drawn upright in its own coordinates and turned onto the flat
  for (const p of layout.panels) {
    const display = sideDisplay(doc, pi, p.index, env, { region: 'trim', assets: opts.assets });
    defs.push(`<clipPath id="fc${id}-${p.id}"><rect width="${n(p.size.w)}" height="${n(p.size.h)}"/></clipPath>`);
    const turned = p.turn ? ` data-turn="${p.turn}"` : '';
    body.push(
      `<g class="flat-panel" data-panel="${p.id}" data-index="${p.index}"${turned} role="button" tabindex="0" aria-label="${esc(p.name)} panel. Edit it.">` +
      `<g transform="${matrixAttr(p.matrix)}" clip-path="url(#fc${id}-${p.id})">${innerArt(display, { assetUrl: opts.assetUrl })}</g>` +
      `<rect x="${n(p.box.x)}" y="${n(p.box.y)}" width="${n(p.box.w)}" height="${n(p.box.h)}" fill="none" stroke="rgba(20,22,26,.4)" stroke-width="1" vector-effect="non-scaling-stroke"/>` +
      `<rect class="flat-ring" x="${n(p.box.x)}" y="${n(p.box.y)}" width="${n(p.box.w)}" height="${n(p.box.h)}" fill="none" stroke="${SEL}" stroke-width="5" vector-effect="non-scaling-stroke" opacity="0" pointer-events="none"/>` +
      `</g>`
    );
  }
  if (opts.safe !== false) {
    for (const p of layout.panels) {
      const r = p.safeFlat;
      body.push(`<rect class="flat-safe" x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" fill="none" stroke="${SAFE}" stroke-width="1.5" stroke-dasharray="5 4" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
    }
  }
  body.push(`<polygon class="flat-cut" points="${poly(layout.outline)}" fill="none" stroke="${TRIM}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
  for (const p of layout.panels) body.push(text(p.box.x + p.box.w / 2, p.box.y + p.box.h / 2, p.label));
  const sel = layout.panels.find((p) => p.id === opts.selected);
  if (sel) {
    const b = sel.box;
    body.push(`<rect class="flat-sel" x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" fill="none" stroke="rgba(20,22,26,.85)" stroke-width="6" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
    body.push(`<rect class="flat-sel" x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" fill="none" stroke="${SEL}" stroke-width="3" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
  }
  const cls = opts.className ? ` class="${esc(opts.className)}"` : '';
  const aria = opts.label ? ` role="group" aria-label="${esc(opts.label)}"` : ' aria-hidden="true"';
  return `<svg xmlns="http://www.w3.org/2000/svg"${cls} viewBox="${n(area.x)} ${n(area.y)} ${n(area.w)} ${n(area.h)}" preserveAspectRatio="xMidYMid meet"${aria}><defs>${defs.join('')}</defs>${body.join('')}</svg>`;
}

// A canvas holding the flat on a white page, at most `maxPx` on its long edge: the cut shape, every panel turned
// the way it prints, the panel names and the cut line. Used for the proof request.
export function renderFlatToCanvas(doc, pi, env, maxPx, assets, existing) {
  const layout = flatOf(doc, pi, env);
  if (!layout) return null;
  const area = flatArea(layout, 1.5);
  const scale = maxPx / Math.max(area.w, area.h);
  const w = Math.max(1, Math.round(area.w * scale));
  const h = Math.max(1, Math.round(area.h * scale));
  const canvas = existing && existing.width === w && existing.height === h ? existing : Object.assign(existing || document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  ctx.setTransform(scale, 0, 0, scale, -area.x * scale, -area.y * scale);
  const path = new Path2D();
  layout.outline.forEach((p, i) => (i ? path.lineTo(p[0], p[1]) : path.moveTo(p[0], p[1])));
  path.closePath();
  ctx.fillStyle = baseColorOf(doc, pi);
  ctx.fill(path);
  const fs = Math.max(2.2, Math.min(layout.bounds.h * 0.06, 4.2));
  const label = (x, y, text, one) => {
    const parts = one ? [text] : lines(text);
    ctx.font = `700 ${fs}px Barlow, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.lineWidth = fs * 0.28;
    ctx.strokeStyle = 'rgba(20,22,26,.85)';
    ctx.fillStyle = '#fff';
    const y0 = y - ((parts.length - 1) * fs * 1.05) / 2 + fs * 0.35;
    parts.forEach((l, i) => {
      ctx.strokeText(l, x, y0 + i * fs * 1.05);
      ctx.fillText(l, x, y0 + i * fs * 1.05);
    });
  };
  for (const d of layout.drape) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(d.box.x, d.box.y, d.box.w, d.box.h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(20,22,26,.4)';
    ctx.lineWidth = 0.45;
    for (let k = -d.box.h; k < d.box.w + d.box.h; k += 2.2 * Math.SQRT2) {
      ctx.beginPath();
      ctx.moveTo(d.box.x + k, d.box.y);
      ctx.lineTo(d.box.x + k + d.box.h, d.box.y + d.box.h);
      ctx.stroke();
    }
    ctx.restore();
    label(d.box.x + d.box.w / 2, d.box.y + d.box.h / 2, d.label);
  }
  for (const p of layout.panels) {
    const display = sideDisplay(doc, pi, p.index, env, { region: 'trim', assets });
    ctx.save();
    ctx.transform(p.matrix[0], p.matrix[1], p.matrix[2], p.matrix[3], p.matrix[4], p.matrix[5]);
    ctx.beginPath();
    ctx.rect(0, 0, p.size.w, p.size.h);
    ctx.clip();
    paintDisplay(ctx, display, assets);
    ctx.restore();
    ctx.strokeStyle = 'rgba(20,22,26,.4)';
    ctx.lineWidth = 0.25;
    ctx.strokeRect(p.box.x, p.box.y, p.box.w, p.box.h);
  }
  ctx.lineWidth = 0.4;
  ctx.strokeStyle = TRIM;
  ctx.lineJoin = 'round';
  ctx.stroke(path);
  for (const p of layout.panels) label(p.box.x + p.box.w / 2, p.box.y + p.box.h / 2, p.label);
  for (const s of layout.strips) label(s.box.x + s.box.w / 2, s.box.y + s.box.h / 2 - 0.2, s.label, true);
  return canvas;
}
