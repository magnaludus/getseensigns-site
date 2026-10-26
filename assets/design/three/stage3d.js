// The lazy 3D stage: one WebGL canvas per designer, procedural products and backdrops, render on demand.
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, PlaneGeometry, MeshBasicMaterial, ShadowMaterial,
  HemisphereLight, DirectionalLight, CanvasTexture, TextureLoader, Color, Vector2, Vector3, Raycaster, SRGBColorSpace,
  NeutralToneMapping, PCFShadowMap, LinearFilter,
} from 'three';
import { specFor } from '../model/specs.js';
import { webglAvailable } from './support.js';
import {
  FOV, clamp, rad, capSize, coverTransform, distanceLimits, fitDistance, frameShift, insetView, cameraPosition, presetFor, sideAzimuth,
} from './geom.js';
import { createOrbit } from './orbit.js';
import { createMaterials, buildEnvironment } from './materials.js';
import { buildScene } from './scenes.js';
import { disposeTree, boxInfo } from './build.js';
import { canvas as makeCanvas, contactCanvas } from './procedural.js';
import { buildCanopy } from './models/canopy.js';
import { buildFeather } from './models/feather.js';
import { buildThrow } from './models/throw.js';
import { buildBanner } from './models/banner.js';
import { buildYard } from './models/yard.js';

const BUILDERS = { canopy: buildCanopy, feather: buildFeather, throw: buildThrow, banner: buildBanner, yard: buildYard };
const FIT_ELEVATION = 12;

function fail(reason, message) {
  const e = new Error(message);
  e.reason = reason;
  return e;
}

// Resolves to the stage, or rejects with an Error whose reason is 'webgl' (no WebGL 2) or 'init' (anything else).
export async function createStage3D(container, opts = {}) {
  try {
    return await build(container, opts);
  } catch (e) {
    throw e && e.reason ? e : fail('init', e && e.message ? e.message : 'Could not start the 3D stage');
  }
}

