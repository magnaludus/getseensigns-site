// Text layout in inches. A measurer is injected: measure(fontId, text) returns the width of `text`
// in em (the width at font size 1), so the same layout runs in the browser (canvas measureText) and
// in node tests (a fake). Each line gets one box (size * lh tall) with the capital letters centered
// in it, so type sits the same way on screen, in the 3D texture and in a PDF later.

export function fontOf(fonts, id) {
  return fonts.find((f) => f.id === id) || fonts[0];
}

export function capHeight(el, fonts) {
  return el.size * fontOf(fonts, el.font).cap;
}

function displayText(el) {
  const t = el.text == null ? '' : String(el.text);
  return el.caps ? t.toUpperCase() : t;
}

function lineWidth(el, measure, str) {
  if (!str) return 0;
  return measure(el.font, str) * el.size + (el.ls || 0) * el.size * Math.max(0, str.length - 1);
}

function wrapParagraph(el, measure, para, maxW) {
  const words = para.split(/ +/).filter((w) => w.length);
  if (!words.length) return [''];
  const lines = [];
  let cur = '';
  const pushWord = (word) => {
    if (lineWidth(el, measure, word) <= maxW || word.length <= 1) return [word];
    const parts = [];
    let chunk = '';
    for (const ch of word) {
      if (chunk && lineWidth(el, measure, chunk + ch) > maxW) {
        parts.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    if (chunk) parts.push(chunk);
    return parts;
  };
  for (const word of words) {
    const candidate = cur ? cur + ' ' + word : word;
    if (!cur || lineWidth(el, measure, candidate) <= maxW) {
      if (!cur && lineWidth(el, measure, word) > maxW) {
        const parts = pushWord(word);
        lines.push(...parts.slice(0, -1));
        cur = parts[parts.length - 1];
      } else {
        cur = candidate;
      }
    } else {
      lines.push(cur);
      const parts = pushWord(word);
      lines.push(...parts.slice(0, -1));
      cur = parts[parts.length - 1];
    }
  }
  lines.push(cur);
  return lines;
}

// el: {text, font, size, lh, ls, caps, w, align}. Returns the lines with their x offsets inside the box.
export function layoutText(el, measure, fonts) {
  const font = fontOf(fonts, el.font);
  const size = el.size;
  const lh = el.lh || 1;
  const lineH = size * lh;
  const capH = size * font.cap;
  const w = el.w;
  const text = displayText(el);
  const lines = [];
  for (const para of text.split('\n')) {
    for (const line of wrapParagraph(el, measure, para, w)) lines.push(line);
  }
  const out = lines.map((t) => {
    const width = lineWidth(el, measure, t);
    let x = 0;
    if (el.align === 'center') x = (w - width) / 2;
    else if (el.align === 'right') x = w - width;
    return { text: t, width, x };
  });
  out.forEach((l, i) => {
    l.baseline = i * lineH + (lineH + capH) / 2;
  });
  const widest = out.reduce((m, l) => Math.max(m, l.width), 0);
  const blockH = out.length * lineH;
  const inkH = (out.length - 1) * lineH + capH;
  const inkTop = (lineH - capH) / 2;
  return { lines: out, size, lineH, capH, blockH, inkH, inkTop, widest, w, h: blockH };
}

// Width of the widest single word. A fit must never need to break a word in the middle.
export function longestWord(el, measure) {
  let widest = 0;
  for (const word of displayText(el).split(/\s+/)) widest = Math.max(widest, lineWidth(el, measure, word));
  return widest;
}

// Largest size (in) whose wrapped text stays within `lines` lines and its ink fits boxW x boxH.
export function fitText(spec, measure, fonts) {
  const font = fontOf(fonts, spec.font);
  const lh = spec.lh || 1;
  const maxLines = spec.lines || 1;
  const minSize = spec.min || 0.4;
  let hi = Math.min(spec.max || Infinity, spec.boxH / font.cap);
  if (!isFinite(hi) || hi < minSize) hi = Math.max(minSize, hi || minSize);
  const test = (size) => {
    const lay = layoutText({ ...spec, size, lh, w: spec.boxW }, measure, fonts);
    const tooWide = lay.widest > spec.boxW + 1e-6 || longestWord({ ...spec, size }, measure) > spec.boxW + 1e-6;
    return lay.lines.length <= maxLines && lay.inkH <= spec.boxH + 1e-6 && !tooWide ? lay : null;
  };
  let best = test(minSize);
  if (!best) return { size: minSize, layout: layoutText({ ...spec, size: minSize, lh, w: spec.boxW }, measure, fonts), fits: false };
  let lo = minSize;
  let size = minSize;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const lay = test(mid);
    if (lay) {
      lo = mid;
      best = lay;
      size = mid;
    } else {
      hi = mid;
    }
    if (hi - lo < 0.005) break;
  }
  const tight = test(hi);
  if (tight && hi > size) {
    best = tight;
    size = hi;
  }
  return { size, layout: best, fits: true };
}

// y of the element box so that the ink of `layout` sits at `valign` inside [boxY, boxY + boxH].
export function alignInk(layout, boxY, boxH, valign) {
  if (valign === 'top') return boxY - layout.inkTop;
  if (valign === 'bottom') return boxY + boxH - layout.inkH - layout.inkTop;
  return boxY + (boxH - layout.inkH) / 2 - layout.inkTop;
}

export function isTooSmall(el, minCapIn, fonts) {
  if (el.type !== 'text' || !String(el.text || '').trim() || el.hidden) return false;
  return capHeight(el, fonts) + 1e-9 < minCapIn;
}

// Box of any element for hit tests, handles and snapping. Text height comes from its layout.
const layoutCache = new WeakMap();

export function layoutOf(el, measure, fonts) {
  const hit = layoutCache.get(el);
  if (hit && hit.v === measure.version) return hit.lay;
  const lay = layoutText(el, measure, fonts);
  layoutCache.set(el, { v: measure.version, lay });
  return lay;
}

export function elementBox(el, measure, fonts) {
  if (el.type === 'text') {
    return { x: el.x, y: el.y, w: el.w, h: layoutOf(el, measure, fonts).blockH, rot: el.rot || 0 };
  }
  return { x: el.x, y: el.y, w: el.w, h: el.h, rot: el.rot || 0 };
}
