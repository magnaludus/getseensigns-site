// Shared materials and the procedural image-based lighting. Models call mats.get(name).
import {
  MeshStandardMaterial, MeshBasicMaterial, Scene, Mesh, SphereGeometry, PlaneGeometry, Color, BackSide, DoubleSide,
  Float32BufferAttribute, PMREMGenerator,
} from 'three';

const DEFS = {
  aluminum: { color: 0xd5dae0, metalness: 0.92, roughness: 0.34 },
  steel: { color: 0x4a4f57, metalness: 0.78, roughness: 0.46 },
  galvanized: { color: 0xbcc1c7, metalness: 0.85, roughness: 0.42 },
  rubber: { color: 0x17181b, roughness: 0.85 },
  pole: { color: 0x2a2d32, metalness: 0.3, roughness: 0.42 },
  brass: { color: 0xcaa24a, metalness: 0.9, roughness: 0.32 },
  zip: { color: 0x1c1d20, roughness: 0.6 },
  hole: { color: 0x0e0e10, roughness: 1 },
  plaster: { color: 0xece9e2, roughness: 0.95 },
  tabletop: { color: 0xd8d4cb, roughness: 0.6 },
  wire: { color: 0x9aa0a8, metalness: 0.9, roughness: 0.38 },
};

export function createMaterials() {
  const cache = {};
  return {
    get(name) {
      if (!cache[name]) {
        const m = new MeshStandardMaterial(DEFS[name]);
        m.userData.shared = true;
        cache[name] = m;
      }
      return cache[name];
    },
    dispose() {
      Object.keys(cache).forEach((k) => cache[k].dispose());
    },
  };
}

// Fabric, plastic and vinyl are per model because their color follows the base color.
export function surface(kind, color) {
  const d = {
    fabric: { roughness: 0.9, metalness: 0 },
    plastic: { roughness: 0.42, metalness: 0 },
    vinyl: { roughness: 0.52, metalness: 0 },
  }[kind];
  return new MeshStandardMaterial({ color, ...d });
}

const SKIES = {
  studio: { top: '#f4f7fb', mid: '#e7ebf0', bottom: '#b9bec6' },
  outdoor: { top: '#6fa6e0', mid: '#d6e6f5', bottom: '#7d8a63' },
};

function domeColors(geo, sky) {
  const top = new Color(sky.top);
  const mid = new Color(sky.mid);
  const bottom = new Color(sky.bottom);
  const p = geo.attributes.position;
  const c = [];
  const tmp = new Color();
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / 50;
    if (t >= 0) tmp.copy(mid).lerp(top, Math.pow(t, 0.7));
    else tmp.copy(mid).lerp(bottom, Math.pow(-t, 0.6));
    c.push(tmp.r, tmp.g, tmp.b);
  }
  geo.setAttribute('color', new Float32BufferAttribute(c, 3));
}

// A small gradient world, pre-filtered once. Returns { texture, dispose }; texture is null if the GPU cannot filter it.
export function buildEnvironment(renderer, kind) {
  const scene = new Scene();
  const dome = new SphereGeometry(50, 24, 16);
  domeColors(dome, SKIES[kind] || SKIES.studio);
  scene.add(new Mesh(dome, new MeshBasicMaterial({ vertexColors: true, side: BackSide })));
  const panels = [];
  const add = (w, h, x, y, z, v) => {
    const g = new PlaneGeometry(w, h);
    const m = new MeshBasicMaterial({ color: new Color(v, v, v), side: DoubleSide });
    const mesh = new Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
    panels.push(mesh);
  };
  if (kind === 'outdoor') {
    add(26, 26, -30, 30, 22, 7);
  } else {
    add(34, 16, -28, 26, 30, 5);
    add(10, 36, 34, 10, 14, 3.2);
    add(40, 10, 0, 40, -10, 2.6);
  }
  let rt = null;
  try {
    const pmrem = new PMREMGenerator(renderer);
    rt = pmrem.fromScene(scene, 0.03, 0.1, 100);
    pmrem.dispose();
  } catch {
    rt = null;
  }
  scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  return { texture: rt ? rt.texture : null, dispose: () => rt && rt.dispose() };
}
