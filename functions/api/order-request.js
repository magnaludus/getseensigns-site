// Cloudflare Pages Function: POST /api/order-request
//
// The order panel on every product page posts here (multipart/form-data, same fields as /api/design-proof plus
// request.order = {items:[{sku, quantity}], options:[{label, value}]}). It needs the DB binding and BREVO_API_KEY
// (see design-proof.js for the on/off rules, honeypot, rate limit, size caps and SVG sanitizing, which are the same).
//
// What it does: saves the request and any artwork like a designer proof request, creates the order in D1 with the
// status awaiting_proof (order id = the GS- reference), emails sales@getseensignsco.com, and emails the customer a
// confirmation. Prices come only from the server's catalog; the browser sends a sku and a quantity, never an amount.
// Nothing is charged: the customer approves the proof and pays from the proof link we email once it is ready.
//
// mode "upload" (at least one artwork file) | "design_for_me" (wording and website in designForMe) | "self" (a design
// from the designer with previews). Answers: 200 {ok, ref, emailed, stored, order: {id, url, subtotal}};
// 400 {ok:false, error: fields|order|logo|preview|design|form}; 413; 429; 500 storage; 503 {ok:false, enabled:false}.

import { handle } from './design-proof.js';
import { json } from '../_lib/util.js';

export async function onRequestPost(context) {
  try {
    return await handle(context.request, context.env, context.now instanceof Date ? context.now : new Date(), undefined, { orderRequired: true });
  } catch (_) {
    console.error('order-request failed');
    return json({ ok: false, error: 'server' }, 500);
  }
}
