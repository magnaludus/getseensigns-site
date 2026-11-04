// Admin proof reminders for proofs that have sat unapproved.
//   GET  /api/admin/proof-reminders  lists orders that are due (status proof_sent, latest proof email at least
//                                    REMINDER_DELAY_HOURS ago, 72 by default, no reminder sent yet). Sends nothing.
//   POST /api/admin/proof-reminders  sends the one reminder email to every due order, at most 50 per call.
// Safe to call daily: an order that got its reminder is never due again, a revised proof restarts the clock, and a
// failed send is retried next time. Orders that were approved, paid or asked for a revision are never reminded.

import { guarded } from '../../_lib/admin.js';
import { getDb } from '../../_lib/db.js';
import { getOrderById, linksFor } from '../../_lib/orders.js';
import { sendOrderEmail, dueProofReminders, proofReminderDelayHours } from '../../_lib/emails.js';
import { baseUrl, json } from '../../_lib/util.js';

export async function listHandler(request, env, now) {
  const db = await getDb(env);
  const due = await dueProofReminders(db, now, proofReminderDelayHours(env));
  return json({ ok: true, delay_hours: proofReminderDelayHours(env), due: due.map((r) => ({ order_id: r.order_id, proof_sent_at: r.proof_sent_at })) });
}

export async function sendHandler(request, env, now) {
  const db = await getDb(env);
  const due = await dueProofReminders(db, now, proofReminderDelayHours(env));
  const results = [];
  for (const row of due) {
    const order = await getOrderById(db, row.order_id);
    if (!order || order.status !== 'proof_sent') { results.push({ order_id: row.order_id, sent: false, skipped: 'order is no longer waiting on the proof' }); continue; }
    const links = linksFor(baseUrl(request, env), order);
    const mail = await sendOrderEmail(env, db, 'proof_reminder', { order, items: JSON.parse(order.line_items_json), links }, now);
    results.push({ order_id: order.id, sent: mail.ok, error: mail.ok ? undefined : mail.error });
  }
  return json({ ok: true, delay_hours: proofReminderDelayHours(env), checked: due.length, sent: results.filter((r) => r.sent).length, results });
}

export const onRequestGet = guarded(listHandler);
export const onRequestPost = guarded(sendHandler);
