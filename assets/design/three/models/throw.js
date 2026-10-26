// Table throw: a draped cloth over a folding table. The front panel carries the art; the rest is the base color.
import {
  Group, Mesh, BufferGeometry, Float32BufferAttribute, BoxGeometry, CylinderGeometry, MeshStandardMaterial, DoubleSide,
  ShapeGeometry, Shape, Vector2,
} from 'three';
import { throwDims, TAU, clamp } from '../geom.js';
import { merge, xf, bar, box3 } from '../build.js';
import { surface } from '../materials.js';

const RC = 2.4;
const RIM = 1.3;
const RIM_ROWS = 4;

// Loop around the table top: points with outward normals and a section tag.
function loop(L, D, rc, step) {
  const pts = [];
  const hx = L / 2;
  const hz = D / 2;
  const arc = (cx, cz, a0, tag) => {
    const n = 6;
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((Math.PI / 2) * i) / n;
      pts.push({ x: cx + Math.sin(a) * rc, z: cz + Math.cos(a) * rc, nx: Math.sin(a), nz: Math.cos(a), tag });
    }
  };
  const line = (x0, z0, x1, z1, nx, nz, tag) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(2, Math.round(len / step));
    for (let i = 1; i < n; i++) pts.push({ x: x0 + ((x1 - x0) * i) / n, z: z0 + ((z1 - z0) * i) / n, nx, nz, tag });
  };
  // front straight (z = +hz), front-right arc, right side, back-right arc, back, back-left arc, left side, front-left arc
  line(-hx + rc, hz, hx - rc, hz, 0, 1, 'front');
  arc(hx - rc, hz - rc, 0, 'front');
  line(hx, hz - rc, hx, -hz + rc, 1, 0, 'side');
  arc(hx - rc, -hz + rc, Math.PI / 2, 'back');
  line(hx - rc, -hz, -hx + rc, -hz, 0, -1, 'back');
  arc(-hx + rc, -hz + rc, Math.PI, 'back');
  line(-hx, -hz + rc, -hx, hz - rc, -1, 0, 'side');
  arc(-hx + rc, hz - rc, (Math.PI * 3) / 2, 'front');
  return pts;
}

function clothGeometry(d, closed) {
  const { L, D, H, hem } = d;
  const pts = loop(L, D, RC, 2);
  const n = pts.length;
  const rows = [];
  for (let k = 0; k <= RIM_ROWS; k++) {
    const a = (k / RIM_ROWS) * (Math.PI / 2);
    rows.push({ y: H - RIM + RIM * Math.cos(a), out: -RIM + RIM * Math.sin(a) });
  }
  const vert = 14;
  for (let j = 1; j <= vert; j++) rows.push({ y: H - RIM - ((H - RIM - hem) * j) / vert, out: 0 });
  const arcLen = [0];
  for (let i = 1; i < n; i++) arcLen.push(arcLen[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const span = H - RIM - hem;
  const pos = [];
  const uv = [];
  rows.forEach((row) => {
    const depth = clamp((H - RIM - row.y) / span, 0, 1);
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const fold = 0.62 * Math.pow(depth, 1.2) * (0.65 * Math.sin((TAU * arcLen[i]) / 13.5 + 0.8) + 0.35 * Math.sin((TAU * arcLen[i]) / 5.3 + 2.2));
      const o = row.out + fold + 0.5 * depth * depth;
      pos.push(p.x + p.nx * o, row.y, p.z + p.nz * o);
      uv.push((p.x + L / 2) / L, (row.y - hem) / (d.frontTop - hem));
    }
  });

  const front = [];
  const rest = [];
  for (let j = 0; j < rows.length - 1; j++) {
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      const t1 = pts[i].tag;
      const t2 = pts[i2].tag;
      if (!closed && j >= RIM_ROWS && t1 === 'back' && t2 === 'back') continue;
      const a = j * n + i;
      const b = j * n + i2;
      const c = (j + 1) * n + i;
      const e = (j + 1) * n + i2;
      (t1 === 'front' && t2 === 'front' ? front : rest).push(a, c, b, b, c, e);
    }
  }
  // Top plate: triangulate the first row, then orient each triangle upward.
  const sg = new ShapeGeometry(new Shape(pts.map((p, i) => new Vector2(pos[i * 3], -pos[i * 3 + 2]))));
  for (let i = 0; i < sg.index.count; i += 3) {
    const t = [sg.index.getX(i), sg.index.getX(i + 1), sg.index.getX(i + 2)];
    const ax = pos[t[1] * 3] - pos[t[0] * 3];
    const az = pos[t[1] * 3 + 2] - pos[t[0] * 3 + 2];
    const bx = pos[t[2] * 3] - pos[t[0] * 3];
    const bz = pos[t[2] * 3 + 2] - pos[t[0] * 3 + 2];
    if (az * bx - ax * bz > 0) rest.push(t[0], t[1], t[2]);
    else rest.push(t[0], t[2], t[1]);
  }
  sg.dispose();

  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex([...front, ...rest]);
  g.addGroup(0, front.length, 0);
  g.addGroup(front.length, rest.length, 1);
  g.computeVertexNormals();
  return g;
}

