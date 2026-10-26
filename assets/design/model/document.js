// The design document: one JSON object that the editor, the 3D textures, share links and the proof
// request all read. Units are inches, the origin is the top left of the trim, rotation is degrees
// about the element center. Every command below is a pure function that returns a new document and
// leaves the old one untouched, so undo and redo are just snapshots.
//
// {v:2, project:{pieces:[{id, productId, choices, qty, templateId, sidesMode:'same'|'each',
//    sides:[{id, name, templateId, edited, bg, elements:[...]}]}],
//  palette:{primary,accent,ink}, fields:{name,line2,phone,web}, logos:[{id,name,w,h,type}],
//  touched:{palette,fields}}}
import { uid } from './ids.js';
import { specFor } from './specs.js';
import { buildTemplateSide, refitText } from './templates.js';
import { normalizeHex } from './color.js';

export const DOC_VERSION = 2;
export const MAX_ELEMENTS = 80;
export const MAX_PIECES = 6;
const GEOMETRY_KEYS = ['x', 'y', 'w', 'h', 'size', 'rot'];
const REFIT_KEYS = ['text', 'font', 'lh', 'ls', 'caps'];

export function productOf(env, productId) {
  const p = env.catalog.products.find((x) => x.id === productId);
  if (!p) throw new Error('Unknown product ' + productId);
  return p;
}

export function defaultChoices(product) {
  const out = {};
  for (const g of product.groups) out[g.id] = g.choices[0].id;
  return out;
}

export function sideNamesFor(product, choices) {
  const s = product.sides;
  if (s.mode === 'by_choice') return s.names[choices[s.group]] || s.names[Object.keys(s.names)[0]];
  return s.names;
}

export function templateOf(env, productId, templateId) {
  const list = env.templates[productId] || [];
  return list.find((t) => t.id === templateId) || list[0];
}

export function getPiece(doc, pi) {
  return doc.project.pieces[pi];
}

export function getSide(doc, pi, si) {
  return doc.project.pieces[pi].sides[si];
}

// The side that is actually drawn for side index `si` (all sides use side 0 in 'same' mode).
export function effectiveSide(piece, si) {
  return piece.sidesMode === 'same' ? piece.sides[0] : piece.sides[si] || piece.sides[0];
}

export function findElement(side, id) {
  return side.elements.find((e) => e.id === id) || null;
}

function newSide(env, product, piece, name, template, fields, spec) {
  const built = buildTemplateSide(template, spec, fields, env);
  return { id: uid('s'), name, templateId: template.id, edited: false, bg: built.bg, elements: built.elements };
}

export function createDocument(env, productId, opts = {}) {
  const product = productOf(env, productId);
  const choices = { ...defaultChoices(product), ...(opts.choices || {}) };
  const template = templateOf(env, productId, opts.templateId || product.templates[0]);
  const palette = { ...(opts.palette || template.palette) };
  const fields = { ...(opts.fields || template.sample) };
  const spec = specFor(env.specs, productId, choices);
  const names = sideNamesFor(product, choices);
  const piece = { id: uid('p'), productId, choices, qty: 1, templateId: template.id, sidesMode: 'same', sides: [] };
  piece.sides = names.map((name) => newSide(env, product, piece, name, template, fields, spec));
  return {
    v: DOC_VERSION,
    project: { pieces: [piece], palette, fields, logos: [], touched: { palette: false, fields: false } },
  };
}

// ---------- update plumbing ----------

function mapPiece(doc, pi, fn) {
  const pieces = doc.project.pieces.map((p, i) => (i === pi ? fn(p) : p));
  return { ...doc, project: { ...doc.project, pieces } };
}

function mapSide(doc, pi, si, fn) {
  return mapPiece(doc, pi, (piece) => ({ ...piece, sides: piece.sides.map((s, i) => (i === si ? fn(s) : s)) }));
}

function editedSide(side, patch) {
  return { ...side, ...patch, edited: true };
}

