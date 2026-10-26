// Geometry checks for the procedural models, run in node with the full three build (no WebGL needed).
// The page maps `three` to the tree-shaken vendor bundle; here a resolve hook maps it to the dev dependency.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const threeUrl = pathToFileURL(join(root, '.design-dev', 'node_modules', 'three', 'build', 'three.module.js')).href;
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) { return s === 'three' ? { url: ${JSON.stringify(threeUrl)}, shortCircuit: true } : n(s, c); }`));

// Canvas generators only run in a browser; the models just need something that quacks like a canvas.
const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ addColorStop() {} })), set: (t, k, v) => { t[k] = v; return true; } });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };

const THREE = await import('three');
const { specFor } = await import('../../../assets/design/model/specs.js');
const G = await import('../../../assets/design/three/geom.js');
const { createMaterials } = await import('../../../assets/design/three/materials.js');
const { disposeTree } = await import('../../../assets/design/three/build.js');
const { buildCanopy } = await import('../../../assets/design/three/models/canopy.js');
const { buildFeather } = await import('../../../assets/design/three/models/feather.js');
const { buildThrow } = await import('../../../assets/design/three/models/throw.js');
const { buildBanner } = await import('../../../assets/design/three/models/banner.js');
const { buildYard } = await import('../../../assets/design/three/models/yard.js');

const specs = JSON.parse(readFileSync(join(root, 'assets', 'design', 'print-specs.json'), 'utf8'));
const mats = createMaterials();
const BUILD = { canopy: buildCanopy, feather: buildFeather, throw: buildThrow, banner: buildBanner, yard: buildYard };

const VARIANTS = [
  ...['valance', 'back', 'kit'].map((package_) => ['canopy', { package: package_ }]),
  ...['10.5', '14', '18'].flatMap((height) => ['spike', 'cross'].map((base) => ['feather', { height, base }])),
  ...['6', '8'].flatMap((length) => ['3', '4'].map((style) => ['throw', { length, style }])),
  ...['2x4', '3x6', '4x8', '3x10'].map((size) => ['banner', { size }]),
  ...['5', '10', '25', '50', '100'].flatMap((pack) => ['1', '2'].map((print) => ['yard', { pack, print }])),
];

function make(product, choices, extra = {}) {
  const spec = specFor(specs, product, choices);
  return { spec, model: BUILD[product]({ spec, choices, specs, mats, base: new THREE.Color('#f2efe6'), anisotropy: 4, reduced: true, options: { mount: 'fence' }, ...extra }) };
}

function meshes(group) {
  const out = [];
  group.traverse((o) => o.isMesh && out.push(o));
  return out;
}

function triangles(group) {
  return meshes(group).reduce((n, m) => {
    const g = m.geometry;
    return n + ((m.isInstancedMesh ? m.count : 1) * (g.index ? g.index.count : g.attributes.position.count)) / 3;
  }, 0);
}

const label = (p, c) => p + ' ' + JSON.stringify(c);

test('every model variant builds finite geometry that stands on the ground inside its box', () => {
  for (const [product, choices] of VARIANTS) {
    const { model } = make(product, choices);
    const name = label(product, choices);
    assert.ok(model.group && model.pickables.length && model.art.length && model.base.length, name);
    model.group.updateMatrixWorld(true);
    const box = new THREE.Box3();
    // the yard box frames the first sign; the pack stands behind it on purpose
    for (const m of meshes(product === 'yard' ? model.group.children[0] : model.group)) {
      for (const k of ['position', 'normal', 'uv']) {
        const a = m.geometry.attributes[k];
        if (!a) continue;
        for (let i = 0; i < a.array.length; i++) assert.ok(Number.isFinite(a.array[i]), `${name}: ${k} has a non-finite value in ${m.geometry.type}`);
      }
      if (!m.isInstancedMesh) box.expandByObject(m);
    }
    box.min.y = Math.min(box.min.y, 0);
    assert.ok(model.box.min[1] === 0, name + ': ground is y = 0');
    const slack = 0.25;
    const tol = product === 'feather' && choices.base === 'cross' ? 14 : 6; // the box frames the flag, not the foot plate
    const size = box.getSize(new THREE.Vector3());
    const bsize = [model.box.max[0] - model.box.min[0], model.box.max[1] - model.box.min[1], model.box.max[2] - model.box.min[2]];
    assert.ok(box.min.x >= model.box.min[0] - tol && box.max.x <= model.box.max[0] + tol, `${name}: x extent ${box.min.x}..${box.max.x} vs box ${model.box.min[0]}..${model.box.max[0]}`);
    assert.ok(box.max.y <= model.box.max[1] + 6, `${name}: height ${box.max.y} vs ${model.box.max[1]}`);
    assert.ok(size.y >= bsize[1] * (1 - slack) && size.x >= bsize[0] * (1 - 0.6), `${name}: box is not wildly larger than the geometry`);
    assert.ok(triangles(model.group) < 16000, `${name}: ${triangles(model.group)} triangles`);
    disposeTree(model.group);
  }
});

test('textured parts expose one slot per printed side', () => {
  const slots = { canopy: 4, feather: 1, throw: 1, banner: 1, yard: 2 };
  for (const [product, choices] of VARIANTS) {
    const { model } = make(product, choices);
    assert.equal(model.art.length, slots[product], label(product, choices));
    const used = new Set(model.pickables.map((p) => p.userData.side));
    for (const s of used) assert.ok(s >= 0 && s < slots[product]);
    if (product === 'canopy') assert.deepEqual([...used].sort(), [0, 1, 2, 3]);
    if (product === 'yard') assert.deepEqual([...used].sort(), [0, 1]);
    // every slot that can show art has at least one material to carry it, except the back of a one sided sign
    model.art.forEach((list, i) => {
      if (product === 'yard' && i === 1 && String(choices.print) === '1') assert.equal(list.length, 0);
      else assert.ok(list.length >= 1, `${label(product, choices)} slot ${i}`);
    });
  }
});

test('building the same variant twice gives the same mesh', () => {
  for (const [product, choices] of VARIANTS.filter((v, i) => i % 3 === 0)) {
    const a = make(product, choices).model;
    const b = make(product, choices).model;
    assert.equal(triangles(a.group), triangles(b.group), label(product, choices));
    assert.deepEqual(a.box, b.box);
  }
});

test('canopy: each side maps the artboard upright onto its own outward face', () => {
  const { spec, model } = make('canopy', { package: 'valance' });
  const f = G.canopyFace(spec);
  const sides = model.pickables;
  assert.equal(sides.length, 4);
  sides.forEach((mesh) => {
    const i = mesh.userData.side;
    // the mesh is turned i quarter turns, so its +Z face looks at the side's azimuth
    const out = new THREE.Vector3(0, 0, 1).applyEuler(mesh.rotation);
    const az = G.deg(Math.atan2(out.x, out.z));
    assert.ok(Math.abs(G.shortestDelta(az, G.sideAzimuth('canopy', i))) < 1e-6, `side ${i} faces azimuth ${az}`);
    const p = mesh.geometry.attributes.position;
    const n = mesh.geometry.attributes.normal;
    const uv = mesh.geometry.attributes.uv;
    let roof = 0;
    let valance = 0;
    for (let k = 0; k < p.count; k++) {
      assert.ok(n.getZ(k) > 0.5, 'normals point outward');
      const u = uv.getX(k);
      const v = uv.getY(k);
      assert.ok(u >= -1e-6 && u <= 1 + 1e-6 && v >= -1e-6 && v <= 1 + 1e-6);
      const x = u * f.w;
      const y = (1 - v) * f.h;
      const want = G.canopyPoint(f, x, y);
      assert.ok(Math.hypot(p.getX(k) - want[0], p.getY(k) - want[1], p.getZ(k) - want[2]) < 1e-3, 'vertex matches the art-to-3D mapping');
      if (y <= f.vy + 1e-3) roof++;
      if (y >= f.vy - 1e-3) valance++;
    }
    assert.ok(roof >= 3 && valance >= 4);
    // triangles are wound counter-clockwise seen from outside
    const idx = mesh.geometry.index;
    for (let t = 0; t < idx.count; t += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(p, idx.getX(t));
      const b = new THREE.Vector3().fromBufferAttribute(p, idx.getX(t + 1));
      const c = new THREE.Vector3().fromBufferAttribute(p, idx.getX(t + 2));
      const fn = b.sub(a).cross(c.sub(a));
      assert.ok(fn.z > 0, 'outward winding');
    }
  });
  // the roof apex of every side meets at one point above the center
  const apexes = sides.map((m) => {
    const p = m.geometry.attributes.position;
    let best = null;
    for (let k = 0; k < p.count; k++) if (!best || p.getY(k) > best.y) best = new THREE.Vector3().fromBufferAttribute(p, k);
    return best.applyEuler(sides[0].rotation.clone().set(0, m.rotation.y, 0));
  });
  apexes.forEach((a) => assert.ok(a.distanceTo(apexes[0]) < 1e-6 && Math.abs(a.x) < 1e-6 && Math.abs(a.z) < 1e-6));
  assert.ok(apexes[0].y > 120 && apexes[0].y < 140);
});

test('canopy packages add the right walls in the base color', () => {
  const count = (pkg) => make('canopy', { package: pkg }).model.group.children.length;
  assert.ok(count('back') === count('valance') + 1 && count('kit') === count('valance') + 3);
  const { model } = make('canopy', { package: 'kit' });
  assert.equal(model.base.length, 1);
  assert.ok(model.base[0].color.equals(new THREE.Color('#f2efe6')));
});

test('feather: flag is cut to the spec outline, left edge on the pole, uv covers the artboard', () => {
  for (const height of ['10.5', '14', '18']) {
    const { spec, model } = make('feather', { height, base: 'spike' });
    const { w, h } = spec.artboard;
    const flag = model.pickables[0];
    const p = flag.geometry.attributes.position;
    const uv = flag.geometry.attributes.uv;
    const rows = G.outlineRows(spec.outline, Math.max(24, Math.ceil(h / 2)), h);
    assert.equal(p.count, rows.length * 11);
    for (let r = 0; r < rows.length; r++) {
      const [y, x0, x1] = rows[r];
      const first = r * 11;
      const last = first + 10;
      assert.ok(Math.abs(uv.getX(first) - x0 / w) < 1e-6 && Math.abs(uv.getX(last) - x1 / w) < 1e-6, 'u follows the row span');
      assert.ok(Math.abs(uv.getY(first) - (1 - y / h)) < 1e-6, 'v goes down the artboard');
      assert.ok(Math.abs(p.getY(first) + y) < 1e-3, 'flag hangs down from its top');
    }
    // pole total height and flag top near the pole top
    const top = new THREE.Box3().setFromObject(model.group).max.y;
    assert.ok(Math.abs(top - G.poleHeightIn({ height })) < 1.5, `${height}: pole top ${top}`);
    assert.ok(model.box.max[1] >= top && model.box.max[1] - top < 3);
    const flagTop = flag.parent.position.y;
    assert.ok(G.poleHeightIn({ height }) - flagTop > 1 && G.poleHeightIn({ height }) - flagTop < 8);
    assert.ok(flagTop - h > 10, 'the flag hangs clear of the ground');
  }
});

test('feather: the sway moves the free edge more than the pole edge and stays gentle', () => {
  const { spec, model } = make('feather', { height: '14', base: 'spike' }, { reduced: false });
  assert.equal(typeof model.update, 'function');
  const flag = model.pickables[0];
  const p = flag.geometry.attributes.position;
  const maxZ = (edge) => {
    let m = 0;
    for (let i = 0; i < p.count; i++) if (i % 11 === (edge ? 10 : 0)) m = Math.max(m, Math.abs(p.getZ(i)));
    return m;
  };
  for (const t of [0.5, 1.7, 3.1, 4.4]) {
    assert.equal(model.update(t), true);
    assert.ok(maxZ(true) < 6, 'trailing edge stays within a few inches');
    assert.ok(maxZ(false) < 0.5, 'the pole edge hardly moves');
    for (let i = 0; i < p.count; i++) assert.ok(Number.isFinite(p.getZ(i)));
  }
  const still = make('feather', { height: '14', base: 'spike' }, { reduced: true }).model;
  assert.equal(still.update ? still.update(1) : false, false);
  assert.ok(spec);
});

test('throw: front panel carries the art, the rest is base color, style 3 is open at the back', () => {
  for (const length of ['6', '8']) {
    const open = make('throw', { length, style: '3' });
    const closed = make('throw', { length, style: '4' });
    const cloth = closed.model.pickables[0];
    const g = cloth.geometry;
    assert.equal(g.groups.length, 2);
    assert.equal(g.groups[0].count + g.groups[1].count, g.index.count);
    assert.ok(triangles(open.model.group) < triangles(closed.model.group));
    const p = g.attributes.position;
    const uv = g.attributes.uv;
    const L = open.spec.artboard.w;
    // art group: every triangle faces the viewer on the front or turns the corner, u runs left to right
    const { start, count } = g.groups[0];
    let minU = 1;
    let maxU = 0;
    for (let t = start; t < start + count; t++) {
      const k = g.index.getX(t);
      minU = Math.min(minU, uv.getX(k));
      maxU = Math.max(maxU, uv.getX(k));
      assert.ok(p.getZ(k) > 0, 'art group is on the front half');
      assert.ok(Math.abs(uv.getX(k) - (p.getX(k) + L / 2) / L) < 1.5 / L, 'u follows x, folds only move vertices a little');
      assert.ok(uv.getY(k) > -1e-6 && uv.getY(k) <= 1 + 1e-6);
    }
    assert.ok(minU < 0.01 && maxU > 0.99, 'the art spans the full front');
    // top plate faces up
    const { start: s2, count: c2 } = g.groups[1];
    let upward = 0;
    let downward = 0;
    for (let t = s2; t < s2 + c2; t += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(p, g.index.getX(t));
      const b = new THREE.Vector3().fromBufferAttribute(p, g.index.getX(t + 1));
      const c = new THREE.Vector3().fromBufferAttribute(p, g.index.getX(t + 2));
      if (a.y > 29.9 && b.y > 29.9 && c.y > 29.9) {
        const n = b.sub(a).cross(c.sub(a));
        if (n.y > 0) upward++;
        else if (n.y < 0) downward++;
      }
    }
    assert.ok(upward > 20 && downward === 0, `top plate ${upward} up, ${downward} down`);
    // size: table length from the spec, 30 in deep, 30 in high, hem about 2 in above the floor
    let minY = Infinity;
    let maxY = -Infinity;
    let maxX = 0;
    let maxZ = 0;
    for (let k = 0; k < p.count; k++) {
      minY = Math.min(minY, p.getY(k));
      maxY = Math.max(maxY, p.getY(k));
      maxX = Math.max(maxX, Math.abs(p.getX(k)));
      maxZ = Math.max(maxZ, Math.abs(p.getZ(k)));
    }
    assert.ok(Math.abs(minY - 2) < 0.01 && Math.abs(maxY - 30) < 0.01);
    assert.ok(maxX > L / 2 - 0.1 && maxX < L / 2 + 1.5 && maxZ > 14.9 && maxZ < 16.5);
  }
});

test('throw: the table under the cloth stays inside it at the rounded corners', () => {
  const { model } = make('throw', { length: '6', style: '3' });
  const cloth = model.pickables[0].geometry.attributes.position;
  const table = model.group.children[1].geometry.attributes.position;
  let tx = 0;
  let tz = 0;
  for (let i = 0; i < table.count; i++) {
    tx = Math.max(tx, table.getX(i));
    tz = Math.max(tz, table.getZ(i));
  }
  // corner of the table top must be inside the corner arc of the cloth (radius 2.4 around (L/2-2.4, 15-2.4))
  const d = Math.hypot(tx - (36 - 2.4), tz - (15 - 2.4));
  assert.ok(d < 2.4 - 0.4, `table corner is ${d} from the arc center`);
  assert.ok(cloth.count > 500);
});

test('banner: true size sheet, grommets from the spec, fence or wall mount', () => {
  for (const size of ['2x4', '3x6', '4x8', '3x10']) {
    for (const mount of ['fence', 'wall']) {
      const { spec, model } = make('banner', { size }, { options: { mount } });
      const { w, h } = spec.artboard;
      const sheet = model.pickables[0];
      sheet.geometry.computeBoundingBox();
      const bb = sheet.geometry.boundingBox;
      assert.ok(Math.abs(bb.max.x - bb.min.x - w) < 1e-6 && Math.abs(bb.max.y - bb.min.y - h) < 1e-6, 'sheet is the artboard size');
      assert.ok(bb.max.z < 1.5 && bb.min.z > -0.01, 'thin vinyl');
      const inst = [];
      model.group.traverse((o) => o.isInstancedMesh && inst.push(o));
      const want = G.grommetPoints(w, h, spec.grommetEveryIn, 1.1).length;
      assert.ok(inst.some((m) => m.count === want), `${size}: ${want} grommets`);
      const names = meshes(model.group).length;
      assert.ok(names > 6);
      const box = model.box;
      if (mount === 'fence') assert.ok(box.max[0] - box.min[0] > w + 30, 'fence is wider than the banner');
      else assert.ok(box.max[0] - box.min[0] < w + 80, 'a plain wall hugs the banner');
    }
  }
});

test('yard sign: trim size, corrugated edge, one first sign and 2 to 3 more for packs', () => {
  for (const pack of ['5', '10', '25', '50', '100']) {
    const { spec, model } = make('yard', { pack, print: '2' });
    const signs = model.group.children;
    assert.equal(signs.length, 1 + G.packExtras(pack));
    const first = model.pickables[0].geometry;
    first.computeBoundingBox();
    assert.ok(Math.abs(first.boundingBox.max.x - first.boundingBox.min.x - spec.artboard.w) < 1e-6);
    assert.ok(Math.abs(first.boundingBox.max.y - first.boundingBox.min.y - spec.artboard.h) < 1e-6);
    const sign = signs[0].children[0];
    const thick = new THREE.Box3().setFromObject(sign);
    assert.ok(thick.max.z - thick.min.z > 0.15 && thick.max.z - thick.min.z < 0.2, 'about 0.16 in thick');
    assert.ok(Math.abs(thick.min.y - 7) < 1e-6, 'sign bottom above the ground on its stake');
    model.view(0);
    assert.ok(signs.slice(1).every((s) => s.visible));
    model.view(180);
    assert.ok(signs.slice(1).every((s) => !s.visible), 'the pack hides behind the front sign when seen from the back');
    model.view(40);
    assert.ok(signs.slice(1).every((s) => s.visible));
    model.setHaze('#d0d8e0');
    const e = signs[1].children.length;
    assert.ok(e >= 1);
  }
});

test('disposeTree releases geometries, materials and instanced buffers once', () => {
  const { model } = make('banner', { size: '3x6' }, { options: { mount: 'fence' } });
  let disposed = 0;
  model.group.traverse((o) => {
    if (o.geometry) o.geometry.addEventListener('dispose', () => disposed++);
  });
  disposeTree(model.group);
  assert.ok(disposed >= 5);
  // shared materials are left alone for the next model
  assert.ok(mats.get('aluminum').userData.shared);
});

// Placeholder numbers (TODO_SPEC) live in print-specs.json; the models must follow that data, not constants.
function withSpecs(edit) {
  const copy = JSON.parse(JSON.stringify(specs));
  edit(copy.products);
  return copy;
}

function makeWith(edited, product, choices, extra = {}) {
  const spec = specFor(edited, product, choices);
  return { spec, model: BUILD[product]({ spec, choices, specs: edited, mats, base: new THREE.Color('#f2efe6'), anisotropy: 4, reduced: true, options: { mount: 'fence' }, ...extra }) };
}

test('canopy follows a changed valance line and roof polygon', () => {
  const edited = withSpecs((p) => {
    const v = p.canopy.variants['*'];
    v.valance_line.y = 70;
    v.roof.apex_x = 59.5;
  });
  const { spec, model } = makeWith(edited, 'canopy', { package: 'valance' });
  assert.equal(spec.valanceLine, 70);
  const p = model.pickables[0].geometry.attributes.position;
  let apex = 0;
  let eave = Infinity;
  let bottom = Infinity;
  for (let i = 0; i < p.count; i++) {
    apex = Math.max(apex, p.getY(i));
    bottom = Math.min(bottom, p.getY(i));
    if (Math.abs(p.getY(i) - 84) < 1e-3) eave = 84;
  }
  const rise = Math.sqrt(70 ** 2 - 59.5 ** 2);
  assert.ok(Math.abs(apex - (84 + rise)) < 1e-3, `apex ${apex}`);
  assert.equal(eave, 84);
  assert.ok(Math.abs(bottom - (84 - (84.28 - 70))) < 1e-3, `valance bottom ${bottom}`);
});

test('feather follows a changed outline and sleeve width', () => {
  const edited = withSpecs((p) => {
    p.feather.outline_shapes.feather.points = [[0, 0], [1, 0.5], [0, 1]];
    p.feather.variants['14'].pole_sleeve_in.value = 6;
  });
  const { spec, model } = makeWith(edited, 'feather', { height: '14', base: 'spike' });
  const { w, h } = spec.artboard;
  const flag = model.pickables[0].geometry.attributes.position;
  let maxX = 0;
  let widest = 0;
  for (let i = 0; i < flag.count; i++) {
    maxX = Math.max(maxX, flag.getX(i));
    if (Math.abs(flag.getY(i) + h / 2) < h / 40) widest = Math.max(widest, flag.getX(i));
  }
  assert.ok(Math.abs(maxX - w) < 1.2, 'the triangle reaches the right edge at mid height');
  assert.ok(widest > w * 0.9);
  const sleeve = model.group.children.find((c) => c.geometry && c.geometry.type === 'CylinderGeometry' && c.geometry.parameters.openEnded);
  assert.ok(sleeve.geometry.parameters.radiusTop > 1, 'a 6 in sleeve is a fatter tube than the 2.5 in one');
});

test('banner grommets follow the spec spacing', () => {
  const edited = withSpecs((p) => {
    Object.values(p.banner.variants).forEach((v) => { v.grommets.every_in = 12; });
  });
  const { spec, model } = makeWith(edited, 'banner', { size: '4x8' });
  const want = G.grommetPoints(spec.artboard.w, spec.artboard.h, 12, 1.1).length;
  const inst = [];
  model.group.traverse((o) => o.isInstancedMesh && inst.push(o.count));
  assert.ok(inst.includes(want) && want > 12, `${want} grommets, instanced meshes ${inst}`);
});

test('throw follows the table height and hem from the spec', () => {
  const edited = withSpecs((p) => {
    p.throw.table.height_in = 36;
    p.throw.table.hem_above_floor_in = 3;
    Object.values(p.throw.variants).forEach((v) => { v.artboard.h = 33; });
  });
  const { model } = makeWith(edited, 'throw', { length: '6', style: '4' });
  const pos = model.pickables[0].geometry.attributes.position;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    lo = Math.min(lo, pos.getY(i));
    hi = Math.max(hi, pos.getY(i));
  }
  assert.ok(Math.abs(lo - 3) < 1e-6 && Math.abs(hi - 36) < 1e-6, `${lo}..${hi}`);
  assert.ok(model.box.max[1] >= 36);
});
