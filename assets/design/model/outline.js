// Outline math for printed shapes (canopy gable, feather flag): polygons in inches, origin top left,
// y down. Pure functions, no DOM, so node tests can load this file.

// Drop points that sit within `eps` of the previous one (the printer's curves have a few 0.05 in steps).
export function dedupe(points, eps = 0.15) {
  const out = [];
  for (const p of points) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) >= eps) out.push([p[0], p[1]]);
  }
  while (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < eps) out.pop();
  return out;
}

export function signedArea(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function bounds(points) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// The polygon moved `d` inches inward. Each point slides along the bisector of its two edges (a mitre
// join), capped so a sharp corner cannot shoot off. Good for a smooth outline whose edges are longer
// than `d` (the canopy gable). Use insetConvex for a short-edged convex shape like a flag tip.
export function insetPolygon(points, d, maxMitre = 4) {
  const pts = dedupe(points);
  const n = pts.length;
  if (n < 3 || !(d > 0)) return pts.map((p) => p.slice());
  const dir = signedArea(pts) > 0 ? 1 : -1;
  const edge = (i) => {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const len = Math.hypot(dx, dy) || 1;
    // inward normal: to the right of travel for a clockwise ring on screen (y down), to the left otherwise
    return { nx: (-dy / len) * dir, ny: (dx / len) * dir };
  };
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = edge((i + n - 1) % n);
    const b = edge(i);
    let bx = a.nx + b.nx;
    let by = a.ny + b.ny;
    const bl = Math.hypot(bx, by);
    if (bl < 1e-6) {
      out.push([pts[i][0] + b.nx * d, pts[i][1] + b.ny * d]);
      continue;
    }
    bx /= bl;
    by /= bl;
    const cos = Math.max(1 / maxMitre, bx * b.nx + by * b.ny);
    const k = d / cos;
    out.push([pts[i][0] + bx * k, pts[i][1] + by * k]);
  }
  return out;
}

// The polygon moved `d` inches inward, for a convex outline: clip it against every edge line moved in
// by d. No loops at short edges. A hair of non-convexity (0.05 in on the flag curves) only trims a hair.
export function insetConvex(points, d) {
  const pts = dedupe(points, 0.02);
  const n = pts.length;
  if (n < 3 || !(d > 0)) return pts.map((p) => p.slice());
  const dir = signedArea(pts) > 0 ? 1 : -1;
  let ring = pts.map((p) => p.slice());
  for (let i = 0; i < n && ring.length >= 3; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const nx = (-dy / len) * dir;
    const ny = (dx / len) * dir;
    // signed distance inside the moved line: >= 0 keeps the point
    const side = (pt) => (pt[0] - p[0]) * nx + (pt[1] - p[1]) * ny - d;
    const next = [];
    for (let j = 0; j < ring.length; j++) {
      const a = ring[j];
      const b = ring[(j + 1) % ring.length];
      const sa = side(a);
      const sb = side(b);
      if (sa >= 0) next.push(a);
      if ((sa >= 0) !== (sb >= 0)) {
        const t = sa / (sa - sb);
        next.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    ring = next;
  }
  return ring;
}

export function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// Distance from a point to the nearest edge of the polygon.
export function distanceToEdge(x, y, points) {
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy)));
  }
  return best;
}

// Distance from a point to an open polyline.
export function distanceToLine(x, y, line) {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i];
    const b = line[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy)));
  }
  return best;
}

// Left and right ends of the polygon on the horizontal line `y`, or null when the line misses it.
export function rowSpan(points, y) {
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
  return x0 > x1 ? null : [x0, x1];
}

// The widest rectangle that spans y0..y1 and sits inside the polygon: the tightest left and right edge
// over that band. Null when the band leaves the polygon.
export function bandRect(points, y0, y1, steps = 12) {
  let lo = -Infinity;
  let hi = Infinity;
  for (let i = 0; i <= steps; i++) {
    const span = rowSpan(points, y0 + ((y1 - y0) * i) / steps);
    if (!span) return null;
    lo = Math.max(lo, span[0]);
    hi = Math.min(hi, span[1]);
  }
  return hi > lo ? { x: lo, y: y0, w: hi - lo, h: y1 - y0 } : null;
}

// The tallest rectangle that spans x0..x1 and sits inside the polygon (bandRect turned on its side).
export function columnRect(points, x0, x1, steps = 12) {
  const r = bandRect(points.map(([x, y]) => [y, x]), x0, x1, steps);
  return r ? { x: x0, y: r.x, w: x1 - x0, h: r.w } : null;
}

// True when the (rotated) box sits inside the polygon, allowing `eps` inches of overshoot.
// `corners` are the box corners in order; points along each edge are sampled too so a bowed edge is caught.
export function boxInside(corners, points, eps = 0) {
  const samples = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    samples.push([a.x, a.y], [(a.x + b.x) / 2, (a.y + b.y) / 2], [a.x + (b.x - a.x) * 0.25, a.y + (b.y - a.y) * 0.25], [a.x + (b.x - a.x) * 0.75, a.y + (b.y - a.y) * 0.75]);
  }
  return samples.every(([x, y]) => pointInPolygon(x, y, points) || distanceToEdge(x, y, points) <= eps);
}