// ---------- elements ----------

export function addElement(doc, pi, si, el, index) {
  const side = getSide(doc, pi, si);
  if (side.elements.length >= MAX_ELEMENTS) return doc;
  const withId = { id: uid('e'), rot: 0, opacity: 1, hidden: false, locked: false, ...el };
  return mapSide(doc, pi, si, (s) => {
    const list = s.elements.slice();
    list.splice(index == null ? list.length : index, 0, withId);
    return editedSide(s, { elements: list });
  });
}

export function updateElement(doc, pi, si, id, patch, env) {
  const side = getSide(doc, pi, si);
  if (!findElement(side, id)) return doc;
  return mapSide(doc, pi, si, (s) =>
    editedSide(s, {
      elements: s.elements.map((e) => {
        if (e.id !== id) return e;
        let next = { ...e, ...patch };
        if (e.type === 'text' && e.fit) {
          if (GEOMETRY_KEYS.some((k) => k in patch)) next.fit = null;
          else if (REFIT_KEYS.some((k) => k in patch)) next = refitText(next, env);
        }
        return next;
      }),
    })
  );
}

// Several elements at once (drag a selection, nudge, align). patches: {id: patch}
export function updateElements(doc, pi, si, patches, env) {
  let out = doc;
  for (const id of Object.keys(patches)) out = updateElement(out, pi, si, id, patches[id], env);
  return out;
}

export function removeElements(doc, pi, si, ids) {
  const drop = new Set(ids);
  const side = getSide(doc, pi, si);
  if (!side.elements.some((e) => drop.has(e.id))) return doc;
  return mapSide(doc, pi, si, (s) => editedSide(s, { elements: s.elements.filter((e) => !drop.has(e.id)) }));
}

export function duplicateElements(doc, pi, si, ids, offset = 1) {
  const side = getSide(doc, pi, si);
  const copies = [];
  for (const e of side.elements) {
    if (ids.includes(e.id)) {
      const copy = { ...JSON.parse(JSON.stringify(e)), id: uid('e'), x: e.x + offset, y: e.y + offset };
      // a copy of a bound or fitted text is a free text: it no longer follows the name fields
      if (e.type === 'text') {
        copy.bind = null;
        copy.fit = null;
      }
      copies.push(copy);
    }
  }
  if (!copies.length || side.elements.length + copies.length > MAX_ELEMENTS) return { doc, ids: [] };
  const next = mapSide(doc, pi, si, (s) => editedSide(s, { elements: s.elements.concat(copies) }));
  return { doc: next, ids: copies.map((c) => c.id) };
}

// action: 'front' | 'back' | 'forward' | 'backward' | a target index
export function reorderElement(doc, pi, si, id, action) {
  const side = getSide(doc, pi, si);
  const from = side.elements.findIndex((e) => e.id === id);
  if (from < 0) return doc;
  const last = side.elements.length - 1;
  let to = from;
  if (action === 'front') to = last;
  else if (action === 'back') to = 0;
  else if (action === 'forward') to = Math.min(last, from + 1);
  else if (action === 'backward') to = Math.max(0, from - 1);
  else if (typeof action === 'number') to = Math.max(0, Math.min(last, action));
  if (to === from) return doc;
  return mapSide(doc, pi, si, (s) => {
    const list = s.elements.slice();
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    return editedSide(s, { elements: list });
  });
}

export function setBackground(doc, pi, si, bg) {
  return mapSide(doc, pi, si, (s) => editedSide(s, { bg }));
}

// ---------- project-wide fields and colors ----------

export function setField(doc, field, value, env) {
  const v = String(value == null ? '' : value).slice(0, 120);
  if (doc.project.fields[field] === v) return doc;
  const pieces = doc.project.pieces.map((piece) => ({
    ...piece,
    sides: piece.sides.map((side) => ({
      ...side,
      elements: side.elements.map((e) => (e.type === 'text' && e.bind === field ? refitText({ ...e, text: v }, env) : e)),
    })),
  }));
  const touched = { ...doc.project.touched, fields: true };
  return { ...doc, project: { ...doc.project, pieces, fields: { ...doc.project.fields, [field]: v }, touched } };
}

