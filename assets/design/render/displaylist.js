// Display list: the one description of a drawn side that both backends (SVG for the editor, canvas
// for 3D textures and PNG previews) follow. Everything is already resolved: colors are hex, text is
// already broken into lines with baselines, shapes are path strings. Coordinates are inches.
import { specFor } from '../model/specs.js';
import { effectiveSide } from '../model/document.js';
import { layoutOf } from '../model/layout.js';
import { shapePath } from '../model/shapes.js';
import { resolveColor } from '../model/color.js';

function resolveBg(bg, palette) {
  if (bg.type === 'gradient') {
    return { type: 'gradient', from: resolveColor(bg.from, palette), to: resolveColor(bg.to, palette), angle: bg.angle == null ? 90 : bg.angle };
  }
  return { type: 'solid', color: resolveColor(bg.color, palette) };
}

function strokeOf(stroke, palette) {
  if (!stroke || !(stroke.w > 0)) return null;
  return { color: resolveColor(stroke.color, palette), w: stroke.w };
}

export function elementItem(el, doc, env, assets) {
  const palette = doc.project.palette;
  const base = { id: el.id, x: el.x, y: el.y, rot: el.rot || 0, opacity: el.opacity == null ? 1 : el.opacity };
  if (el.type === 'text') {
    const lay = layoutOf(el, env.measure, env.fonts);
    const font = env.fonts.find((f) => f.id === el.font) || env.fonts[0];
    const lines = lay.lines.filter((l) => l.text.length).map((l) => ({ t: l.text, x: l.x, y: l.baseline }));
    if (!lines.length) return null;
    return {
      ...base, k: 'text', w: el.w, h: lay.blockH, lines, family: font.family, weight: font.weight, size: el.size,
      ls: (el.ls || 0) * el.size, fill: resolveColor(el.fill, palette, '#000000'), stroke: strokeOf(el.stroke, palette),
    };
  }
  if (el.type === 'shape') {
    return {
      ...base, k: 'path', w: el.w, h: el.h, d: shapePath(el.kind, el.w, el.h, el.rx),
      fill: resolveColor(el.fill, palette, '#000000'), stroke: strokeOf(el.stroke, palette),
    };
  }
  if (el.type === 'image') {
    const asset = el.logoId && assets && assets.get(el.logoId);
    if (asset) return { ...base, k: 'image', w: el.w, h: el.h, logoId: el.logoId };
    return { ...base, k: 'frame', w: el.w, h: el.h, label: el.logoId ? 'Add your logo again' : 'Your logo here' };
  }
  return null;
}

// opts: {region: 'art' | 'trim', hide: Set of ids, assets: Map(logoId -> {src, img, w, h})}
export function sideDisplay(doc, pi, si, env, opts = {}) {
  const piece = doc.project.pieces[pi];
  const side = effectiveSide(piece, si);
  const spec = specFor(env.specs, piece.productId, piece.choices);
  const area = opts.region === 'trim' ? spec.trim : spec.art;
  const items = [];
  for (const el of side.elements) {
    if (el.hidden || (opts.hide && opts.hide.has(el.id))) continue;
    const item = elementItem(el, doc, env, opts.assets);
    if (item) items.push(item);
  }
  return { area, bg: resolveBg(side.bg, doc.project.palette), items, spec };
}

// Direction of a linear gradient across `area` at `angle` degrees (0 = left to right, 90 = top to bottom).
export function gradientLine(area, angle) {
  const a = (angle * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const half = (Math.abs(area.w * dx) + Math.abs(area.h * dy)) / 2;
  const cx = area.x + area.w / 2;
  const cy = area.y + area.h / 2;
  return { x1: cx - dx * half, y1: cy - dy * half, x2: cx + dx * half, y2: cy + dy * half };
}

// Look of the empty "Your logo here" frame, shared by both backends. The dash length is worked out
// from the outline so the pattern closes cleanly at the corners.
export function frameStyle(w, h) {
  const m = Math.min(w, h);
  const sw = Math.max(0.05, m * 0.02);
  const r = Math.min(m * 0.05, w / 2, h / 2);
  const perimeter = 2 * (w + h) - (8 - 2 * Math.PI) * r;
  const count = Math.max(8, Math.round(perimeter / Math.max(0.25, m * 0.11)));
  const period = perimeter / count;
  return { m, sw, r, fs: Math.max(0.3, m * 0.1), dash: period * 0.6, gap: period * 0.4 };
}
