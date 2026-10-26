import { h, icon } from '../dom.js';
import { createColorPick } from '../colorpick.js';
import { setPalette, setBackground, updateElement } from '../../model/document.js';
import { collectWarnings } from '../../model/review.js';
import { bestInk } from '../../model/color.js';
import { debounce } from '../dom.js';

const SLOTS = [['primary', 'Primary (main color)'], ['accent', 'Accent (stripes and highlights)'], ['ink', 'Ink (text)']];

export function createColorsTab(ctx) {
  const { store, env } = ctx;
  const S = store.state;
  const el = h('div', { class: 'dz-tab-body' });
  const picks = {};
  const slotBox = h('div', { class: 'dz-slots' });
  for (const [slot, label] of SLOTS) {
    const pick = createColorPick(ctx, {
      label, value: S.doc.project.palette[slot], slots: false,
      onPick: (v) => store.commit(setPalette(S.doc, { [slot]: v }), { key: 'palette:' + slot }),
    });
    picks[slot] = pick;
    slotBox.append(h('div', { class: 'dz-field' }, h('span', null, label), pick.el));
  }
  const presets = h('div', { class: 'dz-presets' });
  for (const p of env.catalog.palettes) {
    const b = h('button', { type: 'button', class: 'dz-preset', 'aria-label': p.name, title: p.name, onclick: () => { store.commit(setPalette(S.doc, p)); ctx.track('option_change', { palette: p.id }); } });
    b.append(...['primary', 'accent', 'ink'].map((k) => h('i', { style: { background: p[k] } })));
    presets.append(b);
  }

  const bgBox = h('div', { class: 'dz-bg' });
  const modeSolid = h('button', { type: 'button', class: 'dz-chip', onclick: () => setMode('solid') }, 'Solid');
  const modeGrad = h('button', { type: 'button', class: 'dz-chip', onclick: () => setMode('gradient') }, 'Gradient');
  const solidPick = createColorPick(ctx, { label: 'Background color', value: '@primary', onPick: (v) => setBg({ type: 'solid', color: v }, 'bg') });
  const fromPick = createColorPick(ctx, { label: 'Gradient start', value: '@primary', onPick: (v) => setBg({ ...curBg(), type: 'gradient', from: v }, 'bgfrom') });
  const toPick = createColorPick(ctx, { label: 'Gradient end', value: '@accent', onPick: (v) => setBg({ ...curBg(), type: 'gradient', to: v }, 'bgto') });
  const angle = h('input', { type: 'range', min: '0', max: '180', step: '15', class: 'dz-range', 'aria-label': 'Gradient direction', oninput: () => setBg({ ...curBg(), type: 'gradient', angle: Number(angle.value) }, 'bgangle') });
  const gradBox = h('div', null, h('div', { class: 'dz-field' }, h('span', null, 'Start'), fromPick.el), h('div', { class: 'dz-field' }, h('span', null, 'End'), toPick.el), h('label', { class: 'dz-field' }, h('span', null, 'Direction'), angle));
  const solidBox = h('div', { class: 'dz-field' }, solidPick.el);
  bgBox.append(h('div', { class: 'dz-row' }, modeSolid, modeGrad), solidBox, gradBox);

  const warnBox = h('div', { class: 'dz-warnings' });
  el.append(
    h('h2', { class: 'dz-h3' }, 'Brand colors'),
    h('p', { class: 'dz-help' }, 'Change a color once and everything that uses it changes with it.'),
    slotBox,
    h('h2', { class: 'dz-h3' }, 'Color sets'), presets,
    h('h2', { class: 'dz-h3' }, 'Background'), bgBox,
    warnBox
  );

  const curSide = () => S.doc.project.pieces[S.view.pi].sides[S.view.si];
  const curBg = () => {
    const bg = curSide().bg;
    return bg.type === 'gradient' ? { ...bg } : { type: 'gradient', from: bg.color, to: '@accent', angle: 90 };
  };
  function setBg(bg, key) {
    store.commit(setBackground(S.doc, S.view.pi, S.view.si, bg), { key: key + ':' + S.view.si });
  }
  function setMode(mode) {
    const bg = curSide().bg;
    if (mode === 'solid' && bg.type !== 'solid') setBg({ type: 'solid', color: bg.from }, 'bg');
    if (mode === 'gradient' && bg.type !== 'gradient') setBg({ type: 'gradient', from: bg.color, to: '@accent', angle: 90 }, 'bg');
  }

  function renderWarnings() {
    warnBox.textContent = '';
    const bad = collectWarnings(S.doc, env, S.assets).filter((w) => w.kind === 'contrast' && w.pi === S.view.pi && w.si === S.view.si);
    if (!bad.length) return;
    warnBox.append(h('h2', { class: 'dz-h3' }, 'Hard to read'));
    for (const w of bad) {
      warnBox.append(
        h('div', { class: 'dz-warn' }, h('span', null, `${w.message} Contrast ${w.ratio.toFixed(1)} to 1; we want at least 3 to 1.`),
          h('button', { type: 'button', class: 'dz-chip', onclick: () => store.commit(updateElement(S.doc, S.view.pi, S.view.si, w.id, { fill: bestInk(w.behind) }, env)) }, 'Fix it'))
      );
    }
    ctx.track('readability_warning', { kind: 'contrast' });
  }

  function sync() {
    for (const [slot] of SLOTS) picks[slot].set(S.doc.project.palette[slot]);
    for (const p of [solidPick, fromPick, toPick]) p.refresh();
    const bg = curSide().bg;
    modeSolid.setAttribute('aria-pressed', String(bg.type === 'solid'));
    modeGrad.setAttribute('aria-pressed', String(bg.type === 'gradient'));
    solidBox.hidden = bg.type !== 'solid';
    gradBox.hidden = bg.type !== 'gradient';
    if (bg.type === 'solid') solidPick.set(bg.color);
    else {
      fromPick.set(bg.from);
      toPick.set(bg.to);
      angle.value = bg.angle == null ? 90 : bg.angle;
    }
    renderWarnings();
  }
  const later = debounce(sync, 200);
  return {
    el,
    onShow: sync,
    update(state, keys) {
      if (keys.some((k) => ['doc', 'view'].includes(k))) later();
    },
  };
}
