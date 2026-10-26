// Tiny DOM helpers and inline icons. No framework: components build elements with h() and keep their
// own references.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === 'html') el.innerHTML = value;
      else if (value === true) el.setAttribute(key, '');
      else el.setAttribute(key, value);
    }
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}

const PATHS = {
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'm15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  up: 'm6 15 6-6 6 6',
  down: 'm6 9 6 6 6-6',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  'eye-off': 'm3 3 18 18M10.6 6.1A9.7 9.7 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.6 7.6A17 17 0 0 0 2 12s4 7 10 7a9.6 9.6 0 0 0 4.4-1',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  unlock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 7.5-2',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  image: 'M4 5h16v14H4zM8 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM4 17l5-5 4 4 3-3 4 4',
  shape: 'M4 4h8v8H4zM14 14a3.5 3.5 0 1 0 7 0 3.5 3.5 0 0 0-7 0z',
  layers: 'm12 3 9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
  cube: 'm12 2 9 5v10l-9 5-9-5V7l9-5zM12 12l9-5M12 12v10M12 12 3 7',
  flat: 'M3 5h18v14H3zM3 9h18',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  rotate: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  'align-left': 'M4 5h16M4 10h10M4 15h16M4 20h10',
  'align-center': 'M4 5h16M7 10h10M4 15h16M7 20h10',
  'align-right': 'M4 5h16M10 10h10M4 15h16M10 20h10',
  caps: 'M3 19 8 5l5 14M5 14h6M15 19V9h3a3 3 0 0 1 0 6h-3',
  share: 'M12 15V3M8 7l4-4 4 4M5 12v8h14v-8',
  close: 'm6 6 12 12M18 6 6 18',
  check: 'm5 12 5 5 9-10',
  warning: 'M12 3 2 21h20L12 3zM12 10v5M12 18v.5',
  chevron: 'm9 6 6 6-6 6',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  upload: 'M12 16V4M8 8l4-4 4 4M5 14v6h14v-6',
  palette: 'M12 3a9 9 0 1 0 0 18c1.5 0 2-1 1.5-2-.6-1.2.2-2.5 1.6-2.5H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3zM7.5 11a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM11 7.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM15.5 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4v6M9 14v6',
  send: 'm4 12 16-8-5 16-3-7-8-1z',
  sides: 'M4 8l8-4 8 4v8l-8 4-8-4zM12 4v16',
  outline: 'M5 5h14v14H5zM9 9h6v6H9z',
  sparkle: 'm12 3 2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
  guides: 'M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4',
};

export function icon(name, size = 22) {
  const d = PATHS[name] || '';
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
}

// A button with an icon and an accessible name. Pass text to show a visible label as well.
export function iconButton(name, label, onClick, opts = {}) {
  const btn = h('button', { type: 'button', class: 'dz-btn-icon' + (opts.class ? ' ' + opts.class : ''), 'aria-label': label, title: label, onclick: onClick });
  btn.innerHTML = icon(name, opts.size || 22) + (opts.text ? `<span class="dz-btn-text">${opts.text}</span>` : '');
  if (opts.pressed != null) btn.setAttribute('aria-pressed', String(!!opts.pressed));
  if (opts.disabled) btn.disabled = true;
  return btn;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function debounce(fn, ms) {
  let t = 0;
  const run = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  run.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  run.cancel = () => clearTimeout(t);
  return run;
}

export function throttle(fn, ms) {
  let last = 0;
  let timer = 0;
  let pending = null;
  return (...args) => {
    const now = performance.now();
    pending = args;
    if (now - last >= ms) {
      last = now;
      fn(...pending);
      pending = null;
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = 0;
        last = performance.now();
        if (pending) fn(...pending);
        pending = null;
      }, ms - (now - last));
    }
  };
}
