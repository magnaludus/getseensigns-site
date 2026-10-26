// Canvas generators for every procedural texture. No Three.js here: each function returns a canvas.
import { mulberry } from './geom.js';

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function wrapped(ctx, size, x, y, r, draw) {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const px = x + dx * size;
      const py = y + dy * size;
      if (px + r >= 0 && px - r <= size && py + r >= 0 && py - r <= size) draw(px, py);
    }
  }
}

function blob(ctx, x, y, r, color, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color.replace('A', alpha));
  g.addColorStop(1, color.replace('A', 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

// Tileable lawn: mottled patches, faint mowing stripes, fine blades.
export function grassCanvas(size = 512, seed = 7) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const rnd = mulberry(seed);
  ctx.fillStyle = '#527d34';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 46; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 40 + rnd() * 90;
    const lit = rnd() > 0.5;
    wrapped(ctx, size, x, y, r, (px, py) => blob(ctx, px, py, r, lit ? 'rgba(135,175,70,A)' : 'rgba(34,70,30,A)', 0.24));
  }
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  for (let i = 0; i < 4; i++) ctx.fillRect(i * (size / 4), 0, size / 8, size);
  for (let i = 0; i < 4200; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const len = 2.5 + rnd() * 6;
    const a = -1.57 + (rnd() - 0.5) * 0.9;
    const h = 85 + rnd() * 50;
    ctx.strokeStyle = 'hsla(' + h + ',42%,' + (20 + rnd() * 26) + '%,0.4)';
    ctx.lineWidth = 1 + rnd() * 0.8;
    wrapped(ctx, size, x, y, len, (px, py) => {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
      ctx.stroke();
    });
  }
  return c;
}

// One concrete slab per tile with a joint along the left and top edges.
export function concreteCanvas(size = 512, seed = 3) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const rnd = mulberry(seed);
  ctx.fillStyle = '#bcbab4';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 26; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 50 + rnd() * 110;
    wrapped(ctx, size, x, y, r, (px, py) => blob(ctx, px, py, r, rnd() > 0.5 ? 'rgba(255,255,255,A)' : 'rgba(90,88,82,A)', 0.08));
  }
  for (let i = 0; i < 3000; i++) {
    const v = rnd() > 0.5 ? 255 : 60;
    ctx.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.07)';
    ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
  }
  ctx.fillStyle = 'rgba(60,58,54,0.8)';
  ctx.fillRect(0, 0, 5, size);
  ctx.fillRect(0, 0, size, 5);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(5, 0, 2, size);
  ctx.fillRect(0, 5, size, 2);
  return c;
}

export function asphaltCanvas(size = 512, seed = 11) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const rnd = mulberry(seed);
  ctx.fillStyle = '#44464a';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 18; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 60 + rnd() * 120;
    wrapped(ctx, size, x, y, r, (px, py) => blob(ctx, px, py, r, rnd() > 0.5 ? 'rgba(120,120,125,A)' : 'rgba(20,20,22,A)', 0.2));
  }
  for (let i = 0; i < 4500; i++) {
    const v = 20 + rnd() * 200;
    ctx.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.22)';
    ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 1.4, 1 + rnd() * 1.4);
  }
  return c;
}

// Sky for a dome: zenith at the top edge, horizon haze at mid height, soft clouds in the upper half.
export function skyCanvas(w, h, stops, seed = 5) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const rnd = mulberry(seed);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, stops.zenith);
  g.addColorStop(0.28, stops.mid);
  g.addColorStop(0.5, stops.horizon);
  g.addColorStop(1, stops.horizon);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  if (stops.clouds) {
    for (let i = 0; i < 26; i++) {
      const x = rnd() * w;
      const y = h * (0.2 + rnd() * 0.24);
      const r = 40 + rnd() * 90;
      for (let k = 0; k < 5; k++) {
        const ox = (rnd() - 0.5) * r * 1.4;
        const oy = (rnd() - 0.5) * r * 0.25;
        const rr = r * (0.5 + rnd() * 0.5);
        [-w, 0, w].forEach((dx) => {
          ctx.save();
          ctx.translate(x + ox + dx, y + oy);
          ctx.scale(1, 0.38);
          blob(ctx, 0, 0, rr, 'rgba(255,255,255,A)', 0.34);
          ctx.restore();
        });
      }
    }
  }
  return c;
}

function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Soft contact shadow: black with alpha, long edge 256 px. kind 'rect' or 'oval'.
export function contactCanvas(aspect, kind) {
  const W = aspect >= 1 ? 256 : Math.max(32, Math.round(256 * aspect));
  const H = aspect >= 1 ? Math.max(32, Math.round(256 / aspect)) : 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const pad = Math.min(W, H) * 0.22;
  if (kind === 'oval') {
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(W / 2, H / 2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(0,0,0,0.9)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.5)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = pad * 0.85;
    ctx.shadowOffsetX = 5000;
    ctx.fillStyle = '#000';
    roundRectPath(ctx, pad - 5000, pad, W - 2 * pad, H - 2 * pad, pad * 0.5);
    ctx.fill();
  }
  return c;
}

// Chain link: transparent canvas with two families of diagonal wires, 2 diamonds across.
export function chainLinkCanvas(size = 256) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const step = size / 2;
  ctx.lineCap = 'round';
  const draw = (color, width) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    for (let k = -3; k <= 3; k++) {
      for (const s of [1, -1]) {
        ctx.beginPath();
        const o = k * step;
        if (s === 1) {
          ctx.moveTo(o, 0);
          ctx.lineTo(o + size, size);
        } else {
          ctx.moveTo(o, size);
          ctx.lineTo(o + size, 0);
        }
        ctx.stroke();
      }
    }
  };
  draw('rgba(70,74,80,1)', 9);
  draw('rgba(206,211,216,1)', 5);
  return c;
}

// Cross section of corrugated plastic: skins and webs bright, hollows shaded. Tiles along x.
export function fluteCanvas() {
  const c = canvas(64, 32);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 64, 32);
  const g = ctx.createLinearGradient(0, 5, 0, 27);
  g.addColorStop(0, '#9aa0a8');
  g.addColorStop(1, '#6d737b');
  ctx.fillStyle = g;
  ctx.fillRect(9, 5, 55, 22);
  return c;
}

export function awningCanvas(a = '#2f5d8a', b = '#f1ede4') {
  const c = canvas(256, 64);
  const ctx = c.getContext('2d');
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? b : a;
    ctx.fillRect(i * 32, 0, 32, 64);
  }
  return c;
}

export function radialCanvas(size, inner, outer) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