export function setPalette(doc, patch) {
  const palette = { ...doc.project.palette };
  for (const k of ['primary', 'accent', 'ink']) {
    if (patch[k] != null) palette[k] = normalizeHex(patch[k]) || palette[k];
  }
  return { ...doc, project: { ...doc.project, palette, touched: { ...doc.project.touched, palette: true } } };
}

// ---------- pieces: options, quantity, sides ----------

function scaleSide(side, from, to, env) {
  const sx = to.w / from.w;
  const sy = to.h / from.h;
  const k = Math.min(sx, sy);
  return {
    ...side,
    elements: side.elements.map((e) => {
      const next = { ...e, x: e.x * sx, y: e.y * sy };
      if (e.type === 'text') {
        next.w = e.w * sx;
        next.size = e.size * k;
        next.fit = null;
      } else {
        next.w = e.w * sx;
        next.h = e.h * sy;
      }
      return next;
    }),
  };
}

export function setChoices(doc, pi, patch, env) {
  const piece = getPiece(doc, pi);
  const product = productOf(env, piece.productId);
  const choices = { ...piece.choices };
  for (const g of product.groups) {
    if (patch[g.id] != null && g.choices.some((c) => c.id === patch[g.id])) choices[g.id] = patch[g.id];
  }
  const before = specFor(env.specs, piece.productId, piece.choices);
  const after = specFor(env.specs, piece.productId, choices);
  const names = sideNamesFor(product, choices);
  const template = templateOf(env, piece.productId, piece.templateId);
  const resized = before.artboard.w !== after.artboard.w || before.artboard.h !== after.artboard.h;
  return mapPiece(doc, pi, (p) => {
    let sides = p.sides.slice();
    while (sides.length < names.length) {
      const src = sides[0];
      sides.push({ ...JSON.parse(JSON.stringify(src)), id: uid('s'), elements: src.elements.map((e) => ({ ...e, id: uid('e') })) });
    }
    sides = sides.slice(0, names.length).map((s, i) => ({ ...s, name: names[i] }));
    if (resized) {
      sides = sides.map((s) => {
        if (!s.edited) {
          const tpl = templateOf(env, p.productId, s.templateId) || template;
          const built = buildTemplateSide(tpl, after, doc.project.fields, env);
          return { ...s, bg: built.bg, elements: built.elements };
        }
        return scaleSide(s, before.artboard, after.artboard, env);
      });
    }
    return { ...p, choices, sides, qty: product.qty ? p.qty : 1 };
  });
}

export function setQty(doc, pi, qty) {
  const piece = getPiece(doc, pi);
  const n = Math.round(Number(qty));
  return mapPiece(doc, pi, (p) => ({ ...p, qty: Math.max(1, Math.min(20, isFinite(n) ? n : p.qty)) }));
}

export function copySide(doc, pi, from, targets) {
  const piece = getPiece(doc, pi);
  const src = piece.sides[from];
  if (!src) return doc;
  return mapPiece(doc, pi, (p) => ({
    ...p,
    sides: p.sides.map((s, i) => {
      if (i === from || !targets.includes(i)) return s;
      return { ...s, bg: JSON.parse(JSON.stringify(src.bg)), edited: src.edited, templateId: src.templateId, elements: src.elements.map((e) => ({ ...JSON.parse(JSON.stringify(e)), id: uid('e') })) };
    }),
  }));
}

export function setSidesMode(doc, pi, mode) {
  const piece = getPiece(doc, pi);
  if (piece.sidesMode === mode) return doc;
  if (mode === 'each') {
    const targets = piece.sides.map((_, i) => i).filter((i) => i > 0);
    return mapPiece(copySide(doc, pi, 0, targets), pi, (p) => ({ ...p, sidesMode: 'each' }));
  }
  return mapPiece(doc, pi, (p) => ({ ...p, sidesMode: 'same' }));
}

