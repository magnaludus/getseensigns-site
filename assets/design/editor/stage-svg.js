// The flat editor: the design drawn as SVG at print proportions, with selection handles, drag,
// resize, rotate, pinch, snapping, guides, keyboard control and in-place text editing.
import { sideDisplay } from '../render/displaylist.js';
import { innerArt } from '../render/svg.js';
import { elementBox, layoutOf } from '../model/layout.js';
import { findElement, updateElements } from '../model/document.js';
import { specFor } from '../model/specs.js';
import { resolveColor } from '../model/color.js';
import {
  corners, handlePoints, hitTest, resizeBox, rotateAngle, pinchBox, snapTargets, computeSnap, aabb, center,
} from '../model/geometry.js';
import { guidesSvg } from './guides.js';
import { openTextEdit } from './text-edit.js';

const NS = 'http://www.w3.org/2000/svg';
const n = (v) => Math.round(v * 1000) / 1000;
const DOUBLE_TAP_MS = 450;
const DRAG_START_PX = 4;

export function createStage(container, { store, actions, announce }) {
  const S = store.state;
  const env = store.env;
  const root = document.createElement('div');
  root.className = 'dz-stage';
  root.tabIndex = 0;
  root.setAttribute('role', 'application');
  root.setAttribute('aria-roledescription', 'design canvas');
  root.setAttribute('aria-label', 'Design canvas. Tab moves between items. Arrow keys move the selected item, plus and minus resize it, Enter edits text, Delete removes it.');
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'dz-svg');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.innerHTML = '<g class="art"></g><g class="guides" pointer-events="none"></g><g class="sel" pointer-events="none"></g><g class="snap" pointer-events="none"></g>';
  root.append(svg);
  container.append(root);
  const gArt = svg.querySelector('.art');
  const gGuides = svg.querySelector('.guides');
  const gSel = svg.querySelector('.sel');
  const gSnap = svg.querySelector('.snap');

  const pointers = new Map();
  let gesture = null;
  let lastTap = { id: null, t: 0, x: 0, y: 0 };
  let textEdit = null;
  let raf = 0;
  let lastSpecKey = '';

  const piece = () => S.doc.project.pieces[S.view.pi];
  const side = () => piece().sides[S.view.si];
  const spec = () => specFor(env.specs, piece().productId, piece().choices);
  const boxOf = (el) => elementBox(el, env.measure, env.fonts);
  const pxPerIn = () => {
    const m = svg.getScreenCTM();
    return m ? m.a : 1;
  };
  const toDoc = (cx, cy) => {
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  // ---------- drawing ----------

  function drawArt() {
    const display = sideDisplay(S.doc, S.view.pi, S.view.si, env, { hide: S.editing ? new Set([S.editing]) : null, assets: S.assets });
    const a = display.area;
    const key = [a.x, a.y, a.w, a.h].join(',');
    if (key !== lastSpecKey) {
      svg.setAttribute('viewBox', `${n(a.x)} ${n(a.y)} ${n(a.w)} ${n(a.h)}`);
      lastSpecKey = key;
    }
    gArt.innerHTML = innerArt(display, { assetUrl: (id) => (S.assets.get(id) ? S.assets.get(id).url : '') });
    return display.spec;
  }

  function drawGuides(sp) {
    const s = 1 / pxPerIn();
    gGuides.innerHTML = guidesSvg(sp, S.view.guides, s);
  }

  function handleSet(el) {
    if (el.type === 'text') return ['nw', 'ne', 'se', 'sw', 'e', 'w'];
    if (el.type === 'image' && el.keepAspect !== false) return ['nw', 'ne', 'se', 'sw'];
    return ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  }

  function drawSelection() {
    if (S.editing || !S.selection.length) {
      gSel.innerHTML = '';
      return;
    }
    const s = 1 / pxPerIn();
    const out = [];
    const sd = side();
    for (const id of S.selection) {
      const el = findElement(sd, id);
      if (!el) continue;
      const pts = corners(boxOf(el)).map((p) => n(p.x) + ',' + n(p.y)).join(' ');
      out.push(`<polygon points="${pts}" fill="none" stroke="rgba(20,22,26,.85)" stroke-width="${n(4 * s)}" stroke-linejoin="round"/>`);
      out.push(`<polygon points="${pts}" fill="none" stroke="#FFD100" stroke-width="${n(2 * s)}" stroke-linejoin="round"/>`);
    }
    if (S.selection.length === 1) {
      const el = findElement(sd, S.selection[0]);
      if (el && !el.locked) {
        const box = boxOf(el);
        const pts = handlePoints(box, 30 * s);
        const hs = 6 * s;
        const top = pts.n;
        out.push(`<line x1="${n(top.x)}" y1="${n(top.y)}" x2="${n(pts.rot.x)}" y2="${n(pts.rot.y)}" stroke="#FFD100" stroke-width="${n(1.5 * s)}"/>`);
        for (const name of handleSet(el)) {
          const p = pts[name];
          out.push(`<rect x="${n(p.x - hs)}" y="${n(p.y - hs)}" width="${n(hs * 2)}" height="${n(hs * 2)}" rx="${n(2 * s)}" fill="#fff" stroke="#14161A" stroke-width="${n(1.6 * s)}" transform="rotate(${n(box.rot)} ${n(p.x)} ${n(p.y)})"/>`);
        }
        out.push(`<circle cx="${n(pts.rot.x)}" cy="${n(pts.rot.y)}" r="${n(9 * s)}" fill="#FFD100" stroke="#14161A" stroke-width="${n(1.6 * s)}"/>`);
        out.push(`<path d="M${n(pts.rot.x - 4 * s)},${n(pts.rot.y + 1 * s)} a${n(4 * s)},${n(4 * s)} 0 1 1 ${n(1.2 * s)},${n(2.8 * s)}" fill="none" stroke="#14161A" stroke-width="${n(1.6 * s)}" stroke-linecap="round"/>`);
      }
    }
    gSel.innerHTML = out.join('');
  }

  function render() {
    raf = 0;
    if (S.view.mode !== 'flat' || !root.isConnected) return;
    const sp = drawArt();
    drawGuides(sp);
    drawSelection();
    if (textEdit) refreshEdit();
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(render);
  }

  // ---------- hit testing ----------

  function hitHandle(p, type) {
    if (S.selection.length !== 1) return null;
    const el = findElement(side(), S.selection[0]);
    if (!el || el.locked) return null;
    const s = 1 / pxPerIn();
    const radius = (type === 'touch' ? 24 : 12) * s;
    const box = boxOf(el);
    const pts = handlePoints(box, 30 * s);
    let best = null;
    let bestD = radius;
    const names = [...handleSet(el), 'rot'];
    for (const name of names) {
      const d = Math.hypot(p.x - pts[name].x, p.y - pts[name].y);
      if (d <= bestD) {
        best = name;
        bestD = d;
      }
    }
    return best;
  }

  function hitElement(p, type) {
    const s = 1 / pxPerIn();
    const items = side().elements.map((e) => ({ id: e.id, box: boxOf(e), locked: e.locked, hidden: e.hidden }));
    return hitTest(items, p.x, p.y, (type === 'touch' ? 6 : 3) * s);
  }

  // ---------- gestures ----------

  function patchFromBox(startEl, box, handle) {
    if (startEl.type === 'text') {
      const startBox = boxOf(startEl);
      if (handle === 'e' || handle === 'w') return { x: box.x, w: box.w };
      return { x: box.x, y: box.y, w: box.w, size: Math.max(0.2, (startEl.size * box.w) / startBox.w) };
    }
    return { x: box.x, y: box.y, w: box.w, h: box.h };
  }

  function showSnap(guides) {
    const s = 1 / pxPerIn();
    gSnap.innerHTML = guides
      .map((g) => (g.axis === 'x'
        ? `<line x1="${n(g.pos)}" y1="${n(g.from)}" x2="${n(g.pos)}" y2="${n(g.to)}" stroke="#FFD100" stroke-width="${n(1.6 * s)}"/>`
        : `<line x1="${n(g.from)}" y1="${n(g.pos)}" x2="${n(g.to)}" y2="${n(g.pos)}" stroke="#FFD100" stroke-width="${n(1.6 * s)}"/>`))
      .join('');
  }

  function beginMove(p, ids, type) {
    const sd = side();
    const startEls = new Map(ids.map((id) => [id, findElement(sd, id)]));
    gesture = { kind: 'move', ids, startEls, startDoc: S.doc, start: p, moved: false, type, startClient: null };
  }

  function updateMove(p, e) {
    const g = gesture;
    let dx = p.x - g.start.x;
    let dy = p.y - g.start.y;
    const s = 1 / pxPerIn();
    if (!g.moved) {
      const px = Math.hypot((e.clientX - g.startClient.x), (e.clientY - g.startClient.y));
      if (px < DRAG_START_PX) return;
      g.moved = true;
    }
    const sp = spec();
    const boxes = [...g.startEls.values()].map((el) => aabb({ ...boxOf(el), x: el.x + dx, y: el.y + dy }));
    const x0 = Math.min(...boxes.map((b) => b.x));
    const y0 = Math.min(...boxes.map((b) => b.y));
    const union = { x: x0, y: y0, w: Math.max(...boxes.map((b) => b.x + b.w)) - x0, h: Math.max(...boxes.map((b) => b.y + b.h)) - y0 };
    let guides = [];
    if (!e.altKey) {
      const others = side().elements.filter((el) => !g.startEls.has(el.id) && !el.hidden).map(boxOf);
      const snap = computeSnap(union, snapTargets(sp, others), 6 * s);
      dx += snap.dx;
      dy += snap.dy;
      guides = snap.guides;
    }
    // keep the center of the selection on the art
    const cxu = union.x + union.w / 2 + (dx - (p.x - g.start.x));
    const cyu = union.y + union.h / 2 + (dy - (p.y - g.start.y));
    const art = sp.art;
    if (cxu < art.x) dx += art.x - cxu;
    if (cxu > art.x + art.w) dx -= cxu - (art.x + art.w);
    if (cyu < art.y) dy += art.y - cyu;
    if (cyu > art.y + art.h) dy -= cyu - (art.y + art.h);
    const patches = {};
    for (const [id, el] of g.startEls) patches[id] = { x: el.x + dx, y: el.y + dy };
    showSnap(guides);
    previewPatches(patches);
  }

  function previewPatches(patches) {
    store.preview(updateElements(gesture.startDoc, S.view.pi, S.view.si, patches, env));
  }

  function beginHandle(p, handle) {
    const el = findElement(side(), S.selection[0]);
    gesture = { kind: handle === 'rot' ? 'rotate' : 'resize', handle, id: el.id, startEl: el, startBox: boxOf(el), startDoc: S.doc, moved: false };
  }

  function updateHandle(p, e) {
    const g = gesture;
    g.moved = true;
    if (g.kind === 'rotate') {
      const rot = rotateAngle(g.startBox, p, { step: e.shiftKey ? 15 : 0, free: e.altKey });
      previewPatches({ [g.id]: { rot } });
      return;
    }
    const lock = g.startEl.type === 'text' ? ['nw', 'ne', 'se', 'sw'].includes(g.handle)
      : g.startEl.type === 'image' ? g.startEl.keepAspect !== false && !e.shiftKey : e.shiftKey;
    const box = resizeBox(g.startBox, g.handle, p, { lockAspect: lock, minW: 0.5, minH: 0.5 });
    previewPatches({ [g.id]: patchFromBox(g.startEl, box, g.handle) });
  }

  function beginPinch() {
    const ids = S.selection.slice();
    const el = findElement(side(), ids[0]);
    if (!el || el.locked) return;
    const pts = [...pointers.values()].slice(0, 2).map((q) => toDoc(q.x, q.y));
    gesture = { kind: 'pinch', id: el.id, startEl: el, startBox: boxOf(el), start: pts, startDoc: S.doc, moved: true };
  }

  function updatePinch() {
    const g = gesture;
    if (pointers.size < 2) return;
    const now = [...pointers.values()].slice(0, 2).map((q) => toDoc(q.x, q.y));
    const pb = pinchBox(g.startBox, g.start, now);
    const patch = g.startEl.type === 'text'
      ? { x: pb.x, y: pb.y, w: pb.w, size: Math.max(0.2, g.startEl.size * pb.scale), rot: pb.rot }
      : { x: pb.x, y: pb.y, w: pb.w, h: pb.h, rot: pb.rot };
    previewPatches({ [g.id]: patch });
  }

  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (svg.setPointerCapture) {
      try { svg.setPointerCapture(e.pointerId); } catch (_) { /* pointer already gone */ }
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    root.focus({ preventScroll: true });
    if (S.editing) closeEdit();
    if (pointers.size >= 2) {
      if (gesture && gesture.kind !== 'pinch') {
        // a second finger: keep what the first finger did so far and switch to pinch
        gesture = null;
      }
      if (S.selection.length === 1) beginPinch();
      return;
    }
    const type = e.pointerType === 'mouse' || e.pointerType === 'pen' ? 'mouse' : 'touch';
    const p = toDoc(e.clientX, e.clientY);
    const handle = hitHandle(p, type);
    if (handle) {
      beginHandle(p, handle);
      return;
    }
    const id = hitElement(p, type);
    if (!id) {
      gesture = null;
      if (S.selection.length) actions.select([]);
      return;
    }
    const wasSelected = S.selection.length === 1 && S.selection[0] === id;
    let ids = S.selection.includes(id) ? S.selection.slice() : [id];
    if (e.shiftKey) {
      ids = S.selection.includes(id) ? S.selection.filter((x) => x !== id) : S.selection.concat([id]);
      actions.select(ids);
      if (!ids.includes(id)) {
        gesture = null;
        return;
      }
    } else if (!S.selection.includes(id)) {
      actions.select(ids);
    }
    beginMove(p, ids, type);
    gesture.startClient = { x: e.clientX, y: e.clientY };
    gesture.tapId = id;
    gesture.wasSelected = wasSelected;
  }

  function onPointerMove(e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture) return;
    const p = toDoc(e.clientX, e.clientY);
    if (gesture.kind === 'pinch') updatePinch();
    else if (gesture.kind === 'move') updateMove(p, e);
    else updateHandle(p, e);
  }

  function endGesture(e, cancelled) {
    pointers.delete(e.pointerId);
    if (svg.releasePointerCapture) {
      try { svg.releasePointerCapture(e.pointerId); } catch (_) { /* not captured */ }
    }
    const g = gesture;
    if (!g) return;
    if (g.kind === 'pinch' && pointers.size > 0) return;
    gesture = null;
    gSnap.innerHTML = '';
    if (cancelled) {
      store.revert();
      return;
    }
    if (g.moved) {
      store.commit(S.doc, { key: null });
      lastTap = { id: null, t: 0, x: 0, y: 0 };
      return;
    }
    if (g.kind === 'move' && g.tapId) {
      const now = performance.now();
      const el = findElement(side(), g.tapId);
      const near = Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24;
      const again = g.type === 'touch' && g.wasSelected; // tapping a selected text on a touch screen edits it
      if (el && el.type === 'text' && (again || (lastTap.id === g.tapId && now - lastTap.t < DOUBLE_TAP_MS && near))) {
        lastTap = { id: null, t: 0, x: 0, y: 0 };
        startEdit(g.tapId);
      } else {
        lastTap = { id: g.tapId, t: now, x: e.clientX, y: e.clientY };
      }
    }
  }

  // ---------- text editing ----------

  function startEdit(id) {
    const el = findElement(side(), id);
    if (!el || el.type !== 'text' || el.locked || textEdit) return;
    store.set({ editing: id, selection: [id] });
    drawArt();
    drawSelection();
    const palette = S.doc.project.palette;
    textEdit = openTextEdit({
      container: root, svg, el, env, fill: resolveColor(el.fill, palette, '#000'), scale: pxPerIn(),
      lay: layoutOf(el, env.measure, env.fonts),
      onInput: (value) => {
        actions.setTextValue(id, value, { live: true });
      },
      onClose: () => {
        textEdit = null;
        actions.commitCurrent('text:' + id);
        store.set({ editing: null });
        root.focus({ preventScroll: true });
      },
    });
  }

  function refreshEdit() {
    if (!textEdit || !S.editing) return;
    const el = findElement(side(), S.editing);
    if (!el) return;
    textEdit.update(el, layoutOf(el, env.measure, env.fonts), pxPerIn());
  }

  function closeEdit() {
    if (textEdit) textEdit.close();
  }

  // ---------- keyboard ----------

  function cycle(dir) {
    const list = side().elements.filter((e) => !e.hidden && !e.locked);
    if (!list.length) return false;
    const cur = S.selection.length === 1 ? list.findIndex((e) => e.id === S.selection[0]) : -1;
    const next = cur + dir;
    if (cur === -1) {
      actions.select([list[dir > 0 ? 0 : list.length - 1].id]);
      return true;
    }
    if (next < 0 || next >= list.length) {
      actions.select([]);
      return false;
    }
    actions.select([list[next].id]);
    return true;
  }

  function onKeyDown(e) {
    if (S.editing) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    if (mod && key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.redo(); else store.undo();
      return;
    }
    if (mod && key.toLowerCase() === 'y') {
      e.preventDefault();
      store.redo();
      return;
    }
    if (mod && key.toLowerCase() === 'd') {
      e.preventDefault();
      actions.duplicate();
      return;
    }
    if (key === 'Delete' || key === 'Backspace') {
      if (S.selection.length) {
        e.preventDefault();
        actions.remove();
      }
      return;
    }
    if (key === 'Escape') {
      actions.select([]);
      return;
    }
    if (key === 'Tab') {
      if (cycle(e.shiftKey ? -1 : 1)) e.preventDefault();
      return;
    }
    if (!S.selection.length) return;
    if (key === 'Enter' || key === 'F2') {
      const el = findElement(side(), S.selection[0]);
      if (el && el.type === 'text') {
        e.preventDefault();
        startEdit(el.id);
      }
      return;
    }
    const step = e.shiftKey ? 1 : 0.25;
    if (key === 'ArrowLeft') { e.preventDefault(); actions.nudge(-step, 0); } else if (key === 'ArrowRight') { e.preventDefault(); actions.nudge(step, 0); } else if (key === 'ArrowUp') { e.preventDefault(); actions.nudge(0, -step); } else if (key === 'ArrowDown') { e.preventDefault(); actions.nudge(0, step); } else if (key === '+' || key === '=') { e.preventDefault(); actions.scale(e.shiftKey ? 1.15 : 1.05); } else if (key === '-' || key === '_') { e.preventDefault(); actions.scale(e.shiftKey ? 0.87 : 0.95); }
  }

  // ---------- wiring ----------

  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', (e) => endGesture(e, false));
  svg.addEventListener('pointercancel', (e) => endGesture(e, true));
  svg.addEventListener('contextmenu', (e) => e.preventDefault());
  root.addEventListener('keydown', onKeyDown);
  const ro = new ResizeObserver(() => {
    if (S.view.mode !== 'flat') return;
    drawGuides(spec());
    drawSelection();
    refreshEdit();
  });
  ro.observe(root);

  let lastAnnounce = '';
  const unsub = store.subscribe((state, keys) => {
    if (keys.some((k) => ['doc', 'view', 'selection', 'editing', 'assets', 'fonts'].includes(k))) schedule();
    if (keys.includes('selection') && !gesture) {
      let msg = '';
      if (state.selection.length === 1) {
        const el = findElement(side(), state.selection[0]);
        if (el) {
          const b = boxOf(el);
          const what = el.type === 'text' ? `Text, "${String(el.text).slice(0, 40)}"` : el.type === 'image' ? 'Logo' : el.name || 'Shape';
          msg = `${what}, ${n(b.w)} by ${n(b.h)} inches, ${side().name} side`;
        }
      } else if (state.selection.length > 1) msg = `${state.selection.length} items selected`;
      else msg = 'Nothing selected';
      if (msg !== lastAnnounce) {
        lastAnnounce = msg;
        announce(msg);
      }
    }
  });

  schedule();
  return {
    root,
    svg,
    render,
    startEdit,
    closeEdit,
    toDoc,
    pxPerIn,
    destroy() {
      unsub();
      ro.disconnect();
      root.remove();
    },
  };
}
