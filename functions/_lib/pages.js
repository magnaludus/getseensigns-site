// HTML for /proof/<token> and /order/<token>. Uses the site's own stylesheet and nav/footer markup so the pages
// match the rest of getseensignsco.com. Customer-facing text names only Get Seen Signs and "Smiths Station, AL".

import { esc, money, SHOP_EMAIL, SHOP_PHONE, SHOP_PHONE_TEL } from './util.js';
import { CONSENT_TEXT, MAX_FREE_REVISIONS, STATUS_LABELS } from './orders.js';

const EXTRA_CSS = `
.ord{max-width:940px;margin:0 auto;padding:54px 20px 84px}
.ord h1{font-size:clamp(44px,6.5vw,72px);margin-bottom:8px}
.ord h2{font-size:30px;margin:0 0 14px}
.ord .lead{font-size:18px;color:#33363C;margin-bottom:26px;max-width:40em}
.ocard{background:#fff;border:3px solid var(--ink);border-radius:18px;padding:26px;box-shadow:6px 6px 0 var(--ink);margin:0 0 28px}
.ref{display:inline-block;font-family:var(--hd);font-weight:800;letter-spacing:.08em;text-transform:uppercase;background:var(--ink);color:var(--y);border-radius:8px;padding:5px 10px;font-size:16px;margin-bottom:14px}
.pill{display:inline-block;font-family:var(--hd);font-weight:800;text-transform:uppercase;letter-spacing:.05em;background:var(--y);border:2px solid var(--ink);border-radius:999px;padding:4px 14px;font-size:18px}
.proofs{display:grid;gap:18px}
.proofs a{display:block;border:2px solid var(--ink);border-radius:12px;overflow:hidden;background:var(--paper2)}
.proofs img{width:100%;height:auto;max-height:640px;object-fit:contain;background:#fff}
.sum{width:100%;border-collapse:collapse;font-size:17px}
.sum td{padding:11px 0;border-bottom:2px solid var(--paper2);vertical-align:top}
.sum td:last-child{text-align:right;font-weight:700;white-space:nowrap;padding-left:14px}
.sum small{display:block;color:var(--muted);font-size:14px}
.sum .tot td{border-bottom:0;font-family:var(--hd);font-weight:900;text-transform:uppercase;font-size:28px;padding-top:16px}
.fine{font-size:14.5px;color:var(--muted);margin-top:10px}
.ord form{display:grid;gap:16px}
.ord label{display:grid;gap:6px;font-family:var(--hd);font-weight:800;text-transform:uppercase;letter-spacing:.06em;font-size:15px}
.ord input[type=text],.ord textarea{font:500 16px/1.4 var(--bd);color:var(--ink);background:var(--paper);border:2px solid #CFC8B8;border-radius:10px;padding:12px 13px;width:100%;min-width:0;text-transform:none;letter-spacing:0}
.ord input[type=text]:focus,.ord textarea:focus{outline:none;border-color:var(--ink);background:#fff;box-shadow:0 0 0 3px var(--y)}
.ord textarea{min-height:120px;resize:vertical}
.agree{display:flex!important;grid-template-columns:none;gap:12px;align-items:flex-start;font-family:var(--bd)!important;font-weight:600!important;text-transform:none!important;letter-spacing:0!important;font-size:17px!important;line-height:1.45;background:var(--paper);border:2px solid var(--ink);border-radius:12px;padding:14px 16px}
.agree input{width:24px;height:24px;flex:none;margin-top:2px;accent-color:var(--ink)}
.agree a{font-weight:800;text-decoration:underline;text-decoration-color:var(--y);text-decoration-thickness:3px}
.alert{border:3px solid var(--ink);border-radius:12px;padding:14px 16px;margin:0 0 22px;font-weight:600}
.alert.bad{background:#FFE3DD}
.alert.ok{background:#E4F6D9}
.alert.info{background:var(--y)}
.steps4{list-style:none;margin:0 0 26px;padding:0;display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.steps4 li{font-family:var(--hd);font-weight:800;text-transform:uppercase;letter-spacing:.04em;font-size:15px;line-height:1.05;border-top:6px solid #CFC8B8;padding-top:8px;color:var(--muted)}
.steps4 li.done{border-top-color:var(--ink);color:var(--ink)}
.steps4 li.now{border-top-color:var(--y);color:var(--ink)}
@media (max-width:640px){.steps4{grid-template-columns:repeat(2,1fr)}}
.ship{margin:0 0 10px}
.ship b{font-family:var(--hd);text-transform:uppercase;letter-spacing:.04em}
.row-btns{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.ord .btn{font-size:20px}
.ord button.btn{font-family:var(--hd)}
.ord button[disabled]{opacity:.5;cursor:not-allowed}
`;

