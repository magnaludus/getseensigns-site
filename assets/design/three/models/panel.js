// Flat printed products that share one simple build: retractable banner stand, step and repeat backdrop, car magnet,
// hard hat decal and aluminum safety sign pack. Sizes come from the print spec, so every model is true size.
import {
  Group, Mesh, PlaneGeometry, BoxGeometry, CylinderGeometry, SphereGeometry, MeshStandardMaterial,
} from 'three';
import { rad } from '../geom.js';
import { merge, bar, box3 } from '../build.js';
import { surface } from '../materials.js';

// A slab with the print on its front face. Edge and back follow the base color.
function slab(w, h, t, ctx, front, edgeKind = 'vinyl') {
  const edge = surface(edgeKind, ctx.base);
  const back = surface(edgeKind, ctx.base);
  ctx.baseList.push(edge, back);
  // BoxGeometry face order: +x, -x, +y, -y, +z (front), -z (back)
  const mesh = new Mesh(new BoxGeometry(w, h, t), [edge, edge, edge, edge, front, back]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.side = 0;
  return mesh;
}

function frontMaterial(roughness = 0.5) {
  return new MeshStandardMaterial({ roughness, metalness: 0 });
}

function base(ctx) {
  return { ...ctx, baseList: [] };
}

function pack(group, c, extra = {}) {
  return { group, art: [c.art], base: c.baseList, own: [], pickables: c.pick, ...extra };
}

// Retractable banner stand: printed film, aluminum cassette base, pole behind the film and a top bar.
export function buildRetractable(rawCtx) {
  const ctx = base(rawCtx);
  const { spec, mats } = ctx;
  const { w, h } = spec.artboard;
  const group = new Group();
  const front = frontMaterial(0.42);
  const BASE_H = 3.6;
  const sheet = slab(w, h, 0.05, ctx, front);
  sheet.position.set(0, BASE_H + h / 2 - 0.4, 0);
  group.add(sheet);
  const cassette = new Mesh(new CylinderGeometry(2.4, 2.4, w + 3, 20), mats.get('aluminum'));
  cassette.rotation.z = Math.PI / 2;
  cassette.scale.set(1, 1, 0.9);
  cassette.position.set(0, 2.4, 0.2);
  cassette.castShadow = true;
  group.add(cassette);
  for (const sx of [-1, 1]) {
    const cap = new Mesh(new CylinderGeometry(2.5, 2.5, 0.5, 20), mats.get('steel'));
    cap.rotation.z = Math.PI / 2;
    cap.scale.set(1, 1, 0.9);
    cap.position.set(sx * (w / 2 + 1.7), 2.4, 0.2);
    group.add(cap);
  }
  const top = new Mesh(new BoxGeometry(w + 0.6, 0.7, 0.5), mats.get('aluminum'));
  top.position.set(0, BASE_H + h - 0.4 + 0.2, 0);
  group.add(top);
  const pole = new Mesh(merge([{ g: bar([0, BASE_H, -0.9], [0, BASE_H + h + 0.2, -0.9], 0.45, 8) }]), mats.get('aluminum'));
  pole.castShadow = true;
  group.add(pole);
  const c = { art: [front], baseList: ctx.baseList, pick: [sheet] };
  return pack(group, c, {
    box: box3(-w / 2 - 3, 0, -4, w / 2 + 3, BASE_H + h + 1, 5),
    footprint: { w: w + 10, d: 14, kind: 'oval', opacity: 0.32 },
  });
}

// Step and repeat backdrop: fabric between two poles with a top bar and T-shaped feet.
export function buildBackdrop(rawCtx) {
  const ctx = base(rawCtx);
  const { spec, mats } = ctx;
  const { w, h } = spec.artboard;
  const group = new Group();
  const front = frontMaterial(0.8);
  const LIFT = 6;
  const sheet = slab(w, h, 0.08, ctx, front, 'fabric');
  sheet.position.set(0, LIFT + h / 2, 0.6);
  group.add(sheet);
  const parts = [];
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 + 1.2);
    parts.push({ g: bar([x, 0.8, 0], [x, LIFT + h + 6, 0], 0.55, 8) });
    parts.push({ g: bar([x, 0.8, -12], [x, 0.8, 12], 0.7, 8) });
  }
  parts.push({ g: bar([-w / 2 - 1.2, LIFT + h + 5, 0], [w / 2 + 1.2, LIFT + h + 5, 0], 0.5, 8) });
  const frame = new Mesh(merge(parts), mats.get('galvanized'));
  frame.castShadow = true;
  group.add(frame);
  const c = { art: [front], baseList: ctx.baseList, pick: [sheet] };
  return pack(group, c, {
    box: box3(-w / 2 - 4, 0, -14, w / 2 + 4, LIFT + h + 8, 14),
    footprint: { w: w + 16, d: 34, kind: 'oval', opacity: 0.3 },
  });
}

