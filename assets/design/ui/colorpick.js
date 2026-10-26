// A compact color control: swatches for the brand slots plus white and black, a native color
// picker and a hex field. Choosing a slot keeps the element tied to the brand palette.
import { h } from './dom.js';
import { normalizeHex, resolveColor } from '../model/color.js';

const SLOT_LABELS = { '@primary': 'Primary', '@accent': 'Accent', '@ink': 'Ink' };

// opts: {label, value, slots: bool, onPick(value, final)}
export function createColorPick(ctx, opts) {
  const { store } = ctx;
  const el = h('div', { class: 'dz-colorpick', role: 'group', 'aria-label': opts.label });
  const swatches = h('div', { class: 'dz-swatches' });
  const native = h('input', { type: 'color', class: 'dz-color-native', 'aria-label': `${opts.label}: pick a custom color` });
  const hex = h('input', { type: 'text', class: 'dz-input dz-hex', maxlength: 7, spellcheck: 'false', autocomplete: 'off', 'aria-label': `${opts.label}: hex code`, placeholder: '#RRGGBB' });
  let value = opts.value;
  const options = opts.slots === false ? ['#FFFFFF', '#14161A'] : ['@primary', '@accent', '@ink', '#FFFFFF', '#14161A'];
  const buttons = new Map();
  for (const v of options) {
    const name = SLOT_LABELS[v] || (v === '#FFFFFF' ? 'White' : 'Black');
    const b = h('button', { type: 'button', class: 'dz-swatch', 'aria-label': name, title: name, onclick: () => pick(v, true) });
    buttons.set(v, b);
    swatches.append(b);
  }
  native.addEventListener('input', () => pick(native.value.toUpperCase(), false));
  native.addEventListener('change', () => pick(native.value.toUpperCase(), true));
  hex.addEventListener('input', () => {
    const v = normalizeHex(hex.value);
    if (v) pick(v, false);
  });
  hex.addEventListener('change', () => {
    const v = normalizeHex(hex.value);
    if (v) pick(v, true);
    else sync();
  });
  const custom = h('label', { class: 'dz-swatch dz-swatch-custom', title: 'Custom color' }, native);
  swatches.append(custom);
  el.append(swatches, hex);

  function pick(v, final) {
    value = v;
    sync(true);
    opts.onPick(v, final);
  }

  function sync(keepHex) {
    const palette = store.state.doc.project.palette;
    for (const [v, b] of buttons) {
      const color = resolveColor(v, palette);
      b.style.background = color;
      const on = value === v || (value && value.charAt(0) !== '@' && normalizeHex(value) === normalizeHex(v));
      b.setAttribute('aria-pressed', String(!!on));
    }
    const actual = resolveColor(value, palette);
    native.value = actual.toLowerCase();
    custom.style.background = actual;
    const isCustom = value && value.charAt(0) !== '@' && !['#FFFFFF', '#14161A'].includes(normalizeHex(value));
    custom.classList.toggle('is-on', !!isCustom);
    if (!keepHex && document.activeElement !== hex) hex.value = actual;
  }

  sync();
  return {
    el,
    set(v) {
      value = v;
      sync();
    },
    refresh: sync,
  };
}
