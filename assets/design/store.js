// App state: the current document, history, what is selected and which view is open. UI pieces
// subscribe and redraw what changed. `preview(doc)` shows a live change (a drag in progress)
// without adding an undo step; `commit(doc)` adds one.
import { createHistory } from './model/history.js';
import { getSide } from './model/document.js';

export function createStore(initialDoc, env, initialView) {
  const history = createHistory(initialDoc, { limit: 300 });
  const state = {
    doc: initialDoc,
    view: { pi: 0, si: 0, mode: 'flat', scene: 'studio', guides: { trim: true, safe: true, valance_line: true, roof: true, outline: true, sleeve: true, grass_line: true, grommets: true, bleed: true }, tab: 'templates', sheet: 'half', simple: false, ...initialView },
    selection: [],
    editing: null,
    assets: new Map(),
    busy: false,
  };
  const listeners = new Set();
  const emit = (keys) => listeners.forEach((fn) => fn(state, keys));

  function pruneSelection() {
    const piece = state.doc.project.pieces[state.view.pi];
    if (!piece) return;
    if (state.view.si >= piece.sides.length || piece.sidesMode === 'same') state.view.si = 0;
    const side = piece.sides[state.view.si];
    const have = new Set(side.elements.map((e) => e.id));
    const next = state.selection.filter((id) => have.has(id));
    if (next.length !== state.selection.length) state.selection = next;
    if (state.editing && !have.has(state.editing)) state.editing = null;
  }

  return {
    env,
    state,
    history,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    // Change view/selection/etc. keys: set({view: {...}}) merges `view` one level deep.
    set(patch) {
      const keys = Object.keys(patch);
      for (const k of keys) {
        if (k === 'view') state.view = { ...state.view, ...patch.view };
        else state[k] = patch[k];
      }
      pruneSelection();
      emit(keys);
    },
    preview(doc) {
      state.doc = doc;
      pruneSelection();
      emit(['doc', 'preview']);
    },
    commit(doc, opts = {}) {
      history.push(doc, opts.key);
      state.doc = history.doc;
      if (opts.select) state.selection = opts.select;
      pruneSelection();
      emit(['doc', 'history']);
    },
    // Drop an uncommitted preview and go back to the last committed document.
    revert() {
      state.doc = history.doc;
      pruneSelection();
      emit(['doc', 'preview']);
    },
    undo() {
      if (!history.canUndo) return false;
      history.undo();
      state.doc = history.doc;
      pruneSelection();
      emit(['doc', 'history']);
      return true;
    },
    redo() {
      if (!history.canRedo) return false;
      history.redo();
      state.doc = history.doc;
      pruneSelection();
      emit(['doc', 'history']);
      return true;
    },
    replaceDoc(doc) {
      history.reset(doc);
      state.doc = doc;
      state.selection = [];
      state.editing = null;
      state.view = { ...state.view, pi: 0, si: 0 };
      emit(['doc', 'history', 'selection']);
    },
    side() {
      return getSide(state.doc, state.view.pi, state.view.si);
    },
    piece() {
      return state.doc.project.pieces[state.view.pi];
    },
  };
}
