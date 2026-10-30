// Fakes for orders.test.mjs: a D1 database on node:sqlite, a fetch that plays Stripe, Brevo and the proof
// image host, an ASSETS binding that serves the real terms.html, and builders for requests.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { signWebhook } from '../../../functions/_lib/stripe.js';
import { resetSchemaCache } from '../../../functions/_lib/db.js';

const root = new URL('../../../', import.meta.url);

export const NOW = new Date('2026-10-27T18:30:00.000Z');
export const IP = '203.0.113.9';
export const UA = 'Mozilla/5.0 (Test Browser)';
export const ADMIN = 'test-admin-token-0123456789';
export const WEBHOOK_SECRET = 'whsec_test_secret_for_unit_tests';
export const BASE = 'https://getseensignsco.com';

class FakeStatement {
  constructor(sqlite, sql, params) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.params = params || [];
  }
  bind(...params) {
    return new FakeStatement(this.sqlite, this.sql, params.map((p) => (p === undefined ? null : p)));
  }
  _exec(kind) {
    const stmt = this.sqlite.prepare(this.sql);
    if (kind === 'all') return stmt.all(...this.params);
    if (kind === 'get') return stmt.get(...this.params);
    return stmt.run(...this.params);
  }
  async run() {
    const r = this._exec('run');
    return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  async first() {
    const row = this._exec('get');
    return row ? Object.assign({}, row) : null;
  }
  async all() {
    return { results: this._exec('all').map((r) => Object.assign({}, r)), meta: {} };
  }
}

export function fakeD1() {
  const sqlite = new DatabaseSync(':memory:');
  return {
    sqlite,
    prepare: (sql) => new FakeStatement(sqlite, sql),
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        sqlite.exec('COMMIT');
        return out;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

export function fakeAssets() {
  return {
    async fetch(url) {
      const path = new URL(url).pathname;
      if (path === '/terms') return new Response(readFileSync(new URL('terms.html', root)), { headers: { 'Content-Type': 'text/html' } });
      return new Response('not found', { status: 404 });
    },
  };
}

export function makeEnv(overrides) {
  resetSchemaCache();
  return Object.assign(
    {
      DB: fakeD1(),
      ASSETS: fakeAssets(),
      ADMIN_TOKEN: ADMIN,
      STRIPE_SECRET_KEY: 'sk_test_unit_test_placeholder',
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      BREVO_API_KEY: 'brevo-unit-test-placeholder',
    },
    overrides
  );
}

// 1x1 transparent PNG.
export const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
export const PROOF_URL = 'https://proofs.example.com/gs/proof-1.png';
export const PROOF_URL_2 = 'https://proofs.example.com/gs/proof-2.png';

export function installFetch(opts) {
  const real = globalThis.fetch;
  const state = {
    stripe: [],
    brevo: [],
    contacts: [],
    contactsFail: false,
    stripeFail: false,
    brevoFail: false,
    sessions: 0,
    charges: {},
    images: { [PROOF_URL]: { type: 'image/png', bytes: PNG }, [PROOF_URL_2]: { type: 'image/png', bytes: Uint8Array.from([...PNG, 1, 2, 3]) } },
  };
  Object.assign(state, opts);
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const method = (init && init.method) || 'GET';
    if (u === 'https://api.stripe.com/v1/checkout/sessions' && method === 'POST') {
      const params = new URLSearchParams(init.body);
      state.stripe.push({ params, headers: init.headers, url: u });
      if (state.stripeFail) return Response.json({ error: { type: 'invalid_request_error', message: 'boom' } }, { status: 400 });
      state.sessions += 1;
      const id = 'cs_test_' + state.sessions;
      return Response.json({ id, url: 'https://checkout.stripe.com/c/pay/' + id, expires_at: Number(params.get('expires_at')) });
    }
    if (u.startsWith('https://api.stripe.com/v1/charges/')) {
      const id = decodeURIComponent(u.split('/').pop());
      return state.charges[id] ? Response.json(state.charges[id]) : Response.json({ error: { message: 'no such charge' } }, { status: 404 });
    }
    if (u === 'https://api.brevo.com/v3/smtp/email' && method === 'POST') {
      const body = JSON.parse(init.body);
      state.brevo.push({ body, headers: init.headers });
      if (state.brevoFail) return Response.json({ message: 'unauthorized' }, { status: 401 });
      return Response.json({ messageId: '<m' + state.brevo.length + '@brevo>' }, { status: 201 });
    }
    if (u === 'https://api.brevo.com/v3/contacts' && method === 'POST') {
      state.contacts.push({ body: JSON.parse(init.body), headers: init.headers });
      if (state.contactsFail) return Response.json({ message: 'bad list' }, { status: 400 });
      return Response.json({ id: state.contacts.length }, { status: 201 });
    }
    if (state.images[u]) {
      const img = state.images[u];
      return new Response(img.bytes, { headers: { 'Content-Type': img.type } });
    }
    return new Response('not found', { status: 404 });
  };
  state.restore = () => {
    globalThis.fetch = real;
  };
  return state;
}

export const adminReq = (method, path, body, token) =>
  new Request(BASE + path, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token === null ? {} : { Authorization: 'Bearer ' + (token || ADMIN) }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const formReq = (path, fields, headers) =>
  new Request(BASE + path, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': IP, 'User-Agent': UA }, headers),
    body: new URLSearchParams(fields).toString(),
  });

export async function webhookReq(event, opts) {
  const raw = JSON.stringify(event);
  const ts = (opts && opts.timestamp) || Math.floor(NOW.getTime() / 1000);
  const sig = opts && opts.signature ? opts.signature : await signWebhook(raw, (opts && opts.secret) || WEBHOOK_SECRET, ts);
  return new Request(BASE + '/api/stripe-webhook', { method: 'POST', headers: { 'Stripe-Signature': sig, 'Content-Type': 'application/json' }, body: raw });
}

export const textOf = async (res) => await res.text();
