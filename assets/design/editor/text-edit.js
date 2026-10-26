// In-place text editing: a real <textarea> laid over the element so phone keyboards, autocorrect and
// selection work. The textarea is drawn at the sign's scale. Below 16 px the font stays at 16 px and
// the box is scaled down with CSS, because iOS zooms the page when it focuses a smaller field.
import { fontOf } from '../model/layout.js';

export function openTextEdit(opts) {
  const { container, svg, el, env, fill, scale, onInput, onClose, lay } = opts;
  const font = fontOf(env.fonts, el.font);
  const ta = document.createElement('textarea');
  ta.className = 'dz-textedit';
  ta.value = el.text || '';
  ta.setAttribute('aria-label', 'Edit text on the design');
  ta.setAttribute('autocapitalize', el.caps ? 'characters' : 'sentences');
  ta.setAttribute('autocomplete', 'off');
  ta.setAttribute('spellcheck', 'false');
  ta.rows = 1;
  container.append(ta);

  function place(current, layout, curScale) {
    const f = fontOf(env.fonts, current.font);
    const px = current.size * curScale;
    const k = px >= 16 ? 1 : px / 16;
    const fontPx = px >= 16 ? px : 16;
    const wFrame = (current.w * curScale) / k;
    const hFrame = (layout.blockH * curScale) / k;
    const ctm = svg.getScreenCTM();
    const host = container.getBoundingClientRect();
    const cx = (current.x + current.w / 2) * ctm.a + ctm.e - host.left;
    const cy = (current.y + layout.blockH / 2) * ctm.d + ctm.f - host.top;
    const shift = (fontPx * (f.cap + f.desc - f.asc)) / 2;
    const style = ta.style;
    style.left = cx - wFrame / 2 + 'px';
    style.top = cy - hFrame / 2 + 'px';
    style.width = wFrame + 'px';
    style.height = hFrame + 'px';
    style.fontFamily = `"${f.family}", sans-serif`;
    style.fontWeight = f.weight;
    style.fontSize = fontPx + 'px';
    style.lineHeight = String(current.lh || 1);
    style.letterSpacing = (current.ls || 0) * fontPx + 'px';
    style.textAlign = current.align;
    style.textTransform = current.caps ? 'uppercase' : 'none';
    style.color = fill;
    style.transformOrigin = '50% 50%';
    style.transform = `rotate(${current.rot || 0}deg) scale(${k}) translateY(${shift}px)`;
  }

  place(el, lay, scale);
  ta.focus({ preventScroll: true });
  ta.setSelectionRange(ta.value.length, ta.value.length);

  let closed = false;
  const openedAt = performance.now();
  const close = (reason) => {
    if (closed) return;
    closed = true;
    ta.remove();
    onClose(reason);
  };
  ta.addEventListener('input', () => onInput(ta.value));
  ta.addEventListener('blur', () => {
    // A tap on a touch screen is followed by emulated mouse events that can pull focus away at once.
    if (performance.now() - openedAt < 300 && !closed) {
      ta.focus({ preventScroll: true });
      return;
    }
    close('blur');
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
      e.preventDefault();
      close('key');
    }
    e.stopPropagation();
  });
  return {
    update: place,
    close: () => close('api'),
    focus: () => ta.focus({ preventScroll: true }),
    get value() {
      return ta.value;
    },
    el: ta,
  };
}
