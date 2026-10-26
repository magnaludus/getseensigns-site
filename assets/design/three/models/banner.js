// Vinyl banner: true-size sheet with hem, instanced grommets, zip-tied to a chain-link fence or hung on a wall.
import {
  Group, Mesh, InstancedMesh, BufferGeometry, Float32BufferAttribute, PlaneGeometry, BoxGeometry, CylinderGeometry,
  TorusGeometry, SphereGeometry, MeshStandardMaterial, MeshBasicMaterial, CanvasTexture, Matrix4, RepeatWrapping,
  SRGBColorSpace, FrontSide, BackSide, DoubleSide,
} from 'three';
import { grommetPoints } from '../geom.js';
import { merge, xf, bar, box3 } from '../build.js';
import { chainLinkCanvas } from '../procedural.js';
import { surface } from '../materials.js';

const HEM = 1;

// Height of the sheet (local x, y from its center) so edges ripple between ties, or bow when hung.
function zAt(w, h, mount, tie0, pitch) {
  return (x, y) => {
    const edge = Math.pow(Math.abs(y) / (h / 2), 3);
    const rip = Math.pow(Math.sin((Math.PI * (x + w / 2 - tie0)) / pitch), 2);
    if (mount === 'fence') return 0.34 * edge * rip;
    const low = (h / 2 - y) / h;
    return 0.9 * low * low + 0.18 * edge * rip;
  };
}

function sheet(w, h, z) {
  const g = new PlaneGeometry(w, h, Math.min(64, Math.max(8, Math.ceil(w / 2.5))), Math.min(24, Math.max(4, Math.ceil(h / 3))));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, z(p.getX(i), p.getY(i)));
  g.computeVertexNormals();
  return g;
}

// Flat strips that follow the sheet surface, for the hem band and the stitch line.
function strips(rects, z, dz) {
  const pos = [];
  const idx = [];
  for (const [x0, y0, x1, y1] of rects) {
    const nx = Math.max(1, Math.ceil((x1 - x0) / 2.5));
    const ny = Math.max(1, Math.ceil((y1 - y0) / 2.5));
    const b = pos.length / 3;
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = x0 + ((x1 - x0) * i) / nx;
        const y = y0 + ((y1 - y0) * j) / ny;
        pos.push(x, y, z(x, y) + dz);
      }
    }
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = b + j * (nx + 1) + i;
        idx.push(a, a + 1, a + nx + 1, a + 1, a + nx + 2, a + nx + 1);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function hemRects(w, h, o, t) {
  const x0 = -w / 2 + o;
  const x1 = w / 2 - o;
  const y0 = -h / 2 + o;
  const y1 = h / 2 - o;
  return [[x0, y1 - t, x1, y1], [x0, y0, x1, y0 + t], [x0, y0 + t, x0 + t, y1 - t], [x1 - t, y0 + t, x1, y1 - t]];
}

