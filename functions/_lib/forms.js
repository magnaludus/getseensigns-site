// Small helpers shared by the public form endpoints added Oct 30, 2026 (email signup, reorder request).
// Same rules as functions/api/quote-request.js: an in-memory per-IP limit (per isolate, best effort), a honeypot
// field named _gotcha, a 3 second minimum fill time, and an optional "attempt" id that makes retries idempotent.

const REF_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ATTEMPT_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const MIN_ELAPSED_MS = 3000;
export const MAX_BODY = 64 * 1024;

export const field = (form, name) => {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
};

export function randomRef(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return prefix + '-' + Array.from(bytes, (b) => REF_CHARS[b & 31]).join('');
}

export async function refFor(prefix, salt, attempt) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + attempt)));
  return prefix + '-' + Array.from(digest.slice(0, 8), (b) => REF_CHARS[b & 31]).join('');
}

// true when the request is a bot: the honeypot is filled in, or the form was sent faster than a person could.
export function isBot(form) {
  const trap = form.get('_gotcha');
  if (trap && (typeof trap !== 'string' || trap.trim())) return true;
  const raw = field(form, 'elapsedMs');
  const elapsed = Number(raw);
  return raw !== '' && Number.isFinite(elapsed) && elapsed < MIN_ELAPSED_MS;
}

export function makeLimiter(max, windowMs) {
  const hits = new Map();
  return {
    reset() {
      hits.clear();
    },
    refund(ip) {
      const list = ip && hits.get(ip);
      if (list && list.length) list.pop();
    },
    limited(ip, ms) {
      if (!ip) return false;
      const recent = (hits.get(ip) || []).filter((t) => t > ms - windowMs);
      if (recent.length >= max) {
        hits.set(ip, recent);
        return true;
      }
      recent.push(ms);
      hits.set(ip, recent);
      if (hits.size > 5000) {
        for (const [key, times] of hits) if (!times.some((t) => t > ms - windowMs)) hits.delete(key);
      }
      return false;
    },
  };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
