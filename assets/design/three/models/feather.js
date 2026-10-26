// Feather flag: a gridded flag cut to the spec outline, hung on a sleeve and pole, spike or cross base.
import {
  Group, Mesh, BufferGeometry, Float32BufferAttribute, CylinderGeometry, BoxGeometry, SphereGeometry,
  MeshStandardMaterial, FrontSide, BackSide, DoubleSide,
} from 'three';
import { outlineRows, poleHeightIn, TAU } from '../geom.js';
import { merge, xf, box3 } from '../build.js';
import { surface } from '../materials.js';

const COLS = 10;
const TOP_GAP = 4;

function flagGrid(spec) {
  const { w, h } = spec.artboard;
  const rows = Math.max(24, Math.ceil(h / 2));
  const span = outlineRows(spec.outline, rows, h);
  const n = (rows + 1) * (COLS + 1);
  const rest = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const idx = [];
  span.forEach(([y, x0, x1], r) => {
    for (let c = 0; c <= COLS; c++) {
      const x = x0 + ((x1 - x0) * c) / COLS;
      const i = r * (COLS + 1) + c;
      rest[i * 3] = x;
      rest[i * 3 + 1] = -y;
      uv[i * 2] = x / w;
      uv[i * 2 + 1] = 1 - y / h;
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
  return { g, rest, rows, w, h };
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
  const flagTop = poleH - TOP_GAP;
  const front = new MeshStandardMaterial({ roughness: 0.78, metalness: 0, side: FrontSide });
  const back = new MeshStandardMaterial({ roughness: 0.82, metalness: 0, side: BackSide, color: 0xe2e2e2 });
  art[0].push(front, back);
  const flag = new Group();
  flag.position.set(0, flagTop, 0);
  const fm = new Mesh(grid.g, front);
  const bm = new Mesh(grid.g, back);
  fm.castShadow = bm.castShadow = true;
  fm.userData.side = bm.userData.side = 0;
  flag.add(fm, bm);
  group.add(flag);

  const sleeveR = Math.max(0.55, (spec.sleeveIn || 2.5) / 5);
  const sleeveMat = surface('fabric', ctx.base);
  base.push(sleeveMat);
  const sleeve = new Mesh(new CylinderGeometry(sleeveR, sleeveR, h, 12, 1, true), sleeveMat);
  sleeve.material.side = DoubleSide;
  sleeve.position.set(0, flagTop - h / 2, 0);
  sleeve.castShadow = true;
  group.add(sleeve);

  const bs = baseGeometry(choices.base);
  const baseMesh = new Mesh(bs.g, choices.base === 'cross' ? mats.get('steel') : mats.get('galvanized'));
  baseMesh.castShadow = baseMesh.receiveShadow = true;
  group.add(baseMesh);

  const sections = Math.max(3, Math.round(poleH / 44));
  const parts = [];
  const len = (poleH - bs.top + 6) / sections;
  for (let i = 0; i < sections; i++) {
    const t = i / (sections - 1);
    const r = 0.46 - 0.17 * t;
    const y0 = bs.top - 6 + i * len;
    parts.push({ g: new CylinderGeometry(r - 0.025, r, len + 0.4, 10, 1), m: xf(0, y0 + len / 2, 0) });
    if (i) parts.push({ g: new CylinderGeometry(r + 0.1, r + 0.1, 1.6, 10), m: xf(0, y0, 0) });
  }
  parts.push({ g: new SphereGeometry(0.34, 10, 8), m: xf(0, poleH, 0) });
  const pole = new Mesh(merge(parts), mats.get('pole'));
  pole.castShadow = true;
  group.add(pole);

  group.position.x = -w / 2;

  let t0 = 0;
  const pos = grid.g.attributes.position;
  const { rest, rows } = grid;
  const wind = (time, amp) => {
    for (let r = 0; r <= rows; r++) {
      const y = -rest[(r * (COLS + 1)) * 3 + 1];
      const yaw = Math.sin(time * 0.55 + 0.7) * 0.05 * amp;
      for (let c = 0; c <= COLS; c++) {
        const i = r * (COLS + 1) + c;
        const x = rest[i * 3];
        const g = Math.pow(x / w, 1.35);
        const ph = (y / 58) * TAU - time * 1.9;
        const z = amp * 2.1 * g * (Math.sin(ph) + 0.4 * Math.sin(ph * 2.3 + 1.7)) + x * Math.sin(yaw);
        pos.setXYZ(i, x * Math.cos(yaw), rest[i * 3 + 1], z);
      }
    }
    pos.needsUpdate = true;
    grid.g.computeVertexNormals();
  };
  wind(0, ctx.reduced ? 0.35 : 0.6);

  return {
    group,
    box: box3(-w / 2 - 1, 0, -4, w / 2 + 1, poleH + 1, 4),
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
