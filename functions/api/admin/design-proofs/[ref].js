// Admin: GET /api/admin/design-proofs/<ref> returns one designer proof request: the request fields, the design
// document, the file list (which were attached, which are saved here) and the email status.

import catalog from '../../../../assets/design/catalog.json' with { type: 'json' };
import { previewPlan, describePieces } from '../../../../assets/design/model/proof-plan.js';
import { guarded } from '../../../_lib/admin.js';
import { getDb, one } from '../../../_lib/db.js';
import { json, DESIGN_REF_RE } from '../../../_lib/util.js';

export async function detailHandler(request, env, now, context) {
  const ref = context.params.ref;
  if (!DESIGN_REF_RE.test(ref)) return json({ ok: false, error: 'not found' }, 404);
  const db = await getDb(env);
  const row = await one(db, 'SELECT * FROM design_proof_requests WHERE ref = ?', [ref]);
  if (!row) return json({ ok: false, error: 'not found' }, 404);
  const design = row.design_json ? JSON.parse(row.design_json) : null;
  const designEnv = { catalog: catalog, fonts: catalog.fonts };
  return json({
    ok: true,
    ref: row.ref,
    created_at: row.created_at,
    status: row.status,
    emails: { shop: row.shop_email, customer: row.customer_email_status, error: row.email_error },
    request: JSON.parse(row.request_json),
    design: design,
    // what is on every side, and (for a table throw) each panel with how it is turned on the flat, plus what each
    // preview picture shows: the whole flat first, then every panel as it reads installed
    pieces: design ? describePieces(design, designEnv) : null,
    previews: design ? previewPlan(design, designEnv).map((p) => ({ file: 'preview-' + p.n + '.png', kind: p.kind, piece: p.pi + 1, side: p.si, label: p.label })) : null,
    files: JSON.parse(row.files_json),
  });
}

export const onRequestGet = guarded(detailHandler);