// Car magnet on a steel door panel. The panel stays a plain light color.
export function buildMagnet(rawCtx) {
  const ctx = base(rawCtx);
  const { spec, mats } = ctx;
  const { w, h } = spec.artboard;
  const group = new Group();
  const front = frontMaterial(0.35);
  const panelMat = new MeshStandardMaterial({ color: 0xe9ecef, metalness: 0.45, roughness: 0.3 });
  const panel = new Mesh(new BoxGeometry(w + 10, h + 10, 0.6), panelMat);
  panel.position.set(0, (h + 10) / 2 + 1, 0);
  panel.castShadow = true;
  panel.receiveShadow = true;
  group.add(panel);
  const magnet = slab(w, h, 0.06, ctx, front, 'vinyl');
  magnet.position.set(0, (h + 10) / 2 + 1, 0.33);
  group.add(magnet);
  const rail = new Mesh(new BoxGeometry(w + 10, 0.5, 0.9), mats.get('galvanized'));
  rail.position.set(0, 0.8, 0.1);
  group.add(rail);
  const c = { art: [front], baseList: ctx.baseList, pick: [magnet] };
  return pack(group, c, {
    box: box3(-w / 2 - 5, 0, -2, w / 2 + 5, h + 12, 3),
    footprint: { w: w + 14, d: 6, kind: 'oval', opacity: 0.22 },
    own: [panelMat],
  });
}

// Hard hat decal: a white hard hat with the decal bent onto its front. Decal size is true size.
export function buildDecal(rawCtx) {
  const ctx = base(rawCtx);
  const { spec } = ctx;
  const { w } = spec.artboard;
  const group = new Group();
  const R = 5.6;
  const shellMat = new MeshStandardMaterial({ color: 0xf4f2ec, roughness: 0.32, metalness: 0.02 });
  const dome = new Mesh(new SphereGeometry(R, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), shellMat);
  dome.position.y = 2.2;
  dome.scale.set(1, 0.88, 1.12);
  dome.castShadow = true;
  group.add(dome);
  const rim = new Mesh(new CylinderGeometry(R * 1.02, R * 1.04, 0.5, 48), shellMat);
  rim.position.y = 2.0;
  rim.scale.set(1, 1, 1.12);
  group.add(rim);
  const brim = new Mesh(new BoxGeometry(R * 1.5, 0.3, 3.2), shellMat);
  brim.position.set(0, 2.0, R * 1.12 + 1.0);
  brim.rotation.x = rad(-6);
  group.add(brim);
  const ridge = new Mesh(new BoxGeometry(1.1, 0.7, R * 1.9), shellMat);
  ridge.position.set(0, 2.2 + R * 0.88, 0);
  group.add(ridge);

  // The decal follows the dome: each vertex of a small grid is pushed out to the surface.
  const front = frontMaterial(0.28);
  const seg = 14;
  const g = new PlaneGeometry(w, w, seg, seg);
  const p = g.attributes.position;
  const centerY = 2.2 + R * 0.88 * 0.46;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const wy = (centerY + y - 2.2) / 0.88;
    const rr = R * R - x * x - wy * wy;
    p.setZ(i, (rr > 0 ? Math.sqrt(rr) : 0) * 1.12 + 0.03);
    p.setY(i, centerY + y);
  }
  g.computeVertexNormals();
  const decal = new Mesh(g, front);
  decal.userData.side = 0;
  decal.castShadow = false;
  group.add(decal);
  const c = { art: [front], baseList: ctx.baseList, pick: [decal] };
  return pack(group, c, {
    box: box3(-R - 1, 0, -R * 1.12 - 1, R + 1, 2.2 + R * 0.88 + 1.2, R * 1.12 + 4.5),
    footprint: { w: R * 3, d: R * 3, kind: 'oval', opacity: 0.3 },
    own: [shellMat],
  });
}

// Aluminum safety signs: a small fan of plates, one per sign, the first one in front.
export function buildSafety(rawCtx) {
  const ctx = base(rawCtx);
  const { spec, choices, mats } = ctx;
  const { w, h } = spec.artboard;
  const group = new Group();
  const heavy = String(choices && choices.pack).endsWith('hd');
  const T = heavy ? 0.063 : 0.04;
  const count = 5; // a pack of 10 shows its first five
  const arts = [];
  const picks = [];
  const plates = [];
  const LIFT = 8;
  for (let i = count - 1; i >= 0; i--) {
    const front = frontMaterial(0.28);
    const plate = new Mesh(new BoxGeometry(w, h, T), [mats.get('aluminum'), mats.get('aluminum'), mats.get('aluminum'), mats.get('aluminum'), front, mats.get('aluminum')]);
    plate.castShadow = true;
    plate.receiveShadow = true;
    plate.userData.side = i;
    plate.position.set(i * 1.2, LIFT + h / 2 + i * 0.6, -i * 1.1);
    plate.rotation.y = rad(-i * 2.5);
    group.add(plate);
    arts[i] = [front];
    picks.push(plate);
    plates.push(plate);
  }
  const posts = merge([
    { g: bar([-w * 0.28, 0, -0.9], [-w * 0.28, LIFT + h * 0.55, -0.9], 0.55, 8) },
    { g: bar([w * 0.28, 0, -0.9], [w * 0.28, LIFT + h * 0.55, -0.9], 0.55, 8) },
  ]);
  const post = new Mesh(posts, mats.get('galvanized'));
  post.castShadow = true;
  group.add(post);
  return {
    group,
    box: box3(-w / 2 - 2, 0, -count * 1.1 - 2, w / 2 + count * 1.2 + 2, LIFT + h + count * 0.6 + 1, 3),
    pickables: picks,
    art: arts,
    base: [],
    own: [],
    footprint: { w: w + 8, d: 10, kind: 'oval', opacity: 0.26 },
  };
}
