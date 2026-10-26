// Pure numbers for the 3D stage: camera math, spec-derived dimensions, outline sampling.
// No Three.js import, so node tests can load this file. Lengths are inches, angles degrees.

export const rad = (d) => (d * Math.PI) / 180;
export const TAU = Math.PI * 2;
export const deg = (r) => (r * 180) / Math.PI;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const wrap360 = (a) => ((a % 360) + 360) % 360;
export const wrap180 = (a) => wrap360(a + 180) - 180;
export const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- textures

export function capSize(w, h, max) {
  const k = Math.min(1, max / Math.max(w, h));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

// Scale and offset that make a texture cover a viewport (CSS "cover") through texture.repeat/offset.
export function coverTransform(imgW, imgH, viewW, viewH) {
  const ia = imgW / imgH;
  const va = viewW / viewH;
  if (va > ia) {
    const ry = ia / va;
    return { repeat: [1, ry], offset: [0, (1 - ry) / 2] };
  }
  const rx = va / ia;
  return { repeat: [rx, 1], offset: [(1 - rx) / 2, 0] };
}

// ---- camera

export const EL_MIN = 3;
export const EL_MAX = 80;
export const FOV = 34;

const fin = (v, d) => (Number.isFinite(v) ? v : d);

export function clampCamera(s, lim = {}) {
  return {
    azimuth: wrap360(fin(s.azimuth, 0)),
    elevation: clamp(fin(s.elevation, 12), lim.minEl ?? EL_MIN, lim.maxEl ?? EL_MAX),
    distance: clamp(fin(s.distance, 300), lim.minDist ?? 1, lim.maxDist ?? Infinity),
  };
}

export function distanceLimits(fit) {
  return { minDist: fit * 0.3, maxDist: fit * 2.8 };
}

// Distance at which a box (half sizes hx, hy, hz) fits the viewport. The footprint is treated as a
// circle so the result does not change while orbiting. A tall flag is limited by height only, which
// keeps it fully visible on a narrow phone screen.
export function fitDistance(half, fovDeg, aspect, elDeg = 12, margin = 1.1) {
  const r = Math.hypot(half.hx, half.hz);
  const e = rad(elDeg);
  const halfH = half.hy * Math.cos(e) + r * Math.sin(e);
  const t = Math.tan(rad(fovDeg) / 2);
  const dv = halfH / t;
  const dh = r / (t * Math.max(0.2, aspect));
  return Math.max(dv, dh) * margin + r * 0.6;
}

export function cameraPosition(target, s) {
  const a = rad(s.azimuth);
  const e = rad(s.elevation);
  const c = Math.cos(e);
  return [
    target[0] + s.distance * c * Math.sin(a),
    target[1] + s.distance * Math.sin(e),
    target[2] + s.distance * c * Math.cos(a),
  ];
}

const VIEW = {
  canopy: { el: 13, side: 90 },
  feather: { el: 6, side: 55 },
  throw: { el: 16, side: 60 },
  banner: { el: 6, side: 45 },
  yard: { el: 10, side: 50 },
};

// zoom multiplies the fit distance; presets never depend on the viewport.
export function presetFor(productId, name) {
  const v = VIEW[productId] || VIEW.canopy;
  switch (name) {
    case 'side': return { azimuth: v.side, elevation: v.el, zoom: 1 };
    case 'back': return { azimuth: 180, elevation: v.el, zoom: 1 };
    case 'wide': return { azimuth: 32, elevation: v.el + 9, zoom: 1.45 };
    default: return { azimuth: 0, elevation: v.el, zoom: 1 };
  }
}

// Azimuth that makes printed side `index` face the camera, or null when the product has one face.
export function sideAzimuth(productId, index) {
  if (productId === 'canopy') return wrap360((index | 0) * 90);
  if (productId === 'yard') return (index | 0) === 1 ? 180 : 0;
  return null;
}

// ---- products

export function canopyFace(spec, eave = 84) {
  const w = spec.artboard.w;
  const h = spec.artboard.h;
  const vy = spec.valanceLine;
  const poly = spec.roof.polygon;
  const top = Math.min(...poly.map((p) => p[1]));
  const slant = vy - top;
  const run = w / 2;
  const k = Math.min(0.95, run / slant);
  const kv = Math.sqrt(1 - k * k);
  return { w, h, vy, top, slant, run, k, kv, rise: slant * kv, eave, valance: h - vy, poly };
}

// Art space (x right, y down from the top of the artboard) to the side-0 frame (+Z outward).
export function canopyPoint(f, x, y) {
  if (y <= f.vy) {
    const t = f.vy - y;
    return [x - f.w / 2, f.eave + t * f.kv, f.w / 2 - t * f.k];
  }
  return [x - f.w / 2, f.eave - (y - f.vy), f.w / 2];
}

export function outlineToUV(points, art) {
  return points.map(([x, y]) => [x / art.w, 1 - y / art.h]);
}

// For each of rows+1 horizontal lines (top to bottom) the span of the outline polygon: [y, x0, x1].
export function outlineRows(points, rows, height) {
  const out = [];
  for (let r = 0; r <= rows; r++) {
    const y = (r / rows) * height;
    let x0 = Infinity;
    let x1 = -Infinity;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const q = points[(i + 1) % points.length];
      if ((p[1] <= y && q[1] >= y) || (q[1] <= y && p[1] >= y)) {
        if (p[1] === q[1]) {
          x0 = Math.min(x0, p[0], q[0]);
          x1 = Math.max(x1, p[0], q[0]);
        } else {
          const x = p[0] + ((y - p[1]) / (q[1] - p[1])) * (q[0] - p[0]);
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
        }
      }
    }
    if (x0 > x1) {
      const prev = out[r - 1];
      x0 = x1 = prev ? prev[1] : 0;
    }
    out.push([y, x0, x1]);
  }
  return out;
}

