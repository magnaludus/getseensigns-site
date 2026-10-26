// Cloudflare Pages Function: POST /api/design-event
//
// Anonymous usage events from the designer (sendBeacon). Off unless DESIGN_EVENTS_ENABLED is exactly
// "true"; while it is off this returns 503 and the page sends nothing. The site deploys without it.
//
// Turn on:
// 1. Use the same private R2 bucket as design-proof, bound as PROOFS (see design-proof.js).
// 2. Pages → Settings → Environment variables: DESIGN_EVENTS_ENABLED = true. Redeploy.
//    Optional: an R2 lifecycle rule that expires the events/ prefix after 90 days.
//
// Body (text/plain or application/json, 8 KB and 50 events max):
//   {"events":[{"name","t","sid","vp","product","phase","d":{...}}]}
// Only those keys are kept. The IP, user agent, cookies, other headers and the URL are never read.
// One object per batch: events/YYYY-MM-DD/<12 hex>.json = {"day","events":[...]}
// Answers 204; 400 bad input; 413 too large; 500 storage; 503 off.
// Read the numbers with: python3 src/tools/design_events_report.py <folder of exported events/*.json>

import catalog from '../../assets/design/catalog.json' with { type: 'json' };

const NAMES = new Set([
  'design_view', 'design_start', 'product_select', 'option_change', 'template_apply', 'text_edit',
  'logo_upload', 'autobrand_apply', 'piece_add', 'view_3d_open', 'view_3d_fallback', 'scene_change',
  'undo', 'share_create', 'share_open', 'reorder_open', 'dpi_warning', 'readability_warning',
  'proof_review_open', 'proof_submit', 'proof_submit_ok', 'proof_submit_fallback', 'designer_help_open',
  'checkout_start', 'checkout_paid', 'editor_error',
]);
const MAX_BYTES = 8192;
const MAX_EVENTS = 50;
const MAX_T = 86400000;
const KEY_OK = /^[A-Za-z][A-Za-z0-9_]{0,23}$/;
const TOKEN_OK = /^[A-Za-z0-9_.:+/-]+$/;

function reply(body, status) {
  return Response.json(body, { status: status, headers: { 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store' } });
}

// The body as text, or null once it goes past `max` bytes. No header is read to decide.
async function readText(request, max) {
  const reader = request.body && request.body.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > max) {
      reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(part.value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

// Up to 4 small values. Strings must be tokens (no spaces), so free text a person typed cannot get in.
function cleanData(d) {
  const out = {};
  if (!d || typeof d !== 'object' || Array.isArray(d)) return out;
  for (const key of Object.keys(d)) {
    if (Object.keys(out).length >= 4) break;
    const v = d[key];
    if (!KEY_OK.test(key)) continue;
    if (typeof v === 'number' && isFinite(v) && Math.abs(v) < 1e12) out[key] = Math.round(v * 100) / 100;
    else if (typeof v === 'string' && TOKEN_OK.test(v.slice(0, 40))) out[key] = v.slice(0, 40);
  }
  return out;
}

export function cleanEvent(e) {
  if (!e || typeof e !== 'object' || !NAMES.has(e.name)) return null;
  const known = typeof e.product === 'string' && catalog.products.some((p) => p.id === e.product);
  return {
    name: e.name,
    t: typeof e.t === 'number' && isFinite(e.t) && e.t >= 0 && e.t <= MAX_T ? Math.round(e.t) : null,
    sid: typeof e.sid === 'string' ? e.sid.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16) : '',
    vp: e.vp === 'm' || e.vp === 'd' ? e.vp : '',
    product: known ? e.product : '',
    phase: e.phase === 1 || e.phase === 2 || e.phase === 3 ? e.phase : null,
    d: cleanData(e.d),
  };
}

export async function handle(request, env, now) {
  if (env.DESIGN_EVENTS_ENABLED !== 'true') return reply({ ok: false, enabled: false }, 503);
  if (!env.PROOFS) return reply({ ok: false, error: 'storage' }, 500);
  const text = await readText(request, MAX_BYTES);
  if (text === null) return reply({ ok: false, error: 'too-large' }, 413);
  let body;
  try {
    body = JSON.parse(text);
  } catch (_) {
    return reply({ ok: false, error: 'json' }, 400);
  }
  if (!body || !Array.isArray(body.events)) return reply({ ok: false, error: 'events' }, 400);
  if (body.events.length > MAX_EVENTS) return reply({ ok: false, error: 'too-large' }, 413);
  const events = body.events.map(cleanEvent).filter(Boolean);
  if (!events.length) return reply({ ok: false, error: 'events' }, 400);
  const when = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
  const day = when.toISOString().slice(0, 10);
  const id = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
  try {
    await env.PROOFS.put('events/' + day + '/' + id + '.json', JSON.stringify({ day: day, events: events }), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
    });
  } catch (_) {
    console.error('design-event storage failed');
    return reply({ ok: false, error: 'storage' }, 500);
  }
  return new Response(null, { status: 204, headers: { 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store' } });
}

export async function onRequestPost(context) {
  try {
    return await handle(context.request, context.env, new Date());
  } catch (_) {
    console.error('design-event failed');
    return reply({ ok: false, error: 'server' }, 500);
  }
}
