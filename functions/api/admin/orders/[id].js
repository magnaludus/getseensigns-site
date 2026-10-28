// Admin: GET /api/admin/orders/<id> returns the order, every proof, the approval evidence record, shipments,
// email log, disputes, and a plain-text evidence packet for Stripe's dispute form.

import { guarded } from '../../../_lib/admin.js';
import { getDb, all } from '../../../_lib/db.js';
import { getOrderById, loadBundle, evidencePacket, evidenceCore, recordHashOf } from '../../../_lib/orders.js';
import { json } from '../../../_lib/util.js';

export async function detailHandler(request, env, now, context) {
  const db = await getDb(env);
  const order = await getOrderById(db, context.params.id);
  if (!order) return json({ ok: false, error: 'order not found' }, 404);
  const bundle = await loadBundle(db, order);
  const revisions = await all(db, 'SELECT * FROM revisions WHERE order_id = ? ORDER BY id', [order.id]);
  const emails = await all(db, 'SELECT kind, to_email, status, error, created_at FROM emails WHERE order_id = ? ORDER BY id', [order.id]);
  const disputes = await all(db, 'SELECT id, charge_id, payment_intent_id, amount_cents, currency, reason, status, evidence_due_by, logged_at FROM disputes WHERE order_id = ? ORDER BY logged_at', [order.id]);
  const evidence = bundle.approval ? Object.assign(evidenceCore(bundle.approval), { record_hash: bundle.approval.record_hash, record_hash_valid: (await recordHashOf(bundle.approval)) === bundle.approval.record_hash }) : null;
  return json({
    ok: true,
    order: Object.assign({}, order, { line_items_json: undefined, items: bundle.items, shipping: order.shipping_json ? JSON.parse(order.shipping_json) : null, shipping_json: undefined }),
    proofs: bundle.proofs.map((p) => ({ version: p.version, files: p.files, proof_hash: p.proof_hash, note: p.note, created_at: p.created_at })),
    revisions,
    evidence,
    shipments: bundle.shipments,
    emails,
    disputes,
    evidence_packet: evidencePacket(bundle, disputes),
  });
}

export const onRequestGet = guarded(detailHandler);