// Apply a template to one side (or to all sides when the piece is in 'same' mode). The brand colors
// and sample wording follow the template only while the customer has not set their own.
export function applyTemplate(doc, pi, si, templateId, env) {
  const piece = getPiece(doc, pi);
  const template = templateOf(env, piece.productId, templateId);
  const spec = specFor(env.specs, piece.productId, piece.choices);
  const global = piece.sidesMode === 'same' || piece.sides.length === 1;
  const touched = doc.project.touched;
  const palette = !touched.palette && global ? { ...template.palette } : doc.project.palette;
  const fields = !touched.fields && global ? { ...template.sample } : doc.project.fields;
  let next = { ...doc, project: { ...doc.project, palette, fields } };
  const targets = global ? piece.sides.map((_, i) => i) : [si];
  for (const i of targets) {
    const built = buildTemplateSide(template, spec, fields, env);
    next = mapSide(next, pi, i, (s) => ({ ...s, templateId: template.id, edited: false, bg: built.bg, elements: built.elements }));
  }
  return mapPiece(next, pi, (p) => ({ ...p, templateId: template.id }));
}

// ---------- logos ----------

export function addLogo(doc, meta) {
  const logo = { id: meta.id || uid('l'), name: String(meta.name || 'logo').slice(0, 80), w: meta.w, h: meta.h, type: meta.type, vector: !!meta.vector };
  return { doc: { ...doc, project: { ...doc.project, logos: doc.project.logos.concat([logo]) } }, logo };
}

export function removeLogo(doc, id) {
  const pieces = doc.project.pieces.map((piece) => ({
    ...piece,
    sides: piece.sides.map((side) => ({
      ...side,
      elements: side.elements.map((e) => (e.type === 'image' && e.logoId === id ? { ...e, logoId: null } : e)),
    })),
  }));
  return { ...doc, project: { ...doc.project, pieces, logos: doc.project.logos.filter((l) => l.id !== id) } };
}

// Put a logo in the first empty logo frame of a side; if there is none, add a new image element.
export function placeLogo(doc, pi, si, logoId, env) {
  const logo = doc.project.logos.find((l) => l.id === logoId);
  if (!logo) return { doc, id: null };
  const side = getSide(doc, pi, si);
  const aspect = logo.w / logo.h || 1;
  const frame = side.elements.find((e) => e.type === 'image' && !e.logoId && !e.locked);
  if (frame) {
    let w = frame.w;
    let h = w / aspect;
    if (h > frame.h) {
      h = frame.h;
      w = h * aspect;
    }
    const cx = frame.x + frame.w / 2;
    const cy = frame.y + frame.h / 2;
    const patch = { logoId, x: cx - w / 2, y: cy - h / 2, w, h, name: 'Logo' };
    return { doc: updateElement(doc, pi, si, frame.id, patch, env), id: frame.id };
  }
  const spec = specFor(env.specs, getPiece(doc, pi).productId, getPiece(doc, pi).choices);
  const target = Math.min(spec.safe.w, spec.safe.h) * 0.34;
  let w = target;
  let h = w / aspect;
  if (h > target) {
    h = target;
    w = h * aspect;
  }
  const el = { type: 'image', name: 'Logo', logoId, x: spec.safe.x + (spec.safe.w - w) / 2, y: spec.safe.y + (spec.safe.h - h) / 2, w, h, keepAspect: true };
  const next = addElement(doc, pi, si, el);
  const added = next === doc ? null : getSide(next, pi, si).elements.slice(-1)[0].id;
  return { doc: next, id: added };
}

// ---------- validation (also used on share links and on the server) ----------

const ID_OK = /^[A-Za-z0-9_-]{1,40}$/;
const finite = (n) => typeof n === 'number' && isFinite(n);

