// Order emails through the Brevo transactional API (BREVO_API_KEY). From sales@getseensignsco.com, sender
// name Get Seen Signs. Customer-facing text names only Get Seen Signs and a city and state, never a person,
// a legal name or a street address.

import { SITE, SHOP_EMAIL, SHOP_PHONE, SHOP_PHONE_TEL, esc, money, nowIso, log } from './util.js';
import { run } from './db.js';

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const SENDER = { name: 'Get Seen Signs', email: SHOP_EMAIL };
const INK = '#14161A';
const YELLOW = '#FFD100';
const LOGO = SITE + '/assets/brand/getseen-horizontal-for-dark-bg.png';
const FONT = "'Barlow','Helvetica Neue',Helvetica,Arial,sans-serif";
const HEAD_FONT = "'Barlow Condensed','Arial Narrow',Impact,Helvetica,Arial,sans-serif";

export function button(href, label) {
  return (
    '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 8px"><tr><td style="background:' + YELLOW + ';border-radius:10px;border-bottom:4px solid #B89600">' +
    '<a href="' + esc(href) + '" style="display:inline-block;padding:15px 28px;font-family:' + HEAD_FONT + ';font-weight:800;font-size:20px;letter-spacing:.04em;text-transform:uppercase;color:' + INK + ';text-decoration:none">' + esc(label) + '</a>' +
    '</td></tr></table>'
  );
}

function itemRows(items) {
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:14px 0 4px;font-size:15px">' +
    items
      .map(
        (it) =>
          '<tr><td style="padding:9px 0;border-bottom:1px solid #E4DFD2;color:' + INK + '">' + esc(it.name) + (it.description ? '<br><span style="color:#5B5F66;font-size:13px">' + esc(it.description) + '</span>' : '') +
          '<br><span style="color:#5B5F66;font-size:13px">Qty ' + esc(it.quantity) + ' &times; ' + esc(money(it.unit_amount_cents)) + '</span></td>' +
          '<td align="right" style="padding:9px 0;border-bottom:1px solid #E4DFD2;color:' + INK + ';font-weight:700;white-space:nowrap">' + esc(money(it.unit_amount_cents * it.quantity)) + '</td></tr>'
      )
      .join('') +
    '</table>'
  );
}

export function layout({ heading, preheader, bodyHtml }) {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(heading) + '</title></head>' +
    '<body style="margin:0;padding:0;background:#F3EFE6;font-family:' + FONT + ';color:' + INK + '">' +
    '<span style="display:none;max-height:0;overflow:hidden;opacity:0">' + esc(preheader || '') + '</span>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3EFE6"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:2px solid ' + INK + '">' +
    '<tr><td style="background:' + INK + ';padding:22px 28px"><a href="' + SITE + '/" style="text-decoration:none"><img src="' + LOGO + '" width="190" alt="Get Seen Signs" style="display:block;border:0;height:auto;width:190px"></a></td></tr>' +
    '<tr><td style="background:' + YELLOW + ';height:8px;line-height:8px;font-size:0">&nbsp;</td></tr>' +
    '<tr><td style="padding:30px 28px 26px;font-size:16px;line-height:1.55">' +
    '<h1 style="margin:0 0 14px;font-family:' + HEAD_FONT + ';font-weight:900;font-size:36px;line-height:1;text-transform:uppercase;color:' + INK + '">' + esc(heading) + '</h1>' +
    bodyHtml +
    '</td></tr>' +
    '<tr><td style="background:' + INK + ';padding:24px 28px;font-size:14px;line-height:1.6;color:#BDBAB2">' +
    '<div style="font-family:' + HEAD_FONT + ';font-weight:900;font-size:20px;letter-spacing:.08em;text-transform:uppercase;color:#ffffff">Get Seen Signs</div>' +
    '<div>Veteran-owned, family-run online sign shop. Smiths Station, AL.</div>' +
    '<div style="margin-top:8px"><a href="tel:' + SHOP_PHONE_TEL + '" style="color:#ffffff;font-weight:700;text-decoration:none">' + SHOP_PHONE + '</a> &middot; ' +
    SHOP_EMAIL + ' &middot; <a href="' + SITE + '/" style="color:#BDBAB2">getseensignsco.com</a></div>' +
    '<div style="margin-top:8px;font-size:13px"><a href="' + SITE + '/terms" style="color:#8D8A83">Terms</a> &middot; <a href="' + SITE + '/privacy" style="color:#8D8A83">Privacy</a></div>' +
    '</td></tr></table></td></tr></table></body></html>'
  );
}

