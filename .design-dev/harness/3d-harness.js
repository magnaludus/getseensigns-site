// Builds labeled test art for every product and mounts the 3D stage.
// Query: product, choices (a:b,c:d), scene, preset, focus, az, el, dist, base, maxTexture, reduced=1, mount,
// plate=<name> (loads <name>-<size>.webp from /.design-dev/out/three/plates/), ppi, noart=1.
import { createStage3D } from '/assets/design/three/stage3d.js';
import { specFor } from '/assets/design/model/specs.js';

const q = new URLSearchParams(location.search);
const product = q.get('product') || 'canopy';
const choices = {};
(q.get('choices') || '').split(',').filter(Boolean).forEach((kv) => {
  const [k, v] = kv.split(':');
  choices[k] = v;
});
window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason && e.reason.message)));

const COLORS = {
  canopy: [['FRONT', '#d93a2f'], ['RIGHT', '#2563eb'], ['BACK', '#16a34a'], ['LEFT', '#e8a317']],
  yard: [['FRONT', '#1d4ed8'], ['BACK', '#ea580c']],
  default: [['FRONT', '#0f766e']],
};

function fitText(g, text, maxW, maxH, weight = '800') {
  let size = maxH;
  g.font = weight + ' ' + size + 'px "DejaVu Sans", Arial, sans-serif';
  const w = g.measureText(text).width;
  if (w > maxW) size = (size * maxW) / w;
  g.font = weight + ' ' + size + 'px "DejaVu Sans", Arial, sans-serif';
  return size;
}

function marker(g, x, y, s, text, up) {
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(x, up ? y : y + s);
  g.lineTo(x - s, up ? y + s * 1.6 : y - s * 0.6);
  g.lineTo(x + s, up ? y + s * 1.6 : y - s * 0.6);
  g.closePath();
  g.fill();
  g.fillStyle = '#111';
  fitText(g, text, s * 3.4, s * 0.8, '700');
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x, up ? y + s * 2.1 : y - s * 1.2);
}

function drawArt(spec, label, color, ppi) {
  const { w, h } = spec.artboard;
  const c = document.createElement('canvas');
  c.width = Math.round(w * ppi);
  c.height = Math.round(h * ppi);
  const g = c.getContext('2d');
  const k = ppi;
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, color);
  grad.addColorStop(1, color);
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  if (spec.valanceLine) {
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect(0, spec.valanceLine * k, c.width, c.height - spec.valanceLine * k);
  }
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = Math.max(1, k * 0.12);
  for (let x = 12; x < w; x += 12) {
    g.beginPath();
    g.moveTo(x * k, 0);
    g.lineTo(x * k, c.height);
    g.stroke();
  }
  for (let y = 12; y < h; y += 12) {
    g.beginPath();
    g.moveTo(0, y * k);
    g.lineTo(c.width, y * k);
    g.stroke();
  }
  if (spec.roof) {
    g.strokeStyle = '#ffffff';
    g.lineWidth = k * 0.6;
    g.beginPath();
    spec.roof.polygon.forEach(([x, y], i) => (i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k)));
    g.closePath();
    g.stroke();
  }
  if (spec.outline) {
    g.strokeStyle = '#ffffff';
    g.lineWidth = k * 0.5;
    g.beginPath();
    spec.outline.forEach(([x, y], i) => (i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k)));
    g.closePath();
    g.stroke();
  }
  g.strokeStyle = '#ffffff';
  g.lineWidth = k * 1.2;
  g.strokeRect(k * 0.6, k * 0.6, c.width - k * 1.2, c.height - k * 1.2);

  const tall = h > w * 1.6;
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const cx = c.width / 2;
  const roofH = spec.valanceLine ? spec.valanceLine * k : c.height;
  if (tall) {
    const word = label === 'FRONT' ? 'FLAG' : label;
    fitText(g, word, c.width * 0.6, c.width * 0.42);
    g.fillText(word, cx * 0.92, c.height * 0.3);
    fitText(g, 'R', c.width * 0.6, c.width * 0.9);
    g.fillText('R', cx * 1.1, c.height * 0.5);
    marker(g, cx, c.height * 0.035, c.width * 0.1, 'TOP', true);
    marker(g, cx, c.height * 0.985, c.width * 0.1, 'BOTTOM', false);
    g.fillStyle = '#ffffff';
    const ay = c.height * 0.72;
    g.fillRect(c.width * 0.15, ay - k * 0.9, c.width * 0.55, k * 1.8);
    g.beginPath();
    g.moveTo(c.width * 0.85, ay);
    g.lineTo(c.width * 0.66, ay - k * 3);
    g.lineTo(c.width * 0.66, ay + k * 3);
    g.fill();
  } else {
    const ty = spec.valanceLine ? roofH * 0.64 : c.height * 0.4;
    fitText(g, label, c.width * (spec.valanceLine ? 0.46 : 0.62), (spec.valanceLine ? roofH : c.height) * (spec.valanceLine ? 0.2 : 0.3));
    g.fillText(label, cx, ty);
    const ay = spec.valanceLine ? roofH * 0.84 : c.height * 0.68;
    g.fillRect(cx - c.width * 0.22, ay - k * 0.8, c.width * 0.36, k * 1.6);
    g.beginPath();
    g.moveTo(cx + c.width * 0.28, ay);
    g.lineTo(cx + c.width * 0.14, ay - k * 3.2);
    g.lineTo(cx + c.width * 0.14, ay + k * 3.2);
    g.fill();
    const s = Math.min(c.height, c.width) * (spec.valanceLine ? 0.03 : 0.05);
    marker(g, cx, spec.valanceLine ? roofH * 0.04 : c.height * 0.04, s, 'TOP', true);
    if (spec.valanceLine) {
      g.fillStyle = '#ffffff';
      fitText(g, 'VALANCE', c.width * 0.3, (c.height - roofH) * 0.6, '700');
      g.fillText('VALANCE', cx, roofH + (c.height - roofH) / 2);
      marker(g, c.width * 0.14, c.height * 0.985, s * 0.8, 'BOTTOM', false);
    } else {
      marker(g, cx, c.height * 0.985, s, 'BOTTOM', false);
    }
    g.textAlign = 'left';
    g.fillStyle = '#ffffff';
    fitText(g, 'R F', c.width * 0.12, c.height * 0.14, '800');
    g.fillText('R F', c.width * (spec.valanceLine ? 0.2 : 0.05), spec.valanceLine ? roofH * 0.93 : c.height * 0.12);
  }
  markers(g, spec, k);
  return c;
}

