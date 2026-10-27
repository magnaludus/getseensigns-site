// Admin: POST /api/admin/orders creates an order with its first proof and emails the proof link.
//        GET  /api/admin/orders lists recent orders.
// Auth: Authorization: Bearer <ADMIN_TOKEN>.
//
// POST body (JSON):
//   customer_email   required
//   customer_name    optional; prefilled on the approval form
//   line_items       required list. Each is {sku, quantity} for a catalog item (see functions/_lib/catalog.js),
//                    or {name, quantity, unit_amount_cents} for a custom total. {sku:"shipping", name,
//                    unit_amount_cents} adds a shipping charge. Optional "description" shows under the item.
//   proof_image_url  required https link to a png/jpeg/webp/gif (or proof_image_urls: [..] up to 6)
//   proof_note       optional note shown under the proof
//   notes            optional internal note
// Answers 201 {ok, order_id, proof_url, order_url, email: {sent}}.

import { guarded, readJsonBody } from '../../_lib/admin.js';
import { getDb, all } from '../../_lib/db.js';
import { createOrder, linksFor } from '../../_lib/orders.js';
import { sendOrderEmail } from '../../_lib/emails.js';
import { baseUrl, json, log } from '../../_lib/util.js';

export async function createHandler(request, env, now) {
  const parsed = await readJsonBody(request);
  if (parsed.error) return json({ ok: false, error: parsed.error }, 400);
  const db = await getDb(env);
  const made = await createOrder(db, parsed.body, now);
  if (made.error) return json({ ok: false, error: made.error }, 400);
  const links = linksFor(baseUrl(request, env), made.order);
  const items = JSON.parse(made.order.line_items_json);
  log('order_created', { order: made.order.id });
  const mail = await sendOrderEmail(env, db, 'proof_ready', { order: made.order, items, links, version: 1 }, now);
  return json({ ok: true, order_id: made.order.id, status: made.order.status, proof_url: links.proof, order_url: links.order, email: { sent: mail.ok, error: mail.ok ? undefined : mail.error } }, 201);
}

export async function listHandler(request, env) {
  const db = await getDb(env);
  const rows = await all(db, 'SELECT id, status, customer_email, customer_name, subtotal_cents, revisions_used, created_at, updated_at, paid_at FROM orders ORDER BY created_at DESC LIMIT 100', []);
  return json({ ok: true, orders: rows });
}

export const onRequestPost = guarded(createHandler);
export const onRequestGet = guarded(listHandler);
