// Print specs: one place that turns print-specs.json plus the customer's option choices into the
// numbers the editor and the 3D preview need. All lengths are inches. The origin (0, 0) is the top
// left corner of the trim. Pure functions, no DOM, so node tests can load this file.
import { bounds, bandRect, insetConvex, insetPolygon, rowSpan } from './outline.js';

export function variantKey(spec, choices) {
  if (!spec.variant_by.length) return '*';
  return spec.variant_by.map((g) => String((choices || {})[g])).join('-');
}

function rect(x, y, w, h) {
  return { x, y, w, h };
}

// The roof of a canopy side. Real specs give the printer's outline as points; the older placeholder
// is a triangle from the top center to both ends of the valance line.
function roofPolygon(art, valanceY, roof) {
  if (roof && Array.isArray(roof.points) && roof.points.length >= 3) return roof.points.map((p) => [p[0], p[1]]);
  const apexX = roof && roof.apex_x != null ? roof.apex_x : art.w / 2;
  const apexY = roof && roof.apex_y != null ? roof.apex_y : 0;
  return [[apexX, apexY], [art.w, valanceY], [0, valanceY]];
}

const boxOf = (b) => rect(b.x, b.y, b.w, b.h);

export function specFor(specs, productId, choices) {
  const spec = specs.products[productId];
  if (!spec) throw new Error('No print spec for ' + productId);
  const key = variantKey(spec, choices);
  const v = spec.variants[key];
  if (!v) throw new Error('No print spec variant ' + productId + '/' + key);
  const bleed = v.bleed.in || 0;
  const art = { w: v.artboard.w, h: v.artboard.h };
  const trim = rect(0, 0, art.w, art.h);
  const full = rect(-bleed, -bleed, art.w + 2 * bleed, art.h + 2 * bleed);
  let safe;
  if (v.safe.inset != null) {
    safe = rect(v.safe.inset, v.safe.inset, art.w - 2 * v.safe.inset, art.h - 2 * v.safe.inset);
  } else {
    safe = rect(v.safe.x, v.safe.y, v.safe.w, v.safe.h);
  }
  const dpiSource = spec.dpi_override || specs.dpi;
  const out = {
    productId,
    variant: key,
    artboard: art,
    bleed,
    trim,
    art: full,
    safe,
    dpi: { target: v.dpi.target, greenMin: dpiSource.green_min, amberMin: dpiSource.amber_min },
    minCapIn: v.min_cap_in.value,
    readFt: v.min_cap_in.value * specs.read_rule.ft_per_cap_inch,
    overlays: (spec.overlays || []).slice(),
    sides: spec.sides,
    printThrough: !!spec.print_through,
    placeholders: [],
  };
  const mark = (name, row) => {
    if (row && row.status === 'TODO_SPEC') out.placeholders.push(name);
  };
  mark('safe', v.safe);
  if (v.valance_line) {
    out.valanceLine = v.valance_line.y;
    mark('valance_line', v.valance_line);
  }
  if (v.roof) {
    const polygon = roofPolygon(art, v.valance_line.y, v.roof);
    out.roof = { shape: v.roof.shape, polygon };
    // With the printer's points the panel is cut along the roof and straight down the valance sides.
    if (Array.isArray(v.roof.points)) out.cut = [...polygon, [art.w, art.h], [0, art.h]];
    mark('roof', v.roof);
  }
  if (v.outline) {
    if (Array.isArray(v.outline.points)) {
      out.outline = v.outline.points.map((p) => [p[0], p[1]]);
    } else {
      const shape = spec.outline_shapes[v.outline.shape];
      out.outline = shape.points.map(([x, y]) => [x * art.w, y * art.h]);
    }
    out.poleSide = v.outline.pole_side || 'left';
    // The sewn edge: up the straight pole side from the bottom corner, then along the curve to the top tip.
    const tip = out.outline.reduce((best, q, i) => (q[1] < out.outline[best][1] ? i : best), 0);
    out.poleEdge = [out.outline[out.outline.length - 1], ...out.outline.slice(0, tip + 1)];
    if (v.outline.template_page) {
      const tp = v.outline.template_page;
      out.templatePage = { w: tp.w, h: tp.h, offsetX: tp.offset_x, offsetY: tp.offset_y };
    }
    mark('outline', v.outline);
  }
  // The safe line follows the cut outline when the printer says so (2 in inside it).
  const follow = v.safe.outline_inset;
  if (follow > 0) {
    if (out.cut) out.safePoly = insetPolygon(out.cut, follow);
    else if (out.outline) out.safePoly = insetConvex(out.outline, follow);
    if (out.safePoly && v.safe.inset != null) out.safe = boxOf(bounds(out.safePoly));
  }
  if (v.pole_sleeve) {
    out.sleeveWidthIn = v.pole_sleeve.width_in == null ? null : v.pole_sleeve.width_in;
    mark('pole_sleeve', v.pole_sleeve);
  }
  if (v.flutes) out.flutes = v.flutes.direction;
  if (v.grass_line) {
    out.grassLineIn = v.grass_line.h;
    mark('grass_line', v.grass_line);
  }
  if (v.base_zone) out.baseZoneIn = v.base_zone.h;
  if (v.grommets) out.grommetEveryIn = v.grommets.every_in;
  if (spec.table) out.table = spec.table;
  out.regions = regionsFor(out);
  return out;
}

