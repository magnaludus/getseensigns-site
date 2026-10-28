// Order logic on top of D1: creating orders and proofs, revision requests, the approval evidence record,
// payment and shipping state, and dispute lookups. Route files stay thin and call into here.

import { resolveLineItem, subtotalOf, createCheckoutSession, getCharge } from './stripe.js';
import { all, one, run, changes } from './db.js';
import { rememberTerms } from './terms.js';
import {
  newOrderId, newEvidenceId, newToken, TOKEN_RE, sha256Hex, nowIso, oneLine, multiLine, validEmail, isHttpsUrl, money, log,
} from './util.js';

export const MAX_FREE_REVISIONS = 3;
export const CONSENT_TEXT = 'I approve this proof and agree to the Terms of Service';

const MAX_ITEMS = 20;
const MAX_PROOF_FILES = 6;
const MAX_PROOF_BYTES = 20 * 1024 * 1024;
const PROOF_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export const STATUS_LABELS = {
  awaiting_proof: 'We are making your proof',
  proof_sent: 'Proof ready for your review',
  revision_requested: 'Revision in progress',
  approved: 'Proof approved, waiting for payment',
  paid: 'Paid, in production',
  shipped: 'Shipped',
};

const parse = (text, fallback) => {
  try {
    return JSON.parse(text);
  } catch (_) {
    return fallback;
  }
};

export function linksFor(base, order) {
  return { proof: base + '/proof/' + order.token, order: base + '/order/' + order.token };
}

// ---------- input checks ----------

export function parseLineItems(raw) {
  if (!Array.isArray(raw) || !raw.length) return { error: 'line_items must be a non-empty list' };
  if (raw.length > MAX_ITEMS) return { error: 'at most ' + MAX_ITEMS + ' line items' };
  const items = [];
  for (let i = 0; i < raw.length; i++) {
    const r = resolveLineItem(raw[i]);
    if (r.error) return { error: 'line_items[' + i + ']: ' + r.error };
    items.push(r.item);
  }
  const subtotal = subtotalOf(items);
  if (subtotal < 50) return { error: 'order total must be at least $0.50' };
  if (subtotal > 99999999) return { error: 'order total is too large' };
  return { items, subtotal };
}

export function proofUrlsFrom(body) {
  const list = Array.isArray(body.proof_image_urls) ? body.proof_image_urls : body.proof_image_url ? [body.proof_image_url] : [];
  const urls = list.map((u) => (typeof u === 'string' ? u.trim() : ''));
  if (!urls.length) return { error: 'proof_image_url is required' };
  if (urls.length > MAX_PROOF_FILES) return { error: 'at most ' + MAX_PROOF_FILES + ' proof images' };
  for (const u of urls) if (!isHttpsUrl(u) || u.length > 1000) return { error: 'proof image URLs must be https links' };
  return { urls };
}

async function readLimited(res, max) {
  const reader = res.body && res.body.getReader();
  if (!reader) return new Uint8Array(await res.arrayBuffer());
  const chunks = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > max) {
      reader.cancel().catch(() => {});
      throw new Error('proof image is larger than 20 MB');
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return bytes;
}

// Downloads each proof image once, to prove it is a real image and to fix its SHA-256 at the moment the proof
// is made. The hash goes into the approval evidence.
export async function hashProofFiles(urls) {
  const files = [];
  for (const url of urls) {
    let res;
    try {
      res = await fetch(url, { redirect: 'follow' });
    } catch (_) {
      return { error: 'could not download ' + url };
    }
    if (!res.ok) return { error: 'proof image returned HTTP ' + res.status + ': ' + url };
    const type = (res.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (!PROOF_TYPES.has(type)) return { error: 'proof must be a png, jpeg, webp or gif image (got ' + (type || 'unknown type') + '): ' + url };
    let bytes;
    try {
      bytes = await readLimited(res, MAX_PROOF_BYTES);
    } catch (err) {
      return { error: err.message };
    }
    files.push({ url: url, sha256: await sha256Hex(bytes), content_type: type, bytes: bytes.byteLength });
  }
  const proofHash = files.length === 1 ? files[0].sha256 : await sha256Hex(files.map((f) => f.sha256).join('\n'));
  return { files, proofHash };
}

// ---------- reads ----------

export async function getOrderByToken(db, token) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  return one(db, 'SELECT * FROM orders WHERE token = ?', [token]);
}

