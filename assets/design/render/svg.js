// SVG backend for the display list. The editor stage uses innerArt() inside its own <svg>; thumbnails
// use svg() for a complete element. Text is plain <text> at baselines from the layout, so it lines up
// with the canvas backend.
import { gradientLine, frameStyle } from './displaylist.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v) => Math.round(v * 1000) / 1000;
let gradientCount = 0;

function transformAttr(it) {
  const t = `translate(${n(it.x)} ${n(it.y)})`;
  return it.rot ? `${t} rotate(${n(it.rot)} ${n(it.w / 2)} ${n(it.h / 2)})` : t;
}

function strokeAttrs(stroke) {
  return stroke ? ` stroke="${stroke.color}" stroke-width="${n(stroke.w)}" stroke-linejoin="round"` : '';
}

function itemSvg(it, assetUrl) {
  const op = it.opacity !== 1 ? ` opacity="${n(it.opacity)}"` : '';
  if (it.k === 'text') {
    const stroke = it.stroke ? `${strokeAttrs(it.stroke)} paint-order="stroke"` : '';
    const ls = it.ls ? ` letter-spacing="${n(it.ls)}"` : '';
    const lines = it.lines
      .map((l) => `<text x="${n(l.x)}" y="${n(l.y)}" xml:space="preserve">${esc(l.t)}</text>`)
      .join('');
    return `<g data-id="${it.id}" transform="${transformAttr(it)}"${op} font-family="'${esc(it.family)}'" font-weight="${it.weight}" font-size="${n(it.size)}" fill="${it.fill}"${stroke}${ls}>${lines}</g>`;
  }
  if (it.k === 'path') {
    return `<g data-id="${it.id}" transform="${transformAttr(it)}"${op}><path d="${it.d}" fill="${it.fill}"${strokeAttrs(it.stroke)}/></g>`;
  }
  if (it.k === 'image') {
    const href = assetUrl ? assetUrl(it.logoId) : '';
    return `<g data-id="${it.id}" transform="${transformAttr(it)}"${op}><image href="${esc(href)}" width="${n(it.w)}" height="${n(it.h)}" preserveAspectRatio="xMidYMid meet"/></g>`;
  }
  if (it.k === 'frame') {
    const f = frameStyle(it.w, it.h);
    const dash = `${n(f.dash)} ${n(f.gap)}`;
    const box = `width="${n(it.w)}" height="${n(it.h)}" rx="${n(f.r)}"`;
    return (
      `<g data-id="${it.id}" data-frame="1" transform="${transformAttr(it)}"${op}>` +
      `<rect ${box} fill="rgba(255,255,255,.16)"/>` +
      `<rect ${box} fill="none" stroke="rgba(20,22,26,.55)" stroke-width="${n(f.sw * 1.9)}" stroke-dasharray="${dash}"/>` +
      `<rect ${box} fill="none" stroke="#fff" stroke-width="${n(f.sw)}" stroke-dasharray="${dash}"/>` +
      `<text x="${n(it.w / 2)}" y="${n(it.h / 2 + f.fs * 0.35)}" text-anchor="middle" font-family="'Barlow Condensed'" font-weight="900" font-size="${n(f.fs)}" fill="#fff" stroke="rgba(20,22,26,.6)" stroke-width="${n(f.fs * 0.12)}" paint-order="stroke" stroke-linejoin="round">${esc(it.label.toUpperCase())}</text>` +
      `</g>`
    );
  }
  return '';
}

export function innerArt(display, opts = {}) {
  const a = display.area;
  let defs = '';
  let fill;
  if (display.bg.type === 'gradient') {
    const id = 'gbg' + ++gradientCount;
    const g = gradientLine(a, display.bg.angle);
    defs = `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(g.x1)}" y1="${n(g.y1)}" x2="${n(g.x2)}" y2="${n(g.y2)}"><stop offset="0" stop-color="${display.bg.from}"/><stop offset="1" stop-color="${display.bg.to}"/></linearGradient></defs>`;
    fill = `url(#${id})`;
  } else {
    fill = display.bg.color;
  }
  const bg = `<rect class="art-bg" x="${n(a.x)}" y="${n(a.y)}" width="${n(a.w)}" height="${n(a.h)}" fill="${fill}"/>`;
  return defs + bg + display.items.map((it) => itemSvg(it, opts.assetUrl)).join('');
}

export function svg(display, opts = {}) {
  const a = display.area;
  const cls = opts.className ? ` class="${esc(opts.className)}"` : '';
  const label = opts.label ? ` role="img" aria-label="${esc(opts.label)}"` : ' aria-hidden="true"';
  return `<svg xmlns="http://www.w3.org/2000/svg"${cls} viewBox="${n(a.x)} ${n(a.y)} ${n(a.w)} ${n(a.h)}" preserveAspectRatio="xMidYMid meet"${label}>${innerArt(display, opts)}</svg>`;
}
