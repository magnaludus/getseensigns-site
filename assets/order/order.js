// The "Start my order" panel on a product page. The page prices come from assets/order/catalog.json, embedded in the
// page as #order-data. This script only adds them up for display: the order endpoint (/api/order-request) prices every
// order again on the server from the SKU and the quantity, and ignores any amount the browser could send.
const dataEl = document.getElementById('order-data');
const form = document.getElementById('order-form');

if (dataEl && form) {
  const data = JSON.parse(dataEl.textContent);
  const $ = (sel, root = form) => root.querySelector(sel);
  const money = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const statusEl = $('#ord-status');
  const totalEl = $('#ord-total');
  const submit = $('#ord-submit');
  const designLink = $('#ord-design');
  const started = performance.now();
  const MAX_FILES = 4;
  const MAX_FILE = 25 * 1024 * 1024;

  const groupSel = (id) => $(`[data-group="${id}"]`);
  const selection = () => Object.fromEntries(data.groups.map((g) => [g.id, groupSel(g.id).value]));
  const rowFor = (sel) => data.rows.find((r) => Object.keys(r.when).every((k) => r.when[k] === sel[k])) || null;
  const qtyInput = form.elements.qty;
  const qty = () => {
    const n = Math.floor(Number(qtyInput.value));
    return Number.isFinite(n) ? Math.min(data.maxQty, Math.max(1, n)) : 1;
  };
  const path = () => (form.querySelector('input[name="path"]:checked') || {}).value;

  // Choices an option hides for the current selection (pole pockets on mesh, Christmas styles on a yard sign).
  function applyHides() {
    const sel = selection();
    for (const o of data.options) {
      const el = $(`[data-option="${o.id}"]`);
      for (const c of o.choices) {
        const rule = o.hide[c.id];
        const hidden = !!rule && Object.keys(rule).some((g) => rule[g].indexOf(sel[g]) >= 0);
        const opt = [...el.options].find((x) => x.value === c.id);
        opt.hidden = hidden;
        opt.disabled = hidden;
      }
      if (el.selectedOptions[0] && el.selectedOptions[0].disabled) {
        const next = [...el.options].find((x) => !x.disabled);
        if (next) el.value = next.value;
      }
    }
  }

  function addonQty(a) {
    const box = $(`[data-addon="${a.id}"]`);
    return box && box.checked ? qty() : 0;
  }

  function lines() {
    const row = rowFor(selection());
    const out = [];
    if (row) out.push({ sku: row.sku, quantity: qty(), price: row.price });
    for (const a of data.addons) {
      const n = addonQty(a);
      if (n) out.push({ sku: a.sku, quantity: n, price: a.price });
    }
    return out;
  }

  function update() {
    applyHides();
    const items = lines();
    const total = items.reduce((s, it) => s + it.price * it.quantity, 0);
    totalEl.textContent = items.length ? money(total) + ' before tax' : '';
    if (designLink && data.designUrl) {
      const sel = selection();
      const q = new URLSearchParams();
      for (const g of data.groups) if (data.designerMap[g.id]) q.set(data.designerMap[g.id], sel[g.id]);
      if (qty() > 1) q.set('qty', String(qty()));
      designLink.href = data.designUrl + (q.toString() ? '?' + q.toString() : '');
    }
    // The designer path only exists for choices the designer has (not fitted table covers, for example).
    const wrap = $('#ord-path-designer');
    if (wrap) {
      const sel = selection();
      const ok = data.groups.every((g) => !data.designerMap[g.id] || (data.designerOk[g.id] || []).indexOf(sel[g.id]) >= 0);
      wrap.hidden = !ok;
      $('#ord-design-off').hidden = ok;
      const box = wrap.querySelector('input');
      if (!ok && box.checked) form.querySelector('input[name="path"][value="upload"]').checked = true;
    }
    const p = path();
    for (const el of form.querySelectorAll('.ord-panel')) el.hidden = el.dataset.for !== p;
    $('.ord-details').hidden = p === 'designer';
    submit.innerHTML = p === 'designer' ? 'Open the designer <span aria-hidden="true">→</span>' : 'Start my order <span aria-hidden="true">→</span>';
  }

  function say(text, bad) {
    statusEl.textContent = text;
    statusEl.classList.toggle('bad', !!bad);
  }

  function invalid(el, message) {
    el.setAttribute('aria-invalid', 'true');
    say(message, true);
    el.focus();
    return false;
  }

  function validate() {
    for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    const f = form.elements;
    if (!lines().length) return invalid(groupSel(data.groups[0].id), 'Pick your options first.');
    if (path() === 'upload') {
      const files = [...$('#ord-files').files];
      if (!files.length) return invalid($('#ord-files'), 'Choose your artwork or logo, or pick "Rather have us design it".');
      if (files.length > MAX_FILES) return invalid($('#ord-files'), 'Please send up to 4 files.');
      if (files.some((x) => x.size > MAX_FILE)) return invalid($('#ord-files'), 'One of those files is over 25 MB. Please send a smaller one.');
    }
    if (path() === 'dfm' && f.wording.value.trim().length < 3) return invalid(f.wording, 'Tell us the words you want on it.');
    if (!f.name.value.trim()) return invalid(f.name, 'Please enter your name.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.value.trim())) return invalid(f.email, 'Please enter a valid email address.');
    return true;
  }

  function optionNotes() {
    return data.options
      .map((o) => {
        const el = $(`[data-option="${o.id}"]`);
        return el && !el.selectedOptions[0].disabled ? { label: o.label, value: el.selectedOptions[0].textContent } : null;
      })
      .filter(Boolean);
  }

  const ERRORS = {
    fields: 'Please check your name and email.',
    logo: 'We could not read one of your files. Please use PNG, JPG, WebP or SVG.',
    order: 'Something about the order options did not look right. Please reload the page and try again.',
    'too-large': 'Those files are too big. Please send smaller ones, or email them to us.',
    rate: 'We got a lot of requests from your connection. Please try again in an hour, or call us.',
  };

  function done(result) {
    const box = document.createElement('div');
    box.className = 'ord-done';
    box.setAttribute('tabindex', '-1');
    const add = (tag, text, cls) => {
      const el = document.createElement(tag);
      el.textContent = text;
      if (cls) el.className = cls;
      box.append(el);
      return el;
    };
    add('h3', 'Got your order request.');
    const refP = document.createElement('p');
    refP.append('Reference ');
    const ref = document.createElement('span');
    ref.className = 'ord-ref';
    ref.textContent = result.ref;
    refP.append(ref);
    box.append(refP);
    if (result.order) add('p', 'Order total before sales tax: ' + money(result.order.subtotal / 100) + '. Free shipping in the lower 48.');
    add('p', 'Your free proof will be in your inbox within 12 hours, 7 days a week, with 3 revisions included. Nothing is charged and nothing prints until you approve the proof and pay from your proof link.');
    if (result.emailed) add('p', 'We emailed you a confirmation. Check your spam folder if you do not see it.');
    else add('p', 'Our confirmation email may be late. If you do not hear from us, email sales@getseensignsco.com with your reference.');
    if (result.order && result.order.url) {
      const a = document.createElement('a');
      a.className = 'btn btn-y';
      a.href = result.order.url;
      a.textContent = 'See my order status';
      box.append(a);
    }
    form.replaceWith(box);
    box.focus();
  }

  async function send() {
    const f = form.elements;
    const p = path();
    const fd = new FormData();
    const request = {
      name: f.name.value.trim(), email: f.email.value.trim(), phone: f.phone.value.trim(), eventDate: f.eventDate.value, notes: f.notes.value.trim(),
      mode: p === 'upload' ? 'upload' : 'design_for_me', source: 'order-panel:' + data.slug, viewport: window.matchMedia('(max-width: 760px)').matches ? 'm' : 'd',
      elapsedMs: Math.round(performance.now() - started),
      order: { items: lines().map((it) => ({ sku: it.sku, quantity: it.quantity })), options: optionNotes() },
    };
    if (p === 'dfm') request.designForMe = { products: [], wording: f.wording.value.trim(), siteUrl: f.siteUrl.value.trim() };
    fd.append('request', JSON.stringify(request));
    fd.append('_gotcha', f._gotcha.value || '');
    const files = p === 'upload' ? [...$('#ord-files').files] : p === 'dfm' ? [...$('#ord-dfm-files').files].slice(0, MAX_FILES) : [];
    files.forEach((file, i) => fd.append(`logo-${i}`, file));
    submit.disabled = true;
    say('Sending your order request...');
    let res;
    try {
      const r = await fetch('/api/order-request', { method: 'POST', body: fd });
      res = { status: r.status, data: await r.json().catch(() => null) };
    } catch (_) {
      res = { status: 0, data: null };
    }
    submit.disabled = false;
    if (res.data && res.data.ok && res.data.order) return done(res.data);
    if (res.status === 503) return say('Online ordering is not available right now. Please order on Etsy or send us a quote request, and we will take care of you.', true);
    if (res.status === 0) return say('We could not reach the server. Check your connection and try again.', true);
    say((res.data && ERRORS[res.data.error]) || 'Something went wrong on our end. Please try again, or email sales@getseensignsco.com.', true);
  }

  form.addEventListener('input', update);
  form.addEventListener('change', update);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (path() === 'designer') {
      location.href = designLink.href;
      return;
    }
    if (validate()) send();
  });
  update();
}
