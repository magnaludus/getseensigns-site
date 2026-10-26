// Tiny and Three-free: the app loads this eagerly to decide whether to offer the 3D view.
// The vendored Three.js needs WebGL 2, so a WebGL 1 only browser counts as unavailable.

let cached;

export function webglAvailable() {
  if (cached !== undefined) return cached;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    cached = !!gl;
    if (gl) {
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  } catch {
    cached = false;
  }
  return cached;
}

export function lowMemoryDevice() {
  return typeof navigator !== 'undefined' && navigator.deviceMemory <= 2;
}
