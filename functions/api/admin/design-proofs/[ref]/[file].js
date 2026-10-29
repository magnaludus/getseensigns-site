// Admin: GET /api/admin/design-proofs/<ref>/<file> downloads a file that was saved in D1 because it did not fit
// in the email (files marked saved: "d1" in the detail answer).

import { guarded } from '../../../../_lib/admin.js';
import { getDb, all } from '../../../../_lib/db.js';
import { json, DESIGN_REF_RE } from '../../../../_lib/util.js';

const FILE_RE = /^(?:preview|logo)-\d{1,2}\.(?:png|jpg|webp|svg)$/;

function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function fileHandler(request, env, now, context) {
  const { ref, file } = context.params;
  if (!DESIGN_REF_RE.test(ref) || !FILE_RE.test(file)) return json({ ok: false, error: 'not found' }, 404);
  const db = await getDb(env);
  const rows = await all(db, 'SELECT seq, type, bytes, data FROM design_proof_files WHERE ref = ? AND name = ? ORDER BY seq', [ref, file]);
  if (!rows.length) return json({ ok: false, error: 'not found' }, 404);
  const parts = rows.map((r) => fromBase64(r.data));
  const bytes = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of parts) {
    bytes.set(a, at);
    at += a.length;
  }
  if (bytes.length !== rows[0].bytes) return json({ ok: false, error: 'file is incomplete' }, 500);
  return new Response(bytes, {
    headers: {
      'Content-Type': rows[0].type,
      'Content-Disposition': 'attachment; filename="' + ref + '-' + file + '"',
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

export const onRequestGet = guarded(fileHandler);
