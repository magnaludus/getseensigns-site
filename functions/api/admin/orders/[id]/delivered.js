// Admin: POST /api/admin/orders/<id>/delivered records that the package was delivered. It sends nothing. About 24 hours
// later (REVIEW_DELAY_HOURS), POST /api/admin/review-requests sends the thank-you and review email.
// Body (optional): {"delivered_at": "2026-11-05T16:30:00Z"} to use the carrier's delivery time instead of now.
// Shipped orders only. The first delivery time recorded is kept.

import { guarded } from '../../../../_lib/admin.js';
import { getDb } from '../../../../_lib/db.js';
import { getOrderById } from '../../../../_lib/orders.js';
import { markDelivered, reviewDelayHours } from '../../../../_lib/emails.js';
import { json } from '../../../../_lib/util.js';

export async function deliveredHandler(request, env, now, context) {
  const raw = await request.text();
  let deliveredAt = now;
  if (raw.trim()) {
    let body;
    try { body = JSON.parse(raw); } catch (_) { return json({ ok: false, error: 'body must be JSON like {"delivered_at": "2026-11-05T16:30:00Z"}, or empty' }, 400); }
    if (body && body.delivered_at !== undefined) {
      const d = new Date(body.delivered_at);
      if (typeof body.delivered_at !== 'string' || Number.isNaN(d.getTime())) return json({ ok: false, error: 'delivered_at must be a date-time like 2026-11-05T16:30:00Z' }, 400);
      if (d.getTime() > now.getTime() + 5 * 60 * 1000) return json({ ok: false, error: 'delivered_at cannot be in the future' }, 400);
      deliveredAt = d;
    }
  }
  const db = await getDb(env);
  const order = await getOrderById(db, context.params.id);
  if (!order) return json({ ok: false, error: 'order not found' }, 404);
  if (order.status !== 'shipped') return json({ ok: false, error: 'order is ' + order.status + '; only a shipped order can be marked delivered' }, 409);
  const made = await markDelivered(db, order, deliveredAt.toISOString());
  const dueAt = new Date(Date.parse(made.delivered_at) + reviewDelayHours(env) * 3600 * 1000).toISOString();
  return json({ ok: true, order_id: order.id, delivered_at: made.delivered_at, already_recorded: made.already, review_request_due_at: dueAt });
}

export const onRequestPost = guarded(deliveredHandler);
