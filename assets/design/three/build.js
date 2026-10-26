// Small geometry helpers shared by the models. Everything here returns plain Three.js objects.
import {
  BufferGeometry, Float32BufferAttribute, Matrix4, Vector3, Quaternion, Euler, CylinderGeometry, Color,
} from 'three';

const UP = new Vector3(0, 1, 0);
const WHITE = new Color(1, 1, 1);

export function xf(px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new Matrix4().compose(new Vector3(px, py, pz), new Quaternion().setFromEuler(new Euler(rx, ry, rz)), new Vector3(sx, sy, sz));
}

// parts: [{ g: BufferGeometry, m?: Matrix4, c?: Color }]. Source geometries are disposed.
export function merge(parts) {
  const pos = [];
  const nor = [];
  const uv = [];
  const col = [];
  const idx = [];
  const withColor = parts.some((p) => p.c !== undefined);
  let base = 0;
  for (const p of parts) {
    const g = p.m ? p.g.clone().applyMatrix4(p.m) : p.g;
    const P = g.attributes.position;
    const N = g.attributes.normal;
    const U = g.attributes.uv;
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i));
      nor.push(N ? N.getX(i) : 0, N ? N.getY(i) : 1, N ? N.getZ(i) : 0);
      uv.push(U ? U.getX(i) : 0, U ? U.getY(i) : 0);
      if (withColor) {
        const c = p.c || WHITE;
        col.push(c.r, c.g, c.b);
      }
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + base);
    else for (let i = 0; i < P.count; i++) idx.push(i + base);
    base += P.count;
    if (g !== p.g) g.dispose();
    p.g.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  if (withColor) out.setAttribute('color', new Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  return out;
}

// A cylinder from point a to point b.
export function bar(a, b, r, seg = 6, rTop = r) {
  const A = new Vector3(...a);
  const B = new Vector3(...b);
  const d = B.clone().sub(A);
  const len = d.length();
  const g = new CylinderGeometry(rTop, r, len, seg, 1);
  g.applyMatrix4(new Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), new Quaternion().setFromUnitVectors(UP, d.normalize()), new Vector3(1, 1, 1)));
  return g;
}

export function disposeTree(root) {
  root.traverse((o) => {
    if (o.isInstancedMesh) o.dispose();
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    const m = o.material;
    if (m) for (const x of Array.isArray(m) ? m : [m]) if (!x.userData.shared) x.dispose();
  });
}

export function box3(minX, minY, minZ, maxX, maxY, maxZ) {
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

// Half sizes and center of a { min, max } box.
export function boxInfo(b) {
  const half = { hx: (b.max[0] - b.min[0]) / 2, hy: (b.max[1] - b.min[1]) / 2, hz: (b.max[2] - b.min[2]) / 2 };
  const center = [(b.max[0] + b.min[0]) / 2, (b.max[1] + b.min[1]) / 2, (b.max[2] + b.min[2]) / 2];
  return { half, center };
}
