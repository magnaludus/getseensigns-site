// Color helpers: hex parsing, palette slots and WCAG contrast.

export const SLOTS = ['primary', 'accent', 'ink'];

export function normalizeHex(value) {
  if (typeof value !== 'string') return null;
  let s = value.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  return '#' + s.toUpperCase();
}

export function parseHex(value) {
  const hex = normalizeHex(value);
  if (!hex) return null;
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}

export function toHex({ r, g, b }) {
  const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return ('#' + h(r) + h(g) + h(b)).toUpperCase();
}

export function luminance(value) {
  const c = parseHex(value);
  if (!c) return 0;
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// '@primary' -> palette.primary. A hex passes through. Anything else returns the fallback.
export function resolveColor(value, palette, fallback) {
  if (typeof value === 'string' && value.charAt(0) === '@') {
    const slot = value.slice(1);
    return (palette && normalizeHex(palette[slot])) || fallback || '#000000';
  }
  return normalizeHex(value) || fallback || '#000000';
}

export function isSlot(value) {
  return typeof value === 'string' && value.charAt(0) === '@' && SLOTS.includes(value.slice(1));
}

// White or near-black, whichever reads better on `bg`.
export function bestInk(bg) {
  return contrast('#FFFFFF', bg) >= contrast('#14161A', bg) ? '#FFFFFF' : '#14161A';
}

export function mix(a, b, t) {
  const ca = parseHex(a) || { r: 0, g: 0, b: 0 };
  const cb = parseHex(b) || { r: 0, g: 0, b: 0 };
  return toHex({ r: ca.r + (cb.r - ca.r) * t, g: ca.g + (cb.g - ca.g) * t, b: ca.b + (cb.b - ca.b) * t });
}
