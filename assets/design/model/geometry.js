// Box math for the editor: rotated boxes, hit tests, resize and rotate handles, pinch gestures and
// snapping. A box is {x, y, w, h, rot} in inches with rot in degrees about the box center.
// Pure functions, no DOM.
import { bandRect, columnRect } from './outline.js';

const RAD = Math.PI / 180;

export function center(b) {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

export function rotatePoint(px, py, cx, cy, deg) {
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  const dx = px - cx;
  const dy = py - cy;
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
}

export function corners(b) {
  const c = center(b);
  const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
  return pts.map(([x, y]) => rotatePoint(x, y, c.x, c.y, b.rot || 0));
}

// Axis-aligned bounds of the rotated box.
export function aabb(b) {
  const pts = corners(b);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function toLocal(b, px, py) {
  const c = center(b);
  return rotatePoint(px, py, c.x, c.y, -(b.rot || 0));
}

export function pointInBox(b, px, py, slop = 0) {
  const p = toLocal(b, px, py);
  return p.x >= b.x - slop && p.x <= b.x + b.w + slop && p.y >= b.y - slop && p.y <= b.y + b.h + slop;
}

// items: [{id, box, locked, hidden}] bottom to top. Returns the id of the topmost hit.
export function hitTest(items, px, py, slop = 0) {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.hidden || it.locked) continue;
    if (pointInBox(it.box, px, py, slop)) return it.id;
  }
  return null;
}

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const SIGNS = { nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0] };

export function handlePoints(b, rotateGap) {
  const c = center(b);
  const at = (hx, hy) => rotatePoint(b.x + hx * b.w, b.y + hy * b.h, c.x, c.y, b.rot || 0);
  const out = {
    nw: at(0, 0), n: at(0.5, 0), ne: at(1, 0), e: at(1, 0.5), se: at(1, 1), s: at(0.5, 1), sw: at(0, 1), w: at(0, 0.5),
  };
  const top = rotatePoint(b.x + b.w / 2, b.y - rotateGap, c.x, c.y, b.rot || 0);
  out.rot = top;
  return out;
}

// Move a handle to `pointer` (doc inches). The opposite side stays put. Returns a new box.
export function resizeBox(orig, handle, pointer, opts = {}) {
  const [sx, sy] = SIGNS[handle];
  const minW = opts.minW == null ? 0.25 : opts.minW;
  const minH = opts.minH == null ? 0.25 : opts.minH;
  const rot = orig.rot || 0;
  const c = center(orig);
  const p = rotatePoint(pointer.x, pointer.y, c.x, c.y, -rot);
  const hw = orig.w / 2;
  const hh = orig.h / 2;
  const ax = -sx * hw;
  const ay = -sy * hh;
  let w = sx ? Math.max(minW, (p.x - c.x - ax) * sx) : orig.w;
  let h = sy ? Math.max(minH, (p.y - c.y - ay) * sy) : orig.h;
  if (opts.lockAspect && sx && sy) {
    const k = Math.max(w / orig.w, h / orig.h);
    w = Math.max(minW, orig.w * k);
    h = Math.max(minH, orig.h * k);
  }
  const ncx = ax + (sx * w) / 2;
  const ncy = ay + (sy * h) / 2;
  const world = rotatePoint(c.x + ncx, c.y + ncy, c.x, c.y, rot);
  return { x: world.x - w / 2, y: world.y - h / 2, w, h, rot };
}

export function normalizeAngle(deg) {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
}

export function rotateAngle(orig, pointer, opts = {}) {
  const c = center(orig);
  let a = (Math.atan2(pointer.y - c.y, pointer.x - c.x) * 180) / Math.PI + 90;
  if (opts.step) a = Math.round(a / opts.step) * opts.step;
  else if (!opts.free) {
    const near = Math.round(a / 90) * 90;
    if (Math.abs(a - near) < 3) a = near;
  }
  return normalizeAngle(a);
}

// Two-finger gesture: scale about the box center, add the twist, follow the midpoint.
export function pinchBox(orig, start, now) {
  const d0 = Math.hypot(start[1].x - start[0].x, start[1].y - start[0].y) || 1;
  const d1 = Math.hypot(now[1].x - now[0].x, now[1].y - now[0].y) || 1;
  const scale = Math.max(0.1, Math.min(10, d1 / d0));
  const a0 = Math.atan2(start[1].y - start[0].y, start[1].x - start[0].x);
  const a1 = Math.atan2(now[1].y - now[0].y, now[1].x - now[0].x);
  const twist = ((a1 - a0) * 180) / Math.PI;
  const m0 = { x: (start[0].x + start[1].x) / 2, y: (start[0].y + start[1].y) / 2 };
  const m1 = { x: (now[0].x + now[1].x) / 2, y: (now[0].y + now[1].y) / 2 };
  const c = center(orig);
  const cx = c.x + (m1.x - m0.x);
  const cy = c.y + (m1.y - m0.y);
  const w = orig.w * scale;
  const h = orig.h * scale;
  return { x: cx - w / 2, y: cy - h / 2, w, h, rot: normalizeAngle((orig.rot || 0) + twist), scale };
}

