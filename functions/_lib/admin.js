// Admin endpoints: a single bearer token (ADMIN_TOKEN) and JSON bodies.

import { json, safeEqual } from './util.js';

const MIN_TOKEN_LENGTH = 16;
const MAX_BODY = 65536;

// Returns null when the caller is allowed, otherwise the Response to send. Fails closed when no usable
// ADMIN_TOKEN is configured.
export async function adminGuard(request, env) {
  const configured = env && env.ADMIN_TOKEN;
  if (typeof configured !== 'string' || configured.length < MIN_TOKEN_LENGTH) return json({ ok: false, error: 'admin is not configured' }, 503);
  const header = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m || !(await safeEqual(m[1].trim(), configured))) return json({ ok: false, error: 'unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer' });
  return null;
}

export async function readJsonBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) return { error: 'body too large' };
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'body must be a JSON object' };
    return { body };
  } catch (_) {
    return { error: 'body must be valid JSON' };
  }
}

export function guarded(handler) {
  return async (context) => {
    try {
      const denied = await adminGuard(context.request, context.env);
      if (denied) return denied;
      return await handler(context.request, context.env, context.now instanceof Date ? context.now : new Date(), context);
    } catch (err) {
      console.error('admin handler failed: ' + err.message);
      return json({ ok: false, error: 'server error' }, 500);
    }
  };
}