export function validateDocument(doc, env) {
  const errors = [];
  const bad = (msg) => errors.push(msg);
  if (!doc || doc.v !== DOC_VERSION || !doc.project) return { ok: false, errors: ['not a v2 design'] };
  const proj = doc.project;
  if (!Array.isArray(proj.pieces) || proj.pieces.length < 1 || proj.pieces.length > MAX_PIECES) bad('piece count');
  for (const k of ['primary', 'accent', 'ink']) if (!normalizeHex((proj.palette || {})[k])) bad('palette ' + k);
  for (const k of ['name', 'line2', 'phone', 'web']) {
    if (typeof (proj.fields || {})[k] !== 'string' || proj.fields[k].length > 200) bad('field ' + k);
  }
  if (!Array.isArray(proj.logos) || proj.logos.length > 8) bad('logos');
  const fontIds = new Set(env.fonts.map((f) => f.id));
  const seen = new Set();
  const colorOk = (c) => c == null || /^@(primary|accent|ink)$/.test(c) || !!normalizeHex(c);
  for (const piece of Array.isArray(proj.pieces) ? proj.pieces : []) {
    const product = env.catalog.products.find((p) => p.id === piece.productId);
    if (!product) {
      bad('unknown product');
      continue;
    }
    for (const g of product.groups) {
      if (!g.choices.some((c) => c.id === (piece.choices || {})[g.id])) bad('choice ' + g.id);
    }
    const qtyMax = product.qty ? product.qty.max : 1;
    if (!Number.isInteger(piece.qty) || piece.qty < 1 || piece.qty > qtyMax) bad('qty');
    if (piece.sidesMode !== 'same' && piece.sidesMode !== 'each') bad('sidesMode');
    const names = sideNamesFor(product, piece.choices || {});
    if (!Array.isArray(piece.sides) || piece.sides.length !== names.length) {
      bad('side count');
      continue;
    }
    for (const side of piece.sides) {
      if (!Array.isArray(side.elements) || side.elements.length > MAX_ELEMENTS) {
        bad('element count');
        continue;
      }
      if (!side.bg || !(side.bg.type === 'solid' ? colorOk(side.bg.color) : side.bg.type === 'gradient' && colorOk(side.bg.from) && colorOk(side.bg.to))) bad('bg');
      for (const e of side.elements) {
        if (!ID_OK.test(e.id || '') || seen.has(e.id)) bad('element id');
        seen.add(e.id);
        if (!['text', 'shape', 'image'].includes(e.type)) bad('element type');
        for (const k of ['x', 'y', 'w', 'rot']) if (!finite(e[k])) bad('element ' + k);
        if (e.type !== 'text' && !finite(e.h)) bad('element h');
        if (Math.abs(e.x) > 1000 || Math.abs(e.y) > 1000 || e.w < 0 || e.w > 1000 || (e.h != null && (e.h < 0 || e.h > 1000))) bad('element range');
        if (!colorOk(e.fill)) bad('fill');
        if (e.stroke && (!colorOk(e.stroke.color) || !finite(e.stroke.w) || e.stroke.w < 0 || e.stroke.w > 50)) bad('stroke');
        if (e.type === 'text') {
          if (typeof e.text !== 'string' || e.text.length > 500) bad('text');
          if (!fontIds.has(e.font)) bad('font');
          if (!finite(e.size) || e.size <= 0 || e.size > 400) bad('size');
          if (!['left', 'center', 'right'].includes(e.align)) bad('align');
        }
        if (e.type === 'image' && e.logoId && !proj.logos.some((l) => l.id === e.logoId)) {
          // a share link carries no logo bytes; the editor shows a re-upload note
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

// All text elements that carry words, flattened, for summaries.
export function textSummary(piece) {
  const side = piece.sides[0];
  return side.elements.filter((e) => e.type === 'text' && !e.hidden && String(e.text).trim()).map((e) => e.text);
}
