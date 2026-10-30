// GET  /approve/<token>/  the "Approve your proof" page: proof, order summary and the ship-to form.
// POST /approve/<token>/  action=approve  (needs the checkbox and a complete ship-to; emails sales@, then the
//                                         page shows the thank-you)
//                         action=changes  (saves the notes without approving; emails sales@)
// The token is 256 random bits; knowing it is the only credential. Pages are never cached or indexed.
// A catch-all route so /approve/<token> and /approve/<token>/ both work.

import { getDb } from '../_lib/db.js';
import { getApprovalByToken, approve, requestChanges, setShopEmail, shipToLines, SHIP_FIELDS } from '../_lib/proof-approvals.js';
import { sendShopAlert } from '../_lib/emails.js';
import { approvePage, messagePage, fmtDate } from '../_lib/pages.js';
import { clientIp, userAgent, html, redirect, sameOrigin, log } from '../_lib/util.js';

const NOT_FOUND = () => html(messagePage('Link not found', 'We could not find that proof. Please use the link we sent you, or contact us.'), 404);

export function tokenFrom(params) {
  const parts = (Array.isArray(params && params.path) ? params.path : [params && params.path]).filter((p) => typeof p === 'string' && p !== '');
  return parts.length === 1 ? parts[0] : '';
}

export async function showHandler(request, env, token, extra) {
  const db = await getDb(env);
  const record = await getApprovalByToken(db, token);
  if (!record) return NOT_FOUND();
  return html(approvePage(record, extra), (extra && extra.status) || 200);
}

function approvedLines(r) {
  return [
    'Proof ' + r.ref + ' was approved by ' + r.customer_name + '.',
    'Approved at: ' + r.approved_at + ' (' + fmtDate(r.approved_at) + ')',
    'Order: ' + r.order_description.replace(/\n/g, ' / '),
    'Proof: ' + r.proof_url,
    'Ship to:',
    ...shipToLines(r),
    'Phone: ' + r.ship_phone,
    'Email: ' + r.ship_email,
    r.notes ? 'Customer notes: ' + r.notes : 'Customer notes: none',
    'IP: ' + (r.ip || 'unknown'),
    'The ship-to is complete, so the invoice can go out.',
  ];
}

function changesLines(r) {
  return [
    r.customer_name + ' asked for changes on proof ' + r.ref + ' (not approved).',
    'Order: ' + r.order_description.replace(/\n/g, ' / '),
    'Proof: ' + r.proof_url,
    'Requested changes:',
    r.notes,
    'Send an updated proof with a new link from POST /api/admin/proof-approvals.',
  ];
}

export async function postHandler(request, env, token, now, ctx) {
  if (!sameOrigin(request)) return html(messagePage('Request blocked', 'That request came from another site, so we did not process it.'), 403);
  const db = await getDb(env);
  const record = await getApprovalByToken(db, token);
  if (!record) return NOT_FOUND();
  let form;
  try {
    const data = await request.formData();
    form = Object.fromEntries([...data.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : '']));
  } catch (_) {
    return showHandler(request, env, token, { error: 'We could not read that form. Please try again.', status: 400 });
  }
  const values = { notes: form.notes, approve: form.approve };
  for (const f of SHIP_FIELDS) values[f.name] = form[f.name];
  const meta = { ip: clientIp(request), userAgent: userAgent(request) };
  const here = '/approve/' + record.token + '/';
  const later = (promise) => (ctx && ctx.waitUntil ? ctx.waitUntil(promise) : promise);

  if (form.action !== 'approve' && form.action !== 'changes') return showHandler(request, env, token, { error: 'Unknown action.', values, status: 400 });
  const res = form.action === 'approve' ? await approve(db, record, form, meta, now) : await requestChanges(db, record, form, meta, now);
  if (res.error) {
    if (res.status === 409) return redirect(here);
    return showHandler(request, env, token, { error: res.error, fields: res.fields, values, status: res.status });
  }

  const r = res.record;
  const approved = r.status === 'approved';
  log(approved ? 'proof_approval_approved' : 'proof_approval_changes', { ref: r.ref });
  const subject = approved ? 'Proof approved with ship-to: ' + r.customer_name + ' (' + r.ref + ')' : 'Changes requested: ' + r.customer_name + ' (' + r.ref + ')';
  await later(
    sendShopAlert(env, db, r.ref, approved ? 'proof_approval_approved' : 'proof_approval_changes', subject, approved ? approvedLines(r) : changesLines(r), now).then((mail) =>
      setShopEmail(db, r.token, mail.ok ? 'sent' : 'failed', mail.ok ? '' : mail.error, now)
    )
  );
  return redirect(here);
}

export async function onRequestGet(context) {
  try {
    const token = tokenFrom(context.params);
    if (!token) return NOT_FOUND();
    return await showHandler(context.request, context.env, token);
  } catch (err) {
    console.error('approve page failed: ' + err.message);
    return html(messagePage('Something went wrong', 'Please try again in a minute, or contact us.'), 500);
  }
}

export async function onRequestPost(context) {
  try {
    const token = tokenFrom(context.params);
    if (!token) return NOT_FOUND();
    return await postHandler(context.request, context.env, token, context.now instanceof Date ? context.now : new Date(), context);
  } catch (err) {
    console.error('approve post failed: ' + err.message);
    return html(messagePage('Something went wrong', 'Please try again in a minute, or contact us.'), 500);
  }
}
