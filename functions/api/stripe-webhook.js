// POST /api/stripe-webhook   register this URL in Stripe: https://getseensignsco.com/api/stripe-webhook
// Events to send: checkout.session.completed, checkout.session.async_payment_succeeded, charge.dispute.created
// The Stripe-Signature header is verified with STRIPE_WEBHOOK_SECRET against the raw body before anything is read.
//
//   checkout.session.completed (paid)  marks the order paid, stores the shipping address and amounts, emails
//                                      "payment received" once.
//   charge.dispute.created             logs the dispute with the stored approval evidence, saves it in the
//                                      disputes table, and emails the shop.
// Answers 200 for anything verified (including events we ignore), 400 for a bad signature, 500 when storage fails
// so Stripe retries.

import { getDb, one } from '../_lib/db.js';
import { verifyWebhook, StripeError } from '../_lib/stripe.js';
import { markPaid, recordDispute, linksFor, evidenceCore } from '../_lib/orders.js';
import { sendOrderEmail, sendShopAlert } from '../_lib/emails.js';
import { baseUrl, json, log, money } from '../_lib/util.js';

async function onPaid(env, db, request, session, now) {
  if (session.payment_status && session.payment_status !== 'paid') return { ignored: 'unpaid' };
  const res = await markPaid(db, session, now);
  if (!res.order) {
    log('payment_for_unknown_order', { session: session.id });
    return { ignored: 'unknown order' };
  }
  const already = await one(db, "SELECT 1 AS x FROM emails WHERE order_id = ? AND kind = 'payment_received' AND status = 'sent'", [res.order.id]);
  if (!already && (res.order.status === 'paid' || res.order.status === 'shipped')) {
    await sendOrderEmail(env, db, 'payment_received', {
      order: res.order,
      items: JSON.parse(res.order.line_items_json),
      links: linksFor(baseUrl(request, env), res.order),
      amountTotalCents: res.order.amount_total_cents,
    }, now);
  }
  return { order: res.order.id, changed: res.changed };
}

async function onDispute(env, db, dispute, eventId, now) {
  const rec = await recordDispute(env, db, dispute, eventId, now);
  if (rec.isNew) {
    const lines = [
      'A customer opened a dispute. Reason: ' + (dispute.reason || 'unknown') + '. Amount: ' + money(dispute.amount) + '. Evidence due: ' + (rec.due || 'see Stripe') + '.',
      'Dispute ' + dispute.id + ', charge ' + (dispute.charge || '?') + '.',
    ];
    if (rec.order) {
      lines.push('Order ' + rec.order.id + ' (' + rec.order.customer_email + ').');
      if (rec.approval) {
        const ev = evidenceCore(rec.approval);
        lines.push(
          'Approval evidence ' + ev.id + ': approved ' + ev.approved_at + ' from IP ' + ev.ip + ', proof v' + ev.proof_version + ' hash ' + ev.proof_hash + ', terms "' + ev.terms_version + '" hash ' + ev.terms_hash + '.',
          'Full packet: GET /api/admin/orders/' + rec.order.id + ' (evidence_packet).'
        );
      } else lines.push('No approval record was found for this order.');
    } else lines.push('Could not match this dispute to an order.');
    await sendShopAlert(env, db, rec.order ? rec.order.id : '', 'dispute', 'Dispute opened: ' + (rec.order ? rec.order.id : dispute.id), lines, now);
  }
  return { dispute: dispute.id, order: rec.order ? rec.order.id : null };
}

export async function handle(request, env, now) {
  const raw = await request.text();
  let event;
  try {
    event = await verifyWebhook(raw, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET, Math.floor(now.getTime() / 1000));
  } catch (err) {
    if (err instanceof StripeError && err.status === 500) return json({ ok: false, error: 'webhook is not configured' }, 500);
    log('webhook_rejected', { reason: err.message });
    return json({ ok: false, error: 'invalid signature' }, 400);
  }
  const db = await getDb(env);
  const object = event.data && event.data.object;
  let result = { ignored: event.type };
  if (object && (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded')) result = await onPaid(env, db, request, object, now);
  else if (object && event.type === 'charge.dispute.created') result = await onDispute(env, db, object, event.id, now);
  return json({ ok: true, received: event.type, result });
}

export async function onRequestPost(context) {
  try {
    return await handle(context.request, context.env, context.now instanceof Date ? context.now : new Date());
  } catch (err) {
    console.error('stripe webhook failed: ' + err.message);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
