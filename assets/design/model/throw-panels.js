// Table throw panels: where each piece of the printer's flat sits, how it is turned for print, and the
// areas the editor keeps art inside. All lengths are inches, the origin is the top left of the printer's page
// (the flat), and the origin of a panel's own coordinates is its top left as it reads when the cover hangs.
// Pure functions, no DOM and no Three.js, so node tests load this file.
//
// The customer edits every panel upright, as it reads when the cover is on the table. The flat turns the
// pieces that hang from the sides of the top panel so their tops face the table top:
//
//   front, top   upright               the top reads from the front of the table
//   back         turned 180            4-sided only; it hangs from the far edge of the top
//   left end     turned 90 clockwise   letter tops face the top panel, so it reads top to bottom
//   right end    turned 90 counter     letter tops face the top panel, so it reads bottom to top
//
// The printer's flat (see print-specs.json, panels_in_template):
//
//        3-sided                       4-sided
//        [  back strip  ]         [        back        ]
//   [left][    top     ][right]   [left][    top     ][right]
//        [   front     ]               [   front     ]
//
// The 4-sided back is as wide as the whole page; the part above the two ends is corner drape, which wraps the
// table corners. Art goes only in the editable panels, so none of it can land on the drape. A 3-sided throw
// has a short back strip (about 6 in) and an open back: the strip stays plain, and the end art keeps extra
// clearance from the open hem.

export const PANEL_IDS = ['front', 'top', 'left', 'right', 'back'];
export const PANEL_NAMES = { front: 'Front', top: 'Top', left: 'Left end', right: 'Right end', back: 'Back' };
export const PANEL_LABELS = { front: 'FRONT', top: 'TOP', left: 'LEFT END', right: 'RIGHT END', back: 'BACK' };
// Degrees clockwise: the installed (upright) panel turned onto the flat.
export const PANEL_TURN = { front: 0, top: 0, left: 90, right: -90, back: 180 };
export const FLAT_NOTE = 'Side and back art is turned on the flat so it reads right side up when the cover hangs.';

const round = (v) => Math.round(v * 1000) / 1000;
const rect = (x, y, w, h) => ({ x: round(x), y: round(y), w: round(w), h: round(h) });

// ---------- affine matrices: [a, b, c, d, e, f] means x' = a x + c y + e, y' = b x + d y + f ----------
// The same order as canvas transform() and the SVG matrix() function.

function cosSin(turn) {
  const t = ((turn % 360) + 360) % 360;
  if (t === 0) return [1, 0];
  if (t === 90) return [0, 1];
  if (t === 180) return [-1, 0];
  if (t === 270) return [0, -1];
  const a = (t * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)];
}

// The panel as it reads installed is `size` wide and tall. Turn it `turn` degrees clockwise about its center,
// then move it so it fills `box` on the flat. A quarter turn swaps the width and height, so `box` is `size`
// turned: for a left or right end the box is the panel's height wide and its width tall.
export function turnMatrix(box, size, turn) {
  const [c, s] = cosSin(turn);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return [c, s, -s, c, cx - (c * size.w) / 2 + (s * size.h) / 2, cy - (s * size.w) / 2 - (c * size.h) / 2];
}

const zero = (v) => (v === 0 ? 0 : v); // no negative zero in results

export function applyMatrix(m, x, y) {
  return { x: zero(m[0] * x + m[2] * y + m[4]), y: zero(m[1] * x + m[3] * y + m[5]) };
}

// The turn only: where a direction (dx, dy) points after it.
export function applyLinear(m, dx, dy) {
  return { x: zero(m[0] * dx + m[2] * dy), y: zero(m[1] * dx + m[3] * dy) };
}

