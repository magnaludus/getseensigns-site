// Shape outlines as SVG path data in the element's own box (0,0 to w,h). Both render backends use
// these strings (canvas draws them with Path2D), so a shape looks the same everywhere.

const f = (n) => Math.round(n * 1000) / 1000;

function polygon(points) {
  return 'M' + points.map(([x, y]) => f(x) + ',' + f(y)).join(' L') + ' Z';
}

function star(w, h, n, inner) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? 1 : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    pts.push([w / 2 + (Math.cos(a) * r * w) / 2, h / 2 + (Math.sin(a) * r * h) / 2]);
  }
  return polygon(pts);
}

export function shapePath(kind, w, h, rx) {
  if (kind === 'ellipse') {
    const a = w / 2;
    const b = h / 2;
    return `M0,${f(b)} A${f(a)},${f(b)} 0 1 1 ${f(w)},${f(b)} A${f(a)},${f(b)} 0 1 1 0,${f(b)} Z`;
  }
  if (kind === 'triangle') return polygon([[w / 2, 0], [w, h], [0, h]]);
  if (kind === 'star') return star(w, h, 5, 0.42);
  if (kind === 'badge') return star(w, h, 18, 0.9);
  if (kind === 'chevron') return polygon([[0, 0], [w * 0.7, 0], [w, h / 2], [w * 0.7, h], [0, h], [w * 0.3, h / 2]]);
  const r = Math.max(0, Math.min(rx || 0, w / 2, h / 2));
  if (!r) return `M0,0 H${f(w)} V${f(h)} H0 Z`;
  return `M${f(r)},0 H${f(w - r)} A${f(r)},${f(r)} 0 0 1 ${f(w)},${f(r)} V${f(h - r)} A${f(r)},${f(r)} 0 0 1 ${f(w - r)},${f(h)} H${f(r)} A${f(r)},${f(r)} 0 0 1 0,${f(h - r)} V${f(r)} A${f(r)},${f(r)} 0 0 1 ${f(r)},0 Z`;
}
