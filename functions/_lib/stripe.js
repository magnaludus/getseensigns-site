// Stripe over plain fetch (no SDK, so it runs in a Worker): Checkout Session creation, webhook signature
// verification, and one charge lookup. STRIPE_SECRET_KEY is read from env only.

import { CATALOG, TAX_CODE, SHIPPING_TAX_CODE } from './catalog.js';
import { safeEqual } from './util.js';

const API = 'https://api.stripe.com/v1';
const TOLERANCE_SECONDS = 300;
const SESSION_LIFETIME_SECONDS = 23 * 3600;

export class StripeError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export const isTestKey = (key) => /^(sk|rk)_test_/.test(key || '');

// Resolves one requested line into what is stored and shown: catalog SKUs use the catalog's name and amount,
// anything else is a custom line with its own amount. Returns {error} instead of throwing.
export function resolveLineItem(raw) {
  if (!raw || typeof raw !== 'object') return { error: 'line item must be an object' };
  const quantity = Number(raw.quantity == null ? 1 : raw.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) return { error: 'quantity must be a whole number from 1 to 10000' };
  const sku = typeof raw.sku === 'string' ? raw.sku.trim() : '';
  const hasAmount = raw.unit_amount_cents != null;
  const amount = Number(raw.unit_amount_cents);
  if (hasAmount && (!Number.isInteger(amount) || amount < 1 || amount > 10000000)) return { error: 'unit_amount_cents must be a whole number of cents' };

  if (sku && sku !== 'shipping') {
    const entry = Object.prototype.hasOwnProperty.call(CATALOG, sku) ? CATALOG[sku] : null;
    if (!entry) return { error: 'unknown sku ' + sku.slice(0, 60) };
    if (hasAmount && amount !== entry.amount) return { error: 'sku ' + sku + ' is $' + entry.amount / 100 + ' each; leave out sku to bill a custom amount' };
    const note = typeof raw.description === 'string' ? raw.description.trim().slice(0, 300) : '';
    return { item: { sku: sku, name: entry.name, quantity: quantity, unit_amount_cents: entry.amount, price_id: entry.priceId, description: note } };
  }
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name : typeof raw.description === 'string' ? raw.description : '';
  const clean = name.replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, 200);
  if (!clean) return { error: 'custom line items need a name or description' };
  if (!hasAmount) return { error: 'custom line items need unit_amount_cents' };
  return {
    item: {
      sku: sku === 'shipping' ? 'shipping' : '',
      name: clean,
      quantity: quantity,
      unit_amount_cents: amount,
      price_id: '',
      description: '',
    },
  };
}

export const subtotalOf = (items) => items.reduce((sum, it) => sum + it.unit_amount_cents * it.quantity, 0);

function encode(params) {
  const body = new URLSearchParams();
  for (const [key, value] of params) body.append(key, value);
  return body.toString();
}

