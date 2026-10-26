// Text measurer for layout.js, backed by a canvas. measure(fontId, text) -> width in em.
// Call measure.invalidate() after web fonts load so cached widths are thrown away.

export function createMeasurer(fonts) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const byId = new Map(fonts.map((f) => [f.id, f]));
  const cache = new Map();
  const measure = (fontId, text) => {
    const key = fontId + '|' + text;
    let w = cache.get(key);
    if (w == null) {
      const f = byId.get(fontId) || fonts[0];
      ctx.font = `${f.weight} 100px "${f.family}"`;
      w = ctx.measureText(text).width / 100;
      cache.set(key, w);
    }
    return w;
  };
  measure.version = 0;
  measure.invalidate = () => {
    cache.clear();
    measure.version += 1;
  };
  return measure;
}

// Resolves once the given fonts are ready (or after `timeoutMs`), then refreshes the measurer.
export function loadFonts(fonts, measure, timeoutMs = 2500) {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  const jobs = fonts.map((f) => document.fonts.load(`${f.weight} 1em "${f.family}"`).catch(() => null));
  const timeout = new Promise((resolve) => setTimeout(resolve, timeoutMs));
  return Promise.race([Promise.all(jobs), timeout]).then(() => measure.invalidate());
}

export function fontsReady(fonts) {
  return !document.fonts || fonts.every((f) => document.fonts.check(`${f.weight} 1em "${f.family}"`));
}

export function supportsLetterSpacing() {
  const ctx = document.createElement('canvas').getContext('2d');
  return 'letterSpacing' in ctx;
}
