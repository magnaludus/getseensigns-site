// Admin: GET /api/admin/design-proofs lists the latest 100 designer proof requests.
// Auth: Authorization: Bearer <ADMIN_TOKEN>.

import { guarded } from '../../_lib/admin.js';
import { getDb, all } from '../../_lib/db.js';
import { json } from '../../_lib/util.js';

export async function listHandler(request, env) {
  const db = await getDb(env);
  const rows = await all(db, 'SELECT ref, created_at, status, mode, customer_name, customer_email, shop_email, customer_email_status FROM design_proof_requests ORDER BY created_at DESC LIMIT 100', []);
  return json({ ok: true, requests: rows });
}

export const onRequestGet = guarded(listHandler);
