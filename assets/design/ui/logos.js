// Logo uploads. Everything stays in the browser until the customer sends a proof request.
// Accepts PNG, JPG, WebP and SVG up to 25 MB. SVG is cleaned: no scripts, no event handlers, no
// external links. Big photos get a smaller copy for drawing; the original file is kept for upload.
import { addLogo, removeLogo } from '../model/document.js';
import { uid } from '../model/ids.js';

export const MAX_LOGO_BYTES = 25 * 1024 * 1024;
export const MAX_SVG_BYTES = 8 * 1024 * 1024;
export const MAX_LOGOS = 4;
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

export function sanitizeSvg(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return null;
  const bad = root.querySelectorAll('script, foreignObject, iframe, object, embed, audio, video, canvas, animate, set, handler, listener');
  bad.forEach((node) => node.remove());
  const all = [root, ...root.querySelectorAll('*')];
  for (const node of all) {
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on')) node.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'xlink:href') && !(value.startsWith('#') || value.startsWith('data:image/'))) node.removeAttribute(attr.name);
      else if (value.includes('javascript:')) node.removeAttribute(attr.name);
      else if (name === 'style' && /@import|url\(\s*['"]?(?!#|data:)/i.test(attr.value)) node.removeAttribute(attr.name);
    }
  }
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new XMLSerializer().serializeToString(root);
}

function svgSize(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { w: vb[2], h: vb[3] };
  const w = parseFloat(root.getAttribute('width'));
  const h = parseFloat(root.getAttribute('height'));
  if (w > 0 && h > 0) return { w, h };
  return { w: 512, h: 512 };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode'));
    img.src = url;
  });
}

// Returns {ok:true, id} or {ok:false, message}. Adds the logo to the document (no undo step of its own).
export async function addLogoFile(ctx, file) {
  const { store } = ctx;
  if (store.state.doc.project.logos.length >= MAX_LOGOS) return { ok: false, message: 'You can add up to 4 logos. Remove one first.' };
  if (!TYPES.includes(file.type)) return { ok: false, message: 'Use a PNG, JPG, WebP or SVG file.' };
  if (file.size > MAX_LOGO_BYTES) return { ok: false, message: 'That file is over 25 MB. Send a smaller copy.' };
  if (file.type === 'image/svg+xml' && file.size > MAX_SVG_BYTES) return { ok: false, message: 'That SVG is over 8 MB. Try a PNG instead.' };
  try {
    let blob = file;
    let vector = false;
    let w;
    let h;
    if (file.type === 'image/svg+xml') {
      const clean = sanitizeSvg(await file.text());
      if (!clean) return { ok: false, message: 'We could not read that SVG. Try a PNG instead.' };
      blob = new Blob([clean], { type: 'image/svg+xml' });
      ({ w, h } = svgSize(clean));
      vector = true;
    }
    const url = URL.createObjectURL(blob);
    const img = await loadImage(url);
    if (!vector) {
      w = img.naturalWidth;
      h = img.naturalHeight;
    }
    let drawable = img;
    let drawUrl = url;
    if (!vector && Math.max(w, h) > 2400) {
      const k = 2048 / Math.max(w, h);
      const c = document.createElement('canvas');
      c.width = Math.round(w * k);
      c.height = Math.round(h * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const png = file.type !== 'image/jpeg';
      const small = await new Promise((resolve) => c.toBlob(resolve, png ? 'image/png' : 'image/jpeg', 0.92));
      drawUrl = URL.createObjectURL(small);
      drawable = await loadImage(drawUrl);
      URL.revokeObjectURL(url);
    }
    const id = uid('l');
    const assets = new Map(store.state.assets);
    assets.set(id, { id, file: blob, name: file.name, url: drawUrl, img: drawable, w, h, type: file.type, vector });
    const res = addLogo(store.state.doc, { id, name: file.name, w, h, type: file.type, vector });
    store.state.assets = assets;
    store.commit(res.doc);
    return { ok: true, id };
  } catch (_) {
    return { ok: false, message: 'We could not open that image. Try another file.' };
  }
}

// The drawing copy stays in `assets` so that undo can bring a removed logo back.
export function removeLogoById(ctx, id) {
  const { store } = ctx;
  store.commit(removeLogo(store.state.doc, id));
}
