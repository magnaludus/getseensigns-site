// Admin: GET /api/admin/email-signups lists the latest 500 footer signups.
// ?no_code=1 lists only the people whose welcome email went out without a 10% code (SIGNUP_PROMO_CODE was not
// set yet), so they can be sent the code once it exists.
// Auth: Authorization: Bearer <ADMIN_TOKEN>.

import { guarded } from '../../_lib/admin.js';
import { getDb, all } from '../../_lib/db.js';
import { json } from '../../_lib/util.js';

export async function listHandler(request, env) {
  const db = await getDb(env);
  const noCode = new URL(request.url).searchParams.get('no_code') === '1';
  const where = noCode ? " WHERE promo_code = '' AND status = 'subscribed'" : '';
  const rows = await all(
    db,
    'SELECT email, created_at, updated_at, status, source, brevo_status, welcome_status, promo_code, error FROM email_signups' + where + ' ORDER BY created_at DESC LIMIT 500',
    []
  );
  return json({ ok: true, signups: rows });
}

export const onRequestGet = guarded(listHandler);