export function poleHeightIn(choices) {
  const ft = parseFloat(choices && choices.height);
  return (Number.isFinite(ft) ? ft : 10.5) * 12;
}

export function throwDims(spec) {
  const t = spec.table || {};
  const H = t.height_in || 30;
  const hem = t.hem_above_floor_in != null ? t.hem_above_floor_in : 2;
  return { L: spec.artboard.w, D: 30, H, hem, panelH: spec.artboard.h, frontTop: Math.min(H, hem + spec.artboard.h) };
}

// Grommet centers in inches from the banner's top left corner: corners plus roughly every `every` inches.
export function grommetPoints(w, h, every, inset = 1) {
  const e = every > 0 ? every : 24;
  const nx = Math.max(1, Math.round((w - 2 * inset) / e));
  const ny = Math.max(1, Math.round((h - 2 * inset) / e));
  const pts = [];
  for (let i = 0; i <= nx; i++) {
    const x = inset + (i * (w - 2 * inset)) / nx;
    pts.push([x, inset], [x, h - inset]);
  }
  for (let j = 1; j < ny; j++) {
    const y = inset + (j * (h - 2 * inset)) / ny;
    pts.push([inset, y], [w - inset, y]);
  }
  return pts;
}

export function packExtras(pack) {
  return Number(pack) >= 25 ? 3 : 2;
}

// Poses of the extra signs of a pack, staggered behind the first (x, z in inches, ry in degrees).
export const EXTRA_POSES = [
  { x: 33, z: -40, ry: -11 },
  { x: -37, z: -78, ry: 8 },
  { x: 12, z: -122, ry: -4 },
];

// Signed shortest angular difference to - from, in (-180, 180].
export function shortestDelta(from, to) {
  const d = wrap180(to - from);
  return d === -180 ? 180 : d;
}

export const cosDeg = (d) => Math.cos(rad(d));

// Vertical shift (inches, along world Y) that centers the box's projection in the viewport for a view
// from azimuth 0 at the given elevation and distance.
export function frameShift(half, fovDeg, elDeg, dist) {
  const e = rad(elDeg);
  const t = Math.tan(rad(fovDeg) / 2);
  const f = [0, -Math.sin(e), -Math.cos(e)];
  const u = [0, Math.cos(e), -Math.sin(e)];
  const c = [0, dist * Math.sin(e), dist * Math.cos(e)];
  let lo = Infinity;
  let hi = -Infinity;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const r = [sx * half.hx - c[0], sy * half.hy - c[1], sz * half.hz - c[2]];
        const depth = r[0] * f[0] + r[1] * f[1] + r[2] * f[2];
        const y = (r[0] * u[0] + r[1] * u[1] + r[2] * u[2]) / depth;
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
    }
  }
  const mid = (lo + hi) / 2;
  return (mid * dist * t) / Math.cos(e);
}

// Projection settings that make the product fit the part of a w x h canvas that is not covered by UI
// (insets in px). fov and aspect describe that free area; offsetX and offsetY are the principal point
// shift in px, in the sense of PerspectiveCamera.setViewOffset.
export function insetView(w, h, insets, fovDeg) {
  const i = { top: 0, right: 0, bottom: 0, left: 0, ...insets };
  const fw = Math.max(40, w - i.left - i.right);
  const fh = Math.max(40, h - i.top - i.bottom);
  const t = Math.tan(rad(fovDeg) / 2);
  return { fov: 2 * deg(Math.atan((t * fh) / h)), aspect: fw / fh, offsetX: (i.right - i.left) / 2, offsetY: (i.bottom - i.top) / 2 };
}
