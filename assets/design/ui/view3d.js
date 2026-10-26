// The 3D view: loads the Three.js stage only when it is first needed, keeps its textures in step
// with the document, and falls back to a simple flat picture when WebGL is missing, the device is
// short on memory, startup takes more than 4 seconds, or the customer asks for it. Editing and
// sending a proof never depend on this view.
import { h } from './dom.js';
import { webglAvailable, lowMemoryDevice } from '../three/support.js';
import { sideDisplay } from '../render/displaylist.js';
import { renderToCanvas } from '../render/canvas.js';
import { sideNamesFor, productOf } from '../model/document.js';
import { specFor } from '../model/specs.js';
import { resolveColor } from '../model/color.js';
import { renderSimple } from './simple-view.js';

const START_TIMEOUT_MS = 4000;
const CONTEXT_WAIT_MS = 4000; // how long a lost WebGL context gets to come back before the simple view takes over
const PRESETS = [['front', 'Front'], ['side', 'Side'], ['back', 'Back'], ['wide', 'Wide']];

export function createView3d(ctx) {
  const { store, env } = ctx;
  const S = store.state;
  const el = h('div', { class: 'dz-3d', hidden: true });
  const host = h('div', { class: 'dz-3d-host' });
  const simple = h('div', { class: 'dz-simple', hidden: true });
  const simpleCanvas = h('canvas', { class: 'dz-simple-canvas', role: 'img' });
  simple.append(simpleCanvas, h('p', { class: 'dz-simple-note' }, 'Simple view. Your 3D preview is not available on this device, but your design is saved and you can still send it.'));
  const bar = h('div', { class: 'dz-3dbar' });
  const presetBtns = PRESETS.map(([id, label]) => h('button', { type: 'button', class: 'dz-chip dz-chip-dark', onclick: () => stage && stage.setCameraPreset(id, { animate: !reduced }) }, label));
  const sceneSel = h('select', { class: 'dz-input dz-select-dark', 'aria-label': 'Scene', onchange: () => setScene(sceneSel.value) });
  for (const s of env.catalog.scenes) sceneSel.append(h('option', { value: s.id }, s.label));
  const mountSel = h('select', { class: 'dz-input dz-select-dark', 'aria-label': 'Banner mounting', onchange: () => stage && stage.setOptions({ mount: mountSel.value }) },
    h('option', { value: 'fence' }, 'On a fence'), h('option', { value: 'wall' }, 'On a wall'));
  const note = h('p', { class: 'dz-3d-note', role: 'status', hidden: true });
  bar.append(...presetBtns, sceneSel, mountSel);
  el.append(host, simple, bar, note);

  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let stage = null;
  let starting = null;
  let failed = false;
  let lastProduct = '';
  let lastChoices = '';
  let stale = false; // the design changed while the 3D view was hidden
  const canvases = [];
  let raf = 0;
  let timer = 0;
  let lostTimer = 0;

  function isPhone() {
    return window.innerWidth < 768;
  }

  // The view bar (top) and the 3D bar (bottom) float over the canvas. The stage frames the product in
  // the part they leave free.
  function coveredBy() {
    const rect = host.getBoundingClientRect();
    const viewbar = el.parentElement && el.parentElement.querySelector('.dz-viewbar');
    const top = viewbar ? viewbar.getBoundingClientRect().bottom - rect.top : 0;
    const bottom = bar.hidden ? 0 : rect.bottom - bar.getBoundingClientRect().top;
    return { top: Math.max(0, Math.round(top)) + 4, bottom: Math.max(0, Math.round(bottom)) + 4 };
  }

  async function startStage() {
    if (stage || failed) return stage;
    if (starting) return starting;
    starting = (async () => {
      if (!webglAvailable()) return fail('webgl');
      if (lowMemoryDevice()) return fail('memory');
      if (S.view.simple) return fail('chosen');
      let slow = 0;
      const timeout = new Promise((_, reject) => { slow = setTimeout(() => reject(Object.assign(new Error('slow'), { reason: 'timeout' })), START_TIMEOUT_MS); });
      let creating = null;
      try {
        const mod = await Promise.race([import('../three/stage3d.js'), timeout]);
        creating = mod.createStage3D(host, {
          specs: env.specs, catalog: env.catalog, maxTexture: isPhone() ? 1024 : 2048, reducedMotion: reduced, label: '3D preview of your design', insets: coveredBy,
          onPick: (info) => pickSide(info.sideIndex),
          onContextLost: contextLost,
        });
        const made = await Promise.race([creating, timeout]);
        clearTimeout(slow);
        stage = made;
        ctx.track('view_3d_open');
        lastProduct = '';
        syncAll();
        return stage;
      } catch (err) {
        clearTimeout(slow);
        // a stage that finishes after the timeout is not wanted any more
        if (creating) creating.then((late) => late && late.dispose(), () => {});
        return fail(err && err.reason ? err.reason : 'init');
      }
    })();
    return starting;
  }

  // The stage rebuilds itself when the browser gives the WebGL context back (a phone that was busy with
  // something else, say). If that does not happen soon, the simple view takes over.
  function contextLost() {
    const canvas = stage && stage.canvas;
    note.textContent = '3D paused. Getting it back…';
    note.hidden = false;
    const back = () => {
      clearTimeout(lostTimer);
      note.hidden = true;
    };
    if (canvas) canvas.addEventListener('webglcontextrestored', back, { once: true });
    clearTimeout(lostTimer);
    lostTimer = setTimeout(() => {
      if (canvas) canvas.removeEventListener('webglcontextrestored', back);
      fail('context-lost');
    }, CONTEXT_WAIT_MS);
  }

  function fail(reason) {
    failed = true;
    clearTimeout(lostTimer);
    if (stage) {
      try { stage.dispose(); } catch (_) { /* already gone */ }
    }
    stage = null;
    ctx.track('view_3d_fallback', { reason });
    showSimple(true);
    return null;
  }

  function toggleSimple() {
    if (simple.hidden) {
      showSimple(true);
    } else if (!failed) {
      showSimple(false);
      startStage();
    }
  }

  function showSimple(on) {
    simple.hidden = !on;
    host.hidden = on;
    note.hidden = true;
    for (const b of presetBtns) b.hidden = on;
    sceneSel.hidden = on;
    mountSel.hidden = on || S.doc.project.pieces[S.view.pi].productId !== 'banner';
    bar.hidden = on;
    if (on) drawSimple();
    store.set({ view: { simple: on } });
  }

  function drawSimple() {
    const r = simple.getBoundingClientRect();
    const w = Math.max(200, Math.round(r.width || 360));
    const hgt = Math.max(160, Math.round((r.height || 300) - 40));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    simpleCanvas.width = Math.round(w * dpr);
    simpleCanvas.height = Math.round(hgt * dpr);
    simpleCanvas.style.width = w + 'px';
    simpleCanvas.style.height = hgt + 'px';
    const piece = S.doc.project.pieces[S.view.pi];
    const product = productOf(env, piece.productId);
    simpleCanvas.setAttribute('aria-label', `Simple picture of your ${product.name}`);
    renderSimple(simpleCanvas.getContext('2d'), { doc: S.doc, pi: S.view.pi, si: S.view.si, env, assets: S.assets, width: simpleCanvas.width, height: simpleCanvas.height });
  }

  function pickSide(i) {
    const piece = S.doc.project.pieces[S.view.pi];
    const si = piece.sidesMode === 'same' ? 0 : i;
    store.set({ view: { mode: 'flat', si } });
    ctx.announce(`Editing the ${piece.sides[si].name} side`);
  }

  function setScene(id) {
    store.set({ view: { scene: id } });
    if (stage) stage.setScene(id);
    ctx.track('scene_change', { scene: id });
    updateLabel();
  }

  function updateLabel() {
    if (!stage) return;
    const piece = S.doc.project.pieces[S.view.pi];
    const product = productOf(env, piece.productId);
    const scene = env.catalog.scenes.find((s) => s.id === S.view.scene);
    stage.setLabel(`3D preview of your ${product.name} in the ${scene ? scene.label.toLowerCase() : 'studio'} scene. Drag to turn it.`);
  }

  function syncAll() {
    if (!stage) return;
    stale = false;
    const piece = S.doc.project.pieces[S.view.pi];
    const key = JSON.stringify(piece.choices);
    if (piece.productId !== lastProduct || key !== lastChoices) {
      stage.setProduct(piece.productId, piece.choices);
      lastProduct = piece.productId;
      lastChoices = key;
      canvases.length = 0;
    }
    mountSel.hidden = piece.productId !== 'banner';
    sceneSel.value = S.view.scene;
    stage.setScene(S.view.scene);
    updateLabel();
    syncTextures();
  }

  function syncTextures() {
    raf = 0;
    if (!stage) return;
    const piece = S.doc.project.pieces[S.view.pi];
    const names = sideNamesFor(productOf(env, piece.productId), piece.choices);
    const max = isPhone() ? 1024 : 2048;
    const drawn = new Map();
    names.forEach((_, i) => {
      const src = piece.sidesMode === 'same' ? 0 : i;
      if (!drawn.has(src)) {
        const display = sideDisplay(S.doc, S.view.pi, src, env, { region: 'trim', assets: S.assets });
        drawn.set(src, renderToCanvas(display, max, S.assets, canvases[src]));
        canvases[src] = drawn.get(src);
      }
      stage.setSideTexture(i, drawn.get(src));
    });
    const side0 = piece.sides[0];
    const bg = side0.bg.type === 'gradient' ? side0.bg.from : side0.bg.color;
    stage.setBaseColor(resolveColor(bg, S.doc.project.palette));
    stage.requestRender();
  }

  function scheduleTextures(live) {
    if (!stage) {
      if (!simple.hidden) drawSimple();
      return;
    }
    if (live) {
      if (!timer) timer = setTimeout(() => { timer = 0; syncTextures(); }, 100);
    } else {
      clearTimeout(timer);
      timer = 0;
      if (!raf) raf = requestAnimationFrame(syncTextures);
    }
  }

  function focusSide(i) {
    if (stage && S.view.mode === '3d') stage.focusSide(i, { animate: !reduced });
  }

  function onMode() {
    const on = S.view.mode === '3d';
    el.hidden = !on;
    if (on) {
      if (failed || S.view.simple) showSimple(true);
      else startStage().then(() => { if (stage) { stage.resize(); if (stale) syncAll(); } });
      note.hidden = true;
    }
  }

  let lastMode = S.view.mode;
  store.subscribe((state, keys) => {
    if (keys.includes('view') && S.view.mode !== lastMode) {
      lastMode = S.view.mode;
      onMode();
    }
    const changed = keys.includes('doc') || keys.includes('assets') || keys.includes('fonts');
    if (S.view.mode !== '3d') {
      if (changed) stale = true;
      return;
    }
    if (changed) {
      const piece = S.doc.project.pieces[S.view.pi];
      if (stage && (piece.productId !== lastProduct || JSON.stringify(piece.choices) !== lastChoices)) syncAll();
      else scheduleTextures(keys.includes('preview'));
    }
    if (keys.includes('view') && stage) {
      if (sceneSel.value !== S.view.scene) { sceneSel.value = S.view.scene; stage.setScene(S.view.scene); updateLabel(); }
    }
  });

  const ro = new ResizeObserver(() => {
    if (stage && S.view.mode === '3d') stage.resize();
    if (!simple.hidden && S.view.mode === '3d') drawSimple();
  });
  ro.observe(el);
  ro.observe(bar);

  return {
    el,
    focusSide,
    toggleSimple,
    prefetch() {
      if (!failed && webglAvailable() && !lowMemoryDevice()) import('../three/stage3d.js').catch(() => {});
    },
    get stage() {
      return stage;
    },
    get failed() {
      return failed;
    },
  };
}
