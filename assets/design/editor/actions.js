// Editing actions shared by the stage, the toolbar and the side panels. Each one reads the store,
// builds a new document with a model command and commits it (one undo step) or previews it.
import {
  addElement, updateElement, updateElements, removeElements, duplicateElements, reorderElement,
  findElement, setField, templateOf,
} from '../model/document.js';
import { elementBox, layoutText } from '../model/layout.js';
import { aabb, alignArea, alignBoxes, center } from '../model/geometry.js';
import { specFor } from '../model/specs.js';

const TEXT_PRESETS = {
  headline: { label: 'Headline', ref: 0.28, text: 'YOUR HEADLINE' },
  subhead: { label: 'Subhead', ref: 0.14, text: 'YOUR SUBHEAD' },
  caption: { label: 'Caption', ref: 0.08, text: 'Your caption' },
};

export function textPresets() {
  return Object.entries(TEXT_PRESETS).map(([id, p]) => ({ id, label: p.label }));
}

export function createActions(store) {
  const { env } = store;
  const st = store.state;
  const where = () => [st.view.pi, st.view.si];
  const piece = () => st.doc.project.pieces[st.view.pi];
  const side = () => piece().sides[st.view.si];
  const spec = () => specFor(env.specs, piece().productId, piece().choices);
  const unlocked = () => st.selection.filter((id) => {
    const el = findElement(side(), id);
    return el && !el.locked;
  });

  const api = {
    spec,
    side,
    piece,

    select(ids) {
      store.set({ selection: ids });
    },

    // opts: {live: preview only, key: coalesce key}
    setElement(id, patch, opts = {}) {
      const [pi, si] = where();
      const doc = updateElement(st.doc, pi, si, id, patch, env);
      if (opts.live) store.preview(doc);
      else store.commit(doc, { key: opts.key });
    },

    setElements(patches, opts = {}) {
      const [pi, si] = where();
      const doc = updateElements(st.doc, pi, si, patches, env);
      if (opts.live) store.preview(doc);
      else store.commit(doc, { key: opts.key });
    },

    // Typing into the design. A bound element (name, phone...) edits the shared field when every
    // side shares one design; otherwise it becomes its own text for this side.
    setTextValue(id, value, opts = {}) {
      const [pi, si] = where();
      const p = piece();
      const el = findElement(side(), id);
      if (!el) return;
      const global = p.sidesMode === 'same' || p.sides.length === 1;
      const doc = el.bind && global
        ? setField(st.doc, el.bind, value, env)
        : updateElement(st.doc, pi, si, id, { text: String(value).slice(0, 500), bind: null }, env);
      if (opts.live) store.preview(doc);
      else store.commit(doc, { key: opts.key || 'text:' + id });
    },

    commitCurrent(key) {
      store.commit(st.doc, { key });
    },

    nudge(dx, dy, key) {
      const ids = unlocked();
      if (!ids.length) return;
      const patches = {};
      for (const id of ids) {
        const el = findElement(side(), id);
        patches[id] = { x: el.x + dx, y: el.y + dy };
      }
      api.setElements(patches, { key: key || 'nudge' });
    },

    // Scale selected elements about their centers by `factor`.
    scale(factor, key) {
      const ids = unlocked();
      const patches = {};
      for (const id of ids) {
        const el = findElement(side(), id);
        const box = elementBox(el, env.measure, env.fonts);
        const w = box.w * factor;
        const h = box.h * factor;
        const c = center(box);
        const patch = { w };
        if (el.type === 'text') patch.size = Math.max(0.2, el.size * factor);
        else patch.h = h;
        patch.x = c.x - w / 2;
        patch.y = c.y - h / 2;
        patches[id] = patch;
      }
      if (ids.length) api.setElements(patches, { key: key || 'scale' });
    },

    remove() {
      const ids = unlocked();
      if (!ids.length) return;
      const [pi, si] = where();
      store.commit(removeElements(st.doc, pi, si, ids));
      store.set({ selection: [] });
    },

    duplicate() {
      const ids = unlocked();
      if (!ids.length) return;
      const [pi, si] = where();
      const res = duplicateElements(st.doc, pi, si, ids, Math.max(0.5, spec().safe.w * 0.015));
      if (!res.ids.length) return;
      store.commit(res.doc, { select: res.ids });
    },

    reorder(action) {
      const ids = unlocked();
      if (!ids.length) return;
      const [pi, si] = where();
      let doc = st.doc;
      const ordered = action === 'front' || action === 'forward' ? ids : ids.slice().reverse();
      for (const id of ordered) doc = reorderElement(doc, pi, si, id, action);
      store.commit(doc);
    },

    align(edge) {
      const ids = unlocked();
      if (!ids.length) return;
      const items = ids.map((id) => ({ id, box: elementBox(findElement(side(), id), env.measure, env.fonts) }));
      let area = alignArea(spec(), items[0].box, edge);
      if (items.length > 1) {
        const boxes = items.map((it) => aabb(it.box));
        const x = Math.min(...boxes.map((b) => b.x));
        const y = Math.min(...boxes.map((b) => b.y));
        area = { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
      }
      const moves = alignBoxes(items, area, edge);
      const patches = {};
      for (const id of ids) {
        const el = findElement(side(), id);
        const target = moves[id];
        patches[id] = { x: el.x + (target.x - items.find((i) => i.id === id).box.x), y: el.y + (target.y - items.find((i) => i.id === id).box.y) };
      }
      api.setElements(patches);
    },

    toggleHidden(id) {
      const el = findElement(side(), id);
      if (el) api.setElement(id, { hidden: !el.hidden });
    },

    toggleLocked(id) {
      const el = findElement(side(), id);
      if (!el) return;
      api.setElement(id, { locked: !el.locked });
      if (!el.locked) store.set({ selection: st.selection.filter((s) => s !== id) });
    },

    rename(id, name) {
      api.setElement(id, { name: String(name).slice(0, 40) || 'Layer' });
    },

    // The font a new text layer starts with: the template's own, else the first.
    defaultFont() {
      const p = piece();
      const tpl = templateOf(env, p.productId, p.templateId);
      return (tpl && tpl.font) || env.fonts[0].id;
    },

    addText(presetId = 'headline') {
      const [pi, si] = where();
      const preset = TEXT_PRESETS[presetId] || TEXT_PRESETS.headline;
      const s = spec();
      const fontId = api.defaultFont();
      const font = env.fonts.find((f) => f.id === fontId) || env.fonts[0];
      const area = s.regions.peak || s.safe;
      const ref = Math.min(area.w, area.h);
      let size = Math.max(0.4, ref * preset.ref);
      if (presetId !== 'caption') size = Math.max(size, (s.minCapIn * 1.1) / font.cap);
      const w = Math.min(area.w, Math.max(size * 8, 2));
      const el = { type: 'text', name: preset.label, text: preset.text, bind: null, font: fontId, size, lh: 1, ls: 0, align: 'center', caps: presetId !== 'caption', fill: '@ink', stroke: null, fit: null, x: 0, y: 0, w };
      const lay = layoutText(el, env.measure, env.fonts);
      el.x = area.x + (area.w - w) / 2;
      el.y = area.y + (area.h - lay.blockH) / 2;
      const next = addElement(st.doc, pi, si, el);
      if (next === st.doc) return null;
      const id = next.project.pieces[pi].sides[si].elements.slice(-1)[0].id;
      store.commit(next, { select: [id] });
      return id;
    },

    addShape(kind = 'rect') {
      const [pi, si] = where();
      const s = spec();
      const area = s.regions.peak || s.safe;
      const size = Math.min(area.w, area.h) * 0.45;
      const w = kind === 'chevron' ? size * 1.6 : size;
      const el = { type: 'shape', kind, name: kind[0].toUpperCase() + kind.slice(1), x: area.x + (area.w - w) / 2, y: area.y + (area.h - size) / 2, w, h: size, fill: '@accent', stroke: null, rx: 0 };
      const next = addElement(st.doc, pi, si, el);
      if (next === st.doc) return null;
      const id = next.project.pieces[pi].sides[si].elements.slice(-1)[0].id;
      store.commit(next, { select: [id] });
      return id;
    },
  };
  return api;
}
