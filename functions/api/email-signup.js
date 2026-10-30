// Cloudflare Pages Function: POST /api/email-signup
//
// The "Free proof + 10% off your first order" signup in the site footer posts here (form data):
//   email (required); source (optional, the page path); _gotcha (honeypot) and elapsedMs (under 3 seconds) give a
//   fake success and nothing is stored.
//
// What it does:
//   1. Saves the address in D1 (table email_signups, one row per address). Signing up twice is fine: the second
//      time answers ok with already:true and does not email again (unless the first welcome email failed).
//   2. Adds the address to a Brevo contact list when BREVO_SIGNUP_LIST_ID is set (a number, the list id in Brevo).
//      Not set: brevo_status = 'not_configured' and the address stays in D1 only.
//   3. Emails a short welcome. When SIGNUP_PROMO_CODE is set, the email carries that code for 10% off the first
//      order. Not set (today, until the Stripe promotion code is approved and created): the email says the code
//      is on its way, and the row keeps promo_code = '' so GET /api/admin/email-signups?no_code=1 lists who still
//      needs one.
// On or off: the same rule as the other site forms (DB and BREVO_API_KEY set; DESIGN_PROOF_ENABLED=false turns it
// off with a 503). The table is created on first use (migrations/0004_email_signups.sql).
//
// Answers: 200 {ok, already, synced, welcomed}; 400 {ok:false, error:'fields', fields:['email']};
// 429 {ok:false, error:'rate'}; 500 {ok:false, error:'storage'|'server'}; 503 {ok:false, enabled:false}.
// No IP, cookie or user agent is kept.

import { getDb, run, one, changes } from '../_lib/db.js';
import { brevoSend, layout, p as para } from '../_lib/emails.js';
import { SITE, SHOP_EMAIL, SHOP_PHONE, esc, oneLine, validEmail, nowIso, json } from '../_lib/util.js';
import { proofEnabled } from './design-proof.js';
import { MAX_BODY, field, isBot, makeLimiter } from '../_lib/forms.js';

const BREVO_CONTACTS_URL = 'https://api.brevo.com/v3/contacts';
const PROMO_RE = /^[A-Za-z0-9_-]{3,40}$/;
const limiter = makeLimiter(6, 3600000);

export const resetRateLimit = () => limiter.reset();

export function promoCode(env) {
  const code = oneLine(env && env.SIGNUP_PROMO_CODE, 40);
  return PROMO_RE.test(code) ? code.toUpperCase() : '';
}

function listId(env) {
  const raw = oneLine(env && env.BREVO_SIGNUP_LIST_ID, 12);
  return /^\d{1,9}$/.test(raw) && Number(raw) > 0 ? Number(raw) : 0;
}

// Adds or updates the contact in Brevo and puts it on the signup list. Returns 'synced', 'failed' or 'not_configured'.
export async function syncContact(env, email) {
  const id = listId(env);
  if (!id || !env.BREVO_API_KEY) return 'not_configured';
  try {
    const res = await fetch(BREVO_CONTACTS_URL, {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email: email, listIds: [id], updateEnabled: true }),
    });
    return res.ok ? 'synced' : 'failed';
  } catch (_) {
    return 'failed';
  }
}

