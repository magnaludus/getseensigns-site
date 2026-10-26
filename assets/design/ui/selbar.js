// The floating toolbar over the stage for the selected item.
import { h, iconButton } from './dom.js';
import { createColorPick } from './colorpick.js';
import { openPopover } from './popover.js';
import { findElement } from '../model/document.js';

export function createSelbar(ctx) {
  const { store, actions } = ctx;
  const S = store.state;
  const el = h('div', { class: 'dz-selbar', role: 'toolbar', 'aria-label': 'Selected item', hidden: true });
  const edit = iconButton('edit', 'Edit text', () => ctx.startEdit(S.selection[0]));
  const smaller = iconButton('minus', 'Make smaller', () => actions.scale(0.92, 'scale'));
  const bigger = iconButton('plus', 'Make bigger', () => actions.scale(1.08, 'scale'));
  const colorBtn = iconButton('palette', 'Color', () => openColor(colorBtn));
  const alignBtn = iconButton('align-center', 'Align on the sign', () => openAlign(alignBtn));
  alignBtn.setAttribute('aria-haspopup', 'dialog');
  const orderBtn = iconButton('layers', 'Layer order', () => openOrder(orderBtn));
  orderBtn.setAttribute('aria-haspopup', 'dialog');
  const dup = iconButton('copy', 'Duplicate', () => actions.duplicate());
  const del = iconButton('trash', 'Delete', () => actions.remove(), { class: 'dz-danger' });
  el.append(edit, smaller, bigger, colorBtn, alignBtn, orderBtn, dup, del);

  function cur() {
    if (S.selection.length < 1) return null;
    const side = S.doc.project.pieces[S.view.pi].sides[S.view.si];
    return findElement(side, S.selection[0]);
  }

  function openColor(anchor) {
    const e = cur();
    if (!e) return;
    const box = h('div', { class: 'dz-pop-body' });
    const pick = createColorPick(ctx, {
      label: 'Item color', value: e.fill,
      onPick: (v) => actions.setElements(Object.fromEntries(S.selection.map((id) => [id, { fill: v }])), { key: 'selbar-color' }),
    });
    box.append(pick.el);
    openPopover(ctx.host, anchor, box, { label: 'Item color' });
  }

  function openOrder(anchor) {
    const box = h('div', { class: 'dz-pop-body' }, h('p', { class: 'dz-pop-title' }, 'Layer order'));
    const row = h('div', { class: 'dz-aligns' });
    for (const [action, label] of [['front', 'To front'], ['forward', 'Forward'], ['backward', 'Backward'], ['back', 'To back']]) {
      row.append(h('button', { type: 'button', class: 'dz-chip', onclick: () => actions.reorder(action) }, label));
    }
    box.append(row);
    openPopover(ctx.host, anchor, box, { label: 'Layer order' });
  }

  function openAlign(anchor) {
    const box = h('div', { class: 'dz-pop-body' }, h('p', { class: 'dz-pop-title' }, S.selection.length > 1 ? 'Align together' : 'Align on the sign'));
    const row = h('div', { class: 'dz-aligns' });
    const edges = [['left', 'Left'], ['center', 'Center'], ['right', 'Right'], ['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']];
    for (const [edge, label] of edges) {
      row.append(h('button', { type: 'button', class: 'dz-chip', onclick: () => actions.align(edge) }, label));
    }
    box.append(row);
    openPopover(ctx.host, anchor, box, { label: 'Align' });
  }

  function sync() {
    const e = cur();
    const show = !!e && !S.editing && S.view.mode === 'flat';
    el.hidden = !show;
    if (!show) return;
    edit.hidden = !(S.selection.length === 1 && e.type === 'text');
    colorBtn.hidden = e.type === 'image';
  }
  store.subscribe((state, keys) => {
    if (keys.some((k) => ['selection', 'editing', 'view', 'doc'].includes(k))) sync();
  });
  sync();
  return { el };
}
