// "Approve your proof" links for custom orders that are invoiced by hand: the customer approves the proof and gives
// a complete ship-to in one step, so no invoice goes out without a delivery address. Separate from the Stripe
// order flow in orders.js (that one collects shipping in Stripe Checkout).
//
// Record: proof_approvals, reference PA-XXXXXXXX, 256-bit token in /approve/<token>/.
// Status: sent -> changes_requested (notes saved, not approved) -> approved. approved is final.

import { all, one, run, changes } from './db.js';
import { randomId, newToken, TOKEN_RE, nowIso, oneLine, multiLine, validEmail, isHttpsUrl } from './util.js';

export const APPROVAL_REF_RE = /^PA-[0-9A-HJKMNP-TV-Z]{8}$/;
export const APPROVE_TEXT = 'I approve this proof as shown';
export const STATUSES = ['sent', 'changes_requested', 'approved'];

// 50 states plus DC, as the two-letter codes the post office uses.
export const US_STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

const STATE_BY_NAME = Object.fromEntries(Object.entries(US_STATES).map(([code, name]) => [name.toLowerCase(), code]));

// Returns the two-letter code for a state code or full name, or '' when it is not a US state.
export function normalizeState(value) {
  const v = oneLine(value, 40).replace(/\./g, '');
  if (!v) return '';
  const upper = v.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(US_STATES, upper)) return upper;
  return STATE_BY_NAME[v.toLowerCase()] || '';
}

// 12345 or 12345-6789 (also accepts 123456789 and 12345 6789). Returns '' when invalid.
export function normalizeZip(value) {
  const m = /^(\d{5})(?:[-\s]?(\d{4}))?$/.exec(oneLine(value, 20));
  return m ? m[1] + (m[2] ? '-' + m[2] : '') : '';
}

// A 10 digit US phone number (a leading 1 is dropped). Area codes never start with 0 or 1. Returns (555) 555-0100
// style, or '' when invalid.
export function normalizePhone(value) {
  let digits = oneLine(value, 40).replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
  if (digits.length !== 10 || /^[01]/.test(digits)) return '';
  return '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6);
}

// The ship-to fields in the order the form shows them. label is used in error messages.
export const SHIP_FIELDS = [
  { name: 'ship_name', label: 'Delivery name', required: true, max: 120 },
  { name: 'ship_company', label: 'Company', required: false, max: 120 },
  { name: 'ship_street1', label: 'Street address', required: true, max: 200 },
  { name: 'ship_street2', label: 'Apt, suite or unit', required: false, max: 200 },
  { name: 'ship_city', label: 'City', required: true, max: 100 },
  { name: 'ship_state', label: 'State', required: true, max: 40 },
  { name: 'ship_zip', label: 'ZIP code', required: true, max: 20 },
  { name: 'ship_phone', label: 'Phone', required: true, max: 40 },
  { name: 'ship_email', label: 'Email', required: true, max: 200 },
];

// Checks the ship-to on the server. Returns {shipTo} or {errors: {field: message}}.
export function validateShipTo(form) {
  const shipTo = {};
  const errors = {};
  for (const f of SHIP_FIELDS) {
    const value = oneLine(form[f.name], f.max);
    if (!value) {
      if (f.required) errors[f.name] = f.label + ' is required.';
      shipTo[f.name] = '';
      continue;
    }
    shipTo[f.name] = value;
  }
  if (shipTo.ship_state) {
    const code = normalizeState(shipTo.ship_state);
    if (code) shipTo.ship_state = code;
    else errors.ship_state = 'Pick a US state.';
  }
  if (shipTo.ship_zip) {
    const zip = normalizeZip(shipTo.ship_zip);
    if (zip) shipTo.ship_zip = zip;
    else errors.ship_zip = 'Enter a 5 or 9 digit ZIP code.';
  }
  if (shipTo.ship_phone) {
    const phone = normalizePhone(shipTo.ship_phone);
    if (phone) shipTo.ship_phone = phone;
    else errors.ship_phone = 'Enter a 10 digit phone number.';
  }
  if (shipTo.ship_email && !validEmail(shipTo.ship_email)) errors.ship_email = 'Enter a valid email address.';
  return Object.keys(errors).length ? { errors } : { shipTo };
}

