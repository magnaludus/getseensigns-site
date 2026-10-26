// Things to fix before sending: small type, low-resolution logos, hard-to-read colors and content
// outside the safe zone. The customer can still send; we fix these on the proof.
import { specFor, dpiLevel, effectiveDpi } from './specs.js';
import { elementBox, isTooSmall, capHeight } from './layout.js';
import { aabb } from './geometry.js';
import { effectiveSide } from './document.js';
import { sideDisplay } from '../render/displaylist.js';
import { lowContrastText } from './contrast.js';

const clip = (s, n = 24) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

// Returns [{kind, id, pi, si, message}]
export function collectWarnings(doc, env, assets) {
  const out = [];
  doc.project.pieces.forEach((piece, pi) => {
    const spec = specFor(env.specs, piece.productId, piece.choices);
    const sideIds = piece.sidesMode === 'same' ? [0] : piece.sides.map((_, i) => i);
    for (const si of sideIds) {
      const side = effectiveSide(piece, si);
      const where = piece.sides.length > 1 && piece.sidesMode !== 'same' ? ` (${side.name} side)` : '';
      const display = sideDisplay(doc, pi, si, env, { region: 'trim', assets });
      for (const el of side.elements) {
        if (el.hidden) continue;
        if (el.type === 'text' && String(el.text).trim()) {
          if (isTooSmall(el, spec.minCapIn, env.fonts)) {
            out.push({ kind: 'small', id: el.id, pi, si, message: `"${clip(el.text)}" is only ${capHeight(el, env.fonts).toFixed(1)} in tall. Hard to read from ${Math.round(spec.readFt)} ft${where}.` });
          }
        }
        if (el.type === 'image' && el.logoId) {
          const asset = assets && assets.get(el.logoId);
          if (asset && !asset.vector) {
            const dpi = effectiveDpi(asset.w, el.w);
            const level = dpiLevel(dpi, spec.dpi);
            if (level !== 'green') {
              out.push({ kind: 'dpi', id: el.id, pi, si, message: `Your logo is about ${Math.round(dpi)} dpi at this size (we like ${spec.dpi.greenMin}+). It may print soft${where}.` });
            }
          }
        }
        if ((el.type === 'text' && String(el.text).trim()) || (el.type === 'image' && el.logoId)) {
          const b = aabb(elementBox(el, env.measure, env.fonts));
          const f = spec.safe;
          const eps = 0.05;
          if (b.x < f.x - eps || b.y < f.y - eps || b.x + b.w > f.x + f.w + eps || b.y + b.h > f.y + f.h + eps) {
            const what = el.type === 'text' ? `"${clip(el.text)}"` : 'Your logo';
            out.push({ kind: 'safe', id: el.id, pi, si, message: `${what} reaches past the safe zone and may be trimmed${where}.` });
          }
        }
      }
      for (const low of lowContrastText(display)) {
        const el = side.elements.find((e) => e.id === low.id);
        out.push({ kind: 'contrast', id: low.id, pi, si, ratio: low.ratio, behind: low.behind, message: `"${clip(el ? el.text : 'Text')}" is hard to read on its background${where}.` });
      }
    }
  });
  return out;
}
