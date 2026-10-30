// Cloudflare Pages Function: POST /api/reorder-request
//
// The form on /reorder/ posts here (form data):
//   org (organization or business name) and email (required); name, phone, previous_order (an order or quote
//   reference, a date, or the product), notes (optional, but previous_order or notes must say what to reorder);
//   _gotcha (honeypot) and elapsedMs (under 3 seconds) give a fake success; attempt (16 to 64 letters, digits,
//   - or _) makes a retry answer with the same reference instead of saving or emailing twice.
//
// What it does: saves the request in D1 (table reorder_requests), emails the shop (DESIGN_PROOF_TO, or
// sales@getseensignsco.com) through Brevo with Reply-To set to the customer, and emails the customer a short
// confirmation with a reference (RO-XXXXXXXX). Same on/off rule and answers as /api/quote-request:
// 200 {ok, ref, emailed, stored, confirmed}; 400 {ok:false, error:'fields', fields:[...]}; 429; 500; 503 {enabled:false}.
// Listed by GET /api/admin/reorder-requests. The table is created on first use (migrations/0005_reorder_requests.sql).
// No IP, cookie or user agent is kept.

import { getDb, run, one, changes } from '../_lib/db.js';
import { brevoSend, layout, p as para } from '../_lib/emails.js';
import { SHOP_EMAIL, SHOP_PHONE, esc, oneLine, multiLine, validEmail, nowIso, json } from '../_lib/util.js';
import { proofEnabled } from './design-proof.js';
import { ATTEMPT_RE, MAX_BODY, field, isBot, makeLimiter, randomRef, refFor, sleep } from '../_lib/forms.js';

export const REORDER_REF_RE = /^RO-[0-9A-HJKMNP-TV-Z]{8}$/;
const RETRY_MS = 300;
const limiter = makeLimiter(8, 3600000);

export const resetRateLimit = () => limiter.reset();

export function readReorder(form) {
  const r = {
    org: oneLine(field(form, 'org'), 160),
    name: oneLine(field(form, 'name'), 120),
    email: oneLine(field(form, 'email'), 200),
    phone: oneLine(field(form, 'phone'), 40),
    previousOrder: oneLine(field(form, 'previous_order'), 200),
    notes: multiLine(field(form, 'notes'), 3000),
  };
  const bad = [];
  if (r.org.length < 2) bad.push('org');
  if (!validEmail(r.email)) bad.push('email');
  if (r.phone && !/^[0-9+().\s-]{7,40}$/.test(r.phone)) bad.push('phone');
  if (!r.previousOrder && !r.notes) bad.push('previous_order');
  return { reorder: r, bad: bad };
}

function summaryLines(ref, r) {
  return [
    'New reorder request ' + ref,
    '',
    'Organization: ' + r.org,
    'Name: ' + (r.name || '-'),
    'Email: ' + r.email,
    'Phone: ' + (r.phone || '-'),
    'Previous order: ' + (r.previousOrder || '-'),
    '',
    'Notes:',
    r.notes || '-',
    '',
    'Reply to this email to answer the customer.',
  ];
}

async function sendShopEmail(env, ref, r) {
  const configured = oneLine(env.DESIGN_PROOF_TO, 200);
  const to = validEmail(configured) ? configured : SHOP_EMAIL;
  const text = summaryLines(ref, r).join('\n');
  const mail = {
    to: to,
    subject: 'Reorder request: ' + r.org + ' ' + ref,
    html: '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap">' + esc(text) + '</div>',
    text: text,
    replyTo: { email: r.email, name: r.name || r.org },
    tags: ['reorder-request'],
  };
  try {
    await brevoSend(env, mail);
  } catch (_) {
    await sleep(RETRY_MS);
    await brevoSend(env, mail);
  }
}

