// Admin: POST /api/admin/orders/<id>/review-request sends the customer one thank-you-and-review email. Use it after the
// package shows as delivered. Only shipped orders qualify, and it refuses a second send unless the body is {"force": true}.
// Orders placed on Etsy are not in this system; Etsy asks those buyers for a review itself.

import { guarded } from '../../../../_lib/admin.js';
import { getDb } from '../../../../_lib/db.js';
import { getOrderById, linksFor } from '../../../../_lib/orders.js';
import { sendOrderEmail, reviewRequestSent } from '../../../../_lib/emails.js';
import { baseUrl, json } from '../../../../_lib/util.js';

export async function reviewRequestHandler(request, env, now, context) {
  const raw = await request.text();
  let force = false;
  if (raw.trim()) {
    try { const parsed = JSON.parse(raw); force = !!parsed && parsed.force === true; } catch (_) { return json({ ok: false, error: 'body must be JSON like {"force": true}, or empty' }, 400); }
  }
  const db = await getDb(env);
  const order = await getOrderById(db, context.params.id);
  if (!order) return json({ ok: false, error: 'order not found' }, 404);
  if (order.status !== 'shipped') return json({ ok: false, error: 'order is ' + order.status + '; the review request goes out after it has shipped and been delivered' }, 409);
  if (!force && (await reviewRequestSent(db, order.id))) return json({ ok: false, already_sent: true, error: 'a review request was already sent for this order' }, 409);
  const links = linksFor(baseUrl(request, env), order);
  const mail = await sendOrderEmail(env, db, 'review_request', { order, items: JSON.parse(order.line_items_json), links }, now);
  return json({ ok: true, order_id: order.id, email: { sent: mail.ok, error: mail.ok ? undefined : mail.error } });
}

export const onRequestPost = guarded(reviewRequestHandler);
