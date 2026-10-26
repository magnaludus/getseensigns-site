import { h, debounce } from '../dom.js';
import { templateThumb } from '../../render/thumbs.js';
import { applyTemplate } from '../../model/document.js';

export function createTemplatesTab(ctx) {
  const { store, env } = ctx;
  const el = h('div', { class: 'dz-tab-body' });
  const grid = h('div', { class: 'dz-tpl-grid' });
  el.append(h('p', { class: 'dz-help dz-hide-phone' }, 'Pick a starting layout. Your words, colors and logo carry over, and you can change anything.'), grid);

  function render() {
    const doc = store.state.doc;
    const pi = store.state.view.pi;
    const piece = doc.project.pieces[pi];
    const side = piece.sides[store.state.view.si];
    grid.textContent = '';
    for (const tpl of env.templates[piece.productId]) {
      const active = side.templateId === tpl.id;
      const btn = h('button', { type: 'button', class: 'dz-tpl', 'aria-pressed': String(active), 'aria-label': `${tpl.name} template`, onclick: () => choose(tpl) });
      const thumb = h('span', { class: 'dz-tpl-thumb' });
      thumb.innerHTML = templateThumb(doc, pi, tpl, env, store.state.assets);
      btn.append(thumb, h('span', { class: 'dz-tpl-name' }, tpl.name));
      grid.append(btn);
    }
  }

  async function choose(tpl) {
    await ctx.ensureFonts([tpl.font]);
    const { pi, si } = store.state.view;
    store.commit(applyTemplate(store.state.doc, pi, si, tpl.id, env), { select: [] });
    ctx.track('template_apply', { template: tpl.id });
    ctx.announce(`${tpl.name} template applied`);
  }

  const later = debounce(render, 150);
  return {
    el,
    onShow: render,
    update(state, keys) {
      if (keys.some((k) => ['doc', 'assets', 'fonts'].includes(k))) later();
    },
  };
}
