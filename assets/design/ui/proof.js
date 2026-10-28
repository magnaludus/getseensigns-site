// "Get my free proof" and "Rather we design it?": review, contact form and send. Nothing here talks to a
// server except POST /api/design-proof. It never opens the visitor's email app: if sending fails the form
// stays open with everything typed, says so plainly, and offers Try again, call or text (334) 232-9003.
import { h, icon } from './dom.js';
import { createSummary } from './summary.js';
import { sideThumb } from '../render/thumbs.js';
import { sideDisplay } from '../render/displaylist.js';
import { renderToCanvas } from '../render/canvas.js';
import { collectWarnings } from '../model/review.js';
import { projectTotal, money, productById } from '../model/pricing.js';
import { sideNamesFor, productOf } from '../model/document.js';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PHONE = '(334) 232-9003';
const TEL = 'tel:+13342329003';
const SMS = 'sms:+13342329003?body=Hi%2C%20I%20have%20a%20question%20about%20a%20sign';

function makeRef() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return 'GS-' + [...bytes].map((b) => ALPHABET[b % 32]).join('');
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const viewport = () => (window.innerWidth < 768 ? 'm' : 'd');

function toBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export function createProof(ctx) {
  const { store, env } = ctx;
  const S = store.state;
  let dialog = null;

  async function buildPreviews() {
    const out = [];
    const doc = S.doc;
    for (let pi = 0; pi < doc.project.pieces.length && out.length < 12; pi++) {
      const piece = doc.project.pieces[pi];
      const product = productOf(env, piece.productId);
      const names = sideNamesFor(product, piece.choices);
      const count = piece.sidesMode === 'same' ? 1 : names.length;
      for (let si = 0; si < count && out.length < 12; si++) {
        const display = sideDisplay(doc, pi, si, env, { region: 'trim', assets: S.assets });
        const canvas = renderToCanvas(display, 1400, S.assets);
        const blob = await toBlob(canvas);
        const sideName = piece.sidesMode === 'same' && names.length > 1 ? 'all-sides' : names[si];
        out.push({ name: `preview-${pi + 1}-${slug(product.short)}-${slug(sideName)}.png`, blob, pi, si });
      }
    }
    return out;
  }

  async function post(fd) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const res = await fetch('/api/design-proof', { method: 'POST', body: fd, signal: ctrl.signal });
      let data = null;
      try { data = await res.json(); } catch (_) { data = null; }
      return { status: res.status, data };
    } catch (_) {
      return { status: 0, data: null };
    } finally {
      clearTimeout(timer);
    }
  }

  // Plain words for a failed send, plus phone and text links. Never an email link.
  function reasonText(reason) {
    if (reason === 'off') return 'Online requests are paused right now.';
    if (reason === 'rate') return 'You have sent a few requests already. Please try again later.';
    if (reason === 'too-large') return 'Those files are too big to send. Try smaller ones, or call or text us.';
    return 'That did not go through, and we are sorry.';
  }

  function showFailure(error, reason) {
    error.textContent = '';
    error.append(
      `${reasonText(reason)} What you typed is still here. Tap Try again, or call `,
      h('a', { href: TEL }, PHONE),
      ' or ',
      h('a', { href: SMS }, 'text us'),
      ' and we will take it from there.'
    );
    error.hidden = false;
  }

  // ---------- dialog frame ----------

  function frame(title) {
    close();
    const dlg = h('dialog', { class: 'dz-dialog', 'aria-labelledby': 'dz-dlg-title' });
    const head = h('div', { class: 'dz-dlg-head' }, h('h2', { id: 'dz-dlg-title' }, title),
      h('button', { type: 'button', class: 'dz-btn-icon', 'aria-label': 'Close', onclick: () => close() }));
    head.lastChild.innerHTML = icon('close');
    const body = h('div', { class: 'dz-dlg-body' });
    dlg.append(head, body);
    dlg.addEventListener('close', () => { if (dialog === dlg) dialog = null; dlg.remove(); });
    dlg.addEventListener('cancel', () => {});
    document.body.append(dlg);
    dlg.showModal();
    dialog = dlg;
    return { dlg, body, title: head.firstChild };
  }

  function close() {
    if (dialog) {
      const d = dialog;
      dialog = null;
      try { d.close(); } catch (_) { /* already closed */ }
      d.remove();
    }
  }

  const field = (label, input, opts = {}) => h('label', { class: 'dz-field' + (opts.wide ? ' dz-wide' : '') }, h('span', null, label, opts.required ? h('em', { 'aria-hidden': 'true' }, ' *') : null), input);

  // ---------- self-serve flow ----------

  function openSend() {
    ctx.track('proof_review_open');
    const f = frame('Check your design');
    const { body } = f;
    stepReview(f);
  }

  function stepReview(f) {
    const { body } = f;
    f.title.textContent = 'Check your design';
    body.textContent = '';
    const thumbs = h('div', { class: 'dz-review-thumbs' });
    const doc = S.doc;
    doc.project.pieces.forEach((piece, pi) => {
      const names = sideNamesFor(productOf(env, piece.productId), piece.choices);
      const count = piece.sidesMode === 'same' ? 1 : names.length;
      for (let si = 0; si < count; si++) {
        const fig = h('figure', { class: 'dz-review-fig' });
        const holder = h('div', { class: 'dz-review-img' });
        holder.innerHTML = sideThumb(doc, pi, si, env, S.assets);
        fig.append(holder, h('figcaption', null, piece.sidesMode === 'same' && names.length > 1 ? `All ${names.length} sides` : names[si]));
        thumbs.append(fig);
      }
    });
    const summary = createSummary(ctx);
    const warnings = collectWarnings(doc, env, S.assets);
    const warnBox = h('div', { class: 'dz-warnings' });
    if (warnings.length) {
      warnBox.append(h('h2', { class: 'dz-h3' }, 'Worth a look'));
      for (const w of warnings.slice(0, 8)) warnBox.append(h('p', { class: 'dz-warn' }, icon('warning', 18), ' ', w.message));
      warnBox.append(h('p', { class: 'dz-help' }, "You can still send it. We'll fix these on your proof."));
    }
    body.append(
      thumbs, summary.el, warnBox,
      h('div', { class: 'dz-dlg-foot' },
        h('button', { type: 'button', class: 'dz-btn dz-btn-ghost', onclick: () => close() }, 'Keep editing'),
        h('button', { type: 'button', class: 'dz-btn dz-btn-primary', onclick: () => stepContact(f) }, 'Continue'))
    );
  }

  function stepContact(f, extra) {
    const { body } = f;
    f.title.textContent = 'Where should we send your proof?';
    body.textContent = '';
    const name = h('input', { class: 'dz-input', name: 'name', autocomplete: 'name', required: true, maxlength: 100 });
    const email = h('input', { class: 'dz-input', name: 'email', type: 'email', autocomplete: 'email', required: true, maxlength: 160, inputmode: 'email' });
    const phone = h('input', { class: 'dz-input', name: 'phone', type: 'tel', autocomplete: 'tel', maxlength: 30, inputmode: 'tel' });
    const date = h('input', { class: 'dz-input', name: 'eventDate', type: 'date' });
    const hear = h('select', { class: 'dz-input', name: 'hear' }, ...['', 'Etsy', 'Facebook', 'A friend', 'Google', 'Somewhere else'].map((o) => h('option', { value: o }, o || 'Choose one')));
    const notes = h('textarea', { class: 'dz-input dz-textarea', name: 'notes', rows: 3, maxlength: 1500, placeholder: 'Anything we should know? Sizes, colors, wording changes.' });
    const trap = h('input', { name: '_gotcha', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true', class: 'dz-trap' });
    const error = h('p', { class: 'dz-warn', role: 'alert', hidden: true });
    const submit = h('button', { type: 'submit', class: 'dz-btn dz-btn-primary' }, 'Send my design');
    const form = h('form', { class: 'dz-form', novalidate: true },
      field('Your name', name, { required: true }), field('Email', email, { required: true }), field('Phone (optional)', phone),
      field('Event date (optional)', date), field('How did you hear about us? (optional)', hear), field('Notes (optional)', notes, { wide: true }), trap, error,
      h('p', { class: 'dz-help dz-wide' }, 'We use this only to make your proof. We never sell or share it.'),
      h('div', { class: 'dz-dlg-foot dz-wide' }, h('button', { type: 'button', class: 'dz-btn dz-btn-ghost', onclick: () => stepReview(f) }, 'Back'), submit));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.hidden = true;
      if (!name.value.trim()) { fail('Please add your name.', name); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) { fail('Please check your email address.', email); return; }
      submit.disabled = true;
      submit.textContent = 'Sending…';
      const contact = { name: name.value.trim(), email: email.value.trim(), phone: phone.value.trim(), eventDate: date.value, notes: notes.value.trim(), hear: hear.value };
      const failure = await send(f, contact, trap.value, extra);
      if (failure) {
        submit.disabled = false;
        submit.textContent = 'Try again';
        showFailure(error, failure);
      }
    });
    function fail(msg, el) {
      error.textContent = msg;
      error.hidden = false;
      el.focus();
    }
    body.append(form);
    name.focus();
  }

  async function send(f, contact, honey, extra) {
    ctx.track('proof_submit', { mode: 'self' });
    const previews = await buildPreviews();
    const t = projectTotal(env.catalog, S.doc);
    const fd = new FormData();
    fd.append('design', JSON.stringify(S.doc));
    fd.append('request', JSON.stringify({ ...contact, mode: 'self', source: 'designer-v2', viewport: viewport(), clientTotal: t.total, elapsedMs: Math.round(performance.now()) }));
    fd.append('_gotcha', honey || '');
    previews.forEach((p, i) => fd.append(`preview-${i}`, new File([p.blob], p.name, { type: 'image/png' })));
    let n = 0;
    for (const logo of S.doc.project.logos) {
      const asset = S.assets.get(logo.id);
      if (asset) fd.append(`logo-${n++}`, new File([asset.file], asset.name || 'logo', { type: asset.type }));
    }
    const res = await post(fd);
    if (res.data && res.data.ok && res.data.emailed) {
      ctx.track('proof_submit_ok', { mode: 'self' });
      stepDone(f, res.data.ref, contact, res.data.order);
      return null;
    }
    if (res.data && res.data.ok) {
      ctx.track('proof_submit_ok', { mode: 'self' });
      stepDone(f, res.data.ref, contact, res.data.order, true);
      return null;
    }
    const reason = res.status === 503 ? 'off' : res.status === 429 ? 'rate' : res.status === 413 ? 'too-large' : res.status === 0 ? 'network' : (res.data && res.data.error) || 'error';
    ctx.track('proof_submit_fallback', { reason });
    return reason;
  }

  function etsyLink() {
    const piece = S.doc.project.pieces[0];
    const product = productById(env.catalog, piece.productId);
    return `https://www.etsy.com/listing/${product.etsyId}`;
  }

  function stepDone(f, ref, contact, order, notEmailed) {
    const { body } = f;
    f.title.textContent = 'Got it. Your proof is on the way.';
    body.textContent = '';
    body.append(
      h('p', { class: 'dz-ref' }, 'Reference ', h('b', null, ref)),
      h('p', null, "We'll email your proof within 12 hours, 7 days a week. 3 revisions included. Nothing prints until you approve it."),
      notEmailed ? h('p', null, 'Our email hiccuped on this one, but your design is saved. If you do not hear from us in a day, call or text ', h('a', { href: TEL }, PHONE), ` and give us ${ref}.`) : null,
      order ? h('p', null, 'Nothing is charged until you approve your proof and pay from your proof link. ', h('a', { href: order.url }, 'See your order status'), '.') : null,
      h('p', { class: 'dz-help' }, 'Prefer Etsy? ', h('a', { href: etsyLink(), target: '_blank', rel: 'noopener' }, 'Order on Etsy'), ` and mention reference ${ref}.`),
      h('div', { class: 'dz-dlg-foot' },
        h('button', { type: 'button', class: 'dz-btn dz-btn-ghost', onclick: () => ctx.copyShareLink() }, 'Copy a link to this design'),
        h('button', { type: 'button', class: 'dz-btn dz-btn-primary', onclick: () => close() }, 'Done'))
    );
  }

  // ---------- "Rather we design it" ----------

  function openHelp() {
    ctx.track('designer_help_open');
    const f = frame("Rather we design it? It's free.");
    const { body } = f;
    const name = h('input', { class: 'dz-input', autocomplete: 'name', required: true, maxlength: 100 });
    const email = h('input', { class: 'dz-input', type: 'email', autocomplete: 'email', required: true, maxlength: 160, inputmode: 'email' });
    const phone = h('input', { class: 'dz-input', type: 'tel', autocomplete: 'tel', maxlength: 30, inputmode: 'tel' });
    const current = S.doc.project.pieces[0].productId;
    const checks = env.catalog.products.map((p) => {
      const cb = h('input', { type: 'checkbox', value: p.id, id: 'dz-hp-' + p.id, checked: p.id === current });
      cb.dataset.label = p.short;
      return { cb, el: h('label', { class: 'dz-check', for: 'dz-hp-' + p.id }, cb, h('span', null, p.short)) };
    });
    const wording = h('textarea', { class: 'dz-input dz-textarea', rows: 3, maxlength: 1500, placeholder: 'What should it say? Business name, phone, slogan.' });
    const logo = h('input', { type: 'file', class: 'dz-input', accept: 'image/png,image/jpeg,image/webp,image/svg+xml', multiple: true, 'aria-label': 'Logo files' });
    const date = h('input', { class: 'dz-input', type: 'date' });
    const site = h('input', { class: 'dz-input', type: 'url', placeholder: 'https://', maxlength: 200, inputmode: 'url', autocomplete: 'url' });
    const notes = h('textarea', { class: 'dz-input dz-textarea', rows: 2, maxlength: 1500 });
    const trap = h('input', { tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true', class: 'dz-trap' });
    const error = h('p', { class: 'dz-warn', role: 'alert', hidden: true });
    const submit = h('button', { type: 'submit', class: 'dz-btn dz-btn-primary' }, 'Send it to us');
    const form = h('form', { class: 'dz-form', novalidate: true },
      field('Your name', name, { required: true }), field('Email', email, { required: true }), field('Phone (optional)', phone), field('Event date (optional)', date),
      h('fieldset', { class: 'dz-fieldset dz-wide' }, h('legend', null, 'What do you need?'), h('div', { class: 'dz-checks' }, ...checks.map((c) => c.el))),
      field('Wording', wording, { wide: true }), field('Logo (optional)', logo, { wide: true }), field('Match my website (optional)', site, { wide: true }), field('Notes (optional)', notes, { wide: true }),
      trap, error, h('p', { class: 'dz-help dz-wide' }, 'Free design, free proof within 12 hours, 7 days a week, 3 revisions included.'),
      h('div', { class: 'dz-dlg-foot dz-wide' }, h('button', { type: 'button', class: 'dz-btn dz-btn-ghost', onclick: () => close() }, 'Cancel'), submit));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.hidden = true;
      if (!name.value.trim()) { error.textContent = 'Please add your name.'; error.hidden = false; name.focus(); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) { error.textContent = 'Please check your email address.'; error.hidden = false; email.focus(); return; }
      submit.disabled = true;
      submit.textContent = 'Sending…';
      const contact = { name: name.value.trim(), email: email.value.trim(), phone: phone.value.trim(), eventDate: date.value, notes: notes.value.trim() };
      const picked = checks.filter((c) => c.cb.checked);
      const extra = { mode: 'design_for_me', products: picked.map((c) => c.cb.value), productLabels: picked.map((c) => c.cb.dataset.label), wording: wording.value.trim(), siteUrl: site.value.trim() };
      ctx.track('proof_submit', { mode: 'design_for_me' });
      const fd = new FormData();
      fd.append('request', JSON.stringify({ ...contact, mode: 'design_for_me', designForMe: { products: extra.products, wording: extra.wording, siteUrl: extra.siteUrl }, source: 'designer-v2', viewport: viewport(), elapsedMs: Math.round(performance.now()) }));
      fd.append('_gotcha', trap.value || '');
      [...logo.files].slice(0, 4).forEach((file, i) => fd.append(`logo-${i}`, file));
      const res = await post(fd);
      if (res.data && res.data.ok) {
        ctx.track('proof_submit_ok', { mode: 'design_for_me' });
        f.title.textContent = 'Got it.';
        body.textContent = '';
        body.append(
          h('p', { class: 'dz-ref' }, 'Reference ', h('b', null, res.data.ref)),
          h('p', null, 'Your free proof is coming within 12 hours, 7 days a week.'),
          res.data.emailed ? null : h('p', null, 'Our email hiccuped on this one, but your request is saved. If you do not hear from us in a day, call or text ', h('a', { href: TEL }, PHONE), ` and give us ${res.data.ref}.`),
          h('div', { class: 'dz-dlg-foot' }, h('button', { type: 'button', class: 'dz-btn dz-btn-primary', onclick: () => close() }, 'Done'))
        );
        return;
      }
      const reason = res.status === 503 ? 'off' : res.status === 429 ? 'rate' : res.status === 413 ? 'too-large' : res.status === 0 ? 'network' : (res.data && res.data.error) || 'error';
      ctx.track('proof_submit_fallback', { reason });
      submit.disabled = false;
      submit.textContent = 'Try again';
      showFailure(error, reason);
    });
    body.append(form);
    name.focus();
  }

  return { openSend, openHelp, close, buildPreviews, makeRef };
}
