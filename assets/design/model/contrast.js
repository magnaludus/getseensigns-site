// Finds text that is hard to read against what sits under it. Pure: works on the display list.
import { contrast } from './color.js';

function under(display, item, index) {
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  for (let i = index - 1; i >= 0; i--) {
    const it = display.items[i];
    if (it.k !== 'path' || it.rot) continue;
    if (cx >= it.x && cx <= it.x + it.w && cy >= it.y && cy <= it.y + it.h) return it.fill;
  }
  if (display.bg.type === 'gradient') return display.bg.from;
  return display.bg.color;
}

// Returns [{id, ratio, fill, behind}] for text below `min` contrast (3:1 by default).
export function lowContrastText(display, min = 3) {
  const out = [];
  display.items.forEach((it, i) => {
    if (it.k !== 'text') return;
    const behind = under(display, it, i);
    const ratio = contrast(it.fill, behind);
    if (ratio < min) out.push({ id: it.id, ratio, fill: it.fill, behind });
  });
  return out;
}
