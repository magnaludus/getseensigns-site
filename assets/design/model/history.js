// Undo and redo over document snapshots. `push(doc, key)` with the same key inside the coalesce
// window replaces the newest step instead of adding one, so a slider drag or a burst of typing is
// one undo step.

export function createHistory(initial, opts = {}) {
  const limit = opts.limit || 200;
  const windowMs = opts.coalesceMs == null ? 700 : opts.coalesceMs;
  const now = opts.now || (() => Date.now());
  let past = [];
  let present = initial;
  let future = [];
  let lastKey = null;
  let lastAt = 0;

  return {
    get doc() {
      return present;
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    get size() {
      return past.length;
    },
    push(doc, key) {
      if (doc === present) return present;
      const t = now();
      const merge = key != null && key === lastKey && t - lastAt <= windowMs && past.length > 0;
      if (!merge) {
        past.push(present);
        if (past.length > limit) past.shift();
      }
      present = doc;
      future = [];
      lastKey = key == null ? null : key;
      lastAt = t;
      return present;
    },
    undo() {
      if (!past.length) return present;
      future.push(present);
      present = past.pop();
      lastKey = null;
      return present;
    },
    redo() {
      if (!future.length) return present;
      past.push(present);
      present = future.pop();
      lastKey = null;
      return present;
    },
    reset(doc) {
      past = [];
      future = [];
      present = doc;
      lastKey = null;
    },
  };
}
