// The strip over the stage: Flat/3D switch, undo and redo, guides, and the side switcher.
import { h, icon, iconButton } from './dom.js';
import { openPopover } from './popover.js';
import { guideChoices } from '../editor/guides.js';
import { specFor } from '../model/specs.js';
import { sideNamesFor, productOf } from '../model/document.js';

export function createViewbar(ctx) {
  const { store, env } = ctx;
  const S = store.state;
  const el = h('div', { class: 'dz-viewbar' });
  const seg = h('div', { class: 'dz-seg-group', role: 'group', 'aria-label': 'View' });
  const flatBtn = h('button', { type: 'button', class: 'dz-seg-btn', onclick: () => ctx.setMode('flat') });
  flatBtn.innerHTML = icon('flat', 18) + '<span>Flat</span>';
  const cubeBtn = h('button', { type: 'button', class: 'dz-seg-btn', onclick: () => ctx.setMode('3d') });
  cubeBtn.innerHTML = icon('cube', 18) + '<span>3D</span>';
  seg.append(flatBtn, cubeBtn);
  const undo = iconButton('undo', 'Undo', () => store.undo(), { class: 'dz-bar-btn' });
  const redo = iconButton('redo', 'Redo', () => store.redo(), { class: 'dz-bar-btn' });
  const guidesBtn = iconButton('guides', 'Guides', () => openGuides(), { class: 'dz-bar-btn' });
  guidesBtn.setAttribute('aria-haspopup', 'dialog');
  const simpleBtn = h('button', { type: 'button', class: 'dz-seg-btn dz-simple-toggle', onclick: () => ctx.view3d && ctx.view3d.toggleSimple() });
  const right = h('div', { class: 'dz-viewbar-right' }, simpleBtn, undo, redo, guidesBtn);
  el.append(seg, right);

  const sideNav = h('div', { class: 'dz-sidenav', hidden: true });
  const prev = iconButton('chevron', 'Previous side', () => step(-1), { class: 'dz-bar-btn dz-flip', size: 18 });
  const next = iconButton('chevron', 'Next side', () => step(1), { class: 'dz-bar-btn', size: 18 });
  const sideLabel = h('span', { class: 'dz-sidelabel', 'aria-live': 'polite' });
  sideNav.append(prev, sideLabel, next);

  function step(dir) {
    const piece = S.doc.project.pieces[S.view.pi];
    if (piece.sidesMode === 'same') return;
    const n = piece.sides.length;
    const si = (S.view.si + dir + n) % n;
    store.set({ view: { si } });
    ctx.focusSide(si);
  }

  function openGuides() {
    const piece = S.doc.project.pieces[S.view.pi];
    const spec = specFor(env.specs, piece.productId, piece.choices);
    const box = h('div', { class: 'dz-pop-body' }, h('p', { class: 'dz-pop-title' }, 'Show on the design'));
    for (const [key, label] of guideChoices(spec)) {
      const cb = h('input', { type: 'checkbox', id: 'dz-g-' + key, checked: S.view.guides[key] !== false, onchange: () => store.set({ view: { guides: { ...S.view.guides, [key]: cb.checked } } }) });
      box.append(h('label', { class: 'dz-check', for: 'dz-g-' + key }, cb, h('span', null, label)));
    }
    if (spec.placeholders.length) box.append(h('p', { class: 'dz-help' }, 'Some guides are approximate. Your proof uses the exact print template.'));
    openPopover(ctx.host, guidesBtn, box, { label: 'Guides', below: true });
  }

  function sync() {
    const flat = S.view.mode === 'flat';
    flatBtn.setAttribute('aria-pressed', String(flat));
    cubeBtn.setAttribute('aria-pressed', String(!flat));
    undo.disabled = !store.history.canUndo;
    redo.disabled = !store.history.canRedo;
    guidesBtn.hidden = !flat;
    simpleBtn.hidden = flat || !!(ctx.view3d && ctx.view3d.failed);
    simpleBtn.textContent = S.view.simple ? '3D view' : 'Simple view';
    const piece = S.doc.project.pieces[S.view.pi];
    const names = sideNamesFor(productOf(env, piece.productId), piece.choices);
    const each = names.length > 1 && piece.sidesMode !== 'same';
    sideNav.hidden = !each;
    if (el.parentElement) el.parentElement.dataset.sidenav = each ? '1' : '0';
    if (each) sideLabel.textContent = `${names[S.view.si]} side (${S.view.si + 1} of ${names.length})`;
  }
  store.subscribe((state, keys) => {
    if (keys.some((k) => ['view', 'doc', 'history'].includes(k))) sync();
  });
  sync();
  return { el, sideNav };
}
