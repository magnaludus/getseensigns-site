// Canvas backend for the display list. Used for 3D textures and PNG previews. Mirrors render/svg.js:
// same baselines, same stroke order, same frame look.
import { gradientLine, frameStyle } from './displaylist.js';

const DEG = Math.PI / 180;
let letterSpacingOk = null;

function hasLetterSpacing(ctx) {
  if (letterSpacingOk == null) letterSpacingOk = 'letterSpacing' in ctx;
  return letterSpacingOk;
}

function drawLine(ctx, it, line, stroke) {
  const spaced = it.ls && !hasLetterSpacing(ctx);
  if (spaced) {
    let x = line.x;
    for (const ch of line.t) {
      if (stroke) ctx.strokeText(ch, x, line.y);
      ctx.fillText(ch, x, line.y);
      x += ctx.measureText(ch).width + it.ls;
    }
    return;
  }
  if (stroke) ctx.strokeText(line.t, line.x, line.y);
  ctx.fillText(line.t, line.x, line.y);
}

function drawItem(ctx, it, assets) {
  ctx.save();
  ctx.globalAlpha = it.opacity;
  ctx.translate(it.x, it.y);
  if (it.rot) {
    ctx.translate(it.w / 2, it.h / 2);
    ctx.rotate(it.rot * DEG);
    ctx.translate(-it.w / 2, -it.h / 2);
  }
  if (it.k === 'text') {
    ctx.font = `${it.weight} ${it.size}px "${it.family}"`;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    if (hasLetterSpacing(ctx)) ctx.letterSpacing = it.ls + 'px';
    ctx.fillStyle = it.fill;
    if (it.stroke) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = it.stroke.w;
      ctx.strokeStyle = it.stroke.color;
    }
    for (const line of it.lines) drawLine(ctx, it, line, it.stroke);
  } else if (it.k === 'path') {
    const p = new Path2D(it.d);
    ctx.fillStyle = it.fill;
    ctx.fill(p);
    if (it.stroke) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = it.stroke.w;
      ctx.strokeStyle = it.stroke.color;
      ctx.stroke(p);
    }
  } else if (it.k === 'image') {
    const asset = assets && assets.get(it.logoId);
    if (asset && asset.img) ctx.drawImage(asset.img, 0, 0, it.w, it.h);
  } else if (it.k === 'frame') {
    const f = frameStyle(it.w, it.h);
    const box = new Path2D();
    box.roundRect(0, 0, it.w, it.h, f.r);
    ctx.fillStyle = 'rgba(255,255,255,.16)';
    ctx.fill(box);
    ctx.setLineDash([f.dash, f.gap]);
    ctx.lineWidth = f.sw * 1.9;
    ctx.strokeStyle = 'rgba(20,22,26,.55)';
    ctx.stroke(box);
    ctx.lineWidth = f.sw;
    ctx.strokeStyle = '#fff';
    ctx.stroke(box);
    ctx.setLineDash([]);
    ctx.font = `900 ${f.fs}px "Barlow Condensed"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    if (hasLetterSpacing(ctx)) ctx.letterSpacing = '0px';
    ctx.lineJoin = 'round';
    ctx.lineWidth = f.fs * 0.12;
    ctx.strokeStyle = 'rgba(20,22,26,.6)';
    ctx.fillStyle = '#fff';
    ctx.strokeText(it.label.toUpperCase(), it.w / 2, it.h / 2 + f.fs * 0.35);
    ctx.fillText(it.label.toUpperCase(), it.w / 2, it.h / 2 + f.fs * 0.35);
  }
  ctx.restore();
}

// Draw `display` so that its area fills the canvas. scale = pixels per inch.
export function drawDisplay(ctx, display, scale, assets) {
  const a = display.area;
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, -a.x * scale, -a.y * scale);
  if (display.bg.type === 'gradient') {
    const g = gradientLine(a, display.bg.angle);
    const grad = ctx.createLinearGradient(g.x1, g.y1, g.x2, g.y2);
    grad.addColorStop(0, display.bg.from);
    grad.addColorStop(1, display.bg.to);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = display.bg.color;
  }
  ctx.fillRect(a.x, a.y, a.w, a.h);
  for (const it of display.items) drawItem(ctx, it, assets);
  ctx.restore();
}

// A canvas holding the whole artboard, at most `maxPx` on its long edge.
export function renderToCanvas(display, maxPx, assets, existing) {
  const a = display.area;
  const scale = maxPx / Math.max(a.w, a.h);
  const w = Math.max(1, Math.round(a.w * scale));
  const h = Math.max(1, Math.round(a.h * scale));
  const canvas = existing && existing.width === w && existing.height === h ? existing : Object.assign(existing || document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  drawDisplay(ctx, display, w / a.w, assets);
  return canvas;
}
