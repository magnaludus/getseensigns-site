// Admin: POST /api/admin/orders/<id>/proof adds a new proof version (after a revision request) and emails it.
// Body: {proof_image_url | proof_image_urls, proof_note?}

import { guarded, readJsonBody } from '../../../../_lib/admin.js';
import { getDb } from '../../../../_lib/db.js';
import { getOrderById, addProof, linksFor } from '../../../../_lib/orders.js';
import { sendOrderEmail } from '../../../../_lib/emails.js';
import { baseUrl, json } from '../../../../_lib/util.js';

export async function proofHandler(request, env, now, context) {
  const parsed = await readJsonBody(request);
  if (parsed.error) return json({ ok: false, error: parsed.error }, 400);
  const db = await getDb(env);
  const order = await getOrderById(db, context.params.id);
  if (!order) return json({ ok: false, error: 'order not found' }, 404);
  const made = await addProof(db, order, parsed.body, now);
  if (made.error) return json({ ok: false, error: made.error }, made.status || 400);
  const links = linksFor(baseUrl(request, env), made.order);
  const mail = await sendOrderEmail(env, db, 'proof_ready', { order: made.order, items: JSON.parse(made.order.line_items_json), links, version: made.version }, now);
  return json({ ok: true, order_id: made.order.id, proof_version: made.version, proof_url: links.proof, email: { sent: mail.ok, error: mail.ok ? undefined : mail.error } });
}

export const onRequestPost = guarded(proofHandler);
