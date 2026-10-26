import { h, iconButton } from '../dom.js';
import { setChoices, setQty, productOf } from '../../model/document.js';
import { createSummary } from '../summary.js';

export function createOptionsTab(ctx) {
  const { store, env } = ctx;
  const S = store.state;
  const el = h('div', { class: 'dz-tab-body' });
  const groupsBox = h('div', { class: 'dz-groups' });
  const qtyBox = h('div', { class: 'dz-field' });
  const summary = createSummary(ctx);
  el.append(groupsBox, qtyBox, h('h2', { class: 'dz-h3' }, 'Your price'), summary.el);

  function render() {
    const piece = S.doc.project.pieces[S.view.pi];
    const product = productOf(env, piece.productId);
    groupsBox.textContent = '';
    for (const g of product.groups) {
      const fs = h('fieldset', { class: 'dz-fieldset' }, h('legend', null, g.label));
      const row = h('div', { class: 'dz-chips' });
      for (const c of g.choices) {
        const on = piece.choices[g.id] === c.id;
        row.append(h('button', { type: 'button', class: 'dz-chip dz-chip-lg', 'aria-pressed': String(on), onclick: () => {
          store.commit(setChoices(S.doc, S.view.pi, { [g.id]: c.id }, env));
          ctx.track('option_change', { group: g.id, choice: c.id });
          ctx.announce(`${g.label}: ${c.label}`);
        } }, c.label));
      }
      fs.append(row);
      groupsBox.append(fs);
    }
    qtyBox.textContent = '';
    if (product.qty) {
      const input = h('input', { type: 'number', class: 'dz-input dz-num', min: '1', max: String(product.qty.max), step: '1', value: String(piece.qty), inputmode: 'numeric', 'aria-label': `How many ${product.qty.unit}s`, onchange: () => store.commit(setQty(S.doc, S.view.pi, input.value)) });
      qtyBox.append(h('span', null, 'How many'), h('div', { class: 'dz-stepper' },
        iconButton('minus', 'Fewer', () => store.commit(setQty(S.doc, S.view.pi, piece.qty - 1)), { class: 'dz-seg' }), input,
        iconButton('plus', 'More', () => store.commit(setQty(S.doc, S.view.pi, piece.qty + 1)), { class: 'dz-seg' })));
    } else {
      qtyBox.append(h('p', { class: 'dz-help' }, 'The pack size sets how many signs you get. Stakes are included.'));
    }
  }
  return {
    el,
    onShow: render,
    update(state, keys) {
      if (keys.includes('doc')) render();
    },
  };
}
