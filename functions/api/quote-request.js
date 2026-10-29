// Cloudflare Pages Function: POST /api/quote-request
//
// The "Get a quote" form on the home page (#quote) posts here (multipart/form-data or a URL-encoded form):
//   name, email, product (required); quantity, size, needed_by (YYYY-MM-DD), details (optional);
//   _gotcha (honeypot: any value gets a fake success and nothing is stored); elapsedMs (ms since the form was shown,
//   under 3 seconds gets a fake success); attempt (optional, 16 to 64 letters, digits, - or _: one id per filled-in
//   form, reused when the page retries). The reference is derived from it, so a retry of a request that already
//   went through answers with the same reference instead of saving or emailing it twice.
//
// What it does: saves the request in D1 (table quote_requests), emails sales@getseensignsco.com through Brevo with
// Reply-To set to the customer, and emails the customer a short confirmation with a reference (QR-XXXXXXXX).
// On or off: the same rule as the designer proof endpoint (DB and BREVO_API_KEY both set; DESIGN_PROOF_ENABLED=false
// switches it off with a 503). No new env var, no new binding. The table is created on first use (migrations/0003).
//
// Answers: 200 {ok, ref, emailed, stored, confirmed}; 400 {ok:false, error:'fields', fields:[...]};
// 429 {ok:false, error:'rate'}; 500 {ok:false, error:'storage'|'server'}; 503 {ok:false, enabled:false}.
// emailed is true when the email to the shop went out (one automatic retry first). emailed false with stored true
// means the request is saved but the shop email failed: the page shows the reference and says so, and the request
// is listed by GET /api/admin/quote-requests (shop_email = 'failed'). No IP, cookie or user agent is kept.

import { getDb, run, one, changes } from '../_lib/db.js';
import { brevoSend, layout, p as para } from '../_lib/emails.js';
import { SHOP_EMAIL, SHOP_PHONE, esc, oneLine, multiLine, validEmail, nowIso, json } from '../_lib/util.js';
import { proofEnabled } from './design-proof.js';

const MIN_ELAPSED_MS = 3000;
const RATE_MAX = 8;
const RATE_WINDOW_MS = 3600000;
const MAX_BODY = 64 * 1024;
const REF_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const QUOTE_REF_RE = /^QR-[0-9A-HJKMNP-TV-Z]{8}$/;

const ATTEMPT_RE = /^[A-Za-z0-9_-]{16,64}$/;
const RETRY_MS = 300;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function makeQuoteRef() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return 'QR-' + Array.from(bytes, (b) => REF_CHARS[b & 31]).join('');
}

export async function refFromAttempt(attempt) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('quote-request:' + attempt)));
  return 'QR-' + Array.from(digest.slice(0, 8), (b) => REF_CHARS[b & 31]).join('');
}

const hits = new Map();

export function resetRateLimit() {
  hits.clear();
}

function refund(ip) {
  const list = ip && hits.get(ip);
  if (list && list.length) list.pop();
}

function limited(ip, ms) {
  if (!ip) return false;
  const recent = (hits.get(ip) || []).filter((t) => t > ms - RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(ms);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [key, times] of hits) if (!times.some((t) => t > ms - RATE_WINDOW_MS)) hits.delete(key);
  }
  return false;
}

const field = (form, name) => {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
};

export function readQuote(form) {
  const q = {
    name: oneLine(field(form, 'name'), 120),
    email: oneLine(field(form, 'email'), 200),
    product: oneLine(field(form, 'product'), 120),
    quantity: oneLine(field(form, 'quantity'), 12),
    size: oneLine(field(form, 'size'), 60),
    neededBy: oneLine(field(form, 'needed_by'), 10),
    details: multiLine(field(form, 'details'), 3000),
  };
  const bad = [];
  if (q.name.length < 2) bad.push('name');
  if (!validEmail(q.email)) bad.push('email');
  if (!q.product) bad.push('product');
  if (q.quantity && !(/^\d{1,6}$/.test(q.quantity) && Number(q.quantity) >= 1)) bad.push('quantity');
  if (q.neededBy && !(/^\d{4}-\d{2}-\d{2}$/.test(q.neededBy) && !Number.isNaN(Date.parse(q.neededBy + 'T00:00:00Z')))) bad.push('needed_by');
  return { quote: q, bad: bad };
}

function summaryLines(ref, q) {
  return [
    'New quote request ' + ref,
    '',
    'Name: ' + q.name,
    'Email: ' + q.email,
    'Product: ' + q.product,
    'Quantity: ' + (q.quantity || '-'),
    'Size: ' + (q.size || '-'),
    'Needed by: ' + (q.neededBy || '-'),
    '',
    'Details:',
    q.details || '-',
    '',
    'Reply to this email to answer the customer.',
  ];
}

async function sendShopEmail(env, ref, q) {
  const configured = oneLine(env.DESIGN_PROOF_TO, 200);
  const to = validEmail(configured) ? configured : SHOP_EMAIL;
  const text = summaryLines(ref, q).join('\n');
  const mail = {
    to: to,
    subject: 'Quote request: ' + q.product + ' (' + q.name + ') ' + ref,
    html: '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap">' + esc(text) + '</div>',
    text: text,
    replyTo: { email: q.email, name: q.name },
    tags: ['quote-request'],
  };
  try {
    await brevoSend(env, mail);
  } catch (_) {
    await sleep(RETRY_MS);
    await brevoSend(env, mail);
  }
}

