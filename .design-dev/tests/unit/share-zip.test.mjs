import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv } from './helpers.mjs';
import { createDocument, setSidesMode, setField, updateElement, addLogo, validateDocument } from '../../../assets/design/model/document.js';
import { encodeDoc, decodeDoc, shareable } from '../../../assets/design/model/share.js';
import { crc32, zipStore } from '../../../assets/design/model/zip.js';

const env = loadEnv();

test('share link round trip keeps the design', async () => {
  let doc = createDocument(env, 'canopy', { templateId: 'band-stripe' });
  doc = setSidesMode(doc, 0, 'each');
  doc = setField(doc, 'name', 'ROUND TRIP', env);
  const side2 = doc.project.pieces[0].sides[2];
  doc = updateElement(doc, 0, 2, side2.elements.find((e) => e.type === 'text').id, { text: 'BACK' }, env);
  const hash = await encodeDoc(doc);
  assert.match(hash, /^[zj]\.[A-Za-z0-9_-]+$/);
  const back = await decodeDoc(hash, env);
  assert.ok(back, 'decoded');
  assert.deepEqual(back.project.pieces[0].choices, doc.project.pieces[0].choices);
  assert.equal(back.project.pieces[0].sidesMode, 'each');
  assert.deepEqual(back.project.pieces[0].sides.map((s) => s.elements.map((e) => e.text || e.kind || '')), doc.project.pieces[0].sides.map((s) => s.elements.map((e) => e.text || e.kind || '')));
  assert.deepEqual(back.project.palette, doc.project.palette);
  assert.deepEqual(back.project.fields, doc.project.fields);
});

test('same-on-all-sides links carry one side and rebuild the rest', async () => {
  const doc = createDocument(env, 'canopy');
  assert.equal(shareable(doc).project.pieces[0].sides.length, 1);
  const back = await decodeDoc(await encodeDoc(doc), env);
  assert.equal(back.project.pieces[0].sides.length, 4);
  assert.equal(validateDocument(back, env).ok, true);
});

test('logos are not stored in the link', async () => {
  let doc = createDocument(env, 'yard', { templateId: 'split-field' });
  doc = addLogo(doc, { name: 'secret.png', w: 10, h: 10, type: 'image/png' }).doc;
  const hash = await encodeDoc(doc);
  const back = await decodeDoc(hash, env);
  assert.equal(back.project.logos.length, 0);
  assert.ok(!JSON.stringify(shareable(doc)).includes('secret.png'));
});

test('links stay short for a typical design', async () => {
  const doc = createDocument(env, 'canopy');
  assert.ok((await encodeDoc(doc)).length < 2500);
});

test('bad or tampered links decode to null', async () => {
  assert.equal(await decodeDoc('nonsense', env), null);
  assert.equal(await decodeDoc('z.AAAA', env), null);
  assert.equal(await decodeDoc('j.' + Buffer.from('{"v":2}').toString('base64url'), env), null);
  const doc = createDocument(env, 'banner');
  const bad = JSON.parse(JSON.stringify(doc));
  bad.project.pieces[0].choices.size = 'huge';
  assert.equal(await decodeDoc('j.' + Buffer.from(JSON.stringify(bad)).toString('base64url'), env), null);
});

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('zipStore makes an archive that python can read back byte for byte', () => {
  const files = [
    { name: 'summary.txt', data: new TextEncoder().encode('Hello proof\n') },
    { name: 'preview-front.png', data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]) },
    { name: 'design/é.json', data: new TextEncoder().encode('{"v":2}') },
  ];
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  try {
    const path = join(dir, 'out.zip');
    writeFileSync(path, zipStore(files, new Date(2026, 9, 26, 12, 30, 10)));
    const code = `
import zipfile, sys, json
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
print(json.dumps({i.filename: [i.file_size, i.compress_type, z.read(i.filename).hex()] for i in z.infolist()}))
`;
    const out = JSON.parse(execFileSync('python3', ['-I', '-c', code, path], { encoding: 'utf8' }));
    assert.equal(Object.keys(out).length, 3);
    for (const f of files) {
      const [size, method, hex] = out[f.name];
      assert.equal(size, f.data.length);
      assert.equal(method, 0);
      assert.equal(hex, Buffer.from(f.data).toString('hex'));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
