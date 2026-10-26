// A small orbit controller: drag to orbit, wheel and pinch to zoom, arrow keys and +/- on focus.
// It only changes the {azimuth, elevation, distance} state; the stage turns that into a camera.
import { clamp, clampCamera, shortestDelta, ease } from './geom.js';

const DEG_PER_PX = 0.32;
const TAP_PX = 7;

export function createOrbit(el, o) {
  const s = { azimuth: 0, elevation: 12, distance: 300 };
  let lim = { minEl: 3, maxEl: 80, minDist: 20, maxDist: 2000 };
  let goal = s.distance;
  let tween = null;
  let dragging = false;
  let span = 0;
  let moved = 0;
  let downAt = 0;
  let lastTap = null;
  let lastDouble = -1e9;
  const vel = { az: 0, el: 0 };
  const ptrs = new Map();
  let lastMove = 0;

  const fix = () => {
    const c = clampCamera(s, lim);
    if (c.elevation !== s.elevation) vel.el = 0;
    s.azimuth = c.azimuth;
    s.elevation = c.elevation;
    s.distance = c.distance;
    goal = clamp(goal, lim.minDist, lim.maxDist);
  };
  const stopMotion = () => {
    tween = null;
    vel.az = vel.el = 0;
    goal = s.distance;
  };
  const zoomBy = (k) => {
    goal = clamp(goal * k, lim.minDist, lim.maxDist);
    if (o.reduced()) s.distance = goal;
    o.onChange();
  };
  const double = (x, y) => {
    const now = performance.now();
    if (now - lastDouble < 400) return;
    lastDouble = now;
    o.onDouble(x, y);
  };

  const onDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
    stopMotion();
    dragging = true;
    el.style.cursor = 'grabbing';
    if (ptrs.size === 1) {
      moved = 0;
      downAt = lastMove = e.timeStamp;
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      span = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const onMove = (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (ptrs.size === 1) {
      moved += Math.abs(dx) + Math.abs(dy);
      s.azimuth -= dx * DEG_PER_PX;
      s.elevation += dy * DEG_PER_PX;
      const dt = Math.max(1, e.timeStamp - lastMove) / 1000;
      vel.az = vel.az * 0.5 + ((-dx * DEG_PER_PX) / dt) * 0.5;
      vel.el = vel.el * 0.5 + ((dy * DEG_PER_PX) / dt) * 0.5;
      lastMove = e.timeStamp;
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const now = Math.hypot(a.x - b.x, a.y - b.y);
      if (span > 0 && now > 0) {
        s.distance = clamp(s.distance * (span / now), lim.minDist, lim.maxDist);
        goal = s.distance;
      }
      span = now;
      moved += 20;
    }
    fix();
    o.onChange();
  };
  const onUp = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (ptrs.size === 0) {
      dragging = false;
      el.style.cursor = 'grab';
      const quick = e.timeStamp - downAt < 350;
      if (e.type === 'pointerup' && e.pointerType !== 'mouse' && moved < TAP_PX && quick) {
        if (lastTap && e.timeStamp - lastTap.t < 340 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
          lastTap = null;
          double(e.clientX, e.clientY);
        } else {
          lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
        }
      }
      if (o.reduced() || e.timeStamp - lastMove > 70 || e.type === 'pointercancel') vel.az = vel.el = 0;
      o.onChange();
    } else if (ptrs.size === 1) {
      span = 0;
    }
  };
  const onWheel = (e) => {
    e.preventDefault();
    const d = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
    tween = null;
    zoomBy(Math.exp(clamp(d, -240, 240) * 0.0016));
  };
  const onDbl = (e) => {
    if (e.pointerType === 'touch') return;
    double(e.clientX, e.clientY);
  };
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const big = e.shiftKey ? 3 : 1;
    const step = 6 * big;
    let hit = true;
    if (k === 'ArrowLeft') s.azimuth += step;
    else if (k === 'ArrowRight') s.azimuth -= step;
    else if (k === 'ArrowUp') s.elevation += step;
    else if (k === 'ArrowDown') s.elevation -= step;
    else if (k === '+' || k === '=' || k === 'Add') zoomBy(0.88);
    else if (k === '-' || k === '_' || k === 'Subtract') zoomBy(1.14);
    else hit = false;
    if (!hit) return;
    e.preventDefault();
    if (!k.startsWith('Arrow')) return;
    tween = null;
    fix();
    o.onChange();
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('dblclick', onDbl);
  el.addEventListener('keydown', onKey);

  return {
    state: s,
    limits(l) {
      lim = { ...lim, ...l };
      fix();
    },
    // Set the state directly (clamped). Used for jumps.
    set(p) {
      stopMotion();
      Object.assign(s, p);
      fix();
      goal = s.distance;
    },
    // Animate to a goal; azimuth takes the short way round.
    tweenTo(g, ms) {
      const to = clampCamera({ ...s, ...g }, lim);
      if (o.reduced() || !ms) return this.set(to);
      vel.az = vel.el = 0;
      tween = { t0: performance.now(), ms, a0: s.azimuth, da: shortestDelta(s.azimuth, to.azimuth), e0: s.elevation, de: to.elevation - s.elevation, d0: s.distance, dd: to.distance - s.distance };
    },
    // Advance inertia, tween and zoom smoothing. Returns true while something is still moving.
    step(dt, now) {
      let busy = false;
      if (tween) {
        const t = clamp((now - tween.t0) / tween.ms, 0, 1);
        const k = ease(t);
        s.azimuth = tween.a0 + tween.da * k;
        s.elevation = tween.e0 + tween.de * k;
        s.distance = tween.d0 + tween.dd * k;
        goal = s.distance;
        if (t >= 1) tween = null;
        else busy = true;
      } else {
        if (!dragging && (Math.abs(vel.az) > 0.4 || Math.abs(vel.el) > 0.4)) {
          s.azimuth += vel.az * dt;
          s.elevation += vel.el * dt;
          const k = Math.exp(-dt / 0.16);
          vel.az *= k;
          vel.el *= k;
          busy = true;
        } else if (!dragging) {
          vel.az = vel.el = 0;
        }
        if (Math.abs(goal - s.distance) > 0.02) {
          s.distance += (goal - s.distance) * (1 - Math.exp(-dt / 0.07));
          busy = true;
        } else {
          s.distance = goal;
        }
      }
      fix();
      return busy;
    },
    dragging: () => dragging,
    dispose() {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('dblclick', onDbl);
      el.removeEventListener('keydown', onKey);
      ptrs.clear();
    },
  };
}
