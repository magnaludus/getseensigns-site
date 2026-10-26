// Small SVG previews: template cards and side thumbnails. They are inline <svg>, not images, so they
// use the page's loaded fonts.
import { elementItem, sideDisplay } from './displaylist.js';
import { svg } from './svg.js';
import { buildTemplateSide } from '../model/templates.js';
import { specFor } from '../model/specs.js';
import { resolveColor } from '../model/color.js';

// What a template would look like with the customer's current words and colors.
export function templateThumb(doc, pi, template, env, assets) {
  const piece = doc.project.pieces[pi];
  const spec = specFor(env.specs, piece.productId, piece.choices);
  const touched = doc.project.touched;
  const palette = touched.palette ? doc.project.palette : template.palette;
  const fields = touched.fields ? doc.project.fields : template.sample;
  const built = buildTemplateSide(template, spec, fields, env);
  const pseudo = { project: { palette } };
  const items = built.elements.filter((e) => !e.hidden).map((e) => elementItem(e, pseudo, env, assets)).filter(Boolean);
  const bg = built.bg.type === 'gradient'
    ? { type: 'gradient', from: resolveColor(built.bg.from, palette), to: resolveColor(built.bg.to, palette), angle: built.bg.angle == null ? 90 : built.bg.angle }
    : { type: 'solid', color: resolveColor(built.bg.color, palette) };
  return svg({ area: spec.trim, bg, items, spec }, { className: 'dz-thumb-svg' });
}

export function sideThumb(doc, pi, si, env, assets) {
  return svg(sideDisplay(doc, pi, si, env, { region: 'trim', assets }), { className: 'dz-thumb-svg' });
}
