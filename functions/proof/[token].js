// GET  /proof/<token>  the proof approval page.
// POST /proof/<token>  action=approve (records the evidence, then sends the customer on to Stripe Checkout)
//                      action=revise  (records a free revision request)
// The token is 256 random bits; knowing it is the only credential. Pages are never cached or indexed.

import { getDb } from '../_lib/db.js';
import { getOrderByToken, loadBundle, approveProof, requestRevision, startCheckout, linksFor, MAX_FREE_REVISIONS } from '../_lib/orders.js';
import { readTerms } from '../_lib/terms.js';
import { sendOrderEmail, sendShopAlert } from '../_lib/emails.js';
import { proofPage, messagePage } from '../_lib/pages.js';
import { baseUrl, clientIp, userAgent, html, redirect, sameOrigin, log } from '../_lib/util.js';

const NOT_FOUND = () => html(messagePage('Link not found', 'We could not find that proof. Please use the link from your email, or contact us.'), 404);

async function termsOrNull(request, env) {
  try {
    return await readTerms(request, env);
  } catch (err) {
    log('terms_unavailable', { error: err.message });
    return null;
  }
}

export async function showHandler(request, env, token, extra) {
  const db = await getDb(env);
  const order = await getOrderByToken(db, token);
  if (!order) return NOT_FOUND();
  const bundle = await loadBundle(db, order);
  const terms = order.status === 'proof_sent' ? await termsOrNull(request, env) : null;
  return html(proofPage(bundle, Object.assign({ terms }, extra)), (extra && extra.status) || 200);
}

export async function postHandler(request, env, token, now, ctx) {
  if (!sameOrigin(request)) return html(messagePage('Request blocked', 'That request came from another site, so we did not process it.'), 403);
  const db = await getDb(env);
  const order = await getOrderByToken(db, token);
  if (!order) return NOT_FOUND();
  let form;
  try {
    const data = await request.formData();
    form = Object.fromEntries([...data.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : '']));
  } catch (_) {
    return showHandler(request, env, token, { error: 'We could not read that form. Please try again.', status: 400 });
  }
  const meta = { ip: clientIp(request), userAgent: userAgent(request) };
  const base = baseUrl(request, env);
  const links = linksFor(base, order);
  const later = (promise) => (ctx && ctx.waitUntil ? ctx.waitUntil(promise) : promise);

  if (form.action === 'revise') {
    const res = await requestRevision(db, order, form, meta, now);
    if (res.error) return showHandler(request, env, token, { error: res.error, comment: form.comment, status: res.status });
    await later(
      sendShopAlert(env, db, order.id, 'revision_requested', 'Revision requested: order ' + order.id, [
        'Order ' + order.id + ' (' + order.customer_email + ') asked for a change on proof version ' + form.proof_version + '.',
        'Revision ' + res.revisionsUsed + ' of ' + MAX_FREE_REVISIONS + ' free.',
        'Comment:',
        res.comment,
        'Add the new proof with POST /api/admin/orders/' + order.id + '/proof',
      ], now)
    );
    return html(proofPage(await loadBundle(db, await getOrderByToken(db, token)), { notice: 'Thanks. We will email you a new proof within 12 hours.' }));
  }

  if (form.action !== 'approve') return showHandler(request, env, token, { error: 'Unknown action.', status: 400 });

  const terms = await termsOrNull(request, env);
  if (!terms) return showHandler(request, env, token, { error: 'We could not load our Terms just now, so approval is paused. Please try again in a minute.', status: 503 });
  const res = await approveProof(db, order, form, meta, terms, now);
  if (res.error) {
    if (res.state) return redirect(links.order);
    return showHandler(request, env, token, { error: res.error, name: form.customer_name, status: res.status });
  }
  const items = JSON.parse(res.order.line_items_json);
  await later(sendOrderEmail(env, db, 'proof_approved', { order: res.order, items, links }, now));
  const checkout = await startCheckout(env, db, res.order, links, now);
  if (checkout.url) return redirect(checkout.url);
  return redirect(links.order + '?payment=retry');
}

export async function onRequestGet(context) {
  try {
    return await showHandler(context.request, context.env, context.params.token);
  } catch (err) {
    console.error('proof page failed: ' + err.message);
    return html(messagePage('Something went wrong', 'Please try again in a minute, or contact us.'), 500);
  }
}

export async function onRequestPost(context) {
  try {
    return await postHandler(context.request, context.env, context.params.token, context.now instanceof Date ? context.now : new Date(), context);
  } catch (err) {
    console.error('proof post failed: ' + err.message);
    return html(messagePage('Something went wrong', 'Please try again in a minute, or contact us.'), 500);
  }
}
