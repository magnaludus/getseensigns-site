// Turns a template JSON (see src/design_templates) into real elements for one side of one piece.
// Template boxes are fractions of a named region, so one template adapts to every size of a product.
import { uid } from './ids.js';
import { fitText, alignInk } from './layout.js';

const FIELD_NAMES = { name: 'Name', line2: 'Second line', phone: 'Phone', web: 'Website' };

function boxIn(region, box, square) {
  const [bx, by, bw, bh] = box;
  const b = { x: region.x + bx * region.w, y: region.y + by * region.h, w: bw * region.w, h: bh * region.h };
  if (!square) return b;
  const side = Math.min(b.w, b.h);
  return { x: b.x + (b.w - side) / 2, y: b.y + (b.h - side) / 2, w: side, h: side };
}

// Size and place a text element so it fills its template box. Keeps `fit` so it can refit later.
export function refitText(el, env) {
  const fit = el.fit;
  if (!fit) return el;
  const sample = el.text && String(el.text).trim() ? el.text : fit.sample || 'X';
  const res = fitText(
    { text: sample, font: el.font, ls: el.ls, lh: el.lh, caps: el.caps, lines: fit.lines, max: fit.max, boxW: fit.w, boxH: fit.h, min: fit.min },
    env.measure,
    env.fonts
  );
  const next = { ...el, size: res.size, w: fit.w };
  next.x = fit.x;
  next.y = alignInk(res.layout, fit.y, fit.h, fit.valign);
  return next;
}

export function buildTemplateSide(template, spec, fields, env) {
  const elements = [];
  for (const t of template.elements) {
    const region = spec.regions[t.region];
    if (!region) continue;
    const b = boxIn(region, t.box, t.square);
    const rot = t.rot || 0;
    const base = { rot, opacity: t.opacity == null ? 1 : t.opacity, hidden: false, locked: false };
    if (t.type === 'shape') {
      const small = Math.min(b.w, b.h);
      elements.push({
        id: uid('e'), type: 'shape', kind: t.kind, name: t.name || 'Shape',
        x: b.x, y: b.y, w: b.w, h: b.h, fill: t.fill,
        stroke: t.stroke ? { color: t.stroke.color, w: (t.stroke.wf || 0.02) * small } : null,
        rx: (t.rxf || 0) * small, ...base,
      });
    } else if (t.type === 'image') {
      elements.push({
        id: uid('e'), type: 'image', name: t.name || 'Logo', logoId: null,
        x: b.x, y: b.y, w: b.w, h: b.h, keepAspect: true, ...base,
      });
    } else {
      const turned = rot === 90 || rot === -90;
      const bw = turned ? b.h : b.w;
      const bh = turned ? b.w : b.h;
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const font = t.font || template.font;
      const value = t.bind ? fields[t.bind] || '' : t.text;
      const el = {
        id: uid('e'), type: 'text', name: t.name || (t.bind ? FIELD_NAMES[t.bind] : 'Text'),
        x: cx - bw / 2, y: cy - bh / 2, w: bw, size: 1, text: value, bind: t.bind || null,
        font, lh: t.lh || 1, ls: t.ls || 0, align: t.align || 'center', caps: !!t.caps, fill: t.fill,
        stroke: null, ...base,
        fit: {
          x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh, lines: (t.fit && t.fit.lines) || 1,
          max: (t.fit && t.fit.max) || null, min: (t.fit && t.fit.min) || null, valign: t.valign || 'middle',
          sample: template.sample[t.bind] || t.text || 'X',
        },
      };
      const fitted = refitText(el, env);
      if (t.stroke) fitted.stroke = { color: t.stroke.color, w: (t.stroke.wf || 0.04) * fitted.size };
      elements.push(fitted);
    }
  }
  return { bg: JSON.parse(JSON.stringify(template.bg)), elements };
}
