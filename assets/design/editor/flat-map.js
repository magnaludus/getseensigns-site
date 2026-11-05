// The print layout under (or, on a phone, instead of) the editing canvas: the whole flat of a table throw with
// every panel in its place, turned the way it prints, with its name, its safe area and a short note. Tap a
// panel to edit it. The customer never edits here: every panel is edited upright in the main canvas, and this
// shows how those panels end up on the printer's page.
import { h } from '../ui/dom.js';
import { flatSvg, flatOf } from '../render/flat.js';
import { FLAT_NOTE } from '../model/throw-panels.js';

export function createFlatMap(container, { store, env, ctx }) {
  const S = store.state;
  const root = h('section', { class: 'dz-layout', 'aria-label': 'How your cover prints', hidden: true });
  const holder = h('div', { class: 'dz-layout-art' });
  const note = h('p', { class: 'dz-layout-note' }, FLAT_NOTE);
  root.append(h('h2', { class: 'dz-layout-title' }, 'How it prints'), holder, note);
  container.append(root);
  let raf = 0;
  let timer = 0;

  function fontIn(layout) {
    const r = holder.getBoundingClientRect();
    const w = r.width || 360;
    const hgt = r.height || 200;
    const pxPerIn = Math.min(w / (layout.bounds.w + 3), hgt / (layout.bounds.h + 3));
    // about 11 px on screen, but never bigger than a panel can hold
    return Math.max(2.4, Math.min(11 / pxPerIn, 7));
  }

  // Which of the editor and the map shows is set the moment the view changes; the drawing can wait a frame.
  function syncMode() {
    const layout = flatOf(S.doc, S.view.pi, env);
    container.dataset.layout = layout ? '1' : '0';
    container.dataset.map = S.view.flatMap || 'edit';
    root.hidden = !layout || S.view.mode !== 'flat';
    return layout;
  }

  function render() {
    raf = 0;
    const layout = syncMode();
    if (!layout || root.hidden) return;
    const sel = layout.panels[S.view.si];
    holder.innerHTML = flatSvg(S.doc, S.view.pi, env, {
      assets: S.assets,
      assetUrl: (id) => (S.assets.get(id) ? S.assets.get(id).url : ''),
      selected: sel ? sel.id : null,
      fontIn: fontIn(layout),
      label: 'The flat as it prints. Tap a panel to edit it.',
      className: 'dz-layout-svg',
    });
  }

  function schedule(live) {
    if (live) {
      // a drag in progress: redraw a few times a second, not on every pointer move
      if (!timer) timer = setTimeout(() => { timer = 0; render(); }, 140);
      return;
    }
    clearTimeout(timer);
    timer = 0;
    if (!raf) raf = requestAnimationFrame(render);
  }

  function pick(el) {
    const g = el && el.closest ? el.closest('[data-panel]') : null;
    if (!g) return;
    const si = Number(g.dataset.index);
    store.set({ selection: [], view: { si, flatMap: 'edit' } });
    ctx.announce(`Editing the ${g.getAttribute('aria-label').replace(/\. Edit it\.$/, '')}`);
  }
  holder.addEventListener('click', (e) => pick(e.target));
  holder.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(e.target);
    }
  });

  const ro = new ResizeObserver(() => schedule(false));
  ro.observe(holder);
  store.subscribe((state, keys) => {
    if (keys.includes('view')) syncMode();
    if (keys.some((k) => ['doc', 'view', 'assets', 'fonts'].includes(k))) schedule(keys.includes('preview'));
  });
  syncMode();
  schedule(false);
  return { root, render, destroy() { ro.disconnect(); root.remove(); } };
}
