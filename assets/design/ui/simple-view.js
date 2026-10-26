// "Simple view": a flat front-on picture of the product with the customer's art on it, drawn with
// the 2D canvas. It is what the customer sees when 3D is not available. No photos, no WebGL.
import { sideDisplay } from '../render/displaylist.js';
import { renderToCanvas } from '../render/canvas.js';
import { specFor } from '../model/specs.js';
import { resolveColor } from '../model/color.js';

function backdrop(ctx, w, h, ground) {
  const sky = ctx.createLinearGradient(0, 0, 0, ground);
  sky.addColorStop(0, '#E4E7EA');
  sky.addColorStop(1, '#F6F5F1');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, ground);
  const floor = ctx.createLinearGradient(0, ground, 0, h);
  floor.addColorStop(0, '#CFCBC0');
  floor.addColorStop(1, '#E2DFD6');
  ctx.fillStyle = floor;
  ctx.fillRect(0, ground, w, h - ground);
}

function shadow(ctx, cx, y, rx) {
  ctx.save();
  ctx.fillStyle = 'rgba(20,22,26,.18)';
  ctx.beginPath();
  ctx.ellipse(cx, y, rx, rx * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function clipPolygon(ctx, pts, map) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    const p = map(x, y);
    if (i) ctx.lineTo(p[0], p[1]);
    else ctx.moveTo(p[0], p[1]);
  });
  ctx.closePath();
}

function drawCanopy(ctx, art, spec, box, base) {
  const eave = 84;
  const rise = Math.sqrt(Math.max(1, spec.valanceLine * spec.valanceLine - (spec.artboard.w / 2) ** 2));
  const totalH = eave + rise;
  const s = Math.min(box.w / (spec.artboard.w + 10), box.h / (totalH + 4));
  const w = spec.artboard.w * s;
  const x0 = box.x + (box.w - w) / 2;
  const ground = box.y + box.h;
  const eaveY = ground - eave * s;
  const val = spec.artboard.h - spec.valanceLine;
  ctx.fillStyle = '#8E9399';
  for (const lx of [x0 + 1.5 * s, x0 + w - 3.5 * s]) ctx.fillRect(lx, eaveY, 2 * s, eave * s);
  if (spec.valanceLine < spec.artboard.h) {
    ctx.drawImage(art, 0, (spec.valanceLine / spec.artboard.h) * art.height, art.width, (val / spec.artboard.h) * art.height, x0, eaveY, w, val * s);
  }
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x0, eaveY);
  ctx.lineTo(x0 + w / 2, eaveY - rise * s);
  ctx.lineTo(x0 + w, eaveY);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(art, 0, 0, art.width, (spec.valanceLine / spec.artboard.h) * art.height, x0, eaveY - rise * s, w, rise * s);
  ctx.restore();
  ctx.strokeStyle = 'rgba(20,22,26,.35)';
  ctx.lineWidth = Math.max(1, s * 0.5);
  ctx.beginPath();
  ctx.moveTo(x0, eaveY);
  ctx.lineTo(x0 + w / 2, eaveY - rise * s);
  ctx.lineTo(x0 + w, eaveY);
  ctx.stroke();
  shadow(ctx, x0 + w / 2, ground, w * 0.55);
}

function drawFeather(ctx, art, spec, box) {
  const poleH = Number(spec.artboard.h) * 1.2;
  const s = Math.min(box.h / (poleH + 4), box.w / (spec.artboard.w * 1.6));
  const ground = box.y + box.h;
  const flagH = spec.artboard.h * s;
  const flagW = spec.artboard.w * s;
  const poleX = box.x + box.w / 2 - flagW / 2;
  const top = ground - poleH * s;
  ctx.strokeStyle = '#7B8087';
  ctx.lineWidth = Math.max(2, s * 1.3);
  ctx.beginPath();
  ctx.moveTo(poleX, ground);
  ctx.lineTo(poleX, top);
  ctx.stroke();
  ctx.save();
  clipPolygon(ctx, spec.outline, (x, y) => [poleX + x * s, top + y * s]);
  ctx.clip();
  ctx.drawImage(art, poleX, top, flagW, flagH);
  ctx.restore();
  ctx.strokeStyle = 'rgba(20,22,26,.3)';
  ctx.lineWidth = 1;
  clipPolygon(ctx, spec.outline, (x, y) => [poleX + x * s, top + y * s]);
  ctx.stroke();
  shadow(ctx, poleX, ground, flagW * 0.6);
}

