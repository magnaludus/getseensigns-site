import { h, icon } from '../dom.js';
import { createSummary } from '../summary.js';
import { collectWarnings } from '../../model/review.js';
import { debounce } from '../dom.js';

export function createSendTab(ctx) {
  const { store, env } = ctx;
  const S = store.state;
  const el = h('div', { class: 'dz-tab-body' });
  const warnBox = h('div', { class: 'dz-warnings' });
  const summary = createSummary(ctx);
  const go = h('button', { type: 'button', class: 'dz-btn dz-btn-primary dz-btn-block', onclick: () => ctx.openSend() }, 'Get my free proof');
  const help = h('button', { type: 'button', class: 'dz-btn dz-btn-ghost dz-btn-block', onclick: () => ctx.openHelp() }, "Rather we design it? It's free.");
  el.append(
    h('p', { class: 'dz-help' }, 'Send your design and we turn it into a real proof within 12 hours, 7 days a week. 3 revisions included. Nothing prints until you approve it.'),
    summary.el, warnBox, go, help
  );
  function render() {
    warnBox.textContent = '';
    const list = collectWarnings(S.doc, env, S.assets);
    if (!list.length) return;
    warnBox.append(h('h2', { class: 'dz-h3' }, 'Worth a look'));
    for (const w of list.slice(0, 6)) warnBox.append(h('p', { class: 'dz-warn' }, icon('warning', 18), ' ', w.message));
    warnBox.append(h('p', { class: 'dz-help' }, "You can still send. We'll fix these on your proof."));
  }
  const later = debounce(render, 250);
  return {
    el,
    onShow: render,
    update(state, keys) {
      if (keys.some((k) => ['doc', 'assets'].includes(k))) later();
    },
  };
}