async function sendConfirmation(env, ref, r) {
  const hi = r.name ? 'Hi ' + r.name.split(/\s+/)[0] + ',' : 'Hello,';
  const lead = 'Thanks for your reorder request. We will look up your last order and email you a fresh proof and price, usually within 1 business day. Nothing prints or is charged until you approve it.';
  const asked = [['Organization', r.org], ['Previous order', r.previousOrder]].filter((x) => x[1]);
  const html = layout({
    heading: 'We got your reorder request',
    preheader: 'Reference ' + ref + '. We will reply within 1 business day.',
    bodyHtml:
      para(esc(hi)) + para(esc(lead)) +
      '<p style="margin:0 0 12px;font-size:20px"><strong>Reference ' + esc(ref) + '</strong></p>' +
      '<p style="margin:0 0 12px;color:#33363C">' + asked.map((x) => esc(x[0]) + ': ' + esc(x[1])).join('<br>') + '</p>' +
      para('Changing anything, like a date, a name or a phone number? Reply to this email with the changes and mention your reference.'),
  });
  const text = [
    hi, '', lead, '', 'Reference ' + ref, '', ...asked.map((x) => x[0] + ': ' + x[1]), '',
    'Changing anything, like a date, a name or a phone number? Reply to this email with the changes and mention your reference.',
    '', '--', 'Get Seen Signs', SHOP_PHONE + ' | ' + SHOP_EMAIL + ' | getseensignsco.com',
  ].join('\n');
  await brevoSend(env, { to: r.email, toName: r.name || undefined, subject: 'We got your reorder request (reference ' + ref + ')', html: html, text: text, tags: ['reorder-request', 'confirmation'] });
}

async function mark(env, ref, shop, customer, error) {
  try {
    await run(await getDb(env), 'UPDATE reorder_requests SET shop_email = ?, customer_email_status = ?, email_error = ? WHERE ref = ?', [shop, customer, String(error || '').slice(0, 300), ref]);
  } catch (_) {
    console.error('reorder-request status update failed');
  }
}

export async function handle(request, env, now) {
  const when = now instanceof Date ? now : new Date();
  if (!proofEnabled(env) || !env.DB) return json({ ok: false, enabled: false }, 503);
  const ip = request.headers.get('cf-connecting-ip');
  if (limiter.limited(ip, when.getTime())) return json({ ok: false, error: 'rate' }, 429, { 'Retry-After': '3600' });
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return json({ ok: false, error: 'fields', fields: ['notes'] }, 400);

  let form;
  try {
    form = await request.formData();
  } catch (_) {
    return json({ ok: false, error: 'fields', fields: [] }, 400);
  }
  if (isBot(form)) return json({ ok: true, ref: randomRef('RO'), emailed: true, stored: true, confirmed: true });

  const { reorder: r, bad } = readReorder(form);
  if (bad.length) return json({ ok: false, error: 'fields', fields: bad }, 400);

  const attempt = field(form, 'attempt');
  const ref = ATTEMPT_RE.test(attempt) ? await refFor('RO', 'reorder-request', attempt) : randomRef('RO');
  let sendShop = true;
  let sendConfirm = true;
  try {
    const db = await getDb(env);
    const inserted = await run(
      db,
      'INSERT OR IGNORE INTO reorder_requests (ref, created_at, status, org_name, customer_name, customer_email, phone, previous_order, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [ref, nowIso(when), 'new', r.org, r.name, r.email, r.phone, r.previousOrder, r.notes]
    );
    if (!changes(inserted)) {
      limiter.refund(ip);
      const row = await one(db, 'SELECT customer_email, shop_email, customer_email_status FROM reorder_requests WHERE ref = ?', [ref]);
      if (!row || String(row.customer_email).toLowerCase() !== r.email.toLowerCase()) return json({ ok: false, error: 'fields', fields: [] }, 400);
      sendShop = row.shop_email !== 'sent';
      sendConfirm = row.customer_email_status !== 'sent';
    }
  } catch (_) {
    console.error('reorder-request database failed');
    limiter.refund(ip);
    return json({ ok: false, error: 'storage' }, 500);
  }

  let emailed = !sendShop;
  let confirmed = !sendConfirm;
  let error = '';
  if (sendShop) {
    try {
      await sendShopEmail(env, ref, r);
      emailed = true;
    } catch (err) {
      error = (err && err.message) || 'shop email failed';
      console.error('reorder-request shop email failed');
    }
  }
  if (sendConfirm) {
    try {
      await sendConfirmation(env, ref, r);
      confirmed = true;
    } catch (err) {
      error = error || (err && err.message) || 'confirmation failed';
      console.error('reorder-request confirmation failed');
    }
  }
  if (sendShop || sendConfirm) await mark(env, ref, emailed ? 'sent' : 'failed', confirmed ? 'sent' : 'failed', error);
  return json({ ok: true, ref: ref, emailed: emailed, stored: true, confirmed: confirmed });
}

export async function onRequestPost(context) {
  try {
    return await handle(context.request, context.env, context.now);
  } catch (_) {
    console.error('reorder-request failed');
    limiter.refund(context.request.headers.get('cf-connecting-ip'));
    return json({ ok: false, error: 'server' }, 500);
  }
}