export function shipToLines(r) {
  return [
    r.ship_name,
    r.ship_company,
    r.ship_street1,
    r.ship_street2,
    [r.ship_city, [r.ship_state, r.ship_zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
  ].filter(Boolean);
}

export const isPdf = (url) => {
  try {
    return /\.pdf$/i.test(new URL(url).pathname);
  } catch (_) {
    return false;
  }
};

// ---------- records ----------

export async function getApprovalByToken(db, token) {
  if (!TOKEN_RE.test(token || '')) return null;
  return one(db, 'SELECT * FROM proof_approvals WHERE token = ?', [token]);
}

export async function getApprovalByRef(db, ref) {
  if (!APPROVAL_REF_RE.test(ref || '')) return null;
  return one(db, 'SELECT * FROM proof_approvals WHERE ref = ?', [ref]);
}

export const approveUrlFor = (base, record) => base + '/approve/' + record.token + '/';

// Admin create. body: customer_name, order_description, proof_url (https image or PDF), customer_email optional
// (prefills the email field).
export async function createApproval(db, body, now) {
  const customer = oneLine(body.customer_name, 120);
  if (!customer) return { error: 'customer_name is required' };
  const description = multiLine(body.order_description, 2000);
  if (!description) return { error: 'order_description is required' };
  const proofUrl = typeof body.proof_url === 'string' ? body.proof_url.trim() : '';
  if (!proofUrl || proofUrl.length > 1000 || !isHttpsUrl(proofUrl)) return { error: 'proof_url must be an https link to the proof image or PDF' };
  const email = typeof body.customer_email === 'string' ? body.customer_email.trim() : '';
  if (email && !validEmail(email)) return { error: 'customer_email is not a valid email address' };

  const at = nowIso(now);
  for (let tries = 0; tries < 3; tries++) {
    const record = { ref: randomId('PA-', 8), token: newToken() };
    try {
      await run(
        db,
        "INSERT INTO proof_approvals (ref, token, customer_name, customer_email, order_description, proof_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'sent', ?, ?)",
        [record.ref, record.token, customer, email, description, proofUrl, at, at]
      );
      return { record: await getApprovalByRef(db, record.ref) };
    } catch (err) {
      if (!/UNIQUE/i.test(err.message)) throw err;
    }
  }
  throw new Error('could not create a unique approval reference');
}

const OPEN = "status IN ('sent', 'changes_requested')";

// "Request changes": saves the notes, does not approve. Only while the proof is still open.
export async function requestChanges(db, record, form, meta, now) {
  if (record.status === 'approved') return { error: 'This proof is already approved.', status: 409 };
  const notes = multiLine(form.notes, 4000);
  if (!notes) return { error: 'Tell us what to change in the notes box, then press Request changes.', status: 400, fields: { notes: 'Tell us what to change.' } };
  const at = nowIso(now);
  const res = await run(
    db,
    "UPDATE proof_approvals SET status = 'changes_requested', notes = ?, changes_requested_at = ?, ip = ?, user_agent = ?, updated_at = ? WHERE token = ? AND " + OPEN,
    [notes, at, meta.ip, meta.userAgent, at, record.token]
  );
  if (!changes(res)) return { error: 'This proof is already approved.', status: 409 };
  return { record: await getApprovalByToken(db, record.token) };
}

// Approve: needs the checkbox and a complete, valid ship-to. Saves the ship-to, approval time, IP and user agent.
export async function approve(db, record, form, meta, now) {
  if (record.status === 'approved') return { error: 'This proof is already approved.', status: 409 };
  const checked = validateShipTo(form);
  const fields = Object.assign({}, checked.errors);
  if (form.approve !== 'yes') fields.approve = 'Tick the box to approve the proof.';
  if (Object.keys(fields).length) return { error: 'Please fix the highlighted fields.', status: 400, fields };
  const s = checked.shipTo;
  const notes = multiLine(form.notes, 4000);
  const at = nowIso(now);
  const res = await run(
    db,
    "UPDATE proof_approvals SET status = 'approved', ship_name = ?, ship_company = ?, ship_street1 = ?, ship_street2 = ?, ship_city = ?, ship_state = ?, ship_zip = ?, ship_phone = ?, ship_email = ?, notes = CASE WHEN ? = '' THEN notes ELSE ? END, approve_text = ?, approved_at = ?, ip = ?, user_agent = ?, updated_at = ? WHERE token = ? AND " + OPEN,
    [s.ship_name, s.ship_company, s.ship_street1, s.ship_street2, s.ship_city, s.ship_state, s.ship_zip, s.ship_phone, s.ship_email, notes, notes, APPROVE_TEXT, at, meta.ip, meta.userAgent, at, record.token]
  );
  if (!changes(res)) return { error: 'This proof is already approved.', status: 409 };
  return { record: await getApprovalByToken(db, record.token) };
}

export async function setShopEmail(db, token, status, error, now) {
  await run(db, 'UPDATE proof_approvals SET shop_email = ?, email_error = ?, updated_at = ? WHERE token = ?', [status, String(error || '').slice(0, 300), nowIso(now), token]);
}

export async function listApprovals(db, status) {
  const where = STATUSES.includes(status) ? ' WHERE status = ?' : '';
  return all(
    db,
    'SELECT ref, status, customer_name, customer_email, order_description, proof_url, ship_name, ship_city, ship_state, approved_at, changes_requested_at, shop_email, created_at, updated_at FROM proof_approvals' + where + ' ORDER BY created_at DESC LIMIT 100',
    where ? [status] : []
  );
}
