// First-party, cookie-free usage counts. Off by default: with no `data-events` flag on the page this
// never touches the network (in development it logs to the console). When the shop turns it on,
// events are batched and sent with sendBeacon; the server keeps no IP address and no user agent.

const PHASE = 1;

function hash32(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export function createAnalytics({ enabled, endpoint, product }) {
  const sid = Math.random().toString(36).slice(2, 10);
  const vp = window.innerWidth < 768 ? 'm' : 'd';
  const dev = /^(localhost|127\.|\[::1\])/.test(location.hostname) || /[?&]designdebug=1/.test(location.search);
  const t0 = performance.now();
  let queue = [];
  let timer = 0;
  let current = product || '';

  function flush() {
    clearTimeout(timer);
    timer = 0;
    if (!queue.length || !enabled) {
      queue = [];
      return;
    }
    const batch = queue.slice(0, 30);
    queue = queue.slice(30);
    try {
      navigator.sendBeacon(endpoint, new Blob([JSON.stringify({ events: batch })], { type: 'application/json' }));
    } catch (_) { /* analytics must never break the page */ }
    if (queue.length) timer = setTimeout(flush, 10000);
  }

  function track(name, d) {
    const event = { name, t: Math.round(performance.now() - t0), sid, vp, product: current, phase: PHASE };
    if (d && typeof d === 'object') event.d = d;
    if (dev) console.debug('[designer]', name, d || '');
    if (!enabled) return;
    queue.push(event);
    if (queue.length >= 30) flush();
    else if (!timer) timer = setTimeout(flush, 10000);
  }

  if (enabled) {
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  }
  window.addEventListener('error', (e) => track('editor_error', { h: hash32(String(e.message || '')) }));
  window.addEventListener('unhandledrejection', (e) => track('editor_error', { h: hash32(String((e.reason && e.reason.message) || e.reason || '')) }));
  return { track, setProduct(p) { current = p; }, flush };
}
