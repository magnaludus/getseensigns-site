// Feather flag: a gridded flag cut to the printer's outline, sewn to a black sleeve on a bent pole, on a spike or cross base.
import {
  Group, Mesh, BufferGeometry, Float32BufferAttribute, CylinderGeometry, BoxGeometry, SphereGeometry,
  CatmullRomCurve3, TubeGeometry, Vector3, MeshStandardMaterial, FrontSide, BackSide, DoubleSide,
} from 'three';
import { outlineRowsAt, poleHeightIn, TAU } from '../geom.js';
import { distanceToLine } from '../../model/outline.js';
import { merge, xf, box3 } from '../build.js';
import { surface } from '../materials.js';

const COLS = 10;
// The sleeve is a separate sewn piece and its width is not published, so this is only for the picture.
const SLEEVE_R = 0.75;
const TOP_GAP = 1.2;

// Row heights: close together at the top, where the curved edge runs flat, then every 2 in.
export function flagRowYs(h) {
  const ys = [0, 0.25, 0.6, 1.1, 1.8, 2.7, 3.8, 5.2, 7];
  for (let y = 9; y < h - 1; y += 2) ys.push(y);
  ys.push(h);
  return ys;
}

function flagGrid(spec) {
  const { w, h } = spec.artboard;
  const ys = flagRowYs(h);
  const rows = ys.length - 1;
  const span = outlineRowsAt(spec.outline, ys);
  const edge = spec.poleEdge || [[0, h], [0, 0]];
  const n = (rows + 1) * (COLS + 1);
  const rest = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const away = new Float32Array(n);
  const idx = [];
  span.forEach(([y, x0, x1], r) => {
    for (let c = 0; c <= COLS; c++) {
      const x = x0 + ((x1 - x0) * c) / COLS;
      const i = r * (COLS + 1) + c;
      rest[i * 3] = x;
      rest[i * 3 + 1] = -y;
      uv[i * 2] = x / w;
      uv[i * 2 + 1] = 1 - y / h;
      away[i] = distanceToLine(x, y, edge);
    }
  });
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < COLS; c++) {
      const a = r * (COLS + 1) + c;
      const b = a + 1;
      const d = a + COLS + 1;
      idx.push(a, d, b, b, d, d + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(new Float32Array(rest), 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return { g, rest, away, rows, w, h };
}

// Centerline of the sleeve: the sewn edge moved out of the cloth, as points in the flag's frame (x right, y up).
function sleeveCurve(edge, h) {
  const pts = edge.map((p, i) => {
    const a = edge[Math.max(0, i - 1)];
    const b = edge[Math.min(edge.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const out = SLEEVE_R * 0.75;
    return new Vector3(p[0] + (dy / len) * out, -(p[1] - (dx / len) * out), 0);
  });
  return new CatmullRomCurve3(pts.length > 1 ? pts : [new Vector3(0, -h, 0), new Vector3(0, 0, 0)], false, 'centripetal');
}

function baseGeometry(kind) {
  if (kind === 'cross') {
    const parts = [
      { g: new BoxGeometry(26, 1.4, 2.4), m: xf(0, 0.7, 0) },
      { g: new BoxGeometry(2.4, 1.4, 26), m: xf(0, 0.7, 0) },
      { g: new CylinderGeometry(1.15, 1.35, 9, 12), m: xf(0, 5.4, 0) },
      { g: new CylinderGeometry(1.5, 1.5, 0.7, 12), m: xf(0, 1.6, 0) },
    ];
    [[12.4, 0], [-12.4, 0], [0, 12.4], [0, -12.4]].forEach(([x, z]) => parts.push({ g: new CylinderGeometry(1.1, 1.1, 0.5, 8), m: xf(x, 0.25, z) }));
    return { g: merge(parts), top: 9.6 };
  }
  const parts = [
    { g: new CylinderGeometry(2.4, 2.4, 0.4, 20), m: xf(0, 0.2, 0) },
    { g: new CylinderGeometry(0.8, 0.95, 12, 12), m: xf(0, 6.2, 0) },
    { g: new CylinderGeometry(1.05, 1.05, 1.6, 12), m: xf(0, 11.6, 0) },
  ];
  return { g: merge(parts), top: 12 };
}

export function buildFeather(ctx) {
  const { spec, choices, mats } = ctx;
  const { w, h } = spec.artboard;
  const poleH = poleHeightIn(choices);
  const group = new Group();
  const art = [[]];
  const base = [];

  const grid = flagGrid(spec);
  // the top tip of the flag is where the bent pole ends
  const flagTop = poleH - TOP_GAP;
  const curve = sleeveCurve(spec.poleEdge || [[0, h], [0, 0]], h);
  const poleX = curve.points[0].x;
  // Cloth, sleeve and bent top swing together around the pole's vertical axis.
  const swing = new Group();
  swing.position.set(poleX, 0, 0);
  group.add(swing);

  const front = new MeshStandardMaterial({ roughness: 0.78, metalness: 0, side: FrontSide });
  const back = new MeshStandardMaterial({ roughness: 0.82, metalness: 0, side: BackSide, color: 0xe2e2e2 });
  art[0].push(front, back);
  const flag = new Group();
  flag.position.set(-poleX, flagTop, 0);
  const fm = new Mesh(grid.g, front);
  const bm = new Mesh(grid.g, back);
  fm.castShadow = bm.castShadow = true;
  fm.userData.side = bm.userData.side = 0;
  flag.add(fm, bm);
  swing.add(flag);

  // the sleeve runs up the straight pole side and over the curve to the tip
  const sleeveMat = surface('fabric', ctx.base);
  base.push(sleeveMat);
  sleeveMat.side = DoubleSide;
  const sleeve = new Mesh(new TubeGeometry(curve, Math.max(60, curve.points.length * 3), SLEEVE_R, 10, false), sleeveMat);
  sleeve.position.set(-poleX, flagTop, 0);
  sleeve.castShadow = true;
  swing.add(sleeve);
  const tipPoint = curve.points[curve.points.length - 1];
  const tipCap = new Mesh(new SphereGeometry(SLEEVE_R, 12, 8), sleeveMat);
  tipCap.position.set(tipPoint.x - poleX, flagTop + tipPoint.y, 0);
  tipCap.castShadow = true;
  swing.add(tipCap);

  // the bare pole shows from the base up to the bottom of the sleeve, then carries on inside it
  const poleTop = flagTop + curve.points[0].y + 14;
  const bs = baseGeometry(choices.base);
  const baseMesh = new Mesh(bs.g, choices.base === 'cross' ? mats.get('steel') : mats.get('galvanized'));
  baseMesh.position.x = poleX;
  baseMesh.castShadow = baseMesh.receiveShadow = true;
  group.add(baseMesh);

  const sections = Math.max(3, Math.round(poleTop / 44));
  const parts = [];
  const len = (poleTop - bs.top + 6) / sections;
  for (let i = 0; i < sections; i++) {
    const t = i / (sections - 1);
    const r = 0.46 - 0.17 * t;
    const y0 = bs.top - 6 + i * len;
    parts.push({ g: new CylinderGeometry(r - 0.025, r, len + 0.4, 10, 1), m: xf(poleX, y0 + len / 2, 0) });
    if (i) parts.push({ g: new CylinderGeometry(r + 0.1, r + 0.1, 1.6, 10), m: xf(poleX, y0, 0) });
  }
  const pole = new Mesh(merge(parts), mats.get('pole'));
  pole.castShadow = true;
  group.add(pole);

  group.position.x = -w / 2;

  let t0 = 0;
  const pos = grid.g.attributes.position;
  const { rest, rows, away } = grid;
  const wind = (time, amp) => {
    swing.rotation.y = Math.sin(time * 0.55 + 0.7) * 0.05 * amp;
    for (let r = 0; r <= rows; r++) {
      const y = -rest[(r * (COLS + 1)) * 3 + 1];
      const ph = (y / 58) * TAU - time * 1.9;
      const wave = Math.sin(ph) + 0.4 * Math.sin(ph * 2.3 + 1.7);
      for (let c = 0; c <= COLS; c++) {
        const i = r * (COLS + 1) + c;
        // the cloth moves more the farther it is from the sewn edge
        const g = Math.pow(Math.min(1, away[i] / w), 1.35);
        pos.setXYZ(i, rest[i * 3], rest[i * 3 + 1], amp * 2.1 * g * wave);
      }
    }
    pos.needsUpdate = true;
    grid.g.computeVertexNormals();
  };
  wind(0, ctx.reduced ? 0.35 : 0.6);

  return {
    group,
    box: box3(-w / 2 - 2, 0, -4, w / 2 + 2, poleH + 1, 4),
    pickables: [fm, bm],
    art,
    base,
    footprint: { w: 34, d: 34, kind: 'oval', opacity: 0.3 },
    update(time) {
      if (ctx.reduced) return false;
      if (!t0) t0 = time;
      wind(time - t0, 1);
      return true;
    },
    animated: !ctx.reduced,
  };
}
