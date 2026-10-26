// 10x10 pop-up canopy: hex-section aluminum frame, four printed peak-and-valance sides, optional walls.
import {
  Group, Mesh, BufferGeometry, Float32BufferAttribute, ShapeGeometry, Shape, Vector2, Vector3, PlaneGeometry,
  BoxGeometry, CylinderGeometry, SphereGeometry, MeshStandardMaterial, DoubleSide,
} from 'three';
import { canopyFace, canopyPoint } from '../geom.js';
import { merge, bar, xf, box3 } from '../build.js';
import { surface } from '../materials.js';

const EAVE = 84;

// One side's roof triangle and valance strip as a single geometry, UVs = position on the artboard.
function sideGeometry(f) {
  const pos = [];
  const uv = [];
  const idx = [];
  const add = (x, y) => {
    const p = canopyPoint(f, x, y);
    pos.push(p[0], p[1], p[2]);
    uv.push(x / f.w, 1 - y / f.h);
    return pos.length / 3 - 1;
  };
  const tri = (a, b, c, out) => {
    const A = new Vector3(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]);
    const n = new Vector3(pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]).sub(A).cross(new Vector3(pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]).sub(A));
    if (n.dot(out) < 0) idx.push(a, c, b);
    else idx.push(a, b, c);
  };
  const sg = new ShapeGeometry(new Shape(f.poly.map((p) => new Vector2(p[0], p[1]))));
  const base = [];
  const sp = sg.attributes.position;
  for (let i = 0; i < sp.count; i++) base.push(add(sp.getX(i), sp.getY(i)));
  const roofOut = new Vector3(0, f.k, f.kv);
  for (let i = 0; i < sg.index.count; i += 3) tri(base[sg.index.getX(i)], base[sg.index.getX(i + 1)], base[sg.index.getX(i + 2)], roofOut);
  sg.dispose();
  const v0 = add(0, f.vy);
  const v1 = add(f.w, f.vy);
  const v2 = add(f.w, f.h);
  const v3 = add(0, f.h);
  const out = new Vector3(0, 0, 1);
  tri(v0, v1, v2, out);
  tri(v0, v2, v3, out);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function frameGeometry(a, rise) {
  const half = a / 2 - 1.6;
  const alu = [];
  const dark = [];
  const hex = (r, h) => new CylinderGeometry(r, r, h, 6, 1);
  const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  corners.forEach(([sx, sz]) => {
    const x = sx * half;
    const z = sz * half;
    alu.push({ g: hex(0.85, 42), m: xf(x, 21, z) });
    alu.push({ g: hex(1.2, 2.4), m: xf(x, 42.6, z) });
    alu.push({ g: hex(1.0, EAVE - 43.8), m: xf(x, 43.8 + (EAVE - 43.8) / 2, z) });
    dark.push({ g: new BoxGeometry(6.4, 0.45, 6.4), m: xf(x, 0.22, z) });
    dark.push({ g: new CylinderGeometry(1.5, 1.7, 0.9, 6), m: xf(x, 0.8, z) });
    dark.push({ g: new BoxGeometry(2.8, 2.6, 2.8), m: xf(x, EAVE - 2.6, z) });
  });
  const y0 = EAVE - 2;
  const yb = y0 - 25;
  const sides = [[[-half, half], [half, half]], [[half, half], [half, -half]], [[half, -half], [-half, -half]], [[-half, -half], [-half, half]]];
  sides.forEach(([p, q]) => {
    const at = (t, y) => [p[0] + (q[0] - p[0]) * t, y, p[1] + (q[1] - p[1]) * t];
    alu.push({ g: bar(at(0, y0), at(1, y0), 0.55) });
    alu.push({ g: bar(at(0, yb), at(1, yb), 0.5) });
    for (let c = 0; c < 3; c++) {
      const t0 = c / 3;
      const t1 = (c + 1) / 3;
      alu.push({ g: bar(at(t0, y0), at(t1, yb), 0.42) });
      alu.push({ g: bar(at(t0, yb), at(t1, y0), 0.42) });
      const tm = (t0 + t1) / 2;
      const m = at(tm, (y0 + yb) / 2);
      dark.push({ g: new SphereGeometry(0.85, 8, 6), m: xf(m[0], m[1], m[2]) });
    }
  });
  const hubY = EAVE - 1;
  alu.push({ g: bar([-half, hubY, -half], [half, hubY, half], 0.6) });
  alu.push({ g: bar([-half, hubY, half], [half, hubY, -half], 0.6) });
  dark.push({ g: hex(2.6, 3.4), m: xf(0, hubY, 0) });
  alu.push({ g: hex(0.8, rise - 2), m: xf(0, EAVE + rise / 2, 0) });
  dark.push({ g: new SphereGeometry(1.5, 10, 8), m: xf(0, EAVE + rise - 0.6, 0) });
  return { alu: merge(alu), dark: merge(dark) };
}