function build(container, opts) {
  const o = { maxTexture: 1024, reducedMotion: false, label: '3D preview', ...opts };
  if (!webglAvailable()) throw fail('webgl', 'WebGL is not available');

  const el = document.createElement('canvas');
  el.style.cssText = 'position:absolute;left:0;top:0;display:block;width:100%;height:100%;touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent';
  el.tabIndex = 0;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', o.label);
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas: el, antialias: true, alpha: false, preserveDrawingBuffer: true });
  } catch {
    throw fail('webgl', 'Could not create a WebGL context');
  }

  let disposed = false;
  let lost = false;
  let ready = false;
  let raf = 0;
  let last = 0;
  let lastSway = 0;
  let dirty = true;
  let shadowDirty = true;
  let onscreen = true;
  let fit = 0;
  let size = { w: 0, h: 0, dpr: 0 };

  let product = null;
  let choices = {};
  let modelKey = '';
  let options = { mount: 'fence' };
  let sceneId = 'studio';
  let model = null;
  let info = { half: { hx: 1, hy: 1, hz: 1 }, center: [0, 0, 0] };
  let backdrop = null;
  let contact = null;
  let plate = null;
  let plateToken = 0;
  let turntable = false;
  const envs = {};
  const art = [];
  const bySrc = new Map();
  const baseColor = new Color('#f2f2f2');
  const target = [0, 0, 0];
  let insetsSrc = o.insets || {};
  let insets = readInsets();
  let free = { fov: FOV, aspect: 1 };

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 4, 30000);
  const root = new Group();
  scene.add(root);
  const hemi = new HemisphereLight(0xffffff, 0x888888, 1);
  const key = new DirectionalLight(0xffffff, 2.5);
  key.castShadow = true;
  key.shadow.mapSize.set(o.maxTexture >= 2048 ? 2048 : 1024, o.maxTexture >= 2048 ? 2048 : 1024);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.35;
  scene.add(hemi, key, key.target);
  let keyDir = [-0.3, 0.7, 0.9];
  let keyAz = 0;
  let turnAz = NaN;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  let mats = createMaterials();
  let white = whiteTexture();
  const ray = new Raycaster();
  const ndc = new Vector2();

  function whiteTexture() {
    const c = makeCanvas(2, 2);
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 2, 2);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  }

  const canRun = () => onscreen && !document.hidden && !lost && !disposed;

  function requestRender() {
    dirty = true;
    if (!raf && canRun()) raf = requestAnimationFrame(frame);
  }

  const orbit = createOrbit(el, {
    reduced: () => o.reducedMotion,
    onChange: () => {
      if (turntable) shadowDirty = true;
      requestRender();
    },
    onDouble: (x, y) => {
      const hit = pick(x, y);
      if (hit && o.onPick) o.onPick(hit);
    },
  });

  // ---- camera

  function syncCamera() {
    const s = orbit.state;
    const az = turntable ? 0 : s.azimuth;
    root.rotation.y = turntable ? -rad(s.azimuth) : 0;
    const p = cameraPosition(target, { azimuth: az, elevation: s.elevation, distance: s.distance });
    camera.position.set(p[0], p[1], p[2]);
    camera.lookAt(target[0], target[1], target[2]);
    const near = clamp(s.distance * 0.04, 1, 60);
    if (camera.near !== near) {
      camera.near = near;
      camera.far = s.distance * 6 + 14000;
      camera.updateProjectionMatrix();
    }
    if (!turntable && model && Math.abs(s.azimuth - keyAz) > 0.05) aimKey();
    if (turntable && s.azimuth !== turnAz) {
      turnAz = s.azimuth;
      shadowDirty = true;
    }
    if (model && model.view) model.view(s.azimuth);
  }

  // Keeps the product clear of UI drawn over the canvas: fit it to the free area and shift the view into it.
  function applyView() {
    if (!size.w) return;
    const v = insetView(size.w, size.h, insets, FOV);
    free = v;
    if (v.offsetX || v.offsetY) camera.setViewOffset(size.w, size.h, v.offsetX, v.offsetY, size.w, size.h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }

  function refit() {
    if (!model) return;
    const ratio = fit ? orbit.state.distance / fit : 1;
    fit = fitDistance(info.half, free.fov, free.aspect, FIT_ELEVATION, 1.1);
    target[1] = info.center[1] + frameShift(info.half, free.fov, FIT_ELEVATION, fit);
    orbit.limits(distanceLimits(fit));
    orbit.set({ distance: fit * ratio });
  }

  // insets may be an object or a function, so the app can say how much of the canvas its controls cover right now
  function readInsets() {
    return { top: 0, right: 0, bottom: 0, left: 0, ...(typeof insetsSrc === 'function' ? insetsSrc() : insetsSrc) };
  }

  function resize() {
    if (disposed) return;
    const w = Math.max(1, Math.floor(container.clientWidth));
    const h = Math.max(1, Math.floor(container.clientHeight));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const next = readInsets();
    const moved = ['top', 'right', 'bottom', 'left'].some((k) => next[k] !== insets[k]);
    if (w === size.w && h === size.h && dpr === size.dpr && !moved) return;
    insets = next;
    size = { w, h, dpr };
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    applyView();
    refit();
    coverPlate();
    requestRender();
  }

  // ---- textures
  // Sides that get the same canvas share one texture. Uploads wait for the next draw, so a burst of
  // setSideTexture calls costs one upload per canvas.

  function texFor(i) {
    return art[i] ? art[i].tex : white;
  }

  function applyArt() {
    if (!model) return;
    model.art.forEach((list, i) => {
      const t = texFor(i);
      list.forEach((m) => {
        if (m.map !== t) {
          m.map = t;
          m.needsUpdate = true;
        }
      });
    });
  }

  function applyBase() {
    if (model) model.base.forEach((m) => m.color.copy(baseColor));
  }

  function newEntry(src, w, h) {
    const capped = w !== src.width || h !== src.height;
    const img = capped ? makeCanvas(w, h) : src;
    const tex = new CanvasTexture(img);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = aniso;
    return { src, img, tex, w, h, refs: 0, dirty: true };
  }

  function unref(e) {
    if (--e.refs > 0) return;
    e.tex.dispose();
    if (bySrc.get(e.src) === e) bySrc.delete(e.src);
  }

  function dropSide(i) {
    const old = art[i];
    if (!old) return false;
    art[i] = null;
    unref(old);
    return true;
  }

  function setSideTexture(index, src) {
    const i = index | 0;
    if (!src || !src.width || !src.height) {
      if (dropSide(i)) {
        applyArt();
        requestRender();
      }
      return;
    }
    const [w, h] = capSize(src.width, src.height, o.maxTexture);
    let e = bySrc.get(src);
    if (e && (e.w !== w || e.h !== h)) {
      const fresh = newEntry(src, w, h);
      art.forEach((a, k) => {
        if (a === e) {
          art[k] = fresh;
          fresh.refs++;
        }
      });
      e.tex.dispose();
      e = fresh;
      bySrc.set(src, e);
    } else if (!e) {
      e = newEntry(src, w, h);
      bySrc.set(src, e);
    }
    e.dirty = true;
    if (art[i] !== e) {
      const old = art[i];
      art[i] = e;
      e.refs++;
      if (old) unref(old);
    }
    applyArt();
    requestRender();
  }

  function flushTextures() {
    bySrc.forEach((e) => {
      if (!e.dirty) return;
      e.dirty = false;
      if (e.img !== e.src) {
        const g = e.img.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.clearRect(0, 0, e.w, e.h);
        g.drawImage(e.src, 0, 0, e.w, e.h);
      }
      e.tex.needsUpdate = true;
    });
  }

  // ---- lights, environment, backdrop

  function env(kind) {
    if (!envs[kind]) envs[kind] = buildEnvironment(renderer, kind);
    return envs[kind];
  }

  // The key light is fixed relative to the camera, so every side of the product is lit the same way.
  function aimKey() {
    const rad3 = Math.hypot(info.half.hx, info.half.hy, info.half.hz);
    const c = info.center;
    const d = keyDir;
    const a = turntable ? 0 : rad(orbit.state.azimuth);
    const x = d[0] * Math.cos(a) + d[2] * Math.sin(a);
    const z = -d[0] * Math.sin(a) + d[2] * Math.cos(a);
    const len = Math.hypot(d[0], d[1], d[2]);
    const dist = rad3 * 3 + 300;
    key.position.set(c[0] + (x / len) * dist, c[1] + (d[1] / len) * dist, c[2] + (z / len) * dist);
    key.target.position.set(c[0], c[1], c[2]);
    key.target.updateMatrixWorld();
    keyAz = orbit.state.azimuth;
    shadowDirty = true;
  }

  function placeKey() {
    const rad3 = Math.hypot(info.half.hx, info.half.hy, info.half.hz);
    const dist = rad3 * 3 + 300;
    aimKey();
    const s = rad3 * 1.18;
    // about 0.8 in of softness, but never so many texels that the 5 tap filter turns grainy
    key.shadow.radius = clamp((0.8 * key.shadow.mapSize.x) / (2 * s), 2, 8);
    const sc = key.shadow.camera;
    sc.left = -s;
    sc.right = s;
    sc.top = s;
    sc.bottom = -s;
    sc.near = Math.max(1, dist - rad3 * 1.5);
    sc.far = dist + rad3 * 4;
    sc.updateProjectionMatrix();
  }

  function lighting() {
    if (!backdrop) return;
    const L = backdrop.light;
    key.color.set(L.key.color);
    key.intensity = L.key.intensity;
    keyDir = L.key.dir;
    hemi.color.set(L.hemi.sky);
    hemi.groundColor.set(L.hemi.ground);
    hemi.intensity = L.hemi.intensity;
    scene.environment = env(backdrop.env).texture;
    scene.environmentIntensity = L.env;
    placeKey();
  }

  function setScene(id) {
    const meta = ((o.catalog && o.catalog.scenes) || []).find((s) => s.id === id);
    const kind = ['studio', 'yard', 'storefront'].includes(id) ? id : 'studio';
    if (backdrop && id === sceneId) return;
    sceneId = id;
    dropPlate();
    if (backdrop) {
      scene.remove(backdrop.group);
      backdrop.dispose();
    }
    backdrop = buildScene(kind, { anisotropy: aniso });
    scene.add(backdrop.group);
    scene.background = backdrop.bg;
    scene.fog = backdrop.fogObject;
    renderer.setClearColor(backdrop.bg);
    lighting();
    if (model && model.setHaze) model.setHaze(backdrop.haze);
    if (meta && meta.plate) loadPlate(meta.plate);
    requestRender();
  }

  function plateUrl(name) {
    const base = o.plateBase || new URL('../scenes/', import.meta.url).href;
    return base + name + '-' + (o.maxTexture >= 2048 ? 2048 : 1024) + '.webp';
  }

  function loadPlate(name) {
    const token = ++plateToken;
    new TextureLoader().load(
      plateUrl(name),
      (tex) => {
        if (token !== plateToken || disposed) {
          tex.dispose();
          return;
        }
        tex.colorSpace = SRGBColorSpace;
        tex.minFilter = LinearFilter;
        tex.generateMipmaps = false;
        const catcher = new Mesh(new PlaneGeometry(8000, 8000), new ShadowMaterial({ opacity: 0.4 }));
        catcher.rotation.x = -Math.PI / 2;
        catcher.receiveShadow = true;
        scene.add(catcher);
        backdrop.group.visible = false;
        scene.fog = null;
        scene.background = tex;
        plate = { tex, catcher };
        turntable = true;
        orbit.limits({ maxEl: 30 });
        coverPlate();
        shadowDirty = true;
        requestRender();
      },
      undefined,
      () => {}
    );
  }

  function coverPlate() {
    if (!plate || !plate.tex.image) return;
    const im = plate.tex.image;
    const t = coverTransform(im.width, im.height, size.w || 1, size.h || 1);
    plate.tex.repeat.set(t.repeat[0], t.repeat[1]);
    plate.tex.offset.set(t.offset[0], t.offset[1]);
  }

  function dropPlate() {
    plateToken++;
    if (!plate) return;
    scene.remove(plate.catcher);
    plate.catcher.geometry.dispose();
    plate.catcher.material.dispose();
    plate.tex.dispose();
    plate = null;
    turntable = false;
    orbit.limits({ maxEl: 80 });
    if (backdrop) {
      backdrop.group.visible = true;
      scene.background = backdrop.bg;
      scene.fog = backdrop.fogObject;
    }
  }

  // ---- model

  function disposeModel() {
    if (!model) return;
    if (contact) contact.material.map.dispose();
    root.remove(model.group);
    disposeTree(model.group);
    (model.own || []).forEach((t) => t.dispose());
    model = null;
    contact = null;
  }

  // Missing option groups fall back to the first choice in the catalog.
  function withDefaults(pid, ch) {
    const c = { ...(ch || {}) };
    const p = ((o.catalog && o.catalog.products) || []).find((x) => x.id === pid);
    ((p && p.groups) || []).forEach((g) => {
      if (c[g.id] == null && g.choices && g.choices.length) c[g.id] = g.choices[0].id;
    });
    return c;
  }

  function setProduct(pid, ch) {
    const c = withDefaults(pid, ch);
    const k = pid + '|' + JSON.stringify(Object.keys(c).sort().map((n) => [n, c[n]])) + '|' + options.mount;
    if (model && k === modelKey) return;
    const builder = BUILDERS[pid];
    if (!builder) throw new Error('Unknown product ' + pid);
    const spec = specFor(o.specs, pid, c);
    const next = builder({ spec, choices: c, options, specs: o.specs, mats, base: baseColor, anisotropy: aniso, reduced: o.reducedMotion, maxTexture: o.maxTexture });
    const changed = pid !== product;
    disposeModel();
    model = next;
    // sides the new model does not print (a smaller product, a one sided sign) give their texture back
    art.forEach((a, i) => {
      if (a && !(model.art[i] && model.art[i].length)) dropSide(i);
    });
    modelKey = k;
    product = pid;
    choices = { ...c };
    const f = model.footprint;
    const mesh = new Mesh(
      new PlaneGeometry(f.w, f.d),
      new MeshBasicMaterial({ map: contactTexture(f), transparent: true, depthWrite: false, opacity: f.opacity != null ? f.opacity : 0.32, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(f.x || 0, 0.06, f.z || 0);
    mesh.renderOrder = 2;
    model.group.add(mesh);
    contact = mesh;
    root.add(model.group);
    info = boxInfo(model.box);
    target[0] = info.center[0];
    target[1] = info.center[1];
    target[2] = info.center[2];
    applyArt();
    applyBase();
    if (model.setHaze && backdrop) model.setHaze(backdrop.haze);
    placeKey();
    if (changed) fit = 0;
    refit();
    if (changed) applyPreset('front', false);
    requestRender();
  }

  function contactTexture(f) {
    const t = new CanvasTexture(contactCanvas(f.w / f.d, f.kind));
    t.colorSpace = SRGBColorSpace;
    return t;
  }

  function applyPreset(name, animate) {
    if (!product) return;
    const p = presetFor(product, name);
    orbit.tweenTo({ azimuth: p.azimuth, elevation: p.elevation, distance: fit * p.zoom }, animate ? 520 : 0);
    requestRender();
  }

  // ---- picking

  function pick(clientX, clientY) {
    if (!model) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    syncCamera();
    camera.updateMatrixWorld();
    scene.updateMatrixWorld(true);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(model.pickables, false);
    for (const h of hits) {
      if (model.pickFilter && !model.pickFilter(h)) continue;
      return { sideIndex: h.object.userData.side, u: h.uv ? h.uv.x : null, v: h.uv ? h.uv.y : null };
    }
    return null;
  }

  // ---- loop

  function draw() {
    if (!model || lost || disposed || !size.w) return;
    syncCamera();
    flushTextures();
    if (shadowDirty) {
      renderer.shadowMap.needsUpdate = true;
      shadowDirty = false;
    }
    renderer.render(scene, camera);
    if (!ready) {
      ready = true;
      if (o.onReady) o.onReady();
    }
  }

  function frame(now) {
    raf = 0;
    if (!canRun()) return;
    const dt = Math.min(0.06, (now - last) / 1000 || 0.016);
    last = now;
    const moving = orbit.step(dt, now);
    let sway = false;
    let swayTick = false;
    if (model && model.update && !o.reducedMotion) {
      sway = true;
      if (now - lastSway >= 32) {
        lastSway = now;
        model.update(now / 1000);
        swayTick = true;
        shadowDirty = true;
      }
    }
    if (moving || dirty || swayTick) draw();
    dirty = false;
    if (moving || sway) raf = requestAnimationFrame(frame);
  }

  // ---- events

  const onLost = (e) => {
    e.preventDefault();
    lost = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (o.onContextLost) o.onContextLost();
  };
  // The GPU objects died with the context. Drop every Three.js object that owned one without disposing it
  // (a late dispose would delete handles that belong to the old context) and build the stage again.
  const onRestored = () => {
    lost = false;
    const was = { product, choices, scene: sceneId, srcs: art.map((a) => (a ? a.src : null)) };
    if (model) root.remove(model.group);
    if (backdrop) scene.remove(backdrop.group);
    if (plate) scene.remove(plate.catcher);
    model = backdrop = contact = plate = null;
    turntable = false;
    modelKey = '';
    plateToken++;
    Object.keys(envs).forEach((k) => delete envs[k]);
    art.length = 0;
    bySrc.clear();
    key.shadow.map = null;
    mats = createMaterials();
    white = whiteTexture();
    setScene(was.scene);
    if (was.product) setProduct(was.product, was.choices);
    was.srcs.forEach((src, i) => src && setSideTexture(i, src));
    shadowDirty = true;
    requestRender();
  };
  const onVisible = () => {
    if (!document.hidden) requestRender();
  };
  el.addEventListener('webglcontextlost', onLost);
  el.addEventListener('webglcontextrestored', onRestored);
  document.addEventListener('visibilitychange', onVisible);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  if (ro) ro.observe(container);
  const io = typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver((entries) => {
      onscreen = entries[entries.length - 1].isIntersecting;
      if (onscreen) requestRender();
    })
    : null;
  if (io) io.observe(container);

  try {
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.appendChild(el);
    setScene('studio');
    resize();
  } catch (e) {
    teardown();
    throw e;
  }

  function teardown() {
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    orbit.dispose();
    if (ro) ro.disconnect();
    if (io) io.disconnect();
    document.removeEventListener('visibilitychange', onVisible);
    el.removeEventListener('webglcontextlost', onLost);
    el.removeEventListener('webglcontextrestored', onRestored);
    dropPlate();
    disposeModel();
    if (backdrop) {
      scene.remove(backdrop.group);
      backdrop.dispose();
      backdrop = null;
    }
    bySrc.forEach((e) => e.tex.dispose());
    bySrc.clear();
    white.dispose();
    mats.dispose();
    Object.keys(envs).forEach((k) => envs[k].dispose());
    key.dispose();
    renderer.dispose();
    if (!lost) renderer.forceContextLoss();
    if (el.parentNode) el.parentNode.removeChild(el);
  }

  const stage = {
    setProduct(pid, ch) {
      if (!disposed) setProduct(pid, ch);
    },
    setSideTexture(index, src) {
      if (!disposed) setSideTexture(index, src);
    },
    setBaseColor(css) {
      if (disposed) return;
      baseColor.set(css);
      applyBase();
      requestRender();
    },
    setScene(id) {
      if (!disposed) setScene(id);
    },
    setCameraPreset(name, opt) {
      if (!disposed) applyPreset(name, !(opt && opt.animate === false));
    },
    focusSide(index, opt) {
      const az = sideAzimuth(product, index);
      if (az == null || disposed) return;
      orbit.tweenTo({ azimuth: az }, opt && opt.animate === false ? 0 : 520);
      requestRender();
    },
    getCameraState() {
      const s = orbit.state;
      return { azimuth: s.azimuth, elevation: s.elevation, distance: s.distance };
    },
    setCameraState(s) {
      if (disposed) return;
      orbit.set(s || {});
      requestRender();
    },
    setOptions(opt) {
      if (!disposed && opt && (opt.mount === 'fence' || opt.mount === 'wall') && opt.mount !== options.mount) {
        options = { ...options, mount: opt.mount };
        if (product === 'banner') setProduct(product, choices);
      }
    },
    setLabel(text) {
      el.setAttribute('aria-label', text);
    },
    // Optional: CSS pixels at the edges of the canvas that the app covers with its own controls
    // ({ top, right, bottom, left } or a function returning that). resize() reads a function again.
    setInsets(next) {
      if (disposed) return;
      insetsSrc = next || {};
      insets = readInsets();
      applyView();
      refit();
      requestRender();
    },
    resize,
    pick(x, y) {
      return disposed ? null : pick(x, y);
    },
    requestRender() {
      if (!disposed) requestRender();
    },
    renderNow() {
      if (disposed) return;
      resize();
      shadowDirty = true;
      draw();
    },
    getState() {
      const i = renderer.info;
      return {
        product,
        choices: { ...choices },
        scene: sceneId,
        camera: stage.getCameraState(),
        info: { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, frames: i.render.frame },
        textureSize: o.maxTexture,
        textures: art.map((a) => (a ? [a.w, a.h] : null)),
        mount: options.mount,
        plate: !!plate,
      };
    },
    screenshot() {
      stage.renderNow();
      return el;
    },
    get canvas() {
      return el;
    },
    // Test hooks, not part of the public contract.
    _key: () => key,
    _project(p) {
      syncCamera();
      camera.updateMatrixWorld();
      const v = new Vector3(p[0], p[1], p[2]).project(camera);
      return { x: ((v.x + 1) / 2) * size.w, y: ((1 - v.y) / 2) * size.h, depth: v.z };
    },
    dispose() {
      if (!disposed) teardown();
    },
  };
  return stage;
}
