(function () {
  'use strict';
  var KEY = 'gss-admin-token';
  var $ = function (id) { return document.getElementById(id); };
  var token = sessionStorage.getItem(KEY) || '';

  function setStatus(el, text, bad) {
    el.textContent = text;
    el.classList.toggle('bad', !!bad);
  }

  function api(method, path, body) {
    if (!token) return Promise.reject(new Error('Enter your admin token first.'));
    return fetch(path, {
      method: method,
      headers: Object.assign({ Authorization: 'Bearer ' + token }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || data.ok === false) throw new Error(data.error || 'Request failed (' + res.status + ')');
        return data;
      });
    });
  }

  function parseItems(text) {
    return text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(function (line) {
      if (line.indexOf('|') >= 0) {
        var p = line.split('|').map(function (s) { return s.trim(); });
        var cents = Math.round(parseFloat(String(p[2] || '').replace(/[$,]/g, '')) * 100);
        var item = { name: p[0], quantity: parseInt(p[1] || '1', 10), unit_amount_cents: cents };
        if (p[0].toLowerCase() === 'shipping') item.sku = 'shipping';
        return item;
      }
      var m = /^(\S+)(?:\s*[xX*]\s*(\d+))?$/.exec(line);
      if (!m) throw new Error('Could not read the item line: ' + line);
      return { sku: m[1], quantity: m[2] ? parseInt(m[2], 10) : 1 };
    });
  }

  function linkResult(el, label, url, extra) {
    el.classList.remove('bad');
    el.textContent = '';
    var a = document.createElement('a');
    a.href = url;
    a.textContent = url;
    a.target = '_blank';
    a.rel = 'noopener';
    el.appendChild(document.createTextNode(label + ' '));
    el.appendChild(a);
    if (extra) el.appendChild(document.createTextNode('\n' + extra));
  }

  function emailLine(data) {
    return data.email && data.email.sent ? 'Email sent to the customer.' : 'The email did NOT send' + (data.email && data.email.error ? ' (' + data.email.error + ')' : '') + '. Send the link yourself.';
  }

  function loadOrders() {
    return api('GET', '/api/admin/orders').then(function (data) {
      var body = $('orders');
      body.textContent = '';
      data.orders.forEach(function (o) {
        var tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.title = 'Use this order number';
        tr.addEventListener('click', function () {
          $('p-order').value = o.id;
          $('t-order').value = o.id;
          $('p-url').focus();
        });
        [o.id, o.status === 'awaiting_proof' ? 'needs proof' : o.status, o.customer_email, '$' + (o.subtotal_cents / 100).toFixed(2), o.created_at.slice(0, 16).replace('T', ' ')].forEach(function (v) {
          var td = document.createElement('td');
          td.textContent = v;
          tr.appendChild(td);
        });
        body.appendChild(tr);
      });
    });
  }

  $('token-form').addEventListener('submit', function (e) {
    e.preventDefault();
    token = $('token').value.trim();
    sessionStorage.setItem(KEY, token);
    $('token').value = '';
    loadOrders().then(function () { setStatus($('token-status'), 'Token accepted.'); }).catch(function (err) { setStatus($('token-status'), err.message, true); });
  });

  $('create-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var out = $('create-result');
    setStatus(out, 'Creating...');
    var urls = $('c-proof').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    var payload;
    try {
      payload = { customer_email: $('c-email').value.trim(), customer_name: $('c-name').value.trim(), line_items: parseItems($('c-items').value), proof_image_urls: urls, proof_note: $('c-note').value.trim() };
    } catch (err) { setStatus(out, err.message, true); return; }
    api('POST', '/api/admin/orders', payload)
      .then(function (data) { linkResult(out, 'Order ' + data.order_id + ' created. Proof link:', data.proof_url, emailLine(data)); loadOrders(); })
      .catch(function (err) { setStatus(out, err.message, true); });
  });

  $('proof-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var out = $('proof-result');
    setStatus(out, 'Saving...');
    api('POST', '/api/admin/orders/' + encodeURIComponent($('p-order').value.trim()) + '/proof', { proof_image_url: $('p-url').value.trim() })
      .then(function (data) { linkResult(out, 'Proof version ' + data.proof_version + ' added. Link:', data.proof_url, emailLine(data)); loadOrders(); })
      .catch(function (err) { setStatus(out, err.message, true); });
  });

  $('track-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var out = $('track-result');
    setStatus(out, 'Saving...');
    var payload = { carrier: $('t-carrier').value.trim(), tracking_number: $('t-number').value.trim() };
    if ($('t-url').value.trim()) payload.tracking_url = $('t-url').value.trim();
    api('POST', '/api/admin/orders/' + encodeURIComponent($('t-order').value.trim()) + '/tracking', payload)
      .then(function (data) { linkResult(out, 'Marked shipped. Customer status page:', data.order_url, emailLine(data)); loadOrders(); })
      .catch(function (err) { setStatus(out, err.message, true); });
  });

  $('refresh').addEventListener('click', function () {
    loadOrders().catch(function (err) { setStatus($('token-status'), err.message, true); });
  });

  if (token) loadOrders().then(function () { setStatus($('token-status'), 'Using the token from this tab.'); }).catch(function (err) { setStatus($('token-status'), err.message, true); });
})();