function wallGeometry(w, h, fold) {
  const g = new PlaneGeometry(w, h, 28, 6);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const k = (h / 2 - y) / h;
    p.setZ(i, fold * k * (0.7 * Math.sin(x * 0.62 + 0.4) + 0.3 * Math.sin(x * 1.7)));
  }
  g.computeVertexNormals();
  return g;
}

export function buildCanopy(ctx) {
  const { spec, choices, mats, specs } = ctx;
  const f = canopyFace(spec, EAVE);
  const a = f.w;
  const group = new Group();
  const art = [[], [], [], []];
  const base = [];
  const pickables = [];

  const geo = sideGeometry(f);
  for (let i = 0; i < 4; i++) {
    const m = new MeshStandardMaterial({ roughness: 0.84, metalness: 0, side: DoubleSide });
    art[i].push(m);
    const mesh = new Mesh(geo, m);
    mesh.rotation.y = (i * Math.PI) / 2;
    mesh.castShadow = true;
    mesh.userData.side = i;
    group.add(mesh);
    pickables.push(mesh);
  }

  const fr = frameGeometry(a, f.rise);
  const alu = new Mesh(fr.alu, mats.get('aluminum'));
  const dark = new Mesh(fr.dark, mats.get('steel'));
  [alu, dark].forEach((m) => {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  });

  const pieces = (specs && specs.products && specs.products.canopy && specs.products.canopy.other_pieces) || {};
  const bw = (pieces.back_wall && pieces.back_wall.w) || 115.07;
  const bh = (pieces.back_wall && pieces.back_wall.h) || 80.07;
  const hh = (pieces.half_wall && pieces.half_wall.h) || 41.07;
  const inset = a / 2 - 3.4;
  const wallMat = surface('fabric', ctx.base);
  wallMat.side = DoubleSide;
  base.push(wallMat);
  const wall = (w, h, y, rot, x, z) => {
    const m = new Mesh(wallGeometry(w, h, 0.45), wallMat);
    m.position.set(x, y, z);
    m.rotation.y = rot;
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  };
  const pkg = choices && choices.package;
  if (pkg === 'back' || pkg === 'kit') wall(bw, bh, EAVE - 2 - bh / 2, 0, 0, -inset);
  if (pkg === 'kit') {
    wall(bw, hh, 1 + hh / 2, Math.PI / 2, inset, 0);
    wall(bw, hh, 1 + hh / 2, -Math.PI / 2, -inset, 0);
  }

  const top = EAVE + f.rise + 2;
  return {
    group,
    box: box3(-a / 2 - 2, 0, -a / 2 - 2, a / 2 + 2, top, a / 2 + 2),
    pickables,
    art,
    base,
    footprint: { w: a + 20, d: a + 20, kind: 'rect', opacity: 0.22 },
    uvSize: { w: f.w, h: f.h },
  };
}