export const p = (html) => '<p style="margin:0 0 12px">' + html + '</p>';
const small = (html) => '<p style="margin:14px 0 0;font-size:13px;color:#5B5F66">' + html + '</p>';

function textFooter() {
  return ['', '--', 'Get Seen Signs', 'Smiths Station, AL', SHOP_PHONE + ' | ' + SHOP_EMAIL + ' | getseensignsco.com'].join('\n');
}

function itemsText(items) {
  return items.map((it) => '- ' + it.name + ' x ' + it.quantity + ' = ' + money(it.unit_amount_cents * it.quantity)).join('\n');
}

const first = (name) => (name ? String(name).trim().split(/\s+/)[0] : '');
const hello = (order) => (first(order.customer_name) ? 'Hi ' + first(order.customer_name) + ',' : 'Hello,');

export function renderEmail(kind, ctx) {
  const { order, items, links } = ctx;
  const ref = order.id;
  const subtotal = money(items.reduce((s, it) => s + it.unit_amount_cents * it.quantity, 0));

  if (kind === 'proof_ready') {
    const revised = ctx.version > 1;
    const heading = revised ? 'Your updated proof is ready' : 'Your proof is ready';
    const lead = revised ? 'We updated your proof. Take a look and approve it, or send us another change.' : 'Your free proof is ready. Check the spelling, wording, colors, size and quantity, then approve it or ask for changes.';
    return {
      subject: 'Your Get Seen Signs proof is ready (order ' + ref + ')',
      preheader: lead,
      html: layout({
        heading,
        preheader: lead,
        bodyHtml:
          p(esc(hello(order))) + p(esc(lead)) + button(links.proof, 'Review your proof') + itemRows(items) +
          '<p style="margin:6px 0 0;font-size:16px;font-weight:700">Total before sales tax: ' + esc(subtotal) + '</p>' +
          small('Order ' + esc(ref) + '. Three revisions are included. Nothing is printed until you approve the proof. If the button does not work, copy this link: ' + esc(links.proof)),
      }),
      text: [hello(order), '', lead, '', 'Review your proof: ' + links.proof, '', itemsText(items), 'Total before sales tax: ' + subtotal, '', 'Order ' + ref + '. Three revisions are included. Nothing is printed until you approve the proof.', textFooter()].join('\n'),
    };
  }

  if (kind === 'proof_approved') {
    return {
      subject: 'Proof approved: pay to start your order ' + ref,
      preheader: 'Thanks for approving your proof. Pay securely to start production.',
      html: layout({
        heading: 'Proof approved',
        preheader: 'Thanks for approving your proof. Pay securely to start production.',
        bodyHtml:
          p(esc(hello(order))) + p('Thanks for approving your proof. Your order goes into production as soon as payment is received.') + button(links.order, 'Pay securely') + itemRows(items) +
          '<p style="margin:6px 0 0;font-size:16px;font-weight:700">Total before sales tax: ' + esc(subtotal) + '</p>' +
          small('Checkout is handled by Stripe. Sales tax is added where required, and shipping is entered there. Order ' + esc(ref) + '. This link stays good: ' + esc(links.order)),
      }),
      text: [hello(order), '', 'Thanks for approving your proof. Your order goes into production as soon as payment is received.', '', 'Pay securely: ' + links.order, '', itemsText(items), 'Total before sales tax: ' + subtotal, '', 'Order ' + ref + '.', textFooter()].join('\n'),
    };
  }

  if (kind === 'payment_received') {
    const total = ctx.amountTotalCents != null ? money(ctx.amountTotalCents) : subtotal;
    return {
      subject: 'Payment received for order ' + ref,
      preheader: 'We got your payment. Your order is going into production.',
      html: layout({
        heading: 'Payment received',
        preheader: 'We got your payment. Your order is going into production.',
        bodyHtml:
          p(esc(hello(order))) + p('Thank you. We received your payment of <strong>' + esc(total) + '</strong> and your order is going into production. We will email you tracking as soon as it ships.') +
          button(links.order, 'Check order status') + itemRows(items) + small('Order ' + esc(ref) + '. Questions? Call ' + SHOP_PHONE + ' or reply to this email.'),
      }),
      text: [hello(order), '', 'Thank you. We received your payment of ' + total + ' and your order is going into production. We will email you tracking as soon as it ships.', '', 'Order status: ' + links.order, '', itemsText(items), '', 'Order ' + ref + '.', textFooter()].join('\n'),
    };
  }

  if (kind === 'shipped') {
    const s = ctx.shipment;
    const trackLine = s.tracking_url ? '<a href="' + esc(s.tracking_url) + '" style="color:' + INK + ';font-weight:700">' + esc(s.tracking_number) + '</a>' : '<strong>' + esc(s.tracking_number) + '</strong>';
    return {
      subject: 'Your Get Seen Signs order ' + ref + ' has shipped',
      preheader: 'Your order is on the way. Carrier: ' + s.carrier + '.',
      html: layout({
        heading: 'Your order has shipped',
        preheader: 'Your order is on the way. Carrier: ' + s.carrier + '.',
        bodyHtml:
          p(esc(hello(order))) + p('Your order is on the way.') +
          '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0;background:#F3EFE6;border-radius:10px;width:100%"><tr><td style="padding:14px 16px;font-size:15px">Carrier: <strong>' + esc(s.carrier) + '</strong><br>Tracking number: ' + trackLine + '</td></tr></table>' +
          (s.tracking_url ? button(s.tracking_url, 'Track your package') : button(links.order, 'Check order status')) + itemRows(items) +
          small('Order ' + esc(ref) + '. Order status: ' + esc(links.order)),
      }),
      text: [hello(order), '', 'Your order is on the way.', 'Carrier: ' + s.carrier, 'Tracking number: ' + s.tracking_number, s.tracking_url ? 'Track it: ' + s.tracking_url : '', 'Order status: ' + links.order, '', itemsText(items), '', 'Order ' + ref + '.', textFooter()].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n'),
    };
  }

  throw new Error('unknown email kind ' + kind);
}

