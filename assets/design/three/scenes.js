// Procedural backdrops: studio sweep, front yard, strip-mall storefront. All geometry and textures are
// generated here. Each builder returns { group, bg, fog, haze, env, light, ground, dispose }.
import {
  Group, Mesh, BufferGeometry, Float32BufferAttribute, PlaneGeometry, BoxGeometry, CylinderGeometry, SphereGeometry,
  ShapeGeometry, Shape, Vector2, MeshStandardMaterial, MeshBasicMaterial, CanvasTexture, Color, Fog, RepeatWrapping,
  SRGBColorSpace, BackSide, DoubleSide,
} from 'three';
import { smooth, mulberry, rad } from './geom.js';
import { merge, xf, disposeTree } from './build.js';
import { grassCanvas, concreteCanvas, asphaltCanvas, skyCanvas, awningCanvas } from './procedural.js';

const col = (hex) => new Color(hex);

function tex(canvas, aniso, rx, ry) {
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  if (rx) t.repeat.set(rx, ry);
  t.anisotropy = aniso;
  return t;
}

const part = (g, m, c) => ({ g, m, c: col(c) });
const slab = (w, h, d, x, y, z, c, ry = 0) => part(new BoxGeometry(w, h, d), xf(x, y, z, 0, ry, 0), c);

function skyDome(textures, stops) {
  const t = new CanvasTexture(skyCanvas(1024, 512, stops));
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 1;
  textures.push(t);
  const m = new Mesh(new SphereGeometry(9000, 32, 20), new MeshBasicMaterial({ map: t, side: BackSide, fog: false, depthWrite: false }));
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}

// ---- studio

// A round cyclorama: floor, a soft fillet and a wall all the way around, so every angle looks seamless.
function coveGeometry(base) {
  const prof = [];
  for (let r = 0; r < 1700; r += 100) prof.push([r, 0, 0, 1]);
  const R = 480;
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * (Math.PI / 2);
    prof.push([1700 + R * Math.sin(a), R - R * Math.cos(a), -Math.sin(a), Math.cos(a)]);
  }
  for (let y = R + 250; y <= 3300; y += 250) prof.push([1700 + R, y, -1, 0]);
  const nph = 64;
  const pos = [];
  const nor = [];
  const colr = [];
  const idx = [];
  const c0 = col(base);
  prof.forEach(([r, y, nr, ny]) => {
    const v = y > 0 || r >= 1700 ? 0.86 - 0.3 * smooth(0, 3200, y) : 1 - 0.28 * smooth(300, 1700, r);
    for (let i = 0; i <= nph; i++) {
      const ph = (i / nph) * Math.PI * 2;
      const cx = Math.cos(ph);
      const sz = Math.sin(ph);
      pos.push(r * cx, y, r * sz);
      nor.push(nr * cx, ny, nr * sz);
      colr.push(c0.r * v, c0.g * v, c0.b * v);
    }
  });
  for (let j = 0; j < prof.length - 1; j++) {
    for (let i = 0; i < nph; i++) {
      const a = j * (nph + 1) + i;
      idx.push(a, a + 1, a + nph + 1, a + 1, a + nph + 2, a + nph + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new Float32BufferAttribute(colr, 3));
  g.setIndex(idx);
  return g;
}

function studio() {
  const group = new Group();
  const cove = new Mesh(coveGeometry('#e1e4e9'), new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: DoubleSide }));
  cove.receiveShadow = true;
  group.add(cove);
  return {
    group,
    bg: col('#b9bec6'),
    fog: null,
    haze: col('#d2d6dc'),
    env: 'studio',
    light: { key: { color: 0xfff3e4, intensity: 2.4, dir: [-0.3, 0.7, 0.9] }, hemi: { sky: 0xf4f7ff, ground: 0xcdd0d6, intensity: 0.7 }, env: 0.4 },
    ground: cove,
    textures: [],
  };
}

// ---- yard

