// Table throw: a draped cloth over a folding table. Every printed panel carries its own art, drawn upright as
// it reads from outside: the front, the top, the left and right ends and, on a 4-sided throw, the back. The
// rounded corners are drape that wraps the table corners, so they stay the base color and no art goes there. A
// 3-sided throw is open at the back, so its back strip (the rim over the table edge) is the base color too.
//
// Art side indexes follow the panels: 0 front, 1 top, 2 left end, 3 right end, 4 back (4-sided only).
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
const SIDE_ART = { front: 0, left: 2, right: 3, back: 4 };

// Loop around the table top: points with outward normals. kind: 'L' on a straight run (side says which one),
// 'E' where a corner arc meets a run, 'A' inside a corner arc. back: part of the back half (the open back skips these).
function loop(L, D, rc, step) {
  const pts = [];
  const hx = L / 2;
  const hz = D / 2;
  const arc = (cx, cz, a0, back) => {
    const n = 6;
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((Math.PI / 2) * i) / n;
      pts.push({ x: cx + Math.sin(a) * rc, z: cz + Math.cos(a) * rc, nx: Math.sin(a), nz: Math.cos(a), kind: i === 0 || i === n ? 'E' : 'A', side: null, back });
    }
  };
  const line = (x0, z0, x1, z1, nx, nz, side) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(2, Math.round(len / step));
    for (let i = 1; i < n; i++) pts.push({ x: x0 + ((x1 - x0) * i) / n, z: z0 + ((z1 - z0) * i) / n, nx, nz, kind: 'L', side, back: side === 'back' });
  };
  // front run (z = +hz), front-right arc, right end, back-right arc, back run, back-left arc, left end, front-left arc
  line(-hx + rc, hz, hx - rc, hz, 0, 1, 'front');
  arc(hx - rc, hz - rc, 0, false);
  line(hx, hz - rc, hx, -hz + rc, 1, 0, 'right');
  arc(hx - rc, -hz + rc, Math.PI / 2, true);
  line(hx - rc, -hz, -hx + rc, -hz, 0, -1, 'back');
  arc(-hx + rc, -hz + rc, Math.PI, true);
  line(-hx, -hz + rc, -hx, hz - rc, -1, 0, 'left');
  arc(-hx + rc, hz - rc, (Math.PI * 3) / 2, false);
  return pts;
}