// Internal mail to the shop. Plain, not branded for customers.
export function renderShopAlert(subject, lines) {
  const html = '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:' + INK + '">' + lines.map((l) => '<p style="margin:0 0 8px">' + esc(l) + '</p>').join('') + '</div>';
  return { subject: subject, html: html, text: lines.join('\n') };
}

export async function brevoSend(env, { to, toName, subject, html, text, tags, replyTo, attachments }) {
  if (!env.BREVO_API_KEY) throw new Error('BREVO_API_KEY is not set');
  const body = {
    sender: SENDER,
    replyTo: replyTo || { email: SHOP_EMAIL, name: SENDER.name },
    to: [toName ? { email: to, name: toName } : { email: to }],
    subject: subject,
    htmlContent: html,
    textContent: text,
  };
  if (tags && tags.length) body.tags = tags;
  if (attachments && attachments.length) body.attachment = attachments;
  const res = await fetch(BREVO_URL, { method: 'POST', headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }
  if (!res.ok) throw new Error('Brevo ' + res.status + (data && data.message ? ': ' + data.message : ''));
  return (data && data.messageId) || '';
}

async function record(db, orderId, kind, to, status, error, messageId, now) {
  try {
    await run(db, 'INSERT INTO emails (order_id, kind, to_email, status, error, message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [orderId, kind, to, status, String(error || '').slice(0, 300), messageId || '', nowIso(now)]);
  } catch (_) {
    console.error('email log write failed');
  }
}

// Sends one customer email and records the attempt. Never throws: a mail problem must not undo an order step.
export async function sendOrderEmail(env, db, kind, ctx, now) {
  const mail = renderEmail(kind, ctx);
  try {
    const id = await brevoSend(env, { to: ctx.order.customer_email, toName: ctx.order.customer_name, subject: mail.subject, html: mail.html, text: mail.text, tags: ['order', kind] });
    await record(db, ctx.order.id, kind, ctx.order.customer_email, 'sent', '', id, now);
    return { ok: true };
  } catch (err) {
    log('email_failed', { order: ctx.order.id, kind: kind, error: err.message });
    await record(db, ctx.order.id, kind, ctx.order.customer_email, 'failed', err.message, '', now);
    return { ok: false, error: err.message };
  }
}

export async function sendShopAlert(env, db, orderId, kind, subject, lines, now) {
  const mail = renderShopAlert(subject, lines);
  try {
    const id = await brevoSend(env, { to: SHOP_EMAIL, subject: mail.subject, html: mail.html, text: mail.text, tags: ['shop', kind] });
    await record(db, orderId, kind, SHOP_EMAIL, 'sent', '', id, now);
    return { ok: true };
  } catch (err) {
    log('shop_alert_failed', { order: orderId, kind: kind, error: err.message });
    await record(db, orderId, kind, SHOP_EMAIL, 'failed', err.message, '', now);
    return { ok: false, error: err.message };
  }
}