// Gable roof with its ridge along X, centered at (cx, cz), plus the two gable end walls.
function gablePieces(cx, cz, W, D, y0, rise, over, roof, wall) {
  const ang = Math.atan2(rise, D / 2 + over);
  const slant = Math.hypot(D / 2 + over, rise);
  const parts = [];
  [1, -1].forEach((s) => {
    parts.push(part(new BoxGeometry(W + over * 2, 3.2, slant), xf(cx, y0 + rise / 2 + 1.2, cz + (s * (D / 2 + over)) / 2, s * ang, 0, 0), roof));
  });
  const tri = new Shape([new Vector2(-D / 2, 0), new Vector2(D / 2, 0), new Vector2(0, rise)]);
  [W / 2, -W / 2].forEach((x) => parts.push(part(new ShapeGeometry(tri), xf(cx + x, y0, cz, 0, Math.PI / 2, 0), wall)));
  return parts;
}

function windowParts(x, y, z, w, h, frame, shutter) {
  const frames = [
    slab(w + 6, 3, 2.5, x, y + h / 2 + 1.5, z, frame),
    slab(w + 6, 3, 2.5, x, y - h / 2 - 1.5, z, frame),
    slab(3, h, 2.5, x - w / 2 - 1.5, y, z, frame),
    slab(3, h, 2.5, x + w / 2 + 1.5, y, z, frame),
    slab(w, 2, 2.2, x, y, z, frame),
    slab(2, h, 2.2, x, y, z, frame),
  ];
  if (shutter) {
    frames.push(slab(11, h + 6, 2, x - w / 2 - 9, y, z, shutter), slab(11, h + 6, 2, x + w / 2 + 9, y, z, shutter));
  }
  return { frames, glass: new BoxGeometry(w, h, 1).translate(x, y, z - 0.4) };
}