export async function getOrderById(db, id) {
  if (typeof id !== 'string' || !/^GS-[0-9A-HJKMNP-TV-Z]{8}$/.test(id)) return null;
  return one(db, 'SELECT * FROM orders WHERE id = ?', [id]);
}

export async function loadBundle(db, order) {
  const proofRows = await all(db, 'SELECT * FROM proofs WHERE order_id = ? ORDER BY version', [order.id]);
  const proofs = proofRows.map((p) => Object.assign({}, p, { files: parse(p.files_json, []) }));
  const approval = await one(db, 'SELECT * FROM approvals WHERE order_id = ?', [order.id]);
  const shipments = await all(db, 'SELECT * FROM shipments WHERE order_id = ? ORDER BY id', [order.id]);
  return {
    order,
    items: parse(order.line_items_json, []),
    proofs,
    proof: proofs.length ? proofs[proofs.length - 1] : null,
    approval,
    shipments,
  };
}

// ---------- create order and proofs ----------

export async function createOrder(db, body, now) {
  const email = oneLine(body.customer_email, 200).toLowerCase();
  if (!validEmail(email)) return { error: 'customer_email is not a valid email address' };
  const li = parseLineItems(body.line_items);
  if (li.error) return { error: li.error };
  const pu = proofUrlsFrom(body);
  if (pu.error) return { error: pu.error };
  const hashed = await hashProofFiles(pu.urls);
  if (hashed.error) return { error: hashed.error };

  const stamp = nowIso(now);
  const order = {
    id: newOrderId(),
    token: newToken(),
    customer_email: email,
    customer_name: oneLine(body.customer_name, 120),
    status: 'proof_sent',
    line_items_json: JSON.stringify(li.items),
    subtotal_cents: li.subtotal,
    notes: multiLine(body.notes, 2000),
    created_at: stamp,
    updated_at: stamp,
  };
  await db.batch([
    db
      .prepare('INSERT INTO orders (id, token, customer_email, customer_name, status, line_items_json, subtotal_cents, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(order.id, order.token, order.customer_email, order.customer_name, order.status, order.line_items_json, order.subtotal_cents, order.notes, stamp, stamp),
    db
      .prepare('INSERT INTO proofs (order_id, version, files_json, proof_hash, note, created_at) VALUES (?, 1, ?, ?, ?, ?)')
      .bind(order.id, JSON.stringify(hashed.files), hashed.proofHash, multiLine(body.proof_note, 1000), stamp),
  ]);
  return { order: await getOrderById(db, order.id), version: 1 };
}

// An order that came from the website's order panel or the designer: no proof yet, status awaiting_proof.
// `items` come from resolveLineItem on SKUs the server knows, so the prices are the server's. The order id is the
// reference the customer was given (the same GS- number as the design_proof_requests row).
export async function createPendingOrder(db, input, now) {
  const items = input.items;
  const subtotal = items.reduce((sum, it) => sum + it.unit_amount_cents * it.quantity, 0);
  if (!items.length || subtotal < 50) return { error: 'order total must be at least $0.50' };
  const stamp = nowIso(now);
  const order = { id: input.id, token: newToken(), email: oneLine(input.email, 200).toLowerCase(), name: oneLine(input.name, 120), notes: multiLine(input.notes, 2000) };
  await run(
    db,
    "INSERT INTO orders (id, token, customer_email, customer_name, status, line_items_json, subtotal_cents, notes, created_at, updated_at) VALUES (?, ?, ?, ?, 'awaiting_proof', ?, ?, ?, ?, ?)",
    [order.id, order.token, order.email, order.name, JSON.stringify(items), subtotal, order.notes, stamp, stamp]
  );
  return { order: await getOrderById(db, order.id), subtotal };
}

// A new proof after a revision request (status revision_requested) or a replacement before the customer has acted.
export async function addProof(db, order, body, now) {
  const pu = proofUrlsFrom(body);
  if (pu.error) return { error: pu.error };
  const hashed = await hashProofFiles(pu.urls);
  if (hashed.error) return { error: hashed.error };
  const stamp = nowIso(now);
  const results = await db.batch([
    db
      .prepare(
        "INSERT INTO proofs (order_id, version, files_json, proof_hash, note, created_at) SELECT ?, (SELECT COALESCE(MAX(version), 0) + 1 FROM proofs WHERE order_id = ?), ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM orders WHERE id = ? AND status IN ('awaiting_proof', 'proof_sent', 'revision_requested'))"
      )
      .bind(order.id, order.id, JSON.stringify(hashed.files), hashed.proofHash, multiLine(body.proof_note, 1000), stamp, order.id),
    db.prepare("UPDATE orders SET status = 'proof_sent', updated_at = ? WHERE id = ? AND status IN ('awaiting_proof', 'proof_sent', 'revision_requested')").bind(stamp, order.id),
  ]);
  if (changes(results[0]) !== 1) return { error: 'this order already has an approved proof; a new proof cannot be added', status: 409 };
  const proof = await one(db, 'SELECT version FROM proofs WHERE order_id = ? ORDER BY version DESC LIMIT 1', [order.id]);
  return { order: await getOrderById(db, order.id), version: proof.version };
}

// ---------- revisions ----------

export async function requestRevision(db, order, form, meta, now) {
  const comment = multiLine(form.comment, 2000);
  if (comment.length < 3) return { error: 'Please tell us what to change.', status: 400 };
  const bundle = await loadBundle(db, order);
  if (order.status !== 'proof_sent') return { error: 'This proof is no longer open for changes.', status: 409 };
  if (!bundle.proof || String(bundle.proof.version) !== String(form.proof_version)) return { error: 'A newer proof is available. Please reload the page.', status: 409 };
  if (order.revisions_used >= MAX_FREE_REVISIONS) return { error: 'All ' + MAX_FREE_REVISIONS + ' included revisions are used. Please contact us.', status: 409 };
  const stamp = nowIso(now);
  const results = await db.batch([
    db
      .prepare(
        "INSERT INTO revisions (order_id, proof_id, comment, ip, user_agent, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = 'proof_sent' AND revisions_used < ?)"
      )
      .bind(order.id, bundle.proof.id, comment, meta.ip, meta.userAgent, stamp, order.id, MAX_FREE_REVISIONS),
    db
      .prepare("UPDATE orders SET status = 'revision_requested', revisions_used = revisions_used + 1, updated_at = ? WHERE id = ? AND status = 'proof_sent' AND revisions_used < ?")
      .bind(stamp, order.id, MAX_FREE_REVISIONS),
  ]);
  if (changes(results[0]) !== 1) return { error: 'This proof is no longer open for changes.', status: 409 };
  return { ok: true, comment, revisionsUsed: order.revisions_used + 1 };
}

// ---------- approval evidence ----------

// The fields that make up the evidence record, in a fixed order, so record_hash can be recomputed later.
export function evidenceCore(a) {
  return {
    id: a.id,
    order_id: a.order_id,
    token: a.token,
    proof_version: a.proof_version,
    proof_files: typeof a.proof_files_json === 'string' ? parse(a.proof_files_json, []) : a.proof_files,
    proof_hash: a.proof_hash,
    customer_name: a.customer_name,
    customer_email: a.customer_email,
    approved_at: a.approved_at,
    ip: a.ip,
    user_agent: a.user_agent,
    terms_url: a.terms_url,
    terms_version: a.terms_version,
    terms_hash: a.terms_hash,
    consent_text: a.consent_text,
    line_items: typeof a.line_items_json === 'string' ? parse(a.line_items_json, []) : a.line_items,
    subtotal_cents: a.subtotal_cents,
  };
}

export const recordHashOf = (approval) => sha256Hex(JSON.stringify(evidenceCore(approval)));

export async function approveProof(db, order, form, meta, terms, now) {
  const name = oneLine(form.customer_name, 120);
  if (name.length < 2) return { error: 'Please type your full name.', status: 400 };
  if (form.agree !== 'yes') return { error: 'Please tick the box to agree to the Terms and approve the proof.', status: 400 };
  if (order.status !== 'proof_sent') return { error: 'This proof is no longer open for approval.', status: 409, state: order.status };
  const bundle = await loadBundle(db, order);
  if (!bundle.proof || String(bundle.proof.version) !== String(form.proof_version)) return { error: 'A newer proof is available. Please review it before approving.', status: 409 };
  if (form.terms_hash !== terms.hash) return { error: 'Our Terms were updated while this page was open. Please read them again and tick the box.', status: 409 };

  await rememberTerms(db, terms, now);
  const approval = {
    id: newEvidenceId(),
    order_id: order.id,
    token: order.token,
    proof_id: bundle.proof.id,
    proof_version: bundle.proof.version,
    proof_files_json: JSON.stringify(bundle.proof.files),
    proof_hash: bundle.proof.proof_hash,
    customer_name: name,
    customer_email: order.customer_email,
    approved_at: nowIso(now),
    ip: meta.ip,
    user_agent: meta.userAgent,
    terms_url: terms.url,
    terms_version: terms.version,
    terms_hash: terms.hash,
    consent_text: CONSENT_TEXT,
    line_items_json: order.line_items_json,
    subtotal_cents: order.subtotal_cents,
  };
  approval.record_hash = await recordHashOf(approval);
  const results = await db.batch([
    db
      .prepare(
        "INSERT INTO approvals (id, order_id, token, proof_id, proof_version, proof_files_json, proof_hash, customer_name, customer_email, approved_at, ip, user_agent, terms_url, terms_version, terms_hash, consent_text, line_items_json, subtotal_cents, record_hash) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = 'proof_sent') AND ? = (SELECT MAX(version) FROM proofs WHERE order_id = ?)"
      )
      .bind(
        approval.id, approval.order_id, approval.token, approval.proof_id, approval.proof_version, approval.proof_files_json, approval.proof_hash, approval.customer_name, approval.customer_email,
        approval.approved_at, approval.ip, approval.user_agent, approval.terms_url, approval.terms_version, approval.terms_hash, approval.consent_text, approval.line_items_json, approval.subtotal_cents,
        approval.record_hash, order.id, approval.proof_version, order.id
      ),
    db.prepare("UPDATE orders SET status = 'approved', approval_id = ?, updated_at = ? WHERE id = ? AND status = 'proof_sent'").bind(approval.id, approval.approved_at, order.id),
  ]);
  if (changes(results[0]) !== 1) return { error: 'This proof is no longer open for approval.', status: 409 };
  log('proof_approved', { order: order.id, evidence: approval.id });
  return { approval, order: await getOrderById(db, order.id) };
}

// ---------- checkout ----------

const SESSION_REUSE_MARGIN_MS = 5 * 60 * 1000;

function reusableSession(order, nowMs) {
  return order.checkout_url && order.checkout_expires_at && order.checkout_expires_at * 1000 > nowMs + SESSION_REUSE_MARGIN_MS ? order.checkout_url : '';
}

// Returns {url} for the Stripe Checkout page, or {error}. Safe to call again: a live session is reused.
export async function startCheckout(env, db, order, links, now) {
  const nowDate = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
  let current = await getOrderById(db, order.id);
  if (!current || current.status !== 'approved') return { error: 'This order is not waiting for payment.', status: 409 };
  const live = reusableSession(current, nowDate.getTime());
  if (live) return { url: live };
  const approval = await one(db, 'SELECT * FROM approvals WHERE id = ?', [current.approval_id]);
  if (!approval) return { error: 'Approval record is missing.', status: 500 };

  const attempt = current.checkout_attempts;
  const claim = await run(db, "UPDATE orders SET checkout_attempts = checkout_attempts + 1 WHERE id = ? AND checkout_attempts = ? AND status = 'approved'", [current.id, attempt]);
  if (changes(claim) !== 1) {
    current = await getOrderById(db, order.id);
    const url = current && reusableSession(current, nowDate.getTime());
    return url ? { url } : { error: 'Payment page is being prepared. Please try again in a moment.', status: 409 };
  }
  try {
    const session = await createCheckoutSession(env, {
      order: current,
      approval: approval,
      items: parse(current.line_items_json, []),
      successUrl: links.order + '?paid=1',
      cancelUrl: links.order,
      idempotencyKey: 'gss-' + current.id + '-' + (attempt + 1),
      now: nowDate,
    });
    await run(db, 'UPDATE orders SET checkout_session_id = ?, checkout_url = ?, checkout_expires_at = ?, updated_at = ? WHERE id = ?', [session.id, session.url, session.expires_at || null, nowIso(nowDate), current.id]);
    log('checkout_created', { order: current.id, session: session.id });
    return { url: session.url };
  } catch (err) {
    log('checkout_failed', { order: current.id, error: err.message, detail: err.detail || null });
    return { error: 'We could not open the payment page. Please try again, or contact us.', status: 502 };
  }
}

// ---------- payment ----------

// Called for checkout.session.completed (paid). Returns {changed} true only the first time.
export async function markPaid(db, session, now) {
  const orderId = (session.metadata && session.metadata.order_id) || session.client_reference_id || '';
  const order = await getOrderById(db, orderId);
  if (!order) return { order: null };
  const shipping = (session.collected_information && session.collected_information.shipping_details) || session.shipping_details || null;
  const details = session.customer_details || null;
  const shippingJson = JSON.stringify({ shipping: shipping, customer: details ? { name: details.name, email: details.email, phone: details.phone, address: details.address } : null });
  const pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent && session.payment_intent.id ? session.payment_intent.id : null;
  const tax = session.total_details && Number.isInteger(session.total_details.amount_tax) ? session.total_details.amount_tax : null;
  const res = await run(
    db,
    "UPDATE orders SET status = 'paid', paid_at = ?, payment_intent_id = ?, checkout_session_id = COALESCE(?, checkout_session_id), amount_total_cents = ?, amount_tax_cents = ?, shipping_json = ?, updated_at = ? WHERE id = ? AND status = 'approved'",
    [nowIso(now), pi, session.id || null, Number.isInteger(session.amount_total) ? session.amount_total : null, tax, shippingJson, nowIso(now), order.id]
  );
  const fresh = await getOrderById(db, order.id);
  if (changes(res) !== 1) log('payment_ignored', { order: order.id, status: order.status });
  else if (Number.isInteger(session.amount_subtotal) && session.amount_subtotal !== order.subtotal_cents) log('payment_subtotal_mismatch', { order: order.id, expected: order.subtotal_cents, got: session.amount_subtotal });
  return { order: fresh, changed: changes(res) === 1 };
}

// ---------- shipping ----------

export function trackingUrlFor(carrier, number, given) {
  if (given) return given;
  const n = encodeURIComponent(number);
  const c = carrier.toLowerCase();
  if (c.includes('ups')) return 'https://www.ups.com/track?tracknum=' + n;
  if (c.includes('usps') || c.includes('postal')) return 'https://tools.usps.com/go/TrackConfirmAction?tLabels=' + n;
  if (c.includes('fedex')) return 'https://www.fedex.com/fedextrack/?trknbr=' + n;
  if (c.includes('dhl')) return 'https://www.dhl.com/us-en/home/tracking.html?tracking-id=' + n;
  return '';
}

export async function addShipment(db, order, body, now) {
  const carrier = oneLine(body.carrier, 60);
  const number = oneLine(body.tracking_number, 80).replace(/\s+/g, '');
  if (!carrier) return { error: 'carrier is required', status: 400 };
  if (!/^[A-Za-z0-9-]{6,60}$/.test(number)) return { error: 'tracking_number must be 6-60 letters, digits or dashes', status: 400 };
  if (body.tracking_url && !isHttpsUrl(body.tracking_url)) return { error: 'tracking_url must be an https link', status: 400 };
  if (order.status !== 'paid' && order.status !== 'shipped') return { error: 'order is ' + order.status + '; tracking can be added once it is paid', status: 409 };
  const stamp = nowIso(now);
  const url = trackingUrlFor(carrier, number, body.tracking_url ? String(body.tracking_url).trim() : '');
  await db.batch([
    db.prepare('INSERT INTO shipments (order_id, carrier, tracking_number, tracking_url, created_at) VALUES (?, ?, ?, ?, ?)').bind(order.id, carrier, number, url, stamp),
    db.prepare("UPDATE orders SET status = 'shipped', updated_at = ? WHERE id = ? AND status IN ('paid', 'shipped')").bind(stamp, order.id),
  ]);
  return { shipment: { carrier, tracking_number: number, tracking_url: url, created_at: stamp }, order: await getOrderById(db, order.id) };
}

// ---------- disputes ----------

export async function recordDispute(env, db, dispute, eventId, now) {
  let order = dispute.payment_intent ? await one(db, 'SELECT * FROM orders WHERE payment_intent_id = ?', [dispute.payment_intent]) : null;
  if (!order && dispute.charge && env.STRIPE_SECRET_KEY) {
    try {
      const charge = await getCharge(env, dispute.charge);
      const id = charge && charge.metadata && charge.metadata.order_id;
      if (id) order = await getOrderById(db, id);
    } catch (err) {
      log('dispute_charge_lookup_failed', { dispute: dispute.id, error: err.message });
    }
  }
  const due = dispute.evidence_details && dispute.evidence_details.due_by ? new Date(dispute.evidence_details.due_by * 1000).toISOString() : '';
  const res = await run(
    db,
    'INSERT OR IGNORE INTO disputes (id, order_id, approval_id, charge_id, payment_intent_id, amount_cents, currency, reason, status, evidence_due_by, event_id, raw_json, logged_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [dispute.id, order ? order.id : null, order ? order.approval_id : null, dispute.charge || null, dispute.payment_intent || null, Number.isInteger(dispute.amount) ? dispute.amount : null, dispute.currency || null, dispute.reason || null, dispute.status || null, due, eventId || null, JSON.stringify(dispute), nowIso(now)]
  );
  const approval = order && order.approval_id ? await one(db, 'SELECT * FROM approvals WHERE id = ?', [order.approval_id]) : null;
  log('dispute_created', {
    dispute: dispute.id,
    order: order ? order.id : null,
    reason: dispute.reason,
    amount: dispute.amount,
    evidence_due_by: due,
    evidence: approval ? evidenceCore(approval) : null,
  });
  return { order, approval, due, isNew: changes(res) === 1 };
}

// Plain-text packet that can be pasted into Stripe's dispute evidence form.
export function evidencePacket(bundle, disputeRows) {
  const { order, items, approval, shipments } = bundle;
  const lines = ['Order ' + order.id + ' (customer ' + order.customer_email + ')', 'Placed ' + order.created_at + ', paid ' + (order.paid_at || 'not yet'), ''];
  if (approval) {
    const ev = evidenceCore(approval);
    lines.push(
      'PROOF APPROVAL (evidence record ' + ev.id + ')',
      'Customer typed name: ' + ev.customer_name,
      'Customer email: ' + ev.customer_email,
      'Approved at (UTC): ' + ev.approved_at,
      'IP address: ' + ev.ip,
      'User agent: ' + ev.user_agent,
      'Proof version: ' + ev.proof_version + ', SHA-256 ' + ev.proof_hash,
      ...ev.proof_files.map((f) => '  Proof file: ' + f.url + ' (sha256 ' + f.sha256 + ')'),
      'Terms shown: ' + ev.terms_url + ', version "' + ev.terms_version + '", SHA-256 ' + ev.terms_hash,
      'Agreement text the customer ticked: "' + ev.consent_text + '"',
      'Record hash: ' + approval.record_hash,
      ''
    );
  } else lines.push('No approval record exists for this order.', '');
  lines.push('ITEMS', ...items.map((it) => '  ' + it.name + ' x ' + it.quantity + ' @ ' + money(it.unit_amount_cents)), '  Subtotal before tax: ' + money(order.subtotal_cents));
  if (order.amount_total_cents != null) lines.push('  Charged total incl. tax and shipping: ' + money(order.amount_total_cents));
  if (shipments.length) lines.push('', 'SHIPPING', ...shipments.map((s) => '  ' + s.created_at + ' ' + s.carrier + ' ' + s.tracking_number + (s.tracking_url ? ' ' + s.tracking_url : '')));
  if (disputeRows && disputeRows.length) lines.push('', 'DISPUTES', ...disputeRows.map((d) => '  ' + d.id + ' ' + d.reason + ' ' + d.status + ' evidence due ' + d.evidence_due_by));
  return lines.join('\n');
}

