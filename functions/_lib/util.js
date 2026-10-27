// Small helpers shared by the order Pages Functions: ids, hashing, escaping, responses.

export const SITE = 'https://getseensignsco.com';
export const SHOP_EMAIL = 'sales@getseensignsco.com';
export const SHOP_PHONE = '(334) 232-9003';
export const SHOP_PHONE_TEL = '+13342329003';

const ID_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function randomId(prefix, length) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return prefix + Array.from(bytes, (b) => ID_CHARS[b & 31]).join('');
}

export const newOrderId = () => randomId('GS-', 8);
export const newEvidenceId = () => randomId('EV-', 12);

// 256 random bits, base64url: the capability in /proof/<token> and /order/<token>.
export function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export async function sha256Hex(input) {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Compares two strings without leaking where they differ: both are hashed to a fixed length first.
export async function safeEqual(a, b) {
  const [x, y] = await Promise.all([sha256Hex(String(a)), sha256Hex(String(b))]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function oneLine(value, max) {
  const text = typeof value === 'string' ? value : '';
  return text.replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, max || 500).trimEnd();
}

export function multiLine(value, max) {
  const text = typeof value === 'string' ? value : '';
  return text.replace(/\r\n?/g, '\n').replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max || 4000).trimEnd();
}

export function validEmail(value) {
  return (
    typeof value === 'string' &&
    value.length <= 200 &&
    /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(value)
  );
}

export function money(cents) {
  const n = Number(cents) || 0;
  return (n < 0 ? '-$' : '$') + (Math.abs(n) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function isHttpsUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password;
  } catch (_) {
    return false;
  }
}

export function nowIso(now) {
  const d = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
  return d.toISOString();
}

export function clientIp(request) {
  return (request.headers.get('CF-Connecting-IP') || '').slice(0, 64);
}

export function userAgent(request) {
  return oneLine(request.headers.get('User-Agent') || '', 400);
}

const PRIVATE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

export function json(body, status, headers) {
  return Response.json(body, { status: status || 200, headers: Object.assign({}, PRIVATE_HEADERS, headers) });
}

export function html(body, status, headers) {
  return new Response(body, {
    status: status || 200,
    headers: Object.assign(
      {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; form-action 'self' https://checkout.stripe.com; frame-ancestors 'none'; base-uri 'none'",
      },
      PRIVATE_HEADERS,
      headers
    ),
  });
}

export function redirect(location, status) {
  return new Response(null, { status: status || 303, headers: Object.assign({ Location: location }, PRIVATE_HEADERS) });
}

// Browsers send Origin on form posts. A post from another site is refused; no Origin (curl, tests) is allowed
// because the token in the URL is already the secret.
export function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin || origin === 'null') return !origin;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch (_) {
    return false;
  }
}

export function baseUrl(request, env) {
  if (env && typeof env.SITE_URL === 'string' && /^https:\/\/[^/]+$/.test(env.SITE_URL)) return env.SITE_URL;
  const u = new URL(request.url);
  if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname.endsWith('.pages.dev')) return u.origin;
  return SITE;
}

export function log(event, fields) {
  console.log(JSON.stringify(Object.assign({ event: event }, fields)));
}