async function sendConfirmation(env, ref, q) {
  const first = q.name.split(/\s+/)[0];
  const lead = 'Thanks for your quote request. We will reply with a price and next steps, usually within 1 business day.';
  const asked = [['Product', q.product], ['Quantity', q.quantity], ['Size', q.size], ['Needed by', q.neededBy]].filter((r) => r[1]);
  const html = layout({
    heading: 'We got your quote request',
    preheader: 'Reference ' + ref + '. We will reply within 1 business day.',
    bodyHtml:
      para('Hi ' + esc(first) + ',') + para(esc(lead)) +
      '<p style="margin:0 0 12px;font-size:20px"><strong>Reference ' + esc(ref) + '</strong></p>' +
      '<p style="margin:0 0 12px;color:#33363C">' + asked.map((r) => esc(r[0]) + ': ' + esc(r[1])).join('<br>') + '</p>' +
      para('Have a logo or a photo? Reply to this email with the file attached (PNG, JPG, PDF, SVG or AI) and mention your reference.') +
      para('Nothing is charged for a quote.'),
  });
  const text = [
    'Hi ' + first + ',', '', lead, '', 'Reference ' + ref, '',
    ...asked.map((r) => r[0] + ': ' + r[1]), '',
    'Have a logo or a photo? Reply to this email with the file attached (PNG, JPG, PDF, SVG or AI) and mention your reference.',
    'Nothing is charged for a quote.', '', '--', 'Get Seen Signs', SHOP_PHONE + ' | ' + SHOP_EMAIL + ' | getseensignsco.com',
  ].join('\n');
  await brevoSend(env, { to: q.email, toName: q.name, subject: 'We got your quote request (reference ' + ref + ')', html: html, text: text, tags: ['quote-request', 'confirmation'] });
}

async function mark(env, ref, shop, customer, error) {
  try {
    await run(await getDb(env), 'UPDATE quote_requests SET shop_email = ?, customer_email_status = ?, email_error = ? WHERE ref = ?', [shop, customer, String(error || '').slice(0, 300), ref]);
  } catch (_) {
    console.error('quote-request status update failed');
  }
}

export async function handle(request, env, now) {
  const when = now instanceof Date ? now : new Date();
  if (!proofEnabled(env) || !env.DB) return json({ ok: false, enabled: false }, 503);
  if (limited(request.headers.get('cf-connecting-ip'), when.getTime())) return json({ ok: false, error: 'rate' }, 429, { 'Retry-After': '3600' });
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return json({ ok: false, error: 'fields', fields: ['details'] }, 400);

  let form;
  try {
    form = await request.formData();
  } catch (_) {
    return json({ ok: false, error: 'fields', fields: [] }, 400);
  }
  const fake = () => json({ ok: true, ref: makeQuoteRef(), emailed: true, stored: true, confirmed: true });
  const trap = form.get('_gotcha');
  if (trap && (typeof trap !== 'string' || trap.trim())) return fake();
  const elapsed = Number(field(form, 'elapsedMs'));
  if (field(form, 'elapsedMs') !== '' && Number.isFinite(elapsed) && elapsed < MIN_ELAPSED_MS) return fake();

  const { quote: q, bad } = readQuote(form);
  if (bad.length) return json({ ok: false, error: 'fields', fields: bad }, 400);

  const attempt = field(form, 'attempt');
  const ip = request.headers.get('cf-connecting-ip');
  const ref = ATTEMPT_RE.test(attempt) ? await refFromAttempt(attempt) : makeQuoteRef();
  let sendShop = true;
  let sendConfirm = true;
  try {
    const db = await getDb(env);
    const inserted = await run(
      db,
      'INSERT OR IGNORE INTO quote_requests (ref, created_at, status, customer_name, customer_email, product, quantity, size, needed_by, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [ref, nowIso(when), 'new', q.name, q.email, q.product, q.quantity, q.size, q.neededBy, q.details]
    );
    if (!changes(inserted)) {
      // A retry of a request that is already saved: do not count it, do not save it again, and only send what is missing.
      refund(ip);
      const row = await one(db, 'SELECT customer_email, shop_email, customer_email_status FROM quote_requests WHERE ref = ?', [ref]);
      if (!row || String(row.customer_email).toLowerCase() !== q.email.toLowerCase()) return json({ ok: false, error: 'fields', fields: [] }, 400);
      sendShop = row.shop_email !== 'sent';
      sendConfirm = row.customer_email_status !== 'sent';
    }
  } catch (_) {
    console.error('quote-request database failed');
    refund(ip);
    return json({ ok: false, error: 'storage' }, 500);
  }

  let emailed = !sendShop;
  let confirmed = !sendConfirm;
  let error = '';
  if (sendShop) {
    try {
      await sendShopEmail(env, ref, q);
      emailed = true;
    } catch (err) {
      error = (err && err.message) || 'shop email failed';
      console.error('quote-request shop email failed');
    }
  }
  if (sendConfirm) {
    try {
      await sendConfirmation(env, ref, q);
      confirmed = true;
    } catch (err) {
      error = error || (err && err.message) || 'confirmation failed';
      console.error('quote-request confirmation failed');
    }
  }
  if (sendShop || sendConfirm) await mark(env, ref, emailed ? 'sent' : 'failed', confirmed ? 'sent' : 'failed', error);
  return json({ ok: true, ref: ref, emailed: emailed, stored: true, confirmed: confirmed });
}

export async function onRequestPost(context) {
  try {
    return await handle(context.request, context.env, context.now);
  } catch (_) {
    console.error('quote-request failed');
    refund(context.request.headers.get('cf-connecting-ip'));
    return json({ ok: false, error: 'server' }, 500);
  }
}