const NAV = `<a class="skip" href="#main">Skip to content</a>
<header class="nav">
  <div class="wrap nav-in">
    <a class="nav-logo" href="/" aria-label="Get Seen Signs home"><img src="/assets/brand/getseen-wordmark-only-for-dark-bg.svg" alt="Get Seen Signs" width="150" height="58"></a>
    <nav class="nav-links" aria-label="Main">
      <a href="/#products">Products</a><a href="/design/">Design</a><a href="/blog/">Guides</a><a href="/#faq">FAQ</a>
    </nav>
    <a class="nav-design" href="/design/">Design</a>
    <a class="btn btn-y btn-sm" href="/#quote">Get a quote</a>
  </div>
</header>`;

const FOOT = `<footer class="foot">
  <div class="wrap foot-in">
    <div>
      <img src="/assets/brand/getseen-stacked-for-dark-bg.svg" alt="Get Seen Signs" width="150" height="118" loading="lazy">
      <p class="foot-tag">Veteran-owned, family-run online sign shop. Smiths Station, AL.</p>
    </div>
    <div class="foot-cols">
      <div><p class="fh">Reach us</p><a class="foot-phone" href="tel:${SHOP_PHONE_TEL}" aria-label="Call Get Seen Signs at ${SHOP_PHONE}">${SHOP_PHONE}</a><a href="sms:${SHOP_PHONE_TEL}?body=Hi%2C%20I%20have%20a%20question%20about%20my%20order" aria-label="Text Get Seen Signs at ${SHOP_PHONE}">Text us</a><a href="mailto:${SHOP_EMAIL}">${SHOP_EMAIL}</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a></div>
    </div>
  </div>
  <div class="wrap legal"><p>&copy; <span id="yr">2026</span> Get Seen Signs. Smiths Station, AL.</p></div>
</footer>`;

