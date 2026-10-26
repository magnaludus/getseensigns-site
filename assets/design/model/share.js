// No-server share links: the document, compressed, in the URL hash (#d=...). Contact details are
// never part of the document, and logos are not included (only their place in the layout).
import { DOC_VERSION, validateDocument, sideNamesFor } from './document.js';
import { uid } from './ids.js';

export const MAX_HASH_JSON = 200000;

function toBase64Url(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream) {
  const body = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

// What goes into a link: same-on-all-sides pieces keep only side 0, logo files are dropped.
export function shareable(doc) {
  const pieces = doc.project.pieces.map((p) => ({ ...p, sides: p.sidesMode === 'same' ? [p.sides[0]] : p.sides }));
  return { v: DOC_VERSION, project: { ...doc.project, pieces, logos: [] } };
}

export async function encodeDoc(doc) {
  const text = JSON.stringify(shareable(doc));
  const raw = new TextEncoder().encode(text);
  if (typeof CompressionStream === 'function') {
    return 'z.' + toBase64Url(await pipe(raw, new CompressionStream('deflate-raw')));
  }
  return 'j.' + toBase64Url(raw);
}

// Returns a validated document or null. `env` supplies the catalog so missing sides can be rebuilt.
export async function decodeDoc(hash, env) {
  try {
    const kind = hash.slice(0, 2);
    const bytes = fromBase64Url(hash.slice(2));
    let raw;
    if (kind === 'z.') {
      if (typeof DecompressionStream !== 'function') return null;
      raw = await pipe(bytes, new DecompressionStream('deflate-raw'));
    } else if (kind === 'j.') {
      raw = bytes;
    } else {
      return null;
    }
    if (raw.length > MAX_HASH_JSON) return null;
    const doc = JSON.parse(new TextDecoder().decode(raw));
    if (!doc || !doc.project || !Array.isArray(doc.project.pieces)) return null;
    for (const piece of doc.project.pieces) {
      const product = env.catalog.products.find((p) => p.id === piece.productId);
      if (!product || !piece.sides || !piece.sides.length) return null;
      const names = sideNamesFor(product, piece.choices || {});
      while (piece.sides.length < names.length) {
        const src = piece.sides[0];
        piece.sides.push({ ...JSON.parse(JSON.stringify(src)), id: uid('s'), elements: src.elements.map((e) => ({ ...e, id: uid('e') })) });
      }
      piece.sides.forEach((s, i) => {
        s.name = names[i];
      });
    }
    doc.project.logos = [];
    const check = validateDocument(doc, env);
    return check.ok ? doc : null;
  } catch (_) {
    return null;
  }
}
