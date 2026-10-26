import { h, iconButton, icon } from '../dom.js';
import { createColorPick } from '../colorpick.js';
import { setField, findElement } from '../../model/document.js';
import { fitText, layoutOf, isTooSmall, fontOf } from '../../model/layout.js';
import { textPresets } from '../../editor/actions.js';

const FIELDS = [
  ['name', 'Business or team name', 'text'],
  ['line2', 'Second line', 'text'],
  ['phone', 'Phone', 'tel'],
  ['web', 'Website', 'text'],
];

export function createTextTab(ctx) {
  const { store, env, actions } = ctx;
  const S = store.state;
  const el = h('div', { class: 'dz-tab-body' });

  // ---- shared fields ----
  const inputs = {};
  const fieldsBox = h('div', { class: 'dz-fields' });
  for (const [key, label, type] of FIELDS) {
    const input = h('input', {
      type, class: 'dz-input', maxlength: 120, autocomplete: 'off', enterkeyhint: 'done', 'aria-label': label,
      inputmode: type === 'tel' ? 'tel' : 'text',
      oninput: () => {
        store.commit(setField(S.doc, key, input.value, env), { key: 'field:' + key });
        ctx.track('text_edit', { field: key });
      },
    });
    inputs[key] = input;
    fieldsBox.append(h('label', { class: 'dz-field' }, h('span', null, label), input));
  }

  // ---- add text ----
  const addRow = h('div', { class: 'dz-chiprow' });
  for (const p of textPresets()) {
    addRow.append(h('button', { type: 'button', class: 'dz-chip', onclick: async () => { await ctx.ensureFonts([actions.defaultFont()]); const id = actions.addText(p.id); if (id) ctx.startEdit(id); } }, `+ ${p.label}`));
  }

  // ---- selected text ----
  const selBox = h('div', { class: 'dz-selected' });
  const textArea = h('textarea', { class: 'dz-input dz-textarea', rows: 2, 'aria-label': 'Text of the selected item', oninput: () => cur() && actions.setTextValue(cur().id, textArea.value, { key: 'selected-text' }) });
  const fontSel = h('select', { class: 'dz-input', 'aria-label': 'Font', onchange: async () => { await ctx.ensureFonts([fontSel.value]); if (cur()) actions.setElement(cur().id, { font: fontSel.value }); } });
  for (const f of env.fonts) fontSel.append(h('option', { value: f.id }, f.label));
  const sizeIn = h('input', { type: 'number', class: 'dz-input dz-num', step: '0.1', min: '0.2', max: '400', 'aria-label': 'Text size in inches', inputmode: 'decimal', onchange: () => {
    const v = parseFloat(sizeIn.value);
    if (cur() && v > 0) resizeText(v / cur().size);
  } });
  const ptRead = h('span', { class: 'dz-pt' });
  const grow = (f) => () => cur() && resizeText(f);
  const alignBtns = ['left', 'center', 'right'].map((a) => iconButton(`align-${a}`, `Align ${a}`, () => cur() && actions.setElement(cur().id, { align: a }), { class: 'dz-seg' }));
  const capsBtn = iconButton('caps', 'All caps', () => cur() && actions.setElement(cur().id, { caps: !cur().caps }), { class: 'dz-seg' });
  const fillPick = createColorPick(ctx, { label: 'Text color', value: '@ink', onPick: (v, final) => cur() && actions.setElement(cur().id, { fill: v }, { live: false, key: 'fill:' + cur().id }) });
  const outlineOn = h('input', { type: 'checkbox', id: 'dz-outline-on', onchange: () => {
    const e = cur();
    if (!e) return;
    actions.setElement(e.id, { stroke: outlineOn.checked ? { color: '@primary', w: e.size * 0.04 } : null });
  } });
  const outlinePick = createColorPick(ctx, { label: 'Outline color', value: '@primary', onPick: (v) => cur() && cur().stroke && actions.setElement(cur().id, { stroke: { ...cur().stroke, color: v } }, { key: 'stroke-color' }) });
  const outlineW = h('input', { type: 'range', min: '0', max: '15', step: '1', class: 'dz-range', 'aria-label': 'Outline width, percent of text size', oninput: () => {
    const e = cur();
    if (e && e.stroke) actions.setElement(e.id, { stroke: { ...e.stroke, w: (e.size * outlineW.value) / 100 } }, { key: 'stroke-w' });
  } });
  const lsRange = h('input', { type: 'range', min: '-5', max: '30', step: '1', class: 'dz-range', 'aria-label': 'Letter spacing', oninput: () => cur() && actions.setElement(cur().id, { ls: lsRange.value / 100 }, { key: 'ls' }) });
  const lhRange = h('input', { type: 'range', min: '70', max: '160', step: '5', class: 'dz-range', 'aria-label': 'Line height', oninput: () => cur() && actions.setElement(cur().id, { lh: lhRange.value / 100 }, { key: 'lh' }) });
  const fitBtn = h('button', { type: 'button', class: 'dz-chip', onclick: () => fitWidth() }, 'Fit to width');
  const warn = h('p', { class: 'dz-warn', role: 'status', hidden: true });
  const hint = h('p', { class: 'dz-help' }, 'Tap text on the design to edit it. Or add some:');

  selBox.append(
    h('h2', { class: 'dz-h3' }, 'Selected text'),
    textArea,
    h('div', { class: 'dz-row' }, h('label', { class: 'dz-field dz-grow' }, h('span', null, 'Font'), fontSel)),
    h('div', { class: 'dz-field' }, h('span', null, 'Size (inches)'),
      h('div', { class: 'dz-stepper' },
        iconButton('minus', 'Smaller', grow(0.92), { class: 'dz-seg' }), sizeIn, iconButton('plus', 'Bigger', grow(1.08), { class: 'dz-seg' }), ptRead)),
    h('div', { class: 'dz-row dz-segs' }, ...alignBtns, capsBtn, fitBtn),
    h('div', { class: 'dz-field' }, h('span', null, 'Text color'), fillPick.el),
    h('div', { class: 'dz-field' }, h('label', { class: 'dz-check', for: 'dz-outline-on' }, outlineOn, h('span', null, 'Outline')), outlinePick.el, outlineW),
    h('label', { class: 'dz-field' }, h('span', null, 'Letter spacing'), lsRange),
    h('label', { class: 'dz-field' }, h('span', null, 'Line height'), lhRange),
    warn
  );

  // ---- shapes ----
  const shapeRow = h('div', { class: 'dz-chiprow' });
  for (const [kind, label] of [['rect', 'Box'], ['ellipse', 'Circle'], ['triangle', 'Triangle'], ['star', 'Star'], ['chevron', 'Chevron'], ['badge', 'Seal']]) {
    shapeRow.append(h('button', { type: 'button', class: 'dz-chip', onclick: () => actions.addShape(kind) }, `+ ${label}`));
  }
  const shapeBox = h('div', { class: 'dz-selected' });
  const shapeFill = createColorPick(ctx, { label: 'Shape color', value: '@accent', onPick: (v) => curShape() && actions.setElement(curShape().id, { fill: v }, { key: 'shape-fill' }) });
  const shapeOutOn = h('input', { type: 'checkbox', id: 'dz-shape-outline', onchange: () => {
    const e = curShape();
    if (e) actions.setElement(e.id, { stroke: shapeOutOn.checked ? { color: '@ink', w: Math.min(e.w, e.h) * 0.04 } : null });
  } });
  const shapeOutPick = createColorPick(ctx, { label: 'Shape outline color', value: '@ink', onPick: (v) => curShape() && curShape().stroke && actions.setElement(curShape().id, { stroke: { ...curShape().stroke, color: v } }, { key: 'shape-stroke' }) });
  const shapeOutW = h('input', { type: 'range', min: '1', max: '20', step: '1', class: 'dz-range', 'aria-label': 'Outline width', oninput: () => {
    const e = curShape();
    if (e && e.stroke) actions.setElement(e.id, { stroke: { ...e.stroke, w: (Math.min(e.w, e.h) * shapeOutW.value) / 100 } }, { key: 'shape-stroke-w' });
  } });
  shapeBox.append(
    h('h2', { class: 'dz-h3' }, 'Selected shape'),
    h('div', { class: 'dz-field' }, h('span', null, 'Fill'), shapeFill.el),
    h('div', { class: 'dz-field' }, h('label', { class: 'dz-check', for: 'dz-shape-outline' }, shapeOutOn, h('span', null, 'Outline')), shapeOutPick.el, shapeOutW)
  );

  el.append(h('h2', { class: 'dz-h3' }, 'Your words'), fieldsBox, hint, addRow, selBox, h('h2', { class: 'dz-h3' }, 'Shapes'), shapeRow, shapeBox);

  function cur() {
    if (S.selection.length !== 1) return null;
    const piece = S.doc.project.pieces[S.view.pi];
    const e = findElement(piece.sides[S.view.si], S.selection[0]);
    return e && e.type === 'text' ? e : null;
  }

  function curShape() {
    if (S.selection.length !== 1) return null;
    const e = findElement(S.doc.project.pieces[S.view.pi].sides[S.view.si], S.selection[0]);
    return e && e.type === 'shape' ? e : null;
  }

  function resizeText(f) {
    const e = cur();
    if (!e) return;
    const box = { w: e.w, size: e.size };
    const size = Math.max(0.2, box.size * f);
    const k = size / box.size;
    actions.setElement(e.id, { size, w: box.w * k, x: e.x - (box.w * k - box.w) / 2 }, { key: 'size:' + e.id });
  }

  function fitWidth() {
    const e = cur();
    if (!e) return;
    const lines = layoutOf(e, env.measure, env.fonts).lines.length;
    const res = fitText({ text: e.text, font: e.font, ls: e.ls, lh: e.lh, caps: e.caps, lines, boxW: e.w, boxH: 1000, max: 400 }, env.measure, env.fonts);
    actions.setElement(e.id, { size: res.size });
  }

  function sync() {
    for (const [key] of FIELDS) {
      if (document.activeElement !== inputs[key]) inputs[key].value = S.doc.project.fields[key] || '';
    }
    const sh = curShape();
    shapeBox.hidden = !sh;
    if (sh) {
      shapeFill.set(sh.fill);
      shapeOutOn.checked = !!sh.stroke;
      shapeOutPick.el.hidden = !sh.stroke;
      shapeOutW.hidden = !sh.stroke;
      if (sh.stroke) {
        shapeOutPick.set(sh.stroke.color);
        shapeOutW.value = Math.round((sh.stroke.w / Math.min(sh.w, sh.h)) * 100);
      }
    }
    const e = cur();
    selBox.hidden = !e;
    hint.hidden = !!e;
    if (!e) return;
    const piece = S.doc.project.pieces[S.view.pi];
    const spec = actions.spec();
    if (document.activeElement !== textArea) textArea.value = e.text || '';
    fontSel.value = e.font;
    if (document.activeElement !== sizeIn) sizeIn.value = e.size.toFixed(2).replace(/\.?0+$/, '');
    ptRead.textContent = `${Math.round(e.size * 72)} pt`;
    alignBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(e.align === ['left', 'center', 'right'][i])));
    capsBtn.setAttribute('aria-pressed', String(!!e.caps));
    fillPick.set(e.fill);
    outlineOn.checked = !!e.stroke;
    outlinePick.el.hidden = !e.stroke;
    outlineW.hidden = !e.stroke;
    if (e.stroke) {
      outlinePick.set(e.stroke.color);
      outlineW.value = Math.round((e.stroke.w / e.size) * 100);
    }
    lsRange.value = Math.round((e.ls || 0) * 100);
    lhRange.value = Math.round((e.lh || 1) * 100);
    const small = isTooSmall(e, spec.minCapIn, env.fonts);
    warn.hidden = !small;
    if (small) {
      const need = (spec.minCapIn / fontOf(env.fonts, e.font).cap).toFixed(1);
      warn.textContent = `Hard to read from ${Math.round(spec.readFt)} ft. Make letters at least ${spec.minCapIn} in tall (about ${need} in text size).`;
    }
    void piece;
  }

  return {
    el,
    onShow: sync,
    update(state, keys) {
      if (keys.some((k) => ['doc', 'selection', 'view'].includes(k))) sync();
    },
  };
}
