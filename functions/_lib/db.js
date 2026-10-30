// D1 schema for orders, proofs, approval evidence, payments, disputes and tracking.
// The tables are created on first use (CREATE TABLE IF NOT EXISTS), so binding a D1 database named DB is the
// only setup step. The same statements live in migrations/0001_orders.sql for people who prefer wrangler.
//
// Every statement is one line: D1's exec() runs line by line, and triggers must not be split.

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, customer_email TEXT NOT NULL, customer_name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, line_items_json TEXT NOT NULL, subtotal_cents INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'usd', notes TEXT NOT NULL DEFAULT '', revisions_used INTEGER NOT NULL DEFAULT 0, approval_id TEXT, checkout_attempts INTEGER NOT NULL DEFAULT 0, checkout_session_id TEXT, checkout_url TEXT, checkout_expires_at INTEGER, payment_intent_id TEXT, paid_at TEXT, amount_total_cents INTEGER, amount_tax_cents INTEGER, shipping_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS orders_payment_intent ON orders (payment_intent_id)`,
  `CREATE INDEX IF NOT EXISTS orders_session ON orders (checkout_session_id)`,
  `CREATE TABLE IF NOT EXISTS proofs (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, version INTEGER NOT NULL, files_json TEXT NOT NULL, proof_hash TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, UNIQUE (order_id, version))`,
  `CREATE TABLE IF NOT EXISTS revisions (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, proof_id INTEGER NOT NULL, comment TEXT NOT NULL, ip TEXT NOT NULL DEFAULT '', user_agent TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS terms_versions (hash TEXT PRIMARY KEY, version_label TEXT NOT NULL, text TEXT NOT NULL, first_seen_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE, token TEXT NOT NULL, proof_id INTEGER NOT NULL, proof_version INTEGER NOT NULL, proof_files_json TEXT NOT NULL, proof_hash TEXT NOT NULL, customer_name TEXT NOT NULL, customer_email TEXT NOT NULL, approved_at TEXT NOT NULL, ip TEXT NOT NULL, user_agent TEXT NOT NULL, terms_url TEXT NOT NULL, terms_version TEXT NOT NULL, terms_hash TEXT NOT NULL, consent_text TEXT NOT NULL, line_items_json TEXT NOT NULL, subtotal_cents INTEGER NOT NULL, record_hash TEXT NOT NULL)`,
  `CREATE TRIGGER IF NOT EXISTS approvals_no_update BEFORE UPDATE ON approvals BEGIN SELECT RAISE(ABORT, 'approval evidence is immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS approvals_no_delete BEFORE DELETE ON approvals BEGIN SELECT RAISE(ABORT, 'approval evidence is immutable'); END`,
  `CREATE TABLE IF NOT EXISTS shipments (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, carrier TEXT NOT NULL, tracking_number TEXT NOT NULL, tracking_url TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS emails (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, kind TEXT NOT NULL, to_email TEXT NOT NULL, status TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', message_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS disputes (id TEXT PRIMARY KEY, order_id TEXT, approval_id TEXT, charge_id TEXT, payment_intent_id TEXT, amount_cents INTEGER, currency TEXT, reason TEXT, status TEXT, evidence_due_by TEXT, event_id TEXT, raw_json TEXT NOT NULL, logged_at TEXT NOT NULL)`,
];

// Design proof requests from the online designer (POST /api/design-proof). Large files are not kept in rows:
// request and design JSON sit in design_proof_requests (design is capped at 200 KB by the endpoint), and only
// files that did not fit in the email are saved, in base64 chunks of 256 KB, 10 MB at most per request.
export const DESIGN_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS design_proof_requests (ref TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL, mode TEXT NOT NULL, customer_name TEXT NOT NULL, customer_email TEXT NOT NULL, request_json TEXT NOT NULL, design_json TEXT, files_json TEXT NOT NULL, shop_email TEXT NOT NULL DEFAULT 'pending', customer_email_status TEXT NOT NULL DEFAULT 'pending', email_error TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS design_proof_requests_created ON design_proof_requests (created_at)`,
  `CREATE TABLE IF NOT EXISTS design_proof_files (ref TEXT NOT NULL, name TEXT NOT NULL, seq INTEGER NOT NULL, type TEXT NOT NULL, bytes INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (ref, name, seq))`,
];

// Quote requests from the home page form (POST /api/quote-request). No IP, cookie or user agent is kept.
export const QUOTE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS quote_requests (ref TEXT PRIMARY KEY, created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', customer_name TEXT NOT NULL, customer_email TEXT NOT NULL, product TEXT NOT NULL, quantity TEXT NOT NULL DEFAULT '', size TEXT NOT NULL DEFAULT '', needed_by TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '', shop_email TEXT NOT NULL DEFAULT 'pending', customer_email_status TEXT NOT NULL DEFAULT 'pending', email_error TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS quote_requests_created ON quote_requests (created_at)`,
];

// Email list signups from the site footer (POST /api/email-signup). One row per email address (stored lowercased).
// brevo_status: 'synced', 'failed' or 'not_configured' (BREVO_SIGNUP_LIST_ID unset). welcome_status: the welcome email.
// promo_code: the code that went out in the welcome email, '' when SIGNUP_PROMO_CODE was not set yet.
export const SIGNUP_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS email_signups (email TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'subscribed', source TEXT NOT NULL DEFAULT '', brevo_status TEXT NOT NULL DEFAULT 'pending', welcome_status TEXT NOT NULL DEFAULT 'pending', promo_code TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS email_signups_created ON email_signups (created_at)`,
];

// Reorder requests from /reorder/ (POST /api/reorder-request), reference RO-XXXXXXXX.
export const REORDER_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS reorder_requests (ref TEXT PRIMARY KEY, created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', org_name TEXT NOT NULL, customer_name TEXT NOT NULL DEFAULT '', customer_email TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', previous_order TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', shop_email TEXT NOT NULL DEFAULT 'pending', customer_email_status TEXT NOT NULL DEFAULT 'pending', email_error TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS reorder_requests_created ON reorder_requests (created_at)`,
];

let ready = new WeakSet();

export function resetSchemaCache() {
  ready = new WeakSet();
}

export async function getDb(env) {
  const db = env && env.DB;
  if (!db) throw new Error('D1 binding DB is missing');
  if (!ready.has(db)) {
    for (const sql of SCHEMA.concat(DESIGN_SCHEMA, QUOTE_SCHEMA, SIGNUP_SCHEMA, REORDER_SCHEMA)) {
      try {
        await db.prepare(sql).run();
      } catch (err) {
        if (/TRIGGER/.test(sql)) console.error('trigger not created: ' + err.message);
        else throw err;
      }
    }
    ready.add(db);
  }
  return db;
}

export async function one(db, sql, params) {
  return (await db.prepare(sql).bind(...(params || [])).first()) || null;
}

export async function all(db, sql, params) {
  const res = await db.prepare(sql).bind(...(params || [])).all();
  return res.results || [];
}

export async function run(db, sql, params) {
  return db.prepare(sql).bind(...(params || [])).run();
}

export const changes = (res) => (res && res.meta && typeof res.meta.changes === 'number' ? res.meta.changes : 0);