export function buildBanner(ctx) {
  const { spec, mats } = ctx;
  const mount = ctx.options && ctx.options.mount === 'wall' ? 'wall' : 'fence';
  const { w, h } = spec.artboard;
  const group = new Group();
  const art = [[]];
  const base = [];
  const own = [];

  const fenceH = Math.max(48, Math.ceil((h + 22) / 12) * 12);
  const y0 = mount === 'fence' ? (fenceH - h) / 2 + 1 : 26;
  const sheetGroup = new Group();
  sheetGroup.position.set(0, y0 + h / 2, 0);
  group.add(sheetGroup);

  const pts = grommetPoints(w, h, spec.grommetEveryIn, 1.1);
  const tieX = pts.filter((p) => p[1] < 2).map((p) => p[0]).sort((a, b) => a - b);
  const pitch = tieX.length > 1 ? tieX[1] - tieX[0] : 24;
  const z = zAt(w, h, mount, tieX[0] || 0, pitch);
  const sg = sheet(w, h, z);
  const front = new MeshStandardMaterial({ roughness: 0.5, metalness: 0, side: FrontSide });
  const back = new MeshStandardMaterial({ roughness: 0.6, metalness: 0, side: BackSide, color: 0xc4c4c4, emissive: 0x777777 });
  art[0].push(front, back);
  const fm = new Mesh(sg, front);
  const bm = new Mesh(sg, back);
  fm.castShadow = bm.castShadow = true;
  fm.userData.side = bm.userData.side = 0;
  sheetGroup.add(fm, bm);

  const stitch = new Mesh(strips(hemRects(w, h, HEM + 0.12, 0.09), z, 0.03), new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
  sheetGroup.add(stitch);
  const hemBack = surface('vinyl', ctx.base);
  hemBack.side = BackSide;
  base.push(hemBack);
  sheetGroup.add(new Mesh(strips(hemRects(w, h, 0, HEM), z, -0.03), hemBack));

  const gm = new InstancedMesh(new TorusGeometry(0.36, 0.1, 6, 16), mats.get('brass'), pts.length);
  const hole = new InstancedMesh(new CylinderGeometry(0.27, 0.27, 0.16, 14).rotateX(Math.PI / 2), mats.get('hole'), pts.length);
  const m4 = new Matrix4();
  pts.forEach(([x, y], i) => {
    m4.copy(xf(x - w / 2, h / 2 - y, 0.04));
    gm.setMatrixAt(i, m4);
    hole.setMatrixAt(i, m4);
  });
  gm.castShadow = true;
  sheetGroup.add(gm, hole);

  let top;
  let halfW;
  if (mount === 'fence') {
    const padX = 22;
    halfW = w / 2 + padX;
    const fz = -2.6;
    const tex = new CanvasTexture(chainLinkCanvas(256));
    tex.colorSpace = SRGBColorSpace;
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.repeat.set((halfW * 2) / 4.8, (fenceH - 3) / 4.8);
    tex.anisotropy = ctx.anisotropy;
    own.push(tex);
    const fenceMat = new MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.06, metalness: 0.7, roughness: 0.45, side: DoubleSide, depthWrite: true });
    const mesh = new Mesh(new PlaneGeometry(halfW * 2, fenceH - 3), fenceMat);
    mesh.position.set(0, 1.5 + (fenceH - 3) / 2, fz);
    group.add(mesh);
    const hw = halfW - 1.2;
    const posts = [];
    [-hw, hw].forEach((x) => {
      posts.push({ g: new CylinderGeometry(1.19, 1.19, fenceH + 3, 12), m: xf(x, (fenceH + 3) / 2 - 1.5, fz - 1.6) });
      posts.push({ g: new SphereGeometry(1.5, 12, 8), m: xf(x, fenceH + 1.6, fz - 1.6) });
    });
    posts.push({ g: bar([-hw, fenceH - 0.6, fz - 1.1], [hw, fenceH - 0.6, fz - 1.1], 0.83, 10) });
    posts.push({ g: bar([-hw, 2, fz - 0.4], [hw, 2, fz - 0.4], 0.2, 6) });
    const pm = new Mesh(merge(posts), mats.get('galvanized'));
    pm.castShadow = pm.receiveShadow = true;
    group.add(pm);
    const zips = new InstancedMesh(new BoxGeometry(0.24, 0.34, 2.9), mats.get('zip'), pts.length);
    pts.forEach(([x, y], i) => zips.setMatrixAt(i, xf(x - w / 2, y0 + h - y, -1.35)));
    zips.castShadow = true;
    group.add(zips);
    top = fenceH + 4;
  } else {
    halfW = w / 2 + 30;
    const wh = y0 + h + 28;
    const wallMat = mats.get('plaster');
    const wall = new Mesh(new BoxGeometry(halfW * 2, wh, 6), wallMat);
    wall.position.set(0, wh / 2, -1.6 - 3);
    wall.receiveShadow = true;
    wall.castShadow = true;
    group.add(wall);
    const skirting = new Mesh(new BoxGeometry(halfW * 2, 4, 0.8), mats.get('plaster'));
    skirting.position.set(0, 2, -1.2);
    group.add(skirting);
    const tops = pts.filter((p) => p[1] < 2);
    const nails = new InstancedMesh(new CylinderGeometry(0.5, 0.5, 0.25, 10).rotateX(Math.PI / 2), mats.get('galvanized'), tops.length);
    const shafts = new InstancedMesh(new CylinderGeometry(0.14, 0.14, 1.9, 6).rotateX(Math.PI / 2), mats.get('galvanized'), tops.length);
    tops.forEach(([x], i) => {
      nails.setMatrixAt(i, xf(x - w / 2, y0 + h - 1.1, 0.34));
      shafts.setMatrixAt(i, xf(x - w / 2, y0 + h - 1.1, -0.6));
    });
    group.add(nails, shafts);
    top = wh;
  }

  return {
    group,
    box: box3(-halfW, 0, -8, halfW, top, 6),
    pickables: [fm, bm],
    art,
    base,
    own,
    footprint: { w: halfW * 2 + 12, d: 22, kind: 'rect', opacity: 0.26 },
  };
}
