// GET  /order/<token>  order status page (proof, paid, tracking).
// POST /order/<token>  action=pay opens Stripe Checkout for an approved, unpaid order.

import { getDb } from '../_lib/db.js';
import { getOrderByToken, loadBundle, startCheckout, linksFor } from '../_lib/orders.js';
import { orderPage, messagePage } from '../_lib/pages.js';
import { baseUrl, html, redirect, sameOrigin } from '../_lib/util.js';

const NOT_FOUND = () => html(messagePage('Link not found', 'We could not find that order. Please use the link from your email, or contact us.'), 404);

export async function showHandler(request, env, token, extra) {
  const db = await getDb(env);
  const order = await getOrderByToken(db, token);
  if (!order) return NOT_FOUND();
  const url = new URL(request.url);
  const opts = Object.assign({ paid: url.searchParams.get('paid') === '1' }, extra);
  if (!opts.error && url.searchParams.get('payment') === 'retry' && order.status === 'approved') opts.error = 'We could not open the payment page. Please press Pay to try again.';
  return html(orderPage(await loadBundle(db, order), opts), (extra && extra.status) || 200);
}

export async function postHandler(request, env, token, now) {
  if (!sameOrigin(request)) return html(messagePage('Request blocked', 'That request came from another site, so we did not process it.'), 403);
  const db = await getDb(env);
  const order = await getOrderByToken(db, token);
  if (!order) return NOT_FOUND();
  const links = linksFor(baseUrl(request, env), order);
  const res = await startCheckout(env, db, order, links, now);
  if (res.url) return redirect(res.url);
  return showHandler(request, env, token, { error: res.error, status: res.status });
}

export async function onRequestGet(context) {
  try {
    return await showHandler(context.request, context.env, context.params.token);
  } catch (err) {
    console.error('order page failed: ' + err.message);
    return html(messagePage('Something went wrong', 'Please try again in a minute, or contact us.'), 500);
  }
}

export async function onRequestPost(context) {
  try {
    return await postHandler(context.request, context.env, context.params.token, context.now instanceof Date ? context.now : new Date());
  } catch (err) {
    console.error('order post failed: ' + err.message);
    return html(messagePage('Something went wrong', 'Please try again in a minute, or contact us.'), 500);
  }
}