export function invertMatrix(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

export const matrixAttr = (m) => 'matrix(' + m.map((v) => round(v)).join(' ') + ')';

// The box a rectangle covers after the matrix (exact for quarter turns).
export function mapRect(m, r) {
  const pts = [applyMatrix(m, r.x, r.y), applyMatrix(m, r.x + r.w, r.y), applyMatrix(m, r.x + r.w, r.y + r.h), applyMatrix(m, r.x, r.y + r.h)];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return rect(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

export function mapPoly(m, points) {
  return points.map((p) => {
    const q = applyMatrix(m, p[0], p[1]);
    return [round(q.x), round(q.y)];
  });
}

// ---------- the layout ----------

// What a panel looks like on the flat, in words, for the proof summary and the screen reader.
export function readsOnFlat(id) {
  if (id === 'left') return 'turned 90 degrees clockwise on the flat, so it reads top to bottom';
  if (id === 'right') return 'turned 90 degrees counterclockwise on the flat, so it reads bottom to top';
  if (id === 'back') return 'turned 180 degrees on the flat';
  return 'upright on the flat';
}

function safeFor(id, size, style, margins, frontSafe) {
  if (id === 'front') return rect(frontSafe.x, frontSafe.y, frontSafe.w, frontSafe.h);
  const e = margins.edge_in;
  let l = e;
  let r = e;
  let t = e;
  let b = e;
  if (id === 'back') {
    t = margins.hang_in;
    b = margins.hem_in;
  }
  if (id === 'left' || id === 'right') {
    t = margins.hang_in;
    b = margins.hem_in;
    // The side of an end that faces the back of the table is the open hem on a 3-sided throw. As the end hangs,
    // the left end's back edge is on its left and the right end's back edge is on its right.
    if (style === '3') {
      if (id === 'left') l = margins.open_hem_in;
      else r = margins.open_hem_in;
    }
  }
  return rect(l, t, size.w - l - r, size.h - t - b);
}

function outlineOf(style, b) {
  const { front, top, left, right, back } = b;
  const x0 = Math.min(left.x, back.x);
  const x1 = Math.max(right.x + right.w, back.x + back.w);
  const rowTop = top.y;
  const rowBottom = top.y + top.h;
  const fx0 = front.x;
  const fx1 = front.x + front.w;
  const fy1 = front.y + front.h;
  if (style === '4') {
    return [[x0, back.y], [x1, back.y], [x1, rowBottom], [fx1, rowBottom], [fx1, fy1], [fx0, fy1], [fx0, rowBottom], [x0, rowBottom]];
  }
  const bx0 = back.x;
  const bx1 = back.x + back.w;
  const lx0 = left.x;
  const rx1 = right.x + right.w;
  return [[bx0, back.y], [bx1, back.y], [bx1, rowTop], [rx1, rowTop], [rx1, rowBottom], [fx1, rowBottom], [fx1, fy1], [fx0, fy1], [fx0, rowBottom], [lx0, rowBottom], [lx0, rowTop], [bx0, rowTop]];
}

// boxes: the printer's panel boxes on the flat. frontSafe: the printer's safe box on the front panel.
// margins: panel_safe from the print specs. Returns the whole layout, plain data.
export function buildThrowLayout({ style, template, boxes, frontSafe, margins }) {
  const closed = String(style) === '4';
  const st = closed ? '4' : '3';
  const b = {};
  for (const id of PANEL_IDS) b[id] = rect(boxes[id].x, boxes[id].y, boxes[id].w, boxes[id].h);
  // the part of the back that is a panel: the 4-sided back is as wide as the page, but only the part in line with
  // the top and the front is a panel. The rest is corner drape.
  const backBox = closed ? rect(b.top.x, b.back.y, b.top.w, b.back.h) : b.back;
  const boxFor = { front: b.front, top: b.top, left: b.left, right: b.right, back: backBox };
  const ids = closed ? PANEL_IDS : PANEL_IDS.filter((id) => id !== 'back');
  const panels = ids.map((id, index) => {
    const box = boxFor[id];
    const turn = PANEL_TURN[id];
    const quarter = Math.abs(turn) % 180 === 90;
    const size = quarter ? { w: box.h, h: box.w } : { w: box.w, h: box.h };
    const matrix = turnMatrix(box, size, turn).map(round);
    const safe = safeFor(id, size, st, margins, frontSafe);
    return {
      id, index, name: PANEL_NAMES[id], label: PANEL_LABELS[id], box, turn, size, matrix, safe,
      safeFlat: mapRect(matrix, safe),
      openEdge: !closed && (id === 'left' || id === 'right') ? id : null,
    };
  });
  const strips = closed ? [] : [{ id: 'back', name: 'Back strip', label: 'BACK STRIP', box: b.back, note: 'The back of a 3-sided throw is open, so this short strip stays plain.' }];
  const drape = closed
    ? [
        { id: 'drape-left', label: 'CORNER DRAPE', box: rect(b.back.x, b.back.y, b.top.x - b.back.x, b.back.h) },
        { id: 'drape-right', label: 'CORNER DRAPE', box: rect(b.top.x + b.top.w, b.back.y, b.back.x + b.back.w - (b.top.x + b.top.w), b.back.h) },
      ].filter((d) => d.box.w > 0.05)
    : [];
  const outline = outlineOf(st, b).map((p) => [round(p[0]), round(p[1])]);
  const xs = outline.map((p) => p[0]);
  const ys = outline.map((p) => p[1]);
  const bounds = rect(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return {
    style: st, closed, template: { w: template.w, h: template.h }, finished: template.finished ? { w: template.finished.w, h: template.finished.h } : null,
    panels, strips, drape, outline, bounds,
  };
}

// ---------- looking things up ----------

export function panelById(layout, id) {
  return layout.panels.find((p) => p.id === id) || null;
}

// The editable panel under a point on the flat, or null over the strip, the drape or outside the cut shape.
export function panelAtFlat(layout, x, y) {
  return layout.panels.find((p) => x >= p.box.x && x <= p.box.x + p.box.w && y >= p.box.y && y <= p.box.y + p.box.h) || null;
}

// Panel coordinates to flat coordinates and back.
export function panelToFlat(panel, x, y) {
  return applyMatrix(panel.matrix, x, y);
}

export function flatToPanel(panel, x, y) {
  return applyMatrix(invertMatrix(panel.matrix), x, y);
}

// Where "up" (the tops of the letters) and "forward" (the way the words run) point on the flat.
export function flatDirections(panel) {
  return { up: applyLinear(panel.matrix, 0, -1), reads: applyLinear(panel.matrix, 1, 0) };
}

// Shoelace area, for checking that the cut shape is the sum of its boxes.
export function polygonArea(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

export const rectsOverlap = (a, b, eps = 1e-6) => a.x < b.x + b.w - eps && b.x < a.x + a.w - eps && a.y < b.y + b.h - eps && b.y < a.y + a.h - eps;