function tableGeometry(d) {
  const { L, D, H } = d;
  const top = H - 2.6;
  const parts = [{ g: new BoxGeometry(L - 3, 1.3, D - 3), m: xf(0, top, 0) }];
  const lx = L / 2 - 9;
  const lz = D / 2 - 3.5;
  const dark = [];
  [lx, -lx].forEach((x) => {
    [lz, -lz].forEach((z) => {
      dark.push({ g: new CylinderGeometry(0.75, 0.75, top - 0.6, 8), m: xf(x, (top - 0.6) / 2, z) });
      dark.push({ g: new CylinderGeometry(0.9, 0.9, 0.5, 8), m: xf(x, 0.25, z) });
    });
    dark.push({ g: bar([x, 7, lz], [x, 7, -lz], 0.5, 6) });
    dark.push({ g: bar([x, top - 0.7, lz], [x, top - 0.7, -lz], 0.7, 6) });
  });
  dark.push({ g: bar([lx, top - 0.8, lz], [-lx, top - 0.8, lz], 0.6, 6) });
  dark.push({ g: bar([lx, top - 0.8, -lz], [-lx, top - 0.8, -lz], 0.6, 6) });
  return { top: merge(parts), legs: merge(dark) };
}

export function buildThrow(ctx) {
  const { spec, choices, mats } = ctx;
  const d = throwDims(spec);
  const closed = choices && String(choices.style) === '4';
  const group = new Group();
  const art = [[]];
  const base = [];

  const artMat = new MeshStandardMaterial({ roughness: 0.88, metalness: 0, side: DoubleSide });
  art[0].push(artMat);
  const baseMat = surface('fabric', ctx.base);
  baseMat.side = DoubleSide;
  base.push(baseMat);
  const cloth = new Mesh(clothGeometry(d, closed), [artMat, baseMat]);
  cloth.castShadow = true;
  cloth.receiveShadow = true;
  cloth.userData.side = 0;
  group.add(cloth);

  const tb = tableGeometry(d);
  const tt = new Mesh(tb.top, mats.get('tabletop'));
  const legs = new Mesh(tb.legs, mats.get('steel'));
  [tt, legs].forEach((m) => {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  });

  return {
    group,
    box: box3(-d.L / 2 - 1.5, 0, -d.D / 2 - 1.5, d.L / 2 + 1.5, d.H + 0.5, d.D / 2 + 1.5),
    pickables: [cloth],
    pickFilter: (hit) => hit.face && hit.face.materialIndex === 0,
    art,
    base,
    footprint: { w: d.L + 12, d: d.D + 12, kind: 'rect', opacity: 0.3 },
  };
}