export function shell({ title, body, refresh }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | Get Seen Signs</title>
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#14161A">${refresh ? '\n<meta http-equiv="refresh" content="' + refresh + '">' : ''}
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/assets/fonts/barlow-condensed-900.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/barlow-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/style.css">
<style>${EXTRA_CSS}</style>
</head>
<body>
${NAV}
<main id="main" class="ord">
${body}
</main>
${FOOT}
</body>
</html>`;
}

export function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso || '';
  return d.toLocaleString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' UTC';
}

function summary(items, order) {
  const rows = items
    .map(
      (it) =>
        `<tr><td>${esc(it.name)}${it.description ? `<small>${esc(it.description)}</small>` : ''}<small>Qty ${esc(it.quantity)} &times; ${esc(money(it.unit_amount_cents))}</small></td><td>${esc(money(it.unit_amount_cents * it.quantity))}</td></tr>`
    )
    .join('');
  const hasShipping = items.some((it) => it.sku === 'shipping');
  return `<table class="sum"><tbody>${rows}<tr class="tot"><td>Total before tax</td><td>${esc(money(order.subtotal_cents))}</td></tr></tbody></table>
<p class="fine">Sales tax is added at checkout where required.${hasShipping ? '' : ' Shipping to the lower 48 states is free.'}</p>`;
}

function proofImages(proof) {
  return `<div class="proofs">${proof.files
    .map((f, i) => `<a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(f.url)}" alt="Proof image ${i + 1} of ${proof.files.length}" loading="${i ? 'lazy' : 'eager'}"></a>`)
    .join('')}</div>`;
}

const alertBox = (kind, text) => (text ? `<div class="alert ${kind}" role="${kind === 'bad' ? 'alert' : 'status'}">${esc(text)}</div>` : '');

function consentLabel() {
  return esc(CONSENT_TEXT).replace('Terms of Service', '<a href="/terms" target="_blank" rel="noopener">Terms of Service</a>');
}

const COMPLETED = { proof_sent: 1, revision_requested: 1, approved: 2, paid: 3, shipped: 4 };

export function proofPage(bundle, opts) {
  const { order, items, proof, approval } = bundle;
  const o = opts || {};
  const ref = `<span class="ref">Order ${esc(order.id)}</span>`;
  let body;

  if (order.status === 'proof_sent' && proof) {
    const left = Math.max(0, MAX_FREE_REVISIONS - order.revisions_used);
    body = `${ref}
<h1>Review your proof</h1>
<p class="lead">Please check every detail: spelling, wording, phone numbers, colors, layout, size and quantity. What you approve is what we print.${proof.version > 1 ? ' This is revision ' + esc(proof.version - 1) + ' of your proof.' : ''}</p>
${alertBox('bad', o.error)}${alertBox('ok', o.notice)}
<section class="ocard" aria-label="Proof">${proofImages(proof)}${proof.note ? `<p class="fine">${esc(proof.note)}</p>` : ''}</section>
<section class="ocard" aria-label="Order summary"><h2>Your order</h2>${summary(items, order)}</section>
<section class="ocard" aria-labelledby="approve-h"><h2 id="approve-h">Approve this proof</h2>
<form method="post" action="/proof/${esc(order.token)}">
<input type="hidden" name="action" value="approve">
<input type="hidden" name="proof_version" value="${esc(proof.version)}">
<input type="hidden" name="terms_hash" value="${esc(o.terms ? o.terms.hash : '')}">
<label>Your full name<input type="text" name="customer_name" value="${esc(o.name != null ? o.name : order.customer_name)}" autocomplete="name" required maxlength="120"></label>
<label class="agree"><input type="checkbox" name="agree" value="yes" required><span>${consentLabel()}${o.terms ? `<br><small>Terms last updated ${esc(o.terms.version)}.</small>` : ''}</span></label>
${o.terms ? '' : alertBox('bad', 'Approval is paused for a moment because our Terms could not be loaded. Please reload this page in a minute.')}<div class="row-btns"><button class="btn btn-y" type="submit"${o.terms ? '' : ' disabled'}>Approve and continue to payment</button></div>
<p class="fine">After you approve, you will pay securely with Stripe. Your order goes into production once payment is received. Approved custom orders cannot be changed, cancelled or refunded; see the <a href="/terms">Terms</a>.</p>
</form></section>
<section class="ocard" aria-labelledby="rev-h"><h2 id="rev-h">Need a change?</h2>
<p class="fine" style="margin:0 0 12px">${left > 0 ? `You have ${esc(left)} of ${MAX_FREE_REVISIONS} free revisions left. Tell us what to change and we will send a new proof within 12 hours.` : `All ${MAX_FREE_REVISIONS} free revisions are used. Call ${SHOP_PHONE} or email ${SHOP_EMAIL} and we will quote any further changes.`}</p>
${left > 0 ? `<form method="post" action="/proof/${esc(order.token)}">
<input type="hidden" name="action" value="revise">
<input type="hidden" name="proof_version" value="${esc(proof.version)}">
<label>What should we change?<textarea name="comment" required maxlength="2000">${esc(o.comment || '')}</textarea></label>
<div class="row-btns"><button class="btn btn-line" type="submit">Request a revision</button></div></form>` : ''}</section>`;
  } else if (order.status === 'revision_requested') {
    body = `${ref}
<h1>We are on it</h1>
${alertBox('ok', o.notice)}${alertBox('bad', o.error)}
<p class="lead">We got your change request and will email a new proof within 12 hours. You have used ${esc(order.revisions_used)} of ${MAX_FREE_REVISIONS} free revisions.</p>
<p class="fine">Questions? Call ${SHOP_PHONE} or email <a href="mailto:${SHOP_EMAIL}">${SHOP_EMAIL}</a>.</p>`;
  } else {
    body = `${ref}
<h1>Proof ${order.status === 'approved' || order.status === 'paid' || order.status === 'shipped' ? 'approved' : 'closed'}</h1>
${alertBox('bad', o.error)}
<p class="lead">${approval ? 'You approved this proof on ' + esc(fmtDate(approval.approved_at)) + '.' : 'This proof is closed.'}</p>
${proof ? `<section class="ocard" aria-label="Approved proof">${proofImages(proof)}</section>` : ''}
<div class="row-btns"><a class="btn btn-y" href="/order/${esc(order.token)}">${order.status === 'approved' ? 'Go to payment' : 'View order status'}</a></div>`;
  }
  return shell({ title: 'Review your proof', body });
}

export function orderPage(bundle, opts) {
  const { order, items, shipments, approval } = bundle;
  const o = opts || {};
  const done = COMPLETED[order.status] || 0;
  const labels = ['Proof sent', 'Approved', 'Paid', 'Shipped'];
  const stepsHtml = `<ol class="steps4" aria-label="Order progress">${labels
    .map((l, i) => `<li class="${i < done ? 'done' : i === done ? 'now' : ''}">${l}</li>`)
    .join('')}</ol>`;
  const confirming = o.paid && order.status === 'approved';
  const pay =
    order.status === 'approved'
      ? `<section class="ocard"><h2>Pay securely</h2><form method="post" action="/order/${esc(order.token)}"><input type="hidden" name="action" value="pay"><div class="row-btns"><button class="btn btn-y" type="submit">Pay ${esc(money(order.subtotal_cents))} plus tax</button></div></form><p class="fine">Payment is handled by Stripe. Sales tax is added where required and you enter your shipping address there.</p></section>`
      : '';
  const ship = shipments.length
    ? `<section class="ocard"><h2>Tracking</h2>${shipments
        .map(
          (s) =>
            `<p class="ship"><b>${esc(s.carrier)}</b> ${s.tracking_url ? `<a href="${esc(s.tracking_url)}" target="_blank" rel="noopener noreferrer">${esc(s.tracking_number)}</a>` : esc(s.tracking_number)}<br><span class="fine">Shipped ${esc(fmtDate(s.created_at))}</span></p>`
        )
        .join('')}</section>`
    : '';
  const body = `<span class="ref">Order ${esc(order.id)}</span>
<h1>Order status</h1>
<p><span class="pill">${esc(STATUS_LABELS[order.status] || order.status)}</span></p>
<p class="lead" style="margin-top:14px">${
    order.status === 'paid' ? 'Thank you. Your order is in production and we will email tracking when it ships.' :
    order.status === 'shipped' ? 'Your order is on the way.' :
    order.status === 'approved' ? 'Your proof is approved. Pay below and your order goes into production.' :
    order.status === 'revision_requested' ? 'We are working on your requested changes and will email a new proof within 12 hours.' :
    'Your proof is ready for your review.'
  }</p>
${confirming ? alertBox('info', 'Thanks! We are confirming your payment with Stripe. This page refreshes on its own, and you will get an email in a minute.') : ''}${alertBox('bad', o.error)}
${stepsHtml}
${pay}${ship}
<section class="ocard" aria-label="Order summary"><h2>Your order</h2>${summary(items, order)}${order.amount_total_cents != null ? `<p class="fine">Paid in full: ${esc(money(order.amount_total_cents))} including sales tax${order.amount_tax_cents ? ' of ' + esc(money(order.amount_tax_cents)) : ''}.</p>` : ''}</section>
<div class="row-btns">${order.status === 'proof_sent' ? `<a class="btn btn-y" href="/proof/${esc(order.token)}">Review your proof</a>` : approval ? `<a class="btn btn-line" href="/proof/${esc(order.token)}">View approved proof</a>` : ''}</div>
<p class="fine">Questions? Call <a href="tel:${SHOP_PHONE_TEL}">${SHOP_PHONE}</a> or email <a href="mailto:${SHOP_EMAIL}">${SHOP_EMAIL}</a>.</p>`;
  return shell({ title: 'Order status', body, refresh: confirming ? 6 : 0 });
}

export function messagePage(title, text) {
  return shell({ title, body: `<h1>${esc(title)}</h1><p class="lead">${esc(text)}</p><div class="row-btns"><a class="btn btn-y" href="/">Back to Get Seen Signs</a></div>` });
}
