// Admin review requests for delivered orders.
//   GET  /api/admin/review-requests  lists orders that are due (delivered at least REVIEW_DELAY_HOURS ago, 24 by default,
//                                    and no review request sent yet). Sends nothing.
//   POST /api/admin/review-requests  sends the thank-you and review email to every due order, at most 50 per call.
// Safe to call as often as you like: an order that already got its email is never due again. A failed send stays due and
// is retried on the next call. Orders placed on Etsy are not in this system.

import { guarded } from '../../_lib/admin.js';
import { getDb } from '../../_lib/db.js';
import { getOrderById, linksFor } from '../../_lib/orders.js';
import { sendOrderEmail, dueReviewRequests, reviewDelayHours } from '../../_lib/emails.js';
import { baseUrl, json } from '../../_lib/util.js';

export async function listHandler(request, env, now) {
  const db = await getDb(env);
  const due = await dueReviewRequests(db, now, reviewDelayHours(env));
  return json({ ok: true, delay_hours: reviewDelayHours(env), due: due.map((r) => ({ order_id: r.order_id, delivered_at: r.delivered_at })) });
}

export async function sendHandler(request, env, now) {
  const db = await getDb(env);
  const due = await dueReviewRequests(db, now, reviewDelayHours(env));
  const results = [];
  for (const row of due) {
    const order = await getOrderById(db, row.order_id);
    if (!order || order.status !== 'shipped') { results.push({ order_id: row.order_id, sent: false, skipped: 'order is not in the shipped state' }); continue; }
    const links = linksFor(baseUrl(request, env), order);
    const mail = await sendOrderEmail(env, db, 'review_request', { order, items: JSON.parse(order.line_items_json), links }, now);
    results.push({ order_id: order.id, sent: mail.ok, error: mail.ok ? undefined : mail.error });
  }
  return json({ ok: true, delay_hours: reviewDelayHours(env), checked: due.length, sent: results.filter((r) => r.sent).length, results });
}

export const onRequestGet = guarded(listHandler);
export const onRequestPost = guarded(sendHandler);