function yard(ctx) {
  const group = new Group();
  const textures = [];
  const aniso = ctx.anisotropy;
  group.add(skyDome(textures, { zenith: '#5d9ae0', mid: '#a9cdf0', horizon: '#e4eef6', clouds: true }));

  const grass = tex(grassCanvas(512), aniso, 70, 70);
  textures.push(grass);
  const ground = new Mesh(new PlaneGeometry(14000, 14000), new MeshStandardMaterial({ map: grass, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const conc = tex(concreteCanvas(512), aniso, 0.8, 21);
  textures.push(conc);
  const concMat = new MeshStandardMaterial({ map: conc, roughness: 0.95 });
  const walk = new Mesh(new BoxGeometry(48, 1.4, 1260).translate(150, 0.7, -130), concMat);
  walk.receiveShadow = true;
  const conc2 = tex(concreteCanvas(512, 9), aniso, 50, 1);
  textures.push(conc2);
  const street = new Mesh(new BoxGeometry(6000, 1.4, 60).translate(0, 0.7, 380), new MeshStandardMaterial({ map: conc2, roughness: 0.95 }));
  street.receiveShadow = true;
  const asp = tex(asphaltCanvas(256), aniso, 40, 3);
  textures.push(asp);
  const road = new Mesh(new BoxGeometry(6000, 0.6, 300).translate(0, 0.3, 600), new MeshStandardMaterial({ map: asp, roughness: 1 }));
  road.receiveShadow = true;
  group.add(walk, street, road);

  // house
  const hz = -1180;
  const hp = [];
  const wall = '#cdbb9a';
  const trim = '#f1ede4';
  hp.push(slab(640, 126, 300, 40, 63, hz, wall));
  hp.push(slab(260, 108, 250, -400, 54, hz + 20, '#c4b190'));
  hp.push(...gablePieces(40, hz, 640, 300, 126, 96, 14, '#5b4b44', wall));
  hp.push(...gablePieces(-400, hz + 20, 260, 250, 108, 60, 12, '#5b4b44', '#c4b190'));
  hp.push(slab(34, 26, 34, 200, 190, hz - 30, '#8e5e4c'));
  hp.push(slab(190, 5, 42, 150, 3, hz + 150 + 16, '#bdb8ae'));
  hp.push(slab(38, 82, 3, 150, 41, hz + 151, '#2d5b62'));
  hp.push(slab(46, 90, 2, 150, 45, hz + 150, trim));
  hp.push(slab(120, 4, 36, 150, 100, hz + 168, trim));
  [[-1, 1], [1, 1]].forEach(([s]) => hp.push(slab(5, 98, 5, 150 + s * 56, 49, hz + 180, trim)));
  hp.push(slab(180, 76, 2, -400, 38, hz + 146, '#e9e6df'));
  const glass = [];
  [[-80, 66], [-10, 66], [95, 66], [225, 66], [310, 66]].forEach(([x, y]) => {
    const w = windowParts(x, y, hz + 151, 38, 54, trim, '#3f5b6b');
    hp.push(...w.frames);
    glass.push(w.glass);
  });
  const house = new Mesh(merge(hp), new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, side: DoubleSide }));
  house.castShadow = false;
  const glassMesh = new Mesh(merge(glass.map((g) => ({ g }))), new MeshStandardMaterial({ color: 0x7e9db8, roughness: 0.12, metalness: 0.65 }));
  group.add(house, glassMesh);

  // trees and shrubs
  const rnd = mulberry(21);
  const trunks = [];
  const leaves = [];
  const trees = [[-420, -640, 1.0], [560, -560, 1.15], [-760, -980, 1.3], [820, -1050, 1.0], [-120, -1650, 1.5], [1180, -820, 1.2], [-1180, -700, 1.1]];
  trees.forEach(([x, z, s]) => {
    const h = 110 * s;
    trunks.push(part(new CylinderGeometry(5 * s, 7 * s, h, 7), xf(x, h / 2, z), '#5a4332'));
    const greens = ['#4f7f3a', '#5f8f43', '#456f33', '#6a9a4a'];
    for (let i = 0; i < 4; i++) {
      const r = (46 + rnd() * 26) * s;
      leaves.push(part(new SphereGeometry(r, 7, 5), xf(x + (rnd() - 0.5) * 60 * s, h + 20 * s + rnd() * 50 * s, z + (rnd() - 0.5) * 60 * s), greens[i % 4]));
    }
  });
  [[-140, -1030], [-250, -1030], [330, -1030], [450, -1030], [-560, -1060], [-700, -1060]].forEach(([x, z], i) => {
    const r = 22 + rnd() * 10;
    leaves.push(part(new SphereGeometry(r, 7, 5), xf(x, r * 0.8, z, 0, 0, 0, 1.3, 0.9, 1), i % 2 ? '#4a7a38' : '#58883f'));
  });
  const foliageMat = new MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
  group.add(new Mesh(merge(trunks), new MeshStandardMaterial({ vertexColors: true, roughness: 1 })), new Mesh(merge(leaves), foliageMat));

  return {
    group,
    bg: col('#cfe0f0'),
    fog: { color: col('#dbe8f3'), near: 900, far: 7200 },
    haze: col('#dbe8f3'),
    env: 'outdoor',
    light: { key: { color: 0xffe2b8, intensity: 3.1, dir: [-0.6, 1, 0.55] }, hemi: { sky: 0xbfdcff, ground: 0x8f9c68, intensity: 1.2 }, env: 0.78 },
    ground,
    textures,
  };
}

// ---- storefront

function storefront(ctx) {
  const group = new Group();
  const textures = [];
  const aniso = ctx.anisotropy;
  group.add(skyDome(textures, { zenith: '#4f8fd9', mid: '#9cc4ee', horizon: '#dfeaf4', clouds: true }));

  const asp = tex(asphaltCanvas(256), aniso, 70, 70);
  textures.push(asp);
  const ground = new Mesh(new PlaneGeometry(14000, 14000), new MeshStandardMaterial({ map: asp, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const conc = tex(concreteCanvas(512), aniso, 1500 / 60, 360 / 60);
  textures.push(conc);
  const walkZ0 = -150;
  const walkZ1 = 210;
  const walk = new Mesh(new BoxGeometry(1500, 5, walkZ1 - walkZ0).translate(0, 2.5, (walkZ0 + walkZ1) / 2), new MeshStandardMaterial({ map: conc, roughness: 0.95 }));
  walk.receiveShadow = true;
  const curb = new Mesh(new BoxGeometry(3600, 6, 7).translate(0, 3, walkZ1 + 3.5), new MeshStandardMaterial({ color: 0xaaa9a3, roughness: 0.95 }));
  curb.receiveShadow = true;
  group.add(walk, curb);

  // painted stalls
  const lines = [];
  for (let i = -16; i <= 16; i++) lines.push(slab(4, 0.3, 120, i * 108, 0.4, walkZ1 + 100, '#f2f2ee'));
  lines.push(slab(3600, 0.3, 4, 0, 0.4, walkZ1 + 164, '#f2f2ee'));
  group.add(new Mesh(merge(lines), new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })));

  const wallZ = walkZ0 - 4;
  const wallH = 196;
  const wall = '#cbbfa8';
  const trim = '#3a342f';
  const fp = [];
  fp.push(slab(1500, wallH, 8, 0, wallH / 2 + 5, wallZ, wall));
  fp.push(slab(1500, 16, 14, 0, wallH + 12, wallZ - 2, '#e4ddcc'));
  fp.push(slab(1500, 13, 9, 0, 11.5, wallZ + 0.8, '#8c847a'));
  fp.push(slab(1500, 150, 300, 0, wallH / 2 + 5 + 40, wallZ - 154, '#bfb49d'));
  const glass = [];
  const bays = [-315, -105, 105, 315];
  bays.forEach((x, i) => {
    fp.push(slab(18, wallH - 10, 12, x - 98, wallH / 2 + 8, wallZ + 3, '#ddd3be'));
    if (i === 1) {
      fp.push(slab(50, 6, 4, x, 100, wallZ + 6, trim), slab(5, 92, 4, x - 24, 51, wallZ + 6, trim), slab(5, 92, 4, x + 24, 51, wallZ + 6, trim));
      fp.push(slab(3, 20, 3, x + 14, 52, wallZ + 9, '#b9b9bd'));
      glass.push(new BoxGeometry(44, 86, 1).translate(x, 52, wallZ + 3.6));
    } else {
      const w = windowParts(x, 78, wallZ + 6, 150, 100, trim);
      fp.push(...w.frames, slab(160, 6, 14, x, 24, wallZ + 7, '#a8a196'));
      glass.push(w.glass);
    }
  });
  group.add(new Mesh(merge(fp), new MeshStandardMaterial({ vertexColors: true, roughness: 0.93, side: DoubleSide })));
  group.add(new Mesh(merge(glass.map((g) => ({ g }))), new MeshStandardMaterial({ color: 0x8fb0c8, roughness: 0.06, metalness: 0.88 })));

  const aw = tex(awningCanvas(), aniso, 1, 1);
  aw.repeat.set(7, 1);
  textures.push(aw);
  const awMat = new MeshStandardMaterial({ map: aw, roughness: 0.9, side: DoubleSide });
  const awning = new Mesh(new PlaneGeometry(900, 50), awMat);
  awning.position.set(0, 142, wallZ + 6 + 18);
  awning.rotation.x = -rad(36);
  awning.castShadow = true;
  const valance = new Mesh(new PlaneGeometry(900, 11), awMat);
  valance.position.set(0, 118 - 1, wallZ + 6 + 36);
  valance.castShadow = true;
  group.add(awning, valance);
  const rods = [];
  for (let x = -440; x <= 440; x += 220) rods.push(part(new CylinderGeometry(0.7, 0.7, 40, 6), xf(x, 128, wallZ + 24, rad(54), 0, 0), '#2b2b2e'));
  group.add(new Mesh(merge(rods), new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.5 })));

  const pl = [];
  [-210, 210, 440].forEach((x) => {
    pl.push(slab(60, 26, 24, x, 18, wallZ + 24, '#6e5b4a'));
    pl.push(part(new SphereGeometry(20, 8, 6), xf(x, 42, wallZ + 24, 0, 0, 0, 1.3, 0.9, 1), '#4b7a3a'));
  });
  group.add(new Mesh(merge(pl), new MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true })));

  return {
    group,
    bg: col('#cfe0f0'),
    fog: { color: col('#dde8f1'), near: 1100, far: 7600 },
    haze: col('#dde8f1'),
    env: 'outdoor',
    light: { key: { color: 0xfff0d6, intensity: 3.0, dir: [-0.55, 1, 0.75] }, hemi: { sky: 0xcfe3ff, ground: 0xa9a59c, intensity: 1.15 }, env: 0.78 },
    ground,
    textures,
  };
}

export function buildScene(kind, ctx) {
  const s = kind === 'yard' ? yard(ctx) : kind === 'storefront' ? storefront(ctx) : studio(ctx);
  s.kind = kind;
  s.fogObject = s.fog ? new Fog(s.fog.color, s.fog.near, s.fog.far) : null;
  s.dispose = () => {
    disposeTree(s.group);
    s.textures.forEach((t) => t.dispose());
  };
  return s;
}

