// The price box: line items from catalog prices, free shipping, production time. Used in the
// Options tab on phones and in the right column on desktop.
import { h } from './dom.js';
import { projectTotal, money, productionText, productById } from '../model/pricing.js';

export function createSummary(ctx) {
  const { store, env } = ctx;
  const el = h('div', { class: 'dz-summary' });
  function render() {
    const doc = store.state.doc;
    const t = projectTotal(env.catalog, doc);
    el.textContent = '';
    if (!t.ok) {
      el.append(h('p', { class: 'dz-help' }, 'Pick your options to see the price.'));
      return;
    }
    const list = h('ul', { class: 'dz-lines' });
    for (const line of t.lines) {
      const qty = line.qty > 1 ? ` × ${line.qty}` : '';
      list.append(h('li', null, h('span', null, `${line.short}: ${line.label}${qty}`), h('b', null, money(line.total))));
    }
    el.append(list);
    el.append(h('div', { class: 'dz-total' }, h('span', null, 'Total'), h('b', { 'aria-live': 'polite' }, money(t.total))));
    const first = productById(env.catalog, doc.project.pieces[0].productId);
    el.append(
      h('ul', { class: 'dz-perks' },
        h('li', null, 'Free shipping in the lower 48'),
        h('li', null, 'Free design proof within 12 hours, 7 days a week'),
        h('li', null, `Arrives in ${productionText(first)}`),
        h('li', null, '3 revisions. Nothing prints until you approve.')
      )
    );
    const note = t.lines[0].note;
    if (note) el.append(h('p', { class: 'dz-note' }, note));
  }
  render();
  store.subscribe((state, keys) => {
    if (keys.includes('doc')) render();
  });
  return { el, render };
}
