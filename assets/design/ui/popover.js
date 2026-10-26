// A small floating panel anchored to a button. Closes on Escape, on an outside tap, or when another
// popover opens.
import { h } from './dom.js';

let current = null;

export function closePopover() {
  if (current) {
    current.close();
    current = null;
  }
}

export function openPopover(host, anchor, content, opts = {}) {
  closePopover();
  const pop = h('div', { class: 'dz-pop', role: 'dialog', 'aria-label': opts.label || 'Options' }, content);
  host.append(pop);
  const place = () => {
    const a = anchor.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    const w = pop.offsetWidth;
    let left = a.left - hr.left + a.width / 2 - w / 2;
    left = Math.max(8, Math.min(left, hr.width - w - 8));
    pop.style.left = left + 'px';
    if (opts.below) pop.style.top = a.bottom - hr.top + 8 + 'px';
    else pop.style.bottom = hr.bottom - a.top + 8 + 'px';
  };
  place();
  const onDown = (e) => {
    if (!pop.contains(e.target) && !anchor.contains(e.target)) closePopover();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      closePopover();
      anchor.focus();
    }
  };
  setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
  document.addEventListener('keydown', onKey);
  const handle = {
    el: pop,
    close() {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
      pop.remove();
      anchor.setAttribute('aria-expanded', 'false');
      if (opts.onClose) opts.onClose();
    },
  };
  anchor.setAttribute('aria-expanded', 'true');
  current = handle;
  return handle;
}