// Three small squares whose arrangement shows mirroring or flipping: A violet above B pink, C lime to the right.
function markers(g, spec, k) {
  const { w, h } = spec.artboard;
  const box = (color, x, y, bw, bh) => {
    g.fillStyle = color;
    g.fillRect(x * k, y * k, bw * k, bh * k);
  };
  if (spec.valanceLine) {
    const v = spec.valanceLine;
    box('#8000ff', 2, v + 0.8, 6, 2.7);
    box('#ff00a0', 2, v + 4.5, 6, 2.7);
    box('#c8ff00', w - 8, v + 0.8, 6, 6.4);
  } else {
    box('#8000ff', 2, 2, 3.5, 3.5);
    box('#ff00a0', 2, h - 5.5, 3.5, 3.5);
    box('#c8ff00', w * 0.3, h - 5.5, Math.min(6, w * 0.08), 3.5);
  }
}

function solidArt(spec, color, ppi) {
  const c = document.createElement('canvas');
  c.width = Math.round(spec.artboard.w * ppi);
  c.height = Math.round(spec.artboard.h * ppi);
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

const [specs, catalog] = await Promise.all([
  fetch('/assets/design/print-specs.json').then((r) => r.json()),
  fetch('/assets/design/catalog.json').then((r) => r.json()),
]);
const sceneId = q.get('scene') || 'studio';
const plate = q.get('plate');
if (plate) catalog.scenes.forEach((s) => { if (s.id === sceneId) s.plate = plate; });
if (q.get('plateFor')) catalog.scenes.forEach((s) => { if (s.id === q.get('plateFor')) s.plate = q.get('plateName') || 'test-plate'; });

const maxTexture = Number(q.get('maxTexture')) || 2048;
const container = document.getElementById('stage');
window.__ready = false;
window.__harness = { specs, catalog, specFor, drawArt };

function fullChoices(pid, ch) {
  const full = { ...ch };
  ((catalog.products.find((x) => x.id === pid) || {}).groups || []).forEach((g) => {
    if (full[g.id] == null) full[g.id] = g.choices[0].id;
  });
  return full;
}

// Sets the product and its test textures. Used by the page itself and by the e2e script.
window.__apply = (pid, ch = {}, o = {}) => {
  const stage = window.__stage;
  const full = fullChoices(pid, ch);
  const spec = specFor(specs, pid, full);
  const ppi = o.ppi || Number(q.get('ppi')) || Math.min(14, 2400 / Math.max(spec.artboard.w, spec.artboard.h));
  stage.setProduct(pid, ch);
  if (!o.noart) {
    const list = COLORS[pid] || COLORS.default;
    const n = pid === 'canopy' ? 4 : pid === 'yard' && full.print === '2' ? 2 : 1;
    for (let i = 0; i < 4; i++) {
      if (i >= n) {
        stage.setSideTexture(i, null);
        continue;
      }
      const a = o.solid ? solidArt(spec, o.solid, ppi) : drawArt(spec, list[i][0], list[i][1], ppi);
      window['__art' + i] = a;
      stage.setSideTexture(i, a);
    }
  }
  return spec;
};

createStage3D(container, {
  specs,
  catalog,
  maxTexture,
  reducedMotion: q.get('reduced') === '1',
  label: 'Test 3D preview',
  plateBase: '/.design-dev/out/three/plates/',
  onPick: (info) => { window.__picks = (window.__picks || []).concat([info]); },
  onContextLost: () => { window.__lost = (window.__lost || 0) + 1; },
  onReady: () => { window.__firstFrame = true; },
}).then((stage) => {
  window.__stage = stage;
  stage.setBaseColor(q.get('base') || '#f2efe6');
  if (q.get('mount')) stage.setOptions({ mount: q.get('mount') });
  stage.setScene(sceneId);
  window.__apply(product, choices, { noart: q.get('noart') === '1', solid: q.get('solid') });
  if (q.get('preset')) stage.setCameraPreset(q.get('preset'), { animate: false });
  if (q.get('focus')) stage.focusSide(Number(q.get('focus')), { animate: false });
  const cs = {};
  ['az:azimuth', 'el:elevation', 'dist:distance'].forEach((m) => {
    const [p, name] = m.split(':');
    if (q.get(p)) cs[name] = Number(q.get(p));
  });
  if (Object.keys(cs).length) stage.setCameraState(cs);
  stage.renderNow();
  window.__ready = true;
}).catch((e) => {
  window.__failure = { reason: e.reason, message: e.message };
  window.__ready = true;
});
