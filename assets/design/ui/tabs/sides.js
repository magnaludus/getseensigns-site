import { h } from '../dom.js';
import { setSidesMode, copySide, productOf, sideNamesFor } from '../../model/document.js';
import { sideThumb } from '../../render/thumbs.js';
import { debounce } from '../dom.js';

export function createSidesTab(ctx) {
  const { store, env } = ctx;
  const S = store.state;
  const el = h('div', { class: 'dz-tab-body' });

  function render() {
    const piece = S.doc.project.pieces[S.view.pi];
    const product = productOf(env, piece.productId);
    const names = sideNamesFor(product, piece.choices);
    el.textContent = '';
    if (names.length < 2) {
      el.append(h('p', { class: 'dz-help' }, 'This product has one print area, so there is nothing to choose here.'));
      return;
    }
    const same = piece.sidesMode === 'same';
    el.append(
      h('div', { class: 'dz-modes' },
        h('button', { type: 'button', class: 'dz-chip dz-chip-lg', 'aria-pressed': String(same), onclick: () => setMode('same') }, product.sides.sameLabel),
        h('button', { type: 'button', class: 'dz-chip dz-chip-lg', 'aria-pressed': String(!same), onclick: () => setMode('each') }, product.sides.eachLabel))
    );
    const strip = h('div', { class: 'dz-sidestrip', role: 'group', 'aria-label': 'Sides' });
    names.forEach((name, i) => {
      const active = same ? i === 0 : S.view.si === i;
      const b = h('button', { type: 'button', class: 'dz-side', 'aria-pressed': String(active), 'aria-label': `${name} side`, disabled: same && i > 0, onclick: () => { store.set({ view: { si: i } }); ctx.focusSide(i); } });
      const thumb = h('span', { class: 'dz-side-thumb' });
      thumb.innerHTML = sideThumb(S.doc, S.view.pi, same ? 0 : i, env, S.assets);
      b.append(thumb, h('span', null, name));
      strip.append(b);
    });
    el.append(strip);
    if (same) {
      el.append(h('p', { class: 'dz-help' }, 'One design is printed on every side. Choose "Each side different" to design them one at a time.'));
    } else {
      const from = S.view.si;
      const row = h('div', { class: 'dz-chiprow' });
      row.append(h('button', { type: 'button', class: 'dz-chip', onclick: () => copy(from, names.map((_, i) => i).filter((i) => i !== from)) }, 'Copy to all other sides'));
      names.forEach((name, i) => {
        if (i !== from) row.append(h('button', { type: 'button', class: 'dz-chip', onclick: () => copy(from, [i]) }, `Copy to ${name}`));
      });
      el.append(h('h2', { class: 'dz-h3' }, `Copy ${names[from]} side`), row);
    }
  }

  function setMode(mode) {
    store.commit(setSidesMode(S.doc, S.view.pi, mode));
    ctx.track('option_change', { sides: mode });
    ctx.announce(mode === 'same' ? 'Same design on every side' : 'Each side can be different');
  }
  function copy(from, targets) {
    store.commit(copySide(S.doc, S.view.pi, from, targets));
    ctx.announce('Side copied');
  }
  const later = debounce(render, 150);
  return {
    el,
    onShow: render,
    update(state, keys) {
      if (keys.some((k) => ['doc', 'view', 'assets'].includes(k))) later();
    },
  };
}