// Builds the form fields for POST /v1/checkout/sessions.
export function checkoutParams({ order, approval, items, successUrl, cancelUrl, useCatalogPrices, now }) {
  const p = [];
  p.push(['mode', 'payment']);
  p.push(['client_reference_id', order.id]);
  p.push(['customer_email', order.customer_email]);
  p.push(['success_url', successUrl]);
  p.push(['cancel_url', cancelUrl]);
  p.push(['automatic_tax[enabled]', 'true']);
  p.push(['allow_promotion_codes', 'true']);
  p.push(['shipping_address_collection[allowed_countries][0]', 'US']);
  p.push(['consent_collection[terms_of_service]', 'required']);
  p.push(['phone_number_collection[enabled]', 'true']);
  p.push(['payment_intent_data[capture_method]', 'automatic']);
  p.push(['payment_intent_data[description]', 'Get Seen Signs order ' + order.id]);
  p.push(['expires_at', String(Math.floor((now instanceof Date ? now : new Date()).getTime() / 1000) + SESSION_LIFETIME_SECONDS)]);

  const meta = {
    order_id: order.id,
    proof_evidence_id: approval.id,
    approved_at: approval.approved_at,
    proof_version: String(approval.proof_version),
    proof_hash: approval.proof_hash,
    terms_hash: approval.terms_hash,
  };
  for (const [k, v] of Object.entries(meta)) {
    p.push(['metadata[' + k + ']', v]);
    p.push(['payment_intent_data[metadata][' + k + ']', v]);
  }

  items.forEach((it, i) => {
    const at = 'line_items[' + i + ']';
    p.push([at + '[quantity]', String(it.quantity)]);
    if (it.price_id && useCatalogPrices) {
      p.push([at + '[price]', it.price_id]);
      return;
    }
    p.push([at + '[price_data][currency]', 'usd']);
    p.push([at + '[price_data][unit_amount]', String(it.unit_amount_cents)]);
    p.push([at + '[price_data][tax_behavior]', 'exclusive']);
    p.push([at + '[price_data][product_data][name]', it.name]);
    p.push([at + '[price_data][product_data][tax_code]', it.sku === 'shipping' ? SHIPPING_TAX_CODE : TAX_CODE]);
  });
  return p;
}

async function stripeRequest(env, method, path, bodyParams, idempotencyKey) {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeError('STRIPE_SECRET_KEY is not set', 500);
  const headers = { Authorization: 'Bearer ' + key };
  if (bodyParams) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(API + path, { method: method, headers: headers, body: bodyParams ? encode(bodyParams) : undefined });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }
  if (!res.ok) {
    const detail = data && data.error ? { type: data.error.type, code: data.error.code, param: data.error.param, message: data.error.message } : null;
    throw new StripeError('Stripe ' + res.status + (detail && detail.message ? ': ' + detail.message : ''), res.status, detail);
  }
  return data;
}

export async function createCheckoutSession(env, input) {
  const params = checkoutParams(Object.assign({ useCatalogPrices: !isTestKey(env.STRIPE_SECRET_KEY) }, input));
  const session = await stripeRequest(env, 'POST', '/checkout/sessions', params, input.idempotencyKey);
  if (!session || !session.id || !session.url) throw new StripeError('Stripe returned no checkout url', 502);
  return session;
}

export async function getCharge(env, chargeId) {
  return stripeRequest(env, 'GET', '/charges/' + encodeURIComponent(chargeId));
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>...]; signed payload is `${t}.${rawBody}`.
export async function verifyWebhook(rawBody, header, secret, nowSeconds) {
  if (!secret) throw new StripeError('STRIPE_WEBHOOK_SECRET is not set', 500);
  if (!header) throw new StripeError('missing signature', 400);
  let timestamp = '';
  const sigs = [];
  for (const part of header.split(',')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    const k = part.slice(0, at).trim();
    const v = part.slice(at + 1).trim();
    if (k === 't') timestamp = v;
    else if (k === 'v1') sigs.push(v);
  }
  const t = Number(timestamp);
  if (!Number.isFinite(t) || !sigs.length) throw new StripeError('bad signature header', 400);
  const now = nowSeconds == null ? Math.floor(Date.now() / 1000) : nowSeconds;
  if (Math.abs(now - t) > TOLERANCE_SECONDS) throw new StripeError('signature timestamp outside tolerance', 400);
  const expected = await hmacHex(secret, timestamp + '.' + rawBody);
  let ok = false;
  for (const sig of sigs) if (await safeEqual(sig, expected)) ok = true;
  if (!ok) throw new StripeError('signature mismatch', 400);
  try {
    return JSON.parse(rawBody);
  } catch (_) {
    throw new StripeError('body is not JSON', 400);
  }
}

// Used by tests to sign a payload the way Stripe does.
export async function signWebhook(rawBody, secret, timestamp) {
  return 't=' + timestamp + ',v1=' + (await hmacHex(secret, timestamp + '.' + rawBody));
}