function apexOf(polygon) {
  let best = polygon[0];
  for (const p of polygon) if (p[1] < best[1]) best = p;
  return best;
}

// First and last y where the polygon is at least `frac` of its widest, scanned every half inch.
function wideRows(poly, frac) {
  const b = bounds(poly);
  const rows = [];
  for (let y = b.y; y <= b.y + b.h + 1e-6; y += 0.5) {
    const span = rowSpan(poly, Math.min(y, b.y + b.h - 0.01));
    if (span) rows.push([y, span[1] - span[0]]);
  }
  const widest = Math.max(...rows.map((r) => r[1]));
  const ok = rows.filter((r) => r[1] >= frac * widest);
  return { widest, y0: ok[0][0], y1: ok[ok.length - 1][0], rows };
}

// Named areas that templates and the editor point at.
export function regionsFor(s) {
  const r = { art: s.art, trim: s.trim, safe: s.safe };
  if (s.productId === 'canopy' && s.valanceLine != null) {
    const roofH = s.valanceLine;
    const apexX = s.roof ? apexOf(s.roof.polygon)[0] : s.artboard.w / 2;
    const y1 = roofH * 0.46;
    const y2 = y1 + roofH * 0.46;
    const bottom = s.safe.y + s.safe.h;
    // With the real outline the peak block is the widest rectangle that fits the safe gable.
    const band = s.safePoly ? bandRect(s.safePoly, y1, y2) : null;
    if (band) {
      r.peak = boxOf(band);
    } else {
      const w = s.artboard.w * 0.414;
      r.peak = rect(apexX - w / 2, y1, w, y2 - y1);
    }
    let vTop = s.valanceLine;
    let vx = s.safe.x;
    let vw = s.safe.w;
    if (s.safePoly) {
      // the safe line is pulled in by the roof corner just under the valance line; start where it is full width
      const rows = wideRows(s.safePoly, 0.97).rows.filter((q) => q[0] >= s.valanceLine);
      const full = Math.max(...rows.map((q) => q[1]));
      const start = rows.find((q) => q[1] >= full - 0.6);
      if (start) vTop = start[0];
      const vb = bandRect(s.safePoly, vTop, bottom - 0.01);
      if (vb) {
        vx = vb.x;
        vw = vb.w;
      }
    }
    r.valance = rect(vx, vTop, vw, Math.max(1, bottom - vTop));
    r.valancebar = rect(0, s.valanceLine, s.artboard.w, s.artboard.h - s.valanceLine);
    r.roofarea = rect(0, 0, s.artboard.w, s.valanceLine);
  }
  if (s.productId === 'feather') {
    if (s.safePoly) {
      // The flag is cut away at the top left (the bent pole) and the slanted bottom. Stack three blocks
      // where it is at least about half as wide as its widest part, each the widest box that fits.
      const { y0, y1 } = wideRows(s.safePoly, 0.55);
      const z = y1 - y0;
      const band = (a, b) => boxOf(bandRect(s.safePoly, a, b) || s.safe);
      r.head = band(y0, y0 + z * 0.2);
      r.body = band(y0 + z * 0.2, y0 + z * 0.74);
      r.foot = band(y0 + z * 0.74, y1);
    } else {
      const left = (s.sleeveWidthIn || 0) + 0.5;
      const x = Math.max(s.safe.x, left);
      const w = s.safe.x + s.safe.w - x;
      const h = s.safe.h;
      r.head = rect(x, s.safe.y, w * 0.62, h * 0.2);
      r.body = rect(x, s.safe.y + h * 0.2, w, h * 0.54);
      r.foot = rect(x, s.safe.y + h * 0.74, w, h * 0.26);
    }
  }
  return r;
}

export function dpiLevel(dpi, thresholds) {
  if (dpi == null || !isFinite(dpi)) return 'green';
  if (dpi >= thresholds.greenMin) return 'green';
  if (dpi >= thresholds.amberMin) return 'amber';
  return 'red';
}

// Effective resolution of an image placed `placedWidthIn` wide. Vector artwork has no limit.
export function effectiveDpi(pixelWidth, placedWidthIn) {
  if (!pixelWidth || !placedWidthIn) return null;
  return pixelWidth / placedWidthIn;
}
