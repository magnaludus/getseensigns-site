// support.js is loaded eagerly by the app, so it must never throw and never keep a WebGL context alive.
import test from 'node:test';
import assert from 'node:assert/strict';

const url = (n) => `../../../assets/design/three/support.js?case=${n}`;

function fakeDocument(contexts, log) {
  return {
    createElement(tag) {
      log.push('create ' + tag);
      return {
        getContext(type) {
          log.push('ctx ' + type);
          const c = contexts[type];
          if (c instanceof Error) throw c;
          return c || null;
        },
      };
    },
  };
}

function withGlobals(doc, nav, fn) {
  const d = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const n = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
  const restore = () => {
    if (d) Object.defineProperty(globalThis, 'document', d); else delete globalThis.document;
    if (n) Object.defineProperty(globalThis, 'navigator', n); else delete globalThis.navigator;
  };
  return Promise.resolve(fn()).finally(restore);
}

test('webglAvailable is true when webgl2 works and releases the context', async () => {
  const log = [];
  const lose = { loseContext: () => log.push('lose') };
  const gl = { getExtension: (n) => (n === 'WEBGL_lose_context' ? lose : null) };
  await withGlobals(fakeDocument({ webgl2: gl }, log), {}, async () => {
    const m = await import(url('a'));
    assert.equal(m.webglAvailable(), true);
    assert.deepEqual(log, ['create canvas', 'ctx webgl2', 'lose']);
    assert.equal(m.webglAvailable(), true);
    assert.equal(log.length, 3, 'the answer is cached');
  });
});

test('webglAvailable needs WebGL 2 because the vendored Three.js does', async () => {
  const log = [];
  await withGlobals(fakeDocument({ webgl: { getExtension: () => null } }, log), {}, async () => {
    const m = await import(url('b'));
    assert.equal(m.webglAvailable(), false);
    assert.deepEqual(log, ['create canvas', 'ctx webgl2']);
  });
});

test('webglAvailable is false without any context', async () => {
  await withGlobals(fakeDocument({}, []), {}, async () => {
    const m = await import(url('c'));
    assert.equal(m.webglAvailable(), false);
  });
});

test('webglAvailable is false when anything throws', async () => {
  await withGlobals(fakeDocument({ webgl2: new Error('blocked') }, []), {}, async () => {
    const m = await import(url('d'));
    assert.equal(m.webglAvailable(), false);
  });
  await withGlobals({ createElement() { throw new Error('no dom'); } }, {}, async () => {
    const m = await import(url('e'));
    assert.equal(m.webglAvailable(), false);
  });
  await withGlobals(undefined, {}, async () => {
    const m = await import(url('f'));
    assert.equal(m.webglAvailable(), false);
  });
});

test('lowMemoryDevice is true only at 2 GB or less', async () => {
  const m = await import(url('g'));
  await withGlobals({}, { deviceMemory: 2 }, () => assert.equal(m.lowMemoryDevice(), true));
  await withGlobals({}, { deviceMemory: 0.5 }, () => assert.equal(m.lowMemoryDevice(), true));
  await withGlobals({}, { deviceMemory: 4 }, () => assert.equal(m.lowMemoryDevice(), false));
  await withGlobals({}, {}, () => assert.equal(m.lowMemoryDevice(), false));
  await withGlobals({}, undefined, () => assert.equal(m.lowMemoryDevice(), false));
});

test('support.js does not import Three.js', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../../assets/design/three/support.js', import.meta.url), 'utf8');
  assert.ok(!/from\s+['"]three['"]/.test(src) && !/import\s*\(/.test(src));
  assert.ok(src.length < 1200, 'support.js stays tiny');
});
