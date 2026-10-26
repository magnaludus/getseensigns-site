// Overlay guides for the flat editor: trim, bleed, safe area and product-specific lines. Returns SVG
// markup in document inches. `s` is inches per screen pixel, so lines keep a steady on-screen weight.

const n = (v) => Math.round(v * 1000) / 1000;

function line(x1, y1, x2, y2, color, s, dash) {
  const d = dash ? ` stroke-dasharray="${n(dash * s)} ${n(dash * s * 0.7)}"` : '';
  return (
    `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="rgba(20,22,26,.55)" stroke-width="${n(3.6 * s)}"${d}/>` +
    `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${color}" stroke-width="${n(1.6 * s)}"${d}/>`
  );
}

function poly(points, color, s, dash, close = true) {
  const pts = points.map((p) => n(p[0]) + ',' + n(p[1])).join(' ');
  const d = dash ? ` stroke-dasharray="${n(dash * s)} ${n(dash * s * 0.7)}"` : '';
  const tag = close ? 'polygon' : 'polyline';
  return (
    `<${tag} points="${pts}" fill="none" stroke="rgba(20,22,26,.55)" stroke-width="${n(3.6 * s)}" stroke-linejoin="round"${d}/>` +
    `<${tag} points="${pts}" fill="none" stroke="${color}" stroke-width="${n(1.6 * s)}" stroke-linejoin="round"${d}/>`
  );
}

function label(x, y, text, s, anchor = 'start') {
  const fs = 11 * s;
  return `<text x="${n(x)}" y="${n(y)}" font-family="'Barlow',sans-serif" font-weight="700" font-size="${n(fs)}" text-anchor="${anchor}" fill="#fff" stroke="rgba(20,22,26,.85)" stroke-width="${n(fs * 0.28)}" paint-order="stroke" stroke-linejoin="round">${text}</text>`;
}

function shadeOutside(area, polygon, clip, s) {
  // fill the clip rect except the polygon (even-odd), dimming what will not print
  const outer = `M${n(clip.x)},${n(clip.y)} h${n(clip.w)} v${n(clip.h)} h${n(-clip.w)} Z`;
  const inner = 'M' + polygon.map((p) => n(p[0]) + ',' + n(p[1])).join(' L') + ' Z';
  return `<path d="${outer} ${inner}" fill="rgba(20,22,26,.42)" fill-rule="evenodd"/>`;
}

export function guidesSvg(spec, on, s) {
  const out = [];
  const a = spec.art;
  const t = spec.trim;
  const has = (name) => spec.overlays.includes(name) && on[name] !== false;

  if (has('roof') && spec.roof) out.push(shadeOutside(a, spec.roof.polygon, { x: 0, y: 0, w: t.w, h: spec.valanceLine }, s));
  if (has('outline') && spec.outline) out.push(shadeOutside(a, spec.outline, t, s));
  if (has('sleeve') && spec.sleeveIn) out.push(`<rect x="0" y="0" width="${n(spec.sleeveIn)}" height="${n(t.h)}" fill="rgba(20,22,26,.3)"/>`);

  if (has('bleed') && spec.bleed > 0) {
    const outer = `M${n(a.x)},${n(a.y)} h${n(a.w)} v${n(a.h)} h${n(-a.w)} Z`;
    const inner = `M${n(t.x)},${n(t.y)} h${n(t.w)} v${n(t.h)} h${n(-t.w)} Z`;
    out.push(`<path d="${outer} ${inner}" fill="rgba(225,6,0,.22)" fill-rule="evenodd"/>`);
  }
  if (has('trim')) {
    out.push(poly([[t.x, t.y], [t.x + t.w, t.y], [t.x + t.w, t.y + t.h], [t.x, t.y + t.h]], '#00B3FF', s));
  }
  if (has('safe')) {
    const f = spec.safe;
    out.push(poly([[f.x, f.y], [f.x + f.w, f.y], [f.x + f.w, f.y + f.h], [f.x, f.y + f.h]], '#2BD67B', s, 7));
  }
  if (has('valance_line') && spec.valanceLine != null) {
    out.push(line(0, spec.valanceLine, t.w, spec.valanceLine, '#FF9F1C', s, 8));
    out.push(label(t.x + 6 * s, spec.valanceLine - 5 * s, 'Valance line', s));
  }
  if (has('roof') && spec.roof) out.push(poly(spec.roof.polygon, '#FF9F1C', s, 0));
  if (has('outline') && spec.outline) out.push(poly(spec.outline, '#FF9F1C', s, 0));
  if (has('sleeve') && spec.sleeveIn) {
    out.push(line(spec.sleeveIn, 0, spec.sleeveIn, t.h, '#FF9F1C', s, 8));
    out.push(label(spec.sleeveIn + 5 * s, 16 * s, 'Pole sleeve', s));
  }
  if (has('grass_line') && spec.grassLineIn) {
    const y = t.h - spec.grassLineIn;
    out.push(line(0, y, t.w, y, '#C58B3C', s, 4));
    out.push(label(t.x + 6 * s, y - 5 * s, 'Ground line', s));
  }
  if (has('grommets') && spec.grommetEveryIn) {
    const count = Math.max(1, Math.round(t.w / spec.grommetEveryIn));
    const r = Math.min(0.45, t.h / 40);
    for (let i = 0; i <= count; i++) {
      const x = 1 + (i * (t.w - 2)) / count;
      for (const y of [1, t.h - 1]) {
        out.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="rgba(20,22,26,.2)" stroke="#FF9F1C" stroke-width="${n(1.4 * s)}"/>`);
      }
    }
  }
  return out.join('');
}

// Legend entries for the guides toggle: [key, label] for the ones this product has.
export function guideChoices(spec) {
  const names = {
    trim: 'Trim line', bleed: 'Bleed', safe: 'Safe zone', valance_line: 'Valance line', roof: 'Roof shape',
    outline: 'Flag shape', sleeve: 'Pole sleeve', grass_line: 'Ground line', grommets: 'Grommets',
  };
  return spec.overlays.filter((k) => names[k] && !(k === 'bleed' && !(spec.bleed > 0))).map((k) => [k, names[k]]);
}
