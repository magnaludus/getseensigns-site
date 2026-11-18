import { h } from '../dom.js';
import { setSidesMode, copySide, clearSide, productOf, sideNamesFor, hasPanels, sideLabel, templateOf } from '../../model/document.js';
import { quickFill, quickFillOptions } from '../../model/quickfill.js';
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
    const panels = hasPanels(product);
    // the panels of a throw are different pieces, so there is no "same on every side" and nothing to copy across
    const same = !panels && piece.sidesMode === 'same';
    if (panels) {
      el.append(h('p', { class: 'dz-help' }, 'Each panel is drawn upright, the way it reads on the table. On the printed flat the ends and the back are turned so they read right side up when the cover hangs.'));
    } else {
      el.append(
        h('div', { class: 'dz-modes' },
          h('button', { type: 'button', class: 'dz-chip dz-chip-lg', 'aria-pressed': String(same), onclick: () => setMode('same') }, product.sides.sameLabel),
          h('button', { type: 'button', class: 'dz-chip dz-chip-lg', 'aria-pressed': String(!same), onclick: () => setMode('each') }, product.sides.eachLabel))
      );
    }
    const strip = h('div', { class: 'dz-sidestrip', role: 'group', 'aria-label': panels ? 'Panels' : 'Sides' });
    names.forEach((name, i) => {
      const active = same ? i === 0 : S.view.si === i;
      const b = h('button', { type: 'button', class: 'dz-side', 'aria-pressed': String(active), 'aria-label': sideLabel(product, names, i), disabled: same && i > 0, onclick: () => { store.set({ view: { si: i, flatMap: 'edit' } }); ctx.focusSide(i); } });
      const thumb = h('span', { class: 'dz-side-thumb' });
      thumb.innerHTML = sideThumb(S.doc, S.view.pi, same ? 0 : i, env, S.assets);
      b.append(thumb, h('span', null, name));
      strip.append(b);
    });
    el.append(strip);
    if (panels) {
      renderQuickFill(piece, names);
      return;
    }
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

  function renderQuickFill(piece, names) {
    const options = quickFillOptions(S.doc, S.view.pi, env);
    const row = h('div', { class: 'dz-chiprow' });
    for (const o of options) row.append(h('button', { type: 'button', class: 'dz-chip dz-fill', 'data-fill': o.id, onclick: () => fill(o) }, o.label));
    row.append(h('button', { type: 'button', class: 'dz-chip dz-fill', 'data-fill': 'clear', onclick: () => clear(names) }, 'Clear this panel'));
    el.append(h('h2', { class: 'dz-h3' }, 'Quick fill'), row);
    if (!names.includes('Back')) {
      el.append(h('p', { class: 'dz-help' }, 'A 3-sided throw is open at the back, so the short back strip stays plain.'));
    }
  }

  async function fill(option) {
    const piece = S.doc.project.pieces[S.view.pi];
    await ctx.ensureFonts([templateOf(env, piece.productId, piece.templateId).font]);
    const res = quickFill(S.doc, S.view.pi, option.id, env);
    if (!res.changed.length) {
      ctx.announce('Already there. Nothing to add.');
      ctx.toast('Those panels already have it.');
      if (res.skipped.length) store.set({ view: { si: res.skipped[0], flatMap: 'edit' } });
      return;
    }
    store.commit(res.doc, { select: [] });
    // a logo goes on one panel: show it, so the customer can add the file right there
    if (option.id === 'logo-top') store.set({ view: { si: res.changed[0], flatMap: 'edit' } });
    ctx.track('option_change', { quick_fill: option.id });
    const where = res.changed.map((i) => piece.sides[i].name.toLowerCase()).join(', ').replace(/, ([^,]*)$/, ' and $1');
    ctx.announce(option.id === 'logo-top' ? 'Logo frame added to the top panel' : `Business name added to the ${where}`);
    ctx.toast(option.id === 'logo-top' ? (S.doc.project.logos.length ? 'Logo added to the top.' : 'Logo frame added to the top. Add your logo in the Logo tab.') : `Business name added to the ${where}.`);
  }

  function clear(names) {
    const si = S.view.si;
    store.commit(clearSide(S.doc, S.view.pi, si), { select: [] });
    ctx.announce(`${names[si]} cleared`);
  }

  function setMode(mode) {
    store.commit(setSidesMode(S.doc, S.view.pi, mode, env));
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
