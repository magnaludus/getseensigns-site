// Print specs: one place that turns print-specs.json plus the customer's option choices into the
// numbers the editor and the 3D preview need. All lengths are inches. The origin (0, 0) is the top
// left corner of the trim. Pure functions, no DOM, so node tests can load this file.

export function variantKey(spec, choices) {
  if (!spec.variant_by.length) return '*';
  return spec.variant_by.map((g) => String((choices || {})[g])).join('-');
}

function rect(x, y, w, h) {
  return { x, y, w, h };
}

// The roof triangle of a canopy side: apex at the top, base on the valance line.
function roofPolygon(art, valanceY, roof) {
  const apexX = roof && roof.apex_x != null ? roof.apex_x : art.w / 2;
  const apexY = roof && roof.apex_y != null ? roof.apex_y : 0;
  return [[apexX, apexY], [art.w, valanceY], [0, valanceY]];
}

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
    out.roof = { shape: v.roof.shape, polygon: roofPolygon(art, v.valance_line.y, v.roof) };
    mark('roof', v.roof);
  }
  if (v.outline) {
    const shape = spec.outline_shapes[v.outline.shape];
    out.outline = shape.points.map(([x, y]) => [x * art.w, y * art.h]);
    mark('outline', v.outline);
  }
  if (v.pole_sleeve_in) {
    out.sleeveIn = v.pole_sleeve_in.value;
    mark('pole_sleeve_in', v.pole_sleeve_in);
  }
  if (v.grass_line) {
    out.grassLineIn = v.grass_line.h;
    mark('grass_line', v.grass_line);
  }
  if (v.grommets) out.grommetEveryIn = v.grommets.every_in;
  if (spec.table) out.table = spec.table;
  out.regions = regionsFor(out);
  return out;
}

// Named areas that templates and the editor point at.
export function regionsFor(s) {
  const r = { art: s.art, trim: s.trim, safe: s.safe };
  if (s.productId === 'canopy' && s.valanceLine != null) {
    const roofH = s.valanceLine;
    const apexX = s.roof ? s.roof.polygon[0][0] : s.artboard.w / 2;
    const w = s.artboard.w * 0.414;
    const y1 = roofH * 0.46;
    r.peak = rect(apexX - w / 2, y1, w, roofH * 0.46);
    const bottom = s.safe.y + s.safe.h;
    r.valance = rect(s.safe.x, s.valanceLine, s.safe.w, Math.max(1, bottom - s.valanceLine));
    r.valancebar = rect(0, s.valanceLine, s.artboard.w, s.artboard.h - s.valanceLine);
    r.roofarea = rect(0, 0, s.artboard.w, s.valanceLine);
  }
  if (s.productId === 'feather') {
    // The flag narrows toward the tip, so the top block is shorter and keeps to the pole side.
    const left = (s.sleeveIn || 0) + 0.5;
    const x = Math.max(s.safe.x, left);
    const w = s.safe.x + s.safe.w - x;
    const h = s.safe.h;
    r.head = rect(x, s.safe.y, w * 0.62, h * 0.2);
    r.body = rect(x, s.safe.y + h * 0.2, w, h * 0.54);
    r.foot = rect(x, s.safe.y + h * 0.74, w, h * 0.26);
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
