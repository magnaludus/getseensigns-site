// Admin: GET /api/admin/proof-approvals/<ref or token> returns the whole record: status, ship-to, notes,
// approval time, IP, user agent, the shop email status and the approve link.
// Auth: Authorization: Bearer <ADMIN_TOKEN>.

import { guarded } from '../../../_lib/admin.js';
import { getDb } from '../../../_lib/db.js';
import { getApprovalByRef, getApprovalByToken, approveUrlFor } from '../../../_lib/proof-approvals.js';
import { baseUrl, json } from '../../../_lib/util.js';

export async function detailHandler(request, env, now, context) {
  const db = await getDb(env);
  const id = String((context && context.params && context.params.id) || '');
  const record = (await getApprovalByRef(db, id)) || (await getApprovalByToken(db, id));
  if (!record) return json({ ok: false, error: 'approval not found' }, 404);
  return json({ ok: true, approval: Object.assign({}, record, { approve_url: approveUrlFor(baseUrl(request, env), record) }) });
}

export const onRequestGet = guarded(detailHandler);
