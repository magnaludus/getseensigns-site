// Admin: GET /api/admin/design-proofs/<ref> returns one designer proof request: the request fields, the design
// document, the file list (which were attached, which are saved here) and the email status.

import { guarded } from '../../../_lib/admin.js';
import { getDb, one } from '../../../_lib/db.js';
import { json, DESIGN_REF_RE } from '../../../_lib/util.js';

export async function detailHandler(request, env, now, context) {
  const ref = context.params.ref;
  if (!DESIGN_REF_RE.test(ref)) return json({ ok: false, error: 'not found' }, 404);
  const db = await getDb(env);
  const row = await one(db, 'SELECT * FROM design_proof_requests WHERE ref = ?', [ref]);
  if (!row) return json({ ok: false, error: 'not found' }, 404);
  return json({
    ok: true,
    ref: row.ref,
    created_at: row.created_at,
    status: row.status,
    emails: { shop: row.shop_email, customer: row.customer_email_status, error: row.email_error },
    request: JSON.parse(row.request_json),
    design: row.design_json ? JSON.parse(row.design_json) : null,
    files: JSON.parse(row.files_json),
  });
}

export const onRequestGet = guarded(detailHandler);
