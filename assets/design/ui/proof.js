// "Get my free proof" and "Rather we design it?": review, contact form, send, and the fallback when
// the server is off (a zip of previews plus a prefilled email). Nothing here talks to a server
// except POST /api/design-proof, which answers 503 until the shop turns it on.
import { h, icon } from './dom.js';
import { createSummary } from './summary.js';
import { sideThumb } from '../render/thumbs.js';
import { sideDisplay } from '../render/displaylist.js';
import { renderToCanvas } from '../render/canvas.js';
import { collectWarnings } from '../model/review.js';
import { projectTotal, money, productById } from '../model/pricing.js';
import { sideNamesFor, productOf } from '../model/document.js';
import { zipStore } from '../model/zip.js';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const MAILTO = 'sales@getseensignsco.com';

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

  function summaryText(ref, contact, extra) {
    const doc = S.doc;
    const t = projectTotal(env.catalog, doc);
    const lines = ['Design proof request', 'Reference: ' + ref, '', `Name: ${contact.name}`, `Email: ${contact.email}`, `Phone: ${contact.phone || '-'}`, `Event date: ${contact.eventDate || '-'}`, `Notes: ${contact.notes || '-'}`, ''];
    if (extra && extra.mode === 'design_for_me') {
      lines.push('They asked us to design it.', `Products: ${(extra.productLabels || []).join(', ') || '-'}`, `Wording: ${extra.wording || '-'}`, `Website to match: ${extra.siteUrl || '-'}`);
    } else {
      doc.project.pieces.forEach((piece, i) => {
        const product = productOf(env, piece.productId);
        const row = t.lines[i];
        const names = sideNamesFor(product, piece.choices);
        const sides = names.length > 1 ? (piece.sidesMode === 'same' ? `same on all ${names.length} sides` : 'each side different') : 'one print area';
        lines.push(`Product: ${product.name}`, `Option: ${row ? row.label : '-'}`, `Quantity: ${piece.qty}`, `Template: ${piece.templateId}`, `Sides: ${sides}`);
      });
      const f = doc.project.fields;
      lines.push(`Text: ${[f.name, f.line2, f.phone, f.web].filter(Boolean).join(' | ') || '-'}`);
      const p = doc.project.palette;
      lines.push(`Colors: primary ${p.primary}, accent ${p.accent}, ink ${p.ink}`);
      if (doc.project.logos.length) lines.push('Logo files: ' + doc.project.logos.map((l) => l.name).join(', '));
      lines.push(`Price shown: ${money(t.total)}, free shipping in the lower 48`);
    }
    lines.push('', 'Attach the file you downloaded (it has the previews). This is a preview, not the print file. Reply with the free proof.');
    return lines.join('\n');
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name, style: { display: 'none' } });
    document.body.append(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 4000);
  }

  function openMail(ref, contact, extra) {
    const subject = `Design proof request ${ref}`;
    let body = summaryText(ref, contact, extra);
    if (body.length > 1700) body = body.slice(0, 1650) + '\n(shortened)';
    const url = `mailto:${MAILTO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    if (ctx.debug) ctx.debug.lastMailto = url;
    if (!(ctx.debug && ctx.debug.noNavigate)) window.location.href = url;
    return url;
  }

  async function fallbackFiles(ref, contact, previews, extra) {
    const files = [];
    const enc = new TextEncoder();
    for (const p of previews) files.push({ name: p.name, data: new Uint8Array(await p.blob.arrayBuffer()) });
    files.push({ name: 'summary.txt', data: enc.encode(summaryText(ref, contact, extra)) });
    if (!(extra && extra.mode === 'design_for_me')) files.push({ name: 'design.json', data: enc.encode(JSON.stringify(S.doc)) });
    let n = 0;
    for (const logo of S.doc.project.logos) {
      const asset = S.assets.get(logo.id);
      if (asset) {
        n += 1;
        const ext = (asset.type.split('/')[1] || 'png').replace('svg+xml', 'svg').replace('jpeg', 'jpg');
        files.push({ name: `logo-${n}.${ext}`, data: new Uint8Array(await asset.file.arrayBuffer()) });
      }
    }
    return files;
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
      await send(f, contact, trap.value, extra);
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
      stepDone(f, res.data.ref, contact);
      return;
    }
    const reason = res.status === 503 ? 'off' : res.data && res.data.ok ? 'not-emailed' : res.status === 0 ? 'network' : (res.data && res.data.error) || 'error';
    ctx.track('proof_submit_fallback', { reason });
    const ref = (res.data && res.data.ref) || makeRef();
    const files = await fallbackFiles(ref, contact, previews, extra);
    stepFallback(f, ref, contact, files, extra, reason);
  }

  function etsyLink() {
    const piece = S.doc.project.pieces[0];
    const product = productById(env.catalog, piece.productId);
    return `https://www.etsy.com/listing/${product.etsyId}`;
  }

  function stepDone(f, ref, contact) {
    const { body } = f;
    f.title.textContent = 'Got it. Your proof is on the way.';
    body.textContent = '';
    body.append(
      h('p', { class: 'dz-ref' }, 'Reference ', h('b', null, ref)),
      h('p', null, "We'll email your proof within 12 hours, 7 days a week. 3 revisions included. Nothing prints until you approve it."),
      h('p', { class: 'dz-help' }, 'Prefer Etsy? ', h('a', { href: etsyLink(), target: '_blank', rel: 'noopener' }, 'Order on Etsy'), ` and mention reference ${ref}.`),
      h('div', { class: 'dz-dlg-foot' },
        h('button', { type: 'button', class: 'dz-btn dz-btn-ghost', onclick: () => ctx.copyShareLink() }, 'Copy a link to this design'),
        h('button', { type: 'button', class: 'dz-btn dz-btn-primary', onclick: () => close() }, 'Done'))
    );
  }

  function stepFallback(f, ref, contact, files, extra, reason) {
    const { body } = f;
    f.title.textContent = 'One more step to send it';
    body.textContent = '';
    const zipName = `getseen-design-${ref}.zip`;
    const blob = new Blob([zipStore(files)], { type: 'application/zip' });
    download(blob, zipName);
    body.append(
      h('p', { class: 'dz-ref' }, 'Reference ', h('b', null, ref)),
      h('p', null, reason === 'not-emailed'
        ? 'We saved your design, but our email did not go out. Please send it to us by email:'
        : 'Our online form is not available right now, so we put your files in one download and opened an email to us:'),
      h('ol', { class: 'dz-steps' },
        h('li', null, 'Attach the file ', h('b', null, zipName), ' that just downloaded.'),
        h('li', null, `Send the email to ${MAILTO}. It already has your details and the reference.`)),
      h('p', { class: 'dz-help' }, "We'll reply with your free proof within 12 hours, 7 days a week."),
      h('div', { class: 'dz-dlg-foot' },
        h('button', { type: 'button', class: 'dz-btn dz-btn-ghost', onclick: () => download(blob, zipName) }, 'Download my files again'),
        h('button', { type: 'button', class: 'dz-btn dz-btn-primary', onclick: () => openMail(ref, contact, extra) }, 'Open my email'))
    );
    setTimeout(() => openMail(ref, contact, extra), 700);
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
      if (res.data && res.data.ok && res.data.emailed) {
        ctx.track('proof_submit_ok', { mode: 'design_for_me' });
        f.title.textContent = 'Got it.';
        body.textContent = '';
        body.append(h('p', { class: 'dz-ref' }, 'Reference ', h('b', null, res.data.ref)), h('p', null, 'Your free proof is coming within 12 hours, 7 days a week.'), h('div', { class: 'dz-dlg-foot' }, h('button', { type: 'button', class: 'dz-btn dz-btn-primary', onclick: () => close() }, 'Done')));
        return;
      }
      const reason = res.status === 503 ? 'off' : res.status === 0 ? 'network' : (res.data && res.data.error) || 'error';
      ctx.track('proof_submit_fallback', { reason });
      const ref = (res.data && res.data.ref) || makeRef();
      f.title.textContent = 'One more step to send it';
      body.textContent = '';
      const url = openMailLater(ref, contact, extra);
      body.append(
        h('p', { class: 'dz-ref' }, 'Reference ', h('b', null, ref)),
        h('p', null, 'Our online form is not available right now, so we opened an email to us with your details. Send it, and attach your logo to that email if you have one.'),
        h('p', { class: 'dz-help' }, `If no email opened, write to ${MAILTO} and mention ${ref}.`),
        h('div', { class: 'dz-dlg-foot' }, h('button', { type: 'button', class: 'dz-btn dz-btn-primary', onclick: () => openMail(ref, contact, extra) }, 'Open my email'))
      );
      void url;
    });
    body.append(form);
    name.focus();
  }

  function openMailLater(ref, contact, extra) {
    setTimeout(() => openMail(ref, contact, extra), 600);
    return null;
  }

  return { openSend, openHelp, close, buildPreviews, makeRef };
}