// ---------- snapping ----------

// Lines an element can snap to: art edges and centers, the safe area, and other elements.
export function snapTargets(spec, others) {
  const xs = [];
  const ys = [];
  const t = spec.trim;
  const s = spec.safe;
  const tcx = t.x + t.w / 2;
  const tcy = t.y + t.h / 2;
  xs.push({ pos: t.x, kind: 'edge' }, { pos: tcx, kind: 'center' }, { pos: t.x + t.w, kind: 'edge' });
  ys.push({ pos: t.y, kind: 'edge' }, { pos: tcy, kind: 'center' }, { pos: t.y + t.h, kind: 'edge' });
  xs.push({ pos: s.x, kind: 'safe' }, { pos: s.x + s.w, kind: 'safe' });
  ys.push({ pos: s.y, kind: 'safe' }, { pos: s.y + s.h, kind: 'safe' });
  for (const o of others) {
    const b = aabb(o);
    xs.push({ pos: b.x, kind: 'el', from: b.y, to: b.y + b.h }, { pos: b.x + b.w / 2, kind: 'el', from: b.y, to: b.y + b.h }, { pos: b.x + b.w, kind: 'el', from: b.y, to: b.y + b.h });
    ys.push({ pos: b.y, kind: 'el', from: b.x, to: b.x + b.w }, { pos: b.y + b.h / 2, kind: 'el', from: b.x, to: b.x + b.w }, { pos: b.y + b.h, kind: 'el', from: b.x, to: b.x + b.w });
  }
  return { xs, ys, extent: t };
}

function bestSnap(features, lines, threshold) {
  let best = null;
  for (const f of features) {
    for (const l of lines) {
      const d = l.pos - f;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best))) best = d;
    }
  }
  return best;
}

// bbox: axis-aligned bounds of the moving element. Returns the shift to apply and the guides to draw.
export function computeSnap(bbox, targets, threshold) {
  const fx = [bbox.x, bbox.x + bbox.w / 2, bbox.x + bbox.w];
  const fy = [bbox.y, bbox.y + bbox.h / 2, bbox.y + bbox.h];
  const dx = bestSnap(fx, targets.xs, threshold);
  const dy = bestSnap(fy, targets.ys, threshold);
  const guides = [];
  const ex = targets.extent;
  if (dx != null) {
    const moved = fx.map((v) => v + dx);
    for (const l of targets.xs) {
      if (moved.some((v) => Math.abs(v - l.pos) < 1e-6)) {
        guides.push({ axis: 'x', pos: l.pos, from: Math.min(l.from == null ? ex.y : l.from, bbox.y + (dy || 0)), to: Math.max(l.to == null ? ex.y + ex.h : l.to, bbox.y + bbox.h + (dy || 0)), kind: l.kind });
      }
    }
  }
  if (dy != null) {
    const moved = fy.map((v) => v + dy);
    for (const l of targets.ys) {
      if (moved.some((v) => Math.abs(v - l.pos) < 1e-6)) {
        guides.push({ axis: 'y', pos: l.pos, from: Math.min(l.from == null ? ex.x : l.from, bbox.x + (dx || 0)), to: Math.max(l.to == null ? ex.x + ex.w : l.to, bbox.x + bbox.w + (dx || 0)), kind: l.kind });
      }
    }
  }
  return { dx: dx || 0, dy: dy || 0, guides };
}

// ---------- alignment ----------

// What one element aligns to: the safe box, or on a shaped product (canopy gable, curved flag) the part of
// the safe line that runs through the element's own row or column, so Left on the curved flag top stops at the curve.
export function alignArea(spec, box, edge) {
  if (!spec.safePoly) return spec.safe;
  const b = aabb(box);
  const sideways = edge === 'left' || edge === 'center' || edge === 'right';
  return (sideways ? bandRect(spec.safePoly, b.y, b.y + b.h) : columnRect(spec.safePoly, b.x, b.x + b.w)) || spec.safe;
}

// Align boxes inside `area` ({x,y,w,h}). edge: left|center|right|top|middle|bottom. Returns {id: {x, y}} patches.
export function alignBoxes(items, area, edge) {
  const out = {};
  for (const it of items) {
    const b = aabb(it.box);
    let dx = 0;
    let dy = 0;
    if (edge === 'left') dx = area.x - b.x;
    if (edge === 'center') dx = area.x + area.w / 2 - (b.x + b.w / 2);
    if (edge === 'right') dx = area.x + area.w - (b.x + b.w);
    if (edge === 'top') dy = area.y - b.y;
    if (edge === 'middle') dy = area.y + area.h / 2 - (b.y + b.h / 2);
    if (edge === 'bottom') dy = area.y + area.h - (b.y + b.h);
    out[it.id] = { x: it.box.x + dx, y: it.box.y + dy };
  }
  return out;
}
