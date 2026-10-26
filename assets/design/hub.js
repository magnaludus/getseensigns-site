// Entry module for /design/. The hub is plain links, so the editor code is fetched there only when a
// shared design (#d=...), an old ?product= link or usage counts need it.
const root = document.getElementById('designer');
if (root) {
  const debug = (window.GSSDesigner = window.GSSDesigner || {});
  const needsEditor = location.hash.startsWith('#d=') || new URLSearchParams(location.search).has('product') || root.dataset.events === '1';
  if (needsEditor) {
    import('./app.js').then((m) => m.boot(root));
  } else {
    debug.version = 2;
    debug.ready = true;
  }
}