function drawYard(ctx, art, spec, box) {
  const s = Math.min(box.w / (spec.artboard.w + 6), box.h / (spec.artboard.h + 18));
  const w = spec.artboard.w * s;
  const h = spec.artboard.h * s;
  const ground = box.y + box.h;
  const x = box.x + (box.w - w) / 2;
  const y = ground - 8 * s - h;
  ctx.strokeStyle = '#7B8087';
  ctx.lineWidth = Math.max(2, s * 0.5);
  for (const sx of [x + w * 0.3, x + w * 0.7]) {
    ctx.beginPath();
    ctx.moveTo(sx, y + h * 0.7);
    ctx.lineTo(sx, ground + 6 * s);
    ctx.stroke();
  }
  ctx.save();
  ctx.shadowColor = 'rgba(20,22,26,.3)';
  ctx.shadowBlur = s * 1.5;
  ctx.drawImage(art, x, y, w, h);
  ctx.restore();
  shadow(ctx, x + w / 2, ground, w * 0.55);
}

function drawThrow(ctx, art, spec, box, base) {
  const s = Math.min(box.w / (spec.artboard.w + 10), box.h / 58);
  const w = spec.artboard.w * s;
  const x = box.x + (box.w - w) / 2;
  const ground = box.y + box.h - 2 * s;
  const frontH = 28 * s;
  const topH = 5 * s;
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.moveTo(x + 4 * s, ground - frontH - topH);
  ctx.lineTo(x + w - 4 * s, ground - frontH - topH);
  ctx.lineTo(x + w, ground - frontH);
  ctx.lineTo(x, ground - frontH);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.18)';
  ctx.fill();
  ctx.save();
  ctx.shadowColor = 'rgba(20,22,26,.25)';
  ctx.shadowBlur = s;
  ctx.drawImage(art, x, ground - frontH, w, frontH);
  ctx.restore();
  shadow(ctx, x + w / 2, ground + s, w * 0.52);
}

function drawBanner(ctx, art, spec, box) {
  const s = Math.min(box.w / (spec.artboard.w + 6), box.h / (spec.artboard.h + 14));
  const w = spec.artboard.w * s;
  const h = spec.artboard.h * s;
  const x = box.x + (box.w - w) / 2;
  const y = box.y + (box.h - h) / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(20,22,26,.3)';
  ctx.shadowBlur = s * 1.5;
  ctx.drawImage(art, x, y, w, h);
  ctx.restore();
  ctx.strokeStyle = 'rgba(20,22,26,.35)';
  ctx.lineWidth = Math.max(1, s * 0.5);
  ctx.strokeRect(x + s * 0.5, y + s * 0.5, w - s, h - s);
  const r = Math.max(2, s * 0.55);
  const count = Math.max(1, Math.round(spec.artboard.w / (spec.grommetEveryIn || 24)));
  ctx.fillStyle = '#B7BCC2';
  for (let i = 0; i <= count; i++) {
    const gx = x + (1 + (i * (spec.artboard.w - 2)) / count) * s;
    for (const gy of [y + s, y + h - s]) {
      ctx.beginPath();
      ctx.arc(gx, gy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}

export function renderSimple(ctx, { doc, pi, si, env, assets, width, height }) {
  const piece = doc.project.pieces[pi];
  const spec = specFor(env.specs, piece.productId, piece.choices);
  const display = sideDisplay(doc, pi, piece.sidesMode === 'same' ? 0 : si, env, { region: 'trim', assets });
  const art = renderToCanvas(display, 1400, assets);
  const side0 = piece.sides[0];
  const baseColor = resolveColor(side0.bg.type === 'gradient' ? side0.bg.from : side0.bg.color, doc.project.palette);
  const ground = Math.round(height * 0.88);
  ctx.clearRect(0, 0, width, height);
  backdrop(ctx, width, height, ground);
  const box = { x: width * 0.06, y: height * 0.06, w: width * 0.88, h: ground - height * 0.06 };
  if (piece.productId === 'canopy') drawCanopy(ctx, art, spec, box, baseColor);
  else if (piece.productId === 'feather') drawFeather(ctx, art, spec, box);
  else if (piece.productId === 'yard') drawYard(ctx, art, spec, box);
  else if (piece.productId === 'throw') drawThrow(ctx, art, spec, box, baseColor);
  else drawBanner(ctx, art, spec, box);
}
