// Admin: POST /api/admin/proof-approvals creates an "Approve your proof" link and returns it (nothing is emailed;
//        send the link to the customer yourself).
//        GET  /api/admin/proof-approvals lists the latest 100 (?status=sent, changes_requested or approved).
// Auth: Authorization: Bearer <ADMIN_TOKEN>.
//
// POST body (JSON):
//   customer_name      required, shown on the page
//   order_description  required, the order summary shown on the page (line breaks kept)
//   proof_url          required https link to the proof image (png, jpeg, webp, gif) or PDF
//   customer_email     optional, prefills the email field
// Answers 201 {ok, ref, status, approve_url}.

import { guarded, readJsonBody } from '../../_lib/admin.js';
import { getDb } from '../../_lib/db.js';
import { createApproval, listApprovals, approveUrlFor } from '../../_lib/proof-approvals.js';
import { baseUrl, json, log } from '../../_lib/util.js';

export async function createHandler(request, env, now) {
  const parsed = await readJsonBody(request);
  if (parsed.error) return json({ ok: false, error: parsed.error }, 400);
  const db = await getDb(env);
  const made = await createApproval(db, parsed.body, now);
  if (made.error) return json({ ok: false, error: made.error }, 400);
  log('proof_approval_created', { ref: made.record.ref });
  return json({ ok: true, ref: made.record.ref, status: made.record.status, approve_url: approveUrlFor(baseUrl(request, env), made.record) }, 201);
}

export async function listHandler(request, env) {
  const db = await getDb(env);
  const status = new URL(request.url).searchParams.get('status') || '';
  return json({ ok: true, approvals: await listApprovals(db, status) });
}

export const onRequestPost = guarded(createHandler);
export const onRequestGet = guarded(listHandler);