// A non-indexed cloth with one material group per printed panel plus one for the base color, so each panel has
// its own texture coordinates. The normals are worked out on the shared grid first, so the cloth still looks
// smooth across the panel seams.
function clothGeometry(d, closed, artCount) {
  const { L, D, H, hem } = d;
  const hx = L / 2;
  const hz = D / 2;
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
  rows.forEach((row) => {
    const depth = clamp((H - RIM - row.y) / span, 0, 1);
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const fold = 0.62 * Math.pow(depth, 1.2) * (0.65 * Math.sin((TAU * arcLen[i]) / 13.5 + 0.8) + 0.35 * Math.sin((TAU * arcLen[i]) / 5.3 + 2.2));
      const o = row.out + fold + 0.5 * depth * depth;
      pos.push(p.x + p.nx * o, row.y, p.z + p.nz * o);
    }
  });

  // triangles by material: 0 front, 1 top, 2 left, 3 right, 4 back (closed only), last = base
  const base = artCount;
  const buckets = Array.from({ length: artCount + 1 }, () => []);
  for (let j = 0; j < rows.length - 1; j++) {
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      const p1 = pts[i];
      const p2 = pts[i2];
      if (!closed && j >= RIM_ROWS && p1.back && p2.back) continue;
      // a span on a straight run shows that panel's art; a span in a corner arc is drape, the base color
      let mat = base;
      if (p1.kind !== 'A' && p2.kind !== 'A') {
        const side = p1.kind === 'L' ? p1.side : p2.side;
        if (side && SIDE_ART[side] != null && SIDE_ART[side] < artCount) mat = SIDE_ART[side];
      }
      const a = j * n + i;
      const b = j * n + i2;
      const c = (j + 1) * n + i;
      const e = (j + 1) * n + i2;
      buckets[mat].push(a, c, b, b, c, e);
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
    if (az * bx - ax * bz > 0) buckets[1].push(t[0], t[1], t[2]);
    else buckets[1].push(t[0], t[2], t[1]);
  }
  sg.dispose();

  // smooth normals from the shared grid
  const all = buckets.flat();
  const shared = new BufferGeometry();
  shared.setAttribute('position', new Float32BufferAttribute(pos, 3));
  shared.setIndex(all);
  shared.computeVertexNormals();
  const nrm = shared.getAttribute('normal').array;
  shared.dispose();

  // the top art spans the plate (row 0), seen from the front of the table with its top toward the back
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, pos[i * 3]);
    maxX = Math.max(maxX, pos[i * 3]);
    minZ = Math.min(minZ, pos[i * 3 + 2]);
    maxZ = Math.max(maxZ, pos[i * 3 + 2]);
  }
  // Each panel's texture is the panel as it reads from outside, so u runs the way the eye reads it from there:
  // the front left to right (+x), the right end front to back (-z), the back right to left (-x) and the left end
  // back to front (+z). v runs up from the hem.
  const uvOf = (mat, v) => {
    const i = v % n;
    const row = rows[(v - i) / n];
    const p = pts[i];
    const vv = (row.y - hem) / (H - hem);
    if (mat === 1) return [(pos[v * 3] - minX) / (maxX - minX), (maxZ - pos[v * 3 + 2]) / (maxZ - minZ)];
    if (mat === 0) return [(p.x + hx) / L, vv];
    if (mat === 2) return [(p.z + hz) / D, vv];
    if (mat === 3) return [(hz - p.z) / D, vv];
    if (mat === 4) return [(hx - p.x) / L, vv];
    return [(p.x + hx) / L, vv];
  };
  const P = [];
  const N = [];
  const UV = [];
  const g = new BufferGeometry();
  let at = 0;
  buckets.forEach((list, mat) => {
    for (const v of list) {
      P.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      N.push(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
      UV.push(...uvOf(mat, v));
    }
    if (list.length) g.addGroup(at, list.length, mat);
    at += list.length;
  });
  g.setAttribute('position', new Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new Float32BufferAttribute(UV, 2));
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
  // one list of art materials per panel; a 4-sided throw has the back as well. A fitted cover has only its front.
  const panels = spec.flat ? spec.flat.panels.length : 1;
  const artCount = Math.min(panels, closed ? 5 : 4);
  const art = [];
  const faces = [];
  for (let i = 0; i < artCount; i++) {
    const m = new MeshStandardMaterial({ roughness: 0.88, metalness: 0, side: DoubleSide });
    art.push([m]);
    faces.push(m);
  }
  const base = [];
  const baseMat = surface('fabric', ctx.base);
  baseMat.side = DoubleSide;
  base.push(baseMat);
  // the cloth groups run front, top, left, right, back; a fitted cover has no art but the front, so the others use the base color
  const cloth = new Mesh(clothGeometry(d, closed, spec.flat ? artCount : 1), spec.flat ? [...faces, baseMat] : [faces[0], baseMat]);
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

  const printed = spec.flat ? artCount : 1;
  return {
    group,
    box: box3(-d.L / 2 - 1.5, 0, -d.D / 2 - 1.5, d.L / 2 + 1.5, d.H + 0.5, d.D / 2 + 1.5),
    pickables: [cloth],
    // a tap on a printed panel picks that panel; the drape and the base color pick nothing
    pickFilter: (hit) => !!hit.face && hit.face.materialIndex < printed,
    pickSide: (hit) => hit.face.materialIndex,
    art,
    base,
    footprint: { w: d.L + 12, d: d.D + 12, kind: 'rect', opacity: 0.3 },
  };
}
