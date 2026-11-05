// Admin: GET /api/admin/orders/<id> returns the order, every proof, the approval evidence record, shipments,
// email log, disputes, and a plain-text evidence packet for Stripe's dispute form.

import catalog from '../../../../assets/design/catalog.json' with { type: 'json' };
import { previewPlan, describePieces } from '../../../../assets/design/model/proof-plan.js';
import { guarded } from '../../../_lib/admin.js';
import { getDb, all, one } from '../../../_lib/db.js';
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
  const intake = await one(db, 'SELECT request_json, files_json, design_json, shop_email, customer_email_status FROM design_proof_requests WHERE ref = ?', [order.id]);
  const design = intake && intake.design_json ? JSON.parse(intake.design_json) : null;
  const designEnv = { catalog: catalog, fonts: catalog.fonts };
  const evidence = bundle.approval ? Object.assign(evidenceCore(bundle.approval), { record_hash: bundle.approval.record_hash, record_hash_valid: (await recordHashOf(bundle.approval)) === bundle.approval.record_hash }) : null;
  return json({
    ok: true,
    order: Object.assign({}, order, { line_items_json: undefined, items: bundle.items, shipping: order.shipping_json ? JSON.parse(order.shipping_json) : null, shipping_json: undefined }),
    proofs: bundle.proofs.map((p) => ({ version: p.version, files: p.files, proof_hash: p.proof_hash, note: p.note, created_at: p.created_at })),
    // What the customer sent with the order request (phone, event date, artwork notes, files); read the saved files at
    // /api/admin/design-proofs/<id>/<file>. Null for orders made by hand in /admin/.
    // `pieces` says what is on every side (for a table throw, each panel and how it is turned on the flat) and `previews`
    // says which saved picture shows what: the whole flat first, then every panel as it reads installed.
    request: intake
      ? {
          fields: JSON.parse(intake.request_json),
          files: JSON.parse(intake.files_json),
          emails: { shop: intake.shop_email, customer: intake.customer_email_status },
          pieces: design ? describePieces(design, designEnv) : null,
          previews: design ? previewPlan(design, designEnv).map((p) => ({ file: 'preview-' + p.n + '.png', kind: p.kind, piece: p.pi + 1, side: p.si, label: p.label })) : null,
        }
      : null,
    revisions,
    evidence,
    shipments: bundle.shipments,
    emails,
    disputes,
    evidence_packet: evidencePacket(bundle, disputes),
  });
}

export const onRequestGet = guarded(detailHandler);
