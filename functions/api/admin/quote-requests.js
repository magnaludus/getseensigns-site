// Admin: GET /api/admin/quote-requests lists the latest 100 quote requests from the site form.
// Look at shop_email: 'failed' or 'pending' means the request is saved but the email to the shop did not go out,
// so call or reply to that customer. Add ?needs_attention=1 to list only those.
// Auth: Authorization: Bearer <ADMIN_TOKEN>.

import { guarded } from '../../_lib/admin.js';
import { getDb, all } from '../../_lib/db.js';
import { json } from '../../_lib/util.js';

export async function listHandler(request, env) {
  const db = await getDb(env);
  const onlyOpen = new URL(request.url).searchParams.get('needs_attention') === '1';
  const where = onlyOpen ? " WHERE shop_email != 'sent'" : '';
  const rows = await all(
    db,
    'SELECT ref, created_at, status, customer_name, customer_email, product, quantity, size, needed_by, details, shop_email, customer_email_status, email_error FROM quote_requests' + where + ' ORDER BY created_at DESC LIMIT 100',
    []
  );
  return json({ ok: true, requests: rows });
}

export const onRequestGet = guarded(listHandler);