async function sendWelcome(env, email, code) {
  const lead = 'Thanks for joining the Get Seen Signs list. Every order starts with a free digital proof within 12 hours, 7 days a week, and nothing prints or is charged until you approve it.';
  const offer = code
    ? 'Your code for 10% off your first order is ' + code + '. Enter ' + code + ' in the promotion code box at checkout, after you approve your proof, and 10% comes off.'
    : 'Your 10% off code for your first order is on its way. We will email it to this address soon.';
  const html = layout({
    heading: 'You are on the list',
    preheader: code ? 'Your 10% off code: ' + code : 'Free proof on every order, and 10% off your first order.',
    bodyHtml:
      para(esc(lead)) +
      (code ? '<p style="margin:0 0 12px;font-size:22px"><strong>' + esc(code) + '</strong></p>' : '') +
      para(esc(offer)) +
      para('Browse the shop: <a href="' + SITE + '/shop/">getseensignsco.com/shop</a>') +
      '<p style="margin:14px 0 0;font-size:13px;color:#5B5F66">Did not sign up? Reply to this email and we will remove you.</p>',
  });
  const text = [lead, '', offer, '', 'Shop: ' + SITE + '/shop/', '', 'Did not sign up? Reply to this email and we will remove you.', '', '--', 'Get Seen Signs', SHOP_PHONE + ' | ' + SHOP_EMAIL + ' | getseensignsco.com'].join('\n');
  await brevoSend(env, { to: email, subject: code ? 'Your 10% off code from Get Seen Signs' : 'You are on the Get Seen Signs list', html: html, text: text, tags: ['email-signup'] });
}

export async function handle(request, env, now) {
  const when = now instanceof Date ? now : new Date();
  if (!proofEnabled(env) || !env.DB) return json({ ok: false, enabled: false }, 503);
  const ip = request.headers.get('cf-connecting-ip');
  if (limiter.limited(ip, when.getTime())) return json({ ok: false, error: 'rate' }, 429, { 'Retry-After': '3600' });
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return json({ ok: false, error: 'fields', fields: ['email'] }, 400);

  let form;
  try {
    form = await request.formData();
  } catch (_) {
    return json({ ok: false, error: 'fields', fields: [] }, 400);
  }
  if (isBot(form)) return json({ ok: true, already: false, synced: true, welcomed: true });

  const email = oneLine(field(form, 'email'), 200).toLowerCase();
  if (!validEmail(email)) return json({ ok: false, error: 'fields', fields: ['email'] }, 400);
  const source = oneLine(field(form, 'source'), 120);

  let db;
  let already = false;
  let welcome = true;
  try {
    db = await getDb(env);
    const ts = nowIso(when);
    const inserted = await run(db, 'INSERT OR IGNORE INTO email_signups (email, created_at, updated_at, source) VALUES (?, ?, ?, ?)', [email, ts, ts, source]);
    if (!changes(inserted)) {
      already = true;
      limiter.refund(ip);
      const row = await one(db, 'SELECT welcome_status FROM email_signups WHERE email = ?', [email]);
      welcome = !row || row.welcome_status !== 'sent';
    }
  } catch (_) {
    console.error('email-signup database failed');
    limiter.refund(ip);
    return json({ ok: false, error: 'storage' }, 500);
  }

  const code = promoCode(env);
  const brevo = await syncContact(env, email);
  let welcomed = !welcome;
  let error = '';
  if (welcome) {
    try {
      await sendWelcome(env, email, code);
      welcomed = true;
    } catch (err) {
      error = (err && err.message) || 'welcome email failed';
      console.error('email-signup welcome email failed');
    }
  }
  try {
    const sets = ['updated_at = ?', 'brevo_status = ?', 'error = ?'];
    const params = [nowIso(when), brevo, String(error).slice(0, 300)];
    if (welcome) {
      sets.push('welcome_status = ?', 'promo_code = ?');
      params.push(welcomed ? 'sent' : 'failed', welcomed ? code : '');
    }
    await run(db, 'UPDATE email_signups SET ' + sets.join(', ') + ' WHERE email = ?', params.concat([email]));
  } catch (_) {
    console.error('email-signup status update failed');
  }
  return json({ ok: true, already: already, synced: brevo === 'synced', welcomed: welcomed });
}

export async function onRequestPost(context) {
  try {
    return await handle(context.request, context.env, context.now);
  } catch (_) {
    console.error('email-signup failed');
    limiter.refund(context.request.headers.get('cf-connecting-ip'));
    return json({ ok: false, error: 'server' }, 500);
  }
}
