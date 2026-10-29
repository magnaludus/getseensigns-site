// Admin: POST /api/admin/orders/<id>/tracking adds a carrier and tracking number to a paid order, marks it
// shipped, and emails the customer. Body: {carrier, tracking_number, tracking_url?}

import { guarded, readJsonBody } from '../../../../_lib/admin.js';
import { getDb } from '../../../../_lib/db.js';
import { getOrderById, addShipment, linksFor } from '../../../../_lib/orders.js';
import { sendOrderEmail } from '../../../../_lib/emails.js';
import { baseUrl, json } from '../../../../_lib/util.js';

export async function trackingHandler(request, env, now, context) {
  const parsed = await readJsonBody(request);
  if (parsed.error) return json({ ok: false, error: parsed.error }, 400);
  const db = await getDb(env);
  const order = await getOrderById(db, context.params.id);
  if (!order) return json({ ok: false, error: 'order not found' }, 404);
  const made = await addShipment(db, order, parsed.body, now);
  if (made.error) return json({ ok: false, error: made.error }, made.status || 400);
  const links = linksFor(baseUrl(request, env), made.order);
  const mail = await sendOrderEmail(env, db, 'shipped', { order: made.order, items: JSON.parse(made.order.line_items_json), links, shipment: made.shipment }, now);
  return json({ ok: true, order_id: made.order.id, status: made.order.status, shipment: made.shipment, order_url: links.order, email: { sent: mail.ok, error: mail.ok ? undefined : mail.error } });
}

export const onRequestPost = guarded(trackingHandler);
