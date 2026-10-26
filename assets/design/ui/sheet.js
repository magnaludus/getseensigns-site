// The tools panel: a bottom sheet on phones (collapsed, half or full height) and a left rail on
// desktop. Tabs follow the WAI-ARIA tab pattern. Each tab builds when first opened.
import { h, icon } from './dom.js';
import { createTemplatesTab } from './tabs/templates.js';
import { createTextTab } from './tabs/text.js';
import { createLogoTab } from './tabs/logo.js';
import { createLayersTab } from './tabs/layers.js';
import { createColorsTab } from './tabs/colors.js';
import { createOptionsTab } from './tabs/options.js';
import { createSidesTab } from './tabs/sides.js';
import { createSendTab } from './tabs/send.js';
import { sideNamesFor, productOf } from '../model/document.js';

const TABS = [
  { id: 'templates', label: 'Templates', icon: 'grid', build: createTemplatesTab },
  { id: 'text', label: 'Text', icon: 'text', build: createTextTab },
  { id: 'logo', label: 'Logo', icon: 'image', build: createLogoTab },
  { id: 'colors', label: 'Colors', icon: 'palette', build: createColorsTab },
  { id: 'options', label: 'Options', icon: 'sliders', build: createOptionsTab },
  { id: 'sides', label: 'Sides', icon: 'sides', build: createSidesTab },
  { id: 'layers', label: 'Layers', icon: 'layers', build: createLayersTab },
  { id: 'send', label: 'Send', icon: 'send', build: createSendTab },
];

export function createSheet(ctx) {
  const { store, env } = ctx;
  const S = store.state;
  const root = h('section', { class: 'dz-sheet', 'data-state': S.view.sheet, 'aria-label': 'Design tools' });
  const handle = h('button', { type: 'button', class: 'dz-sheet-handle', 'aria-label': 'Make the tools panel taller or shorter', onclick: () => cycle() });
  const tabbar = h('div', { class: 'dz-tabs', role: 'tablist', 'aria-label': 'Design tools' });
  const panels = h('div', { class: 'dz-panels' });
  root.append(handle, tabbar, panels);

  const built = new Map();
  const tabBtns = new Map();
  const panelEls = new Map();

  for (const t of TABS) {
    const btn = h('button', { type: 'button', role: 'tab', class: 'dz-tab', 'data-tab': t.id, id: `dz-tab-${t.id}`, 'aria-controls': `dz-panel-${t.id}`, 'aria-selected': 'false', tabindex: '-1', onclick: () => open(t.id, true) });
    btn.innerHTML = icon(t.icon, 22) + `<span>${t.label}</span>`;
    tabBtns.set(t.id, btn);
    tabbar.append(btn);
    const panel = h('div', { class: 'dz-panel', role: 'tabpanel', id: `dz-panel-${t.id}`, 'aria-labelledby': `dz-tab-${t.id}`, hidden: true, tabindex: '0' });
    panelEls.set(t.id, panel);
    panels.append(panel);
  }

  tabbar.addEventListener('keydown', (e) => {
    const ids = visibleTabs().map((t) => t.id);
    const i = ids.indexOf(S.view.tab);
    let next = null;
    if (e.key === 'ArrowRight') next = ids[(i + 1) % ids.length];
    else if (e.key === 'ArrowLeft') next = ids[(i - 1 + ids.length) % ids.length];
    else if (e.key === 'Home') next = ids[0];
    else if (e.key === 'End') next = ids[ids.length - 1];
    if (next) {
      e.preventDefault();
      open(next, false);
      tabBtns.get(next).focus();
    }
  });

  function visibleTabs() {
    const piece = S.doc.project.pieces[S.view.pi];
    const names = sideNamesFor(productOf(env, piece.productId), piece.choices);
    return TABS.filter((t) => t.id !== 'sides' || names.length > 1);
  }

  function open(id, fromClick) {
    const state = S.view.sheet;
    if (fromClick && S.view.tab === id && state !== 'collapsed' && ctx.isPhone()) {
      store.set({ view: { sheet: 'collapsed' } });
      return;
    }
    store.set({ view: { tab: id, sheet: state === 'collapsed' ? 'half' : state } });
  }

  function cycle() {
    const order = ['collapsed', 'half', 'full'];
    const next = order[(order.indexOf(S.view.sheet) + 1) % order.length];
    store.set({ view: { sheet: next } });
  }

  function sync() {
    const vis = visibleTabs();
    const ids = new Set(vis.map((t) => t.id));
    for (const t of TABS) {
      const btn = tabBtns.get(t.id);
      btn.hidden = !ids.has(t.id);
      const on = S.view.tab === t.id && ids.has(t.id);
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
      const panel = panelEls.get(t.id);
      panel.hidden = !on;
      if (on && !built.has(t.id)) {
        const tab = t.build(ctx);
        built.set(t.id, tab);
        panel.append(tab.el);
        if (tab.onShow) tab.onShow();
      } else if (on && built.get(t.id).onShow && lastTab !== t.id) {
        built.get(t.id).onShow();
      }
    }
    if (!ids.has(S.view.tab)) store.set({ view: { tab: 'templates' } });
    root.setAttribute('data-state', S.view.sheet);
    handle.setAttribute('aria-expanded', String(S.view.sheet !== 'collapsed'));
    lastTab = S.view.tab;
  }
  let lastTab = '';

  store.subscribe((state, keys) => {
    if (keys.includes('view') || keys.includes('doc')) sync();
    const tab = built.get(S.view.tab);
    if (tab && tab.update) tab.update(state, keys);
  });
  // keep hidden tabs fresh the next time they open
  sync();
  return { el: root, open, cycle };
}
