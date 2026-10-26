// The layers list doubles as the screen-reader view of the design: every item is a list entry with
// its own controls. Drag the handle to reorder, or use the up and down buttons.
import { h, icon, iconButton } from '../dom.js';
import { reorderElement } from '../../model/document.js';
import { debounce } from '../dom.js';

const TYPE_ICON = { text: 'text', image: 'image', shape: 'shape' };

export function createLayersTab(ctx) {
  const { store, actions } = ctx;
  const S = store.state;
  const el = h('div', { class: 'dz-tab-body' });
  const list = h('ol', { class: 'dz-layers', 'aria-label': 'Design layers, top first' });
  el.append(h('p', { class: 'dz-help' }, 'Everything on this side, top layer first. Tap a layer to select it.'), list);
  let drag = null;

  function label(e) {
    if (e.type === 'text') return String(e.text || '').trim() ? `${e.name}: ${String(e.text).slice(0, 28)}` : `${e.name} (empty)`;
    if (e.type === 'image') return e.logoId ? 'Logo' : 'Logo spot (empty)';
    return e.name || 'Shape';
  }

  function render() {
    const side = S.doc.project.pieces[S.view.pi].sides[S.view.si];
    list.textContent = '';
    const top = side.elements.slice().reverse();
    top.forEach((e, di) => {
      const row = h('li', { class: 'dz-layer', 'data-id': e.id, 'aria-current': S.selection.includes(e.id) ? 'true' : null });
      const handle = h('span', { class: 'dz-layer-handle', role: 'presentation', title: 'Drag to reorder' });
      handle.innerHTML = icon('layers', 18);
      handle.addEventListener('pointerdown', (ev) => startDrag(ev, e.id, di, row));
      const pick = h('button', { type: 'button', class: 'dz-layer-name' + (S.selection.includes(e.id) ? ' is-on' : ''), onclick: () => actions.select([e.id]) },
        h('span', { class: 'dz-layer-ic', html: icon(TYPE_ICON[e.type], 18) }), h('span', null, label(e)));
      row.append(
        handle, pick,
        iconButton(e.hidden ? 'eye-off' : 'eye', e.hidden ? 'Show layer' : 'Hide layer', () => actions.toggleHidden(e.id), { size: 18 }),
        iconButton(e.locked ? 'lock' : 'unlock', e.locked ? 'Unlock layer' : 'Lock layer', () => actions.toggleLocked(e.id), { size: 18 }),
        iconButton('edit', 'Rename layer', () => rename(e), { size: 18 }),
        iconButton('up', 'Move layer up', () => store.commit(reorderElement(S.doc, S.view.pi, S.view.si, e.id, 'forward')), { size: 18, disabled: di === 0 }),
        iconButton('down', 'Move layer down', () => store.commit(reorderElement(S.doc, S.view.pi, S.view.si, e.id, 'backward')), { size: 18, disabled: di === top.length - 1 })
      );
      list.append(row);
    });
  }

  function rename(e) {
    const name = window.prompt('Layer name', e.name || '');
    if (name != null && name.trim()) actions.rename(e.id, name.trim());
  }

  function startDrag(ev, id, di, row) {
    ev.preventDefault();
    const rows = [...list.children];
    drag = { id, from: di, to: di, rows };
    row.classList.add('is-dragging');
    const move = (e) => {
      const y = e.clientY;
      let to = rows.length - 1;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect();
        if (y < r.top + r.height / 2) {
          to = i;
          break;
        }
      }
      drag.to = to;
      rows.forEach((r, i) => r.classList.toggle('is-target', i === to && to !== drag.from));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const { from, to } = drag;
      drag = null;
      if (from !== to) {
        const side = S.doc.project.pieces[S.view.pi].sides[S.view.si];
        const arrayIndex = side.elements.length - 1 - to;
        store.commit(reorderElement(S.doc, S.view.pi, S.view.si, id, arrayIndex));
      } else {
        render();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  const later = debounce(() => { if (!drag) render(); }, 80);
  return {
    el,
    onShow: render,
    update(state, keys) {
      if (keys.some((k) => ['doc', 'selection', 'view'].includes(k))) later();
    },
  };
}
