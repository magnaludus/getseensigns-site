// Designer entry point. Loads the data files, builds the page UI, and wires the pieces together:
// the flat editor, the 3D view, the tools sheet and the proof request. Everything is plain ES
// modules. Nothing is sent anywhere until the customer sends a proof request.
import { h, icon, iconButton } from './ui/dom.js';
import { createMeasurer, loadFonts, fontsReady } from './render/measure.js';
import { createDocument, setField, setPalette } from './model/document.js';
import { createStore } from './store.js';
import { createActions } from './editor/actions.js';
import { createStage } from './editor/stage-svg.js';
import { createViewbar } from './ui/viewbar.js';
import { createSelbar } from './ui/selbar.js';
import { createSheet } from './ui/sheet.js';
import { createSummary } from './ui/summary.js';
import { createView3d } from './ui/view3d.js';
import { createProof } from './ui/proof.js';
import { createAnalytics } from './analytics.js';
import { openPopover, closePopover } from './ui/popover.js';
import { projectTotal, money, productById } from './model/pricing.js';
import { encodeDoc, decodeDoc } from './model/share.js';

async function loadJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not load ' + url);
  return res.json();
}

function isEditable(target) {
  return !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

function startEditor(root, env, analytics, doc, opts) {
  root.textContent = '';
  const store = createStore(doc, env, {});
  const S = store.state;
  const actions = createActions(store);
  const app = h('div', { class: 'dz-app', 'data-mode': 'flat' });
  const live = h('div', { class: 'dz-live', role: 'status', 'aria-live': 'polite' });
  const toast = h('div', { class: 'dz-toast', role: 'status', hidden: true });
  let toastTimer = 0;
  let announceFlip = false;
  const debug = window.GSSDesigner;
  analytics.setProduct(doc.project.pieces[0].productId);

  const ctx = {
    store, env, actions, host: app, debug,
    track: analytics.track,
    isPhone: () => window.innerWidth < 768,
    announce(msg) {
      // a trailing no-break space on every other message makes screen readers speak repeated text
      announceFlip = !announceFlip;
      live.textContent = announceFlip ? msg : msg + '\u00A0';
    },
    toast(msg, ms = 3200) {
      toast.textContent = msg;
      toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toast.hidden = true; }, ms);
    },
    setMode(mode) {
      stage.closeEdit();
      store.set({ selection: mode === '3d' ? [] : S.selection, view: { mode } });
    },
    startEdit(id) {
      if (S.view.mode !== 'flat') store.set({ view: { mode: 'flat' } });
      stage.startEdit(id);
    },
    focusSide(i) {
      view3d.focusSide(i);
    },
    // Make sure fonts are loaded before something is laid out with them (a template, a font choice).
    async ensureFonts(ids) {
      const list = env.fonts.filter((f) => ids.includes(f.id) && !fontsReady([f]));
      if (list.length) {
        await loadFonts(list, env.measure);
        store.set({ fonts: Date.now() });
      }
    },
    openSend: () => proof.openSend(),
    openHelp: () => proof.openHelp(),
    async copyShareLink() {
      const hash = await encodeDoc(S.doc);
      const url = `${location.origin}${location.pathname}#d=${hash}`;
      analytics.track('share_create');
      try {
        if (navigator.share && ctx.isPhone()) {
          await navigator.share({ title: 'My Get Seen Signs design', url });
          return;
        }
        await navigator.clipboard.writeText(url);
        ctx.toast('Link copied. Logos are not included, so add yours again if you share it.', 4500);
      } catch (_) {
        window.prompt('Copy this link to share your design', url);
      }
    },
  };

  // ---- top bar ----
  const productName = h('span', null);
  const prodBtn = h('button', { type: 'button', class: 'dz-prodbtn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: () => openSwitcher() }, productName, h('span', { html: icon('chevron', 16) }));
  const back = h('a', { class: 'dz-btn-icon', href: '/design/', 'aria-label': 'All products', title: 'All products' });
  back.innerHTML = '<svg class="ic" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>';
  const price = h('span', { class: 'dz-price' });
  const share = iconButton('share', 'Share a link to this design', () => ctx.copyShareLink());
  const top = h('header', { class: 'dz-top' }, back, prodBtn, h('span', { class: 'dz-top-spacer' }), price, share);

  function syncTop() {
    const piece = S.doc.project.pieces[0];
    productName.textContent = productById(env.catalog, piece.productId).short;
    const t = projectTotal(env.catalog, S.doc);
    price.textContent = '';
    price.append(money(t.total), h('small', null, 'free shipping'));
    price.setAttribute('aria-label', `${money(t.total)}, free shipping`);
  }

  function openSwitcher() {
    const box = h('div', { class: 'dz-pop-body' }, h('p', { class: 'dz-pop-title' }, 'Switch product'));
    for (const p of env.catalog.products) {
      const t = projectTotal(env.catalog, createDocument(env, p.id));
      box.append(h('button', { type: 'button', class: 'dz-chip dz-chip-lg', 'aria-pressed': String(p.id === S.doc.project.pieces[0].productId), onclick: () => { closePopover(); switchProduct(p.id); } }, `${p.short} · ${money(t.total)}`));
    }
    openPopover(app, prodBtn, box, { label: 'Switch product', below: true });
  }

  function hasWork() {
    const piece = S.doc.project.pieces[0];
    return piece.sides.some((s) => s.edited) || S.doc.project.touched.fields || S.doc.project.touched.palette || S.doc.project.logos.length > 0;
  }

  function switchProduct(id) {
    if (id === S.doc.project.pieces[0].productId) return;
    if (hasWork() && !window.confirm('Switching products starts a new layout. Your words, colors and logos carry over. Continue?')) return;
    const old = S.doc.project;
    let next = createDocument(env, id, {
      palette: old.touched.palette ? old.palette : undefined,
      fields: old.touched.fields ? old.fields : undefined,
    });
    next = { ...next, project: { ...next.project, logos: old.logos, touched: { ...old.touched } } };
    store.replaceDoc(next);
    analytics.setProduct(id);
    analytics.track('product_select', { product: id });
    ctx.announce(`${productById(env.catalog, id).name} selected`);
  }

  // ---- stage area ----
  const flat = h('div', { class: 'dz-flat' });
  const stage = createStage(flat, { store, actions, announce: ctx.announce });
  const viewbar = createViewbar(ctx);
  const selbar = createSelbar(ctx);
  const view3d = createView3d(ctx);
  ctx.view3d = view3d;
  const stageCol = h('div', { class: 'dz-stagecol' }, flat, view3d.el, viewbar.el, viewbar.sideNav, selbar.el);
  const cube = viewbar.el.querySelectorAll('.dz-seg-btn')[1];
  ['pointerenter', 'focus', 'touchstart'].forEach((t) => cube.addEventListener(t, () => view3d.prefetch(), { once: true, passive: true }));

  // ---- tools, send bar, desktop aside ----
  const sheet = createSheet(ctx);
  const proof = createProof(ctx);
  const sendBtn = h('button', { type: 'button', class: 'dz-btn dz-btn-primary', onclick: () => proof.openSend() }, 'Get my free proof');
  const helpLink = h('button', { type: 'button', onclick: () => proof.openHelp() }, "Rather we design it? It's free.");
  const cta = h('div', { class: 'dz-cta' }, sendBtn, h('p', { class: 'dz-cta-sub' }, helpLink));
  const asideSummary = createSummary(ctx);
  const aside = h('aside', { class: 'dz-aside', 'aria-label': 'Price and proof' },
    h('h2', { class: 'dz-h3' }, 'Your price'), asideSummary.el,
    h('button', { type: 'button', class: 'dz-btn dz-btn-primary dz-btn-block', onclick: () => proof.openSend() }, 'Get my free proof'),
    h('button', { type: 'button', class: 'dz-btn dz-btn-ghost dz-btn-block', onclick: () => proof.openHelp() }, "Rather we design it? It's free."));

  app.append(top, stageCol, sheet.el, aside, cta, live, toast);
  root.append(app);
  store.set({});

  // ---- state reactions ----
  let started = false;
  let lastSel = 0;
  store.subscribe((state, keys) => {
    if (keys.includes('doc')) {
      syncTop();
      if (!started && store.history.size > 0) {
        started = true;
        analytics.track('design_start');
      }
    }
    if (keys.includes('view')) {
      app.dataset.mode = S.view.mode;
      const flatOn = S.view.mode === 'flat';
      flat.hidden = !flatOn;
      if (flatOn) stage.render();
    }
    if (keys.includes('editing') && S.editing && ctx.isPhone() && S.view.sheet !== 'collapsed') {
      store.set({ view: { sheet: 'collapsed' } });
    }
    if (keys.includes('selection')) {
      if (S.selection.length === 1 && lastSel === 0 && S.view.sheet !== 'collapsed') {
        const side = S.doc.project.pieces[S.view.pi].sides[S.view.si];
        const el = side.elements.find((e) => e.id === S.selection[0]);
        if (el && el.type === 'text') sheet.open('text', false);
        else if (el && el.type === 'image') sheet.open('logo', false);
      }
      lastSel = S.selection.length;
    }
  });
  syncTop();
  if (ctx.isPhone()) store.set({ view: { sheet: 'half' } });

  // First tap on the tools or the top bar: slide the editor up so the page heading is out of the way.
  let engaged = false;
  const engage = () => {
    if (engaged || !ctx.isPhone()) return;
    engaged = true;
    app.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  };
  sheet.el.addEventListener('pointerdown', engage, { passive: true });
  top.addEventListener('pointerdown', engage, { passive: true });

  const onKey = (e) => {
    if (e.defaultPrevented || isEditable(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.redo(); else store.undo();
      analytics.track('undo');
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      store.redo();
    }
  };
  document.addEventListener('keydown', onKey);

  if (debug) Object.assign(debug, { store, actions, ctx, stage, view3d, env, startedAt: performance.now() });
  return {
    store, ctx,
    destroy() {
      document.removeEventListener('keydown', onKey);
      stage.destroy();
    },
  };
}

export async function boot(root) {
  const debug = (window.GSSDesigner = window.GSSDesigner || {});
  debug.version = 2;
  debug.ready = false;
  const base = root.dataset.assets || '/assets/design/';
  const entry = root.dataset.entry || 'design';
  let data;
  try {
    data = await Promise.all(['catalog', 'print-specs', 'templates'].map((n) => loadJson(`${base}${n}.json`)));
  } catch (_) {
    root.textContent = '';
    root.append(h('p', { class: 'designer-loading' },
      'The designer could not load. Email ',
      h('a', { href: 'mailto:sales@getseensignsco.com' }, 'sales@getseensignsco.com'),
      ', ',
      h('a', { href: 'sms:+13342329003?body=Hi%2C%20I%20have%20a%20question%20about%20a%20sign', 'aria-label': 'Text Get Seen Signs at (334) 232-9003' }, 'text us'),
      ', or ',
      h('a', { href: 'https://wa.me/13342329003?text=Hi%2C%20I%20have%20a%20question%20about%20a%20sign', rel: 'noopener noreferrer', 'aria-label': 'Chat with Get Seen Signs on WhatsApp' }, 'chat on WhatsApp'),
      ' at ',
      h('a', { href: 'tel:+13342329003', 'aria-label': 'Call Get Seen Signs at (334) 232-9003' }, '(334) 232-9003'),
      ' and we will make your proof with you.'));
    return;
  }
  const [catalog, specs, templates] = data;
  const measure = createMeasurer(catalog.fonts);
  const env = { catalog, specs, templates, fonts: catalog.fonts, measure };
  // Wait only for the font the first layout uses (it is preloaded); the others load in the background.
  const firstTpl = catalog.products.find((p) => p.id === (root.dataset.product || ''));
  const firstFont = firstTpl && templates[firstTpl.id] ? templates[firstTpl.id][0].font : 'condensed';
  await loadFonts(catalog.fonts.filter((f) => f.id === firstFont), measure);
  const analytics = createAnalytics({ enabled: root.dataset.events === '1', endpoint: root.dataset.eventsUrl || '/api/design-event', product: root.dataset.product || '' });
  analytics.track('design_view');

  const params = new URLSearchParams(location.search);
  let productId = root.dataset.product || '';
  const open = (doc, note) => {
    const controller = startEditor(root, env, analytics, doc, {});
    const rest = catalog.fonts.filter((f) => !fontsReady([f]));
    if (rest.length) loadFonts(rest, measure).then(() => controller.store.set({ fonts: Date.now() }));
    if (note) controller.ctx.toast(note, 5000);
    debug.ready = true;
  };

  const hash = location.hash.startsWith('#d=') ? location.hash.slice(3) : '';
  if (hash) {
    const shared = await decodeDoc(hash, env);
    document.head.append(h('meta', { name: 'robots', content: 'noindex' }));
    if (shared) {
      analytics.track('share_open');
      open(shared, 'Opened a shared design. Logos are not included, so add yours again.');
      return;
    }
  }
  if (!productId) {
    // The hub page lists the products as plain links. An old ?product= link goes to that product's page.
    const legacy = catalog.products.find((p) => p.id === params.get('product'));
    if (legacy) {
      location.replace(`/design/${legacy.slug}/`);
      return;
    }
    debug.ready = true;
    return;
  }
  if (catalog.products.some((p) => p.id === productId)) open(createDocument(env, productId));
}
