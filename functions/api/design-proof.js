// Cloudflare Pages Function: POST /api/design-proof
//
// Off unless DESIGN_PROOF_ENABLED is exactly "true". While it is off, this
// returns 503 and the design page keeps the mailto + PNG download path.
// No secrets, buckets or email bindings are required for the site to deploy.
//
// Turn on (all in the existing Cloudflare account, nothing new to buy):
// 1. Create a private R2 bucket, for example getseen-design-proofs.
//    Do not enable public access or r2.dev.
// 2. Pages project → Settings → Bindings → R2 bucket.
//    Variable name: PROOFS
// 3. Optional email, via Cloudflare Email Routing (free on the zone):
//    - Verify the destination mailbox (sales@getseensignsco.com).
//    - Add a send_email binding named SEND_EMAIL, allowed to that destination.
// 4. Pages → Settings → Environment variables (Production, and Preview if you want):
//      DESIGN_PROOF_ENABLED = true
//      DESIGN_PROOF_TO      = sales@getseensignsco.com
//      DESIGN_PROOF_FROM    = an address on getseensignsco.com Email Routing can send as
//                             (for example proofs@getseensignsco.com)
// 5. Redeploy.
//
// Request, multipart/form-data:
//   design       JSON string, the v2 design document (200 KB max). Optional when request.mode is design_for_me.
//   request      JSON string {name, email, phone, eventDate, notes, mode, source, viewport, clientTotal,
//                elapsedMs, hear, designForMe: {products, wording, siteUrl}}
//   preview-<n>  PNG, 6 MB max each, 12 max
//   logo-<n>     png, jpeg, webp or svg, 25 MB max each (svg 8 MB), 4 max
//   _gotcha      honeypot: any value gets a fake success and nothing is stored
// The whole body is capped at 40 MB because formData() keeps it in memory (128 MB Worker).
//
// Answers: 200 {ok, ref, emailed, stored, serverTotal, priceMismatch}; 400 {ok:false, error} with error
// fields, design, preview, logo or form; 413 too-large; 429 rate; 500 storage or server; 503 {ok:false, enabled:false}.
// emailed false with stored true means the request is in R2 but the email did not go out.
//
// Stored keys (private bucket; no IP, cookies or user agent are kept):
//   design-proofs/YYYY-MM-DD/<ref>/design.json, preview-<n>.png, logo-<n>.<png|jpg|webp|svg>, request.json
// SVG logos are stored sanitized. request.json is written last, so a folder without it is a failed upload.
// The email is a text summary. Previews, then logos, are attached while together under 1.5 MB.

import catalog from '../../assets/design/catalog.json' with { type: 'json' };
import { projectTotal, productById, money } from '../../assets/design/model/pricing.js';
import { validateDocument } from '../../assets/design/model/document.js';

const MAX_DESIGN = 200000;
const MAX_REQUEST = 32000;
const MAX_PREVIEW = 6 * 1024 * 1024;
const MAX_LOGO = 25 * 1024 * 1024;
const MAX_SVG = 8 * 1024 * 1024;
const MAX_BODY = 40 * 1024 * 1024;
const MAX_PREVIEWS = 12;
const MAX_LOGOS = 4;
const ATTACH_LIMIT = 1500000;
const MIN_ELAPSED_MS = 3000;
const RATE_MAX = 8;
const RATE_WINDOW_MS = 3600000;
const REF_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ENV = { catalog: catalog, fonts: catalog.fonts };
const LOGO_TYPES = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' };

class Reject extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function json(body, status, headers) {
  const base = { 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store' };
  return Response.json(body, { status: status || 200, headers: Object.assign(base, headers) });
}

function oneLine(value, max) {
  const text = typeof value === 'string' ? value : '';
  return text.replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, max || 500).trimEnd();
}

function multiLine(value, max) {
  const text = typeof value === 'string' ? value : '';
  return text.replace(/\r\n?/g, '\n').replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max || 4000).trimEnd();
}

function validEmail(value) {
  return (
    value.length <= 200 &&
    /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(value)
  );
}

function dayStamp(d) {
  return d.toISOString().slice(0, 10);
}

export function makeRef() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return 'GS-' + Array.from(bytes, (b) => REF_CHARS[b & 31]).join('');
}

// ---------- soft rate limit: per isolate, in memory, keyed by IP and never written anywhere ----------

const hits = new Map();

export function resetRateLimit() {
  hits.clear();
}

function limited(ip, ms) {
  if (!ip) return false;
  const recent = (hits.get(ip) || []).filter((t) => t > ms - RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(ms);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [key, list] of hits) if (list[list.length - 1] <= ms - RATE_WINDOW_MS) hits.delete(key);
    if (hits.size > 5000) hits.clear();
  }
  return false;
}

// ---------- SVG logos: rewritten tag by tag, only canonical markup comes out ----------
// Dropped with their content: script, foreignObject, iframe, object, embed (any namespace prefix),
// <use> that points outside the file, and animations that target href or an on* handler.
// Dropped attributes: on*, xml:base, XHTML/MathML/XSL namespace declarations, javascript: values, and any
// href/xlink:href/src/action that does not start with # (or data:image/ on <image> and <feImage>).
// Comments, processing instructions and DOCTYPE (entities) are removed; CDATA becomes escaped text.

const DROP_TAGS = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed']);
const ANIM_TAGS = new Set(['set', 'animate', 'animatemotion', 'animatetransform']);
const IMAGE_TAGS = new Set(['image', 'feimage']);
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction']);
const NAME_OK = /^[A-Za-z_:][\w:.-]*$/;
const TAG_NAME = /[A-Za-z][^\s/>]*/y;
const SVG_ROOT = /<(?:[A-Za-z][\w.-]*:)?svg[\s/>]/i;
const ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|(amp|lt|gt|quot|apos));/g;
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const localName = (name) => name.slice(name.lastIndexOf(':') + 1).toLowerCase();
const isSpace = (c) => c === 32 || c === 9 || c === 10 || c === 13 || c === 12;
const escapeText = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (v) => escapeText(v).replace(/"/g, '&quot;');

const codePoint = (cp) => (cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : String.fromCharCode(0xfffd));

function decode(value) {
  return value.replace(ENTITY, (m, dec, hex, named) => (named ? NAMED[named] : codePoint(dec ? Number(dec) : parseInt(hex, 16))));
}

// CSS escapes are resolved first so u\72l( cannot hide a url(; any backslash left over is then removed.
// Every url( that does not point at #id or data:image/ becomes none, and @import rules are cut out.
// Written as scans, not one big regex, so a hostile file cannot make it slow. Cutting can join two halves
// into a new url(, so it runs again until nothing changes; a text that keeps changing is dropped.
const CSS_KEY = /url\(|@import/gi;
const CSS_STOP = /[;{}]/g;
const CSS_KEEP = /^\s*["']?\s*(?:#|data:image\/)/i;

function scrubCss(s) {
  const out = [];
  let done = 0;
  let paren = -2;
  CSS_KEY.lastIndex = 0;
  for (let m = CSS_KEY.exec(s); m; m = CSS_KEY.exec(s)) {
    const from = m.index + m[0].length;
    let cut;
    if (m[0].length === 4) {
      if (paren !== -1 && paren < from) paren = s.indexOf(')', from);
      if (paren >= 0 && CSS_KEEP.test(s.slice(from, Math.min(paren, from + 40)))) continue;
      out.push(s.slice(done, m.index), 'none');
      cut = paren < 0 ? s.length : paren + 1;
    } else {
      CSS_STOP.lastIndex = from;
      const stop = CSS_STOP.exec(s);
      out.push(s.slice(done, m.index));
      cut = stop ? (stop[0] === ';' ? stop.index + 1 : stop.index) : s.length;
    }
    done = cut;
    CSS_KEY.lastIndex = cut;
  }
  out.push(s.slice(done));
  return out.join('');
}

function cleanCss(css) {
  let s = css.replace(/\\(?:([0-9a-fA-F]{1,6})\s?|([^\n]))/g, (m, hex, ch) => (hex ? codePoint(parseInt(hex, 16)) : ch)).replace(/\\/g, '');
  for (let pass = 0; pass < 3; pass++) {
    const next = scrubCss(s);
    if (next === s) return s;
    s = next;
  }
  return '';
}

function skipPast(s, token, from) {
  const at = s.indexOf(token, from);
  return at < 0 ? s.length : at + token.length;
}

function skipDeclaration(s, i) {
  const gt = s.indexOf('>', i);
  if (gt < 0) return s.length;
  const bracket = s.slice(i, gt).indexOf('[');
  if (bracket < 0) return gt + 1;
  const close = s.indexOf(']', i + bracket);
  return close < 0 ? s.length : skipPast(s, '>', close);
}

// Reads one tag starting at s[i] === '<'. Returns null when it is not a tag, tag.broken when it never ends.
function readTag(s, i) {
  const n = s.length;
  let p = i + 1;
  const close = s.charCodeAt(p) === 47;
  if (close) p++;
  TAG_NAME.lastIndex = p;
  const m = TAG_NAME.exec(s);
  if (!m) return null;
  const tag = { close: close, name: m[0], attrs: [], self: false, end: n, broken: false };
  p += m[0].length;
  for (;;) {
    while (p < n && (isSpace(s.charCodeAt(p)) || s.charCodeAt(p) === 47)) p++;
    if (p >= n) {
      tag.broken = true;
      return tag;
    }
    if (s.charCodeAt(p) === 62) {
      tag.self = !close && s.charCodeAt(p - 1) === 47;
      tag.end = p + 1;
      return tag;
    }
    let q = p;
    while (q < n && !isSpace(s.charCodeAt(q)) && s.charCodeAt(q) !== 47 && s.charCodeAt(q) !== 62 && s.charCodeAt(q) !== 61) q++;
    if (q === p) q++;
    const name = s.slice(p, q);
    p = q;
    while (p < n && isSpace(s.charCodeAt(p))) p++;
    let value = null;
    if (s[p] === '=') {
      p++;
      while (p < n && isSpace(s.charCodeAt(p))) p++;
      const quote = s[p];
      if (quote === '"' || quote === "'") {
        const end = s.indexOf(quote, p + 1);
        if (end < 0) {
          tag.broken = true;
          return tag;
        }
        value = s.slice(p + 1, end);
        p = end + 1;
      } else {
        let end = p;
        while (end < n && !isSpace(s.charCodeAt(end)) && s.charCodeAt(end) !== 62) end++;
        value = s.slice(p, end);
        p = end;
      }
    }
    if (!close) tag.attrs.push([name, value]);
  }
}

// Position after the element that starts with `tag`, counting nested tags of the same name.
function skipElement(s, tag) {
  if (tag.self) return tag.end;
  const target = tag.name.toLowerCase();
  let depth = 1;
  let p = tag.end;
  for (;;) {
    const at = s.indexOf('<', p);
    if (at < 0) return s.length;
    const t = readTag(s, at);
    if (!t) {
      p = at + 1;
      continue;
    }
    if (t.broken) return s.length;
    p = t.end;
    if (t.name.toLowerCase() === target) {
      if (t.close) {
        depth -= 1;
        if (depth === 0) return p;
      } else if (!t.self) {
        depth += 1;
      }
    }
  }
}

// Kept attributes as [name, value], or null when the whole element has to go.
function cleanAttrs(tag, lname) {
  const kept = [];
  for (const [name, raw] of tag.attrs) {
    if (!NAME_OK.test(name)) continue;
    const ln = localName(name);
    let v = decode(raw == null ? '' : raw);
    if (ln.startsWith('on') || /^on/i.test(name) || name.toLowerCase() === 'xml:base') continue;
    if (/^xmlns(:|$)/i.test(name) && /xhtml|mathml|xsl|xul/i.test(v)) continue;
    if (URL_ATTRS.has(ln)) {
      v = v.replace(/^[\x00-\x20]+/, '');
      const local = v.startsWith('#');
      if (lname === 'use' && !local) return null;
      if (!local && !(IMAGE_TAGS.has(lname) && /^data:image\//i.test(v))) continue;
    } else {
      if (ln === 'style' || /url\(/i.test(v)) v = cleanCss(v);
      if (/(?:java|vb)script:/i.test(v.replace(/[\x00-\x20]+/g, ''))) continue;
    }
    kept.push([name, v]);
  }
  if (ANIM_TAGS.has(lname)) {
    const target = kept.find((a) => localName(a[0]) === 'attributename');
    if (target && /^(?:on|(?:[\w-]+:)?(?:href|src|action|formaction)$)/i.test(target[1].trim())) return null;
  }
  return kept;
}

export function sanitizeSvg(input) {
  const raw = String(input);
  const s = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const n = s.length;
  const out = [];
  let style = false;
  let i = 0;
  while (i < n) {
    const lt = s.indexOf('<', i);
    const text = s.slice(i, lt < 0 ? n : lt);
    if (text) out.push(style ? escapeText(cleanCss(decode(text))) : text.replace(/\]\]>/g, ']]&gt;'));
    if (lt < 0) break;
    i = lt;
    if (s.startsWith('<!--', i)) {
      i = skipPast(s, '-->', i + 4);
    } else if (s.startsWith('<![CDATA[', i)) {
      const end = s.indexOf(']]>', i + 9);
      const data = s.slice(i + 9, end < 0 ? n : end);
      out.push(escapeText(style ? cleanCss(data) : data));
      i = end < 0 ? n : end + 3;
    } else if (s.startsWith('<?', i)) {
      i = skipPast(s, '?>', i + 2);
    } else if (s.startsWith('<!', i)) {
      i = skipDeclaration(s, i);
    } else {
      const tag = readTag(s, i);
      if (!tag) {
        out.push('&lt;');
        i += 1;
        continue;
      }
      i = tag.end;
      if (tag.broken || !NAME_OK.test(tag.name)) continue;
      const lname = localName(tag.name);
      if (tag.close) {
        if (!DROP_TAGS.has(lname)) out.push('</' + tag.name + '>');
        if (lname === 'style') style = false;
        continue;
      }
      const attrs = DROP_TAGS.has(lname) ? null : cleanAttrs(tag, lname);
      if (!attrs) {
        i = skipElement(s, tag);
        continue;
      }
      out.push('<' + tag.name + attrs.map((a) => ' ' + a[0] + '="' + escapeAttr(a[1]) + '"').join('') + (tag.self ? '/>' : '>'));
      if (lname === 'style' && !tag.self) style = true;
    }
  }
  return out.join('');
}

// ---------- email ----------

function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function encodeHeader(value) {
  const clean = oneLine(value, 400);
  if (/^[\x20-\x7E]*$/.test(clean)) return clean;
  const bytes = new TextEncoder().encode(clean);
  return '=?UTF-8?B?' + bytesToBase64(bytes) + '?=';
}

function wrapBase64(b64) {
  const lines = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join('\r\n');
}

function buildMime(head, text, files, boundary) {
  const lines = [
    'From: ' + head.from,
    'To: ' + head.to,
    'Reply-To: ' + head.replyTo,
    'Subject: ' + head.subject,
    'Date: ' + head.date,
    'Message-ID: ' + head.messageId,
    'MIME-Version: 1.0',
  ];
  const body = wrapBase64(bytesToBase64(new TextEncoder().encode(text)));
  const textHead = ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', ''];
  if (!files.length) return lines.concat(textHead, body, '').join('\r\n');
  lines.push('Content-Type: multipart/mixed; boundary="' + boundary + '"', '', '--' + boundary);
  lines.push(...textHead, body);
  for (const file of files) {
    const name = encodeHeader(file.filename);
    lines.push(
      '--' + boundary,
      'Content-Type: ' + file.type + '; name="' + name + '"',
      'Content-Transfer-Encoding: base64',
      'Content-Disposition: attachment; filename="' + name + '"',
      '',
      wrapBase64(bytesToBase64(file.bytes))
    );
  }
  lines.push('--' + boundary + '--', '');
  return lines.join('\r\n');
}

function optionLabels(piece) {
  const product = productById(catalog, piece.productId);
  return product.groups
    .map((g) => {
      const choice = g.choices.find((c) => c.id === piece.choices[g.id]);
      return g.label + ': ' + (choice ? choice.label : piece.choices[g.id]);
    })
    .join(', ');
}

function summaryText(d) {
  const c = d.contact;
  const lines = [
    'Design proof request',
    'Reference: ' + d.ref,
    'Mode: ' + (d.mode === 'design_for_me' ? 'Design it for me' : 'Self-designed'),
    'Received: ' + d.when.toISOString(),
    '',
    'Name: ' + c.name,
    'Email: ' + c.email,
    'Phone: ' + (c.phone || '-'),
    'Event date: ' + (c.eventDate || '-'),
    'Heard about us: ' + (c.hear || '-'),
    'Source: ' + (c.source || '-') + (c.viewport ? ' (' + (c.viewport === 'm' ? 'phone' : 'desktop') + ')' : ''),
    'Notes: ' + (c.notes || '-'),
  ];
  if (d.dfm) {
    lines.push('', 'Design it for me');
    lines.push('Products: ' + (d.dfm.products.map((id) => productById(catalog, id).short).join(', ') || '-'));
    lines.push('Wording: ' + (d.dfm.wording || '-'), 'Website: ' + (d.dfm.siteUrl || '-'));
  }
  if (d.design) {
    const proj = d.design.project;
    proj.pieces.forEach((piece, n) => {
      const product = productById(catalog, piece.productId);
      const names = piece.sides.map((s) => oneLine(s && s.name, 40)).filter(Boolean);
      lines.push('', 'Piece ' + (n + 1) + ': ' + product.name);
      lines.push('  Options: ' + optionLabels(piece));
      if (product.qty) lines.push('  Quantity: ' + piece.qty);
      lines.push('  Template: ' + (oneLine(piece.templateId, 60) || '-'));
      lines.push('  Sides: ' + (piece.sidesMode === 'each' ? 'each side different' : 'same on all sides') + (names.length ? ' (' + names.join(', ') + ')' : ''));
    });
    lines.push('', 'Design text');
    for (const key of ['name', 'line2', 'phone', 'web']) lines.push('  ' + key + ': ' + (oneLine(proj.fields[key], 200) || '-'));
    lines.push('Colors: primary ' + oneLine(proj.palette.primary, 20) + ', accent ' + oneLine(proj.palette.accent, 20) + ', ink ' + oneLine(proj.palette.ink, 20));
  }
  lines.push('Logo files: ' + (d.logos.length ? d.logos.map((l) => l.file + ' (' + l.name + ')').join(', ') : 'none'));
  lines.push('');
  if (d.serverTotal == null) {
    lines.push('Server total: not priced (no design attached)');
  } else {
    lines.push('Server total: ' + money(d.serverTotal) + ' (Free shipping)');
    if (d.priceMismatch) lines.push('WARNING: the page showed ' + money(d.clientTotal) + ' but the server price is ' + money(d.serverTotal) + '. Check before quoting.');
  }
  const attached = d.attach.map((a) => a.filename);
  const all = d.keys.map((k) => k.slice(k.lastIndexOf('/') + 1));
  lines.push('', 'Attached: ' + (attached.join(', ') || 'none'));
  const only = all.filter((f) => /^(preview|logo)-/.test(f) && attached.indexOf(f) < 0);
  if (only.length) lines.push('Only in R2: ' + only.join(', '));
  lines.push('', 'Files in R2:', ...d.keys, '', 'This is a preview, not the print file. Reply with the free proof.');
  return lines.join('\n');
}

async function sendMail(env, d, deps) {
  if (!env.SEND_EMAIL || !env.DESIGN_PROOF_TO || !env.DESIGN_PROOF_FROM) return false;
  const to = oneLine(env.DESIGN_PROOF_TO, 200);
  const from = oneLine(env.DESIGN_PROOF_FROM, 200);
  if (!validEmail(to) || !validEmail(from)) return false;
  let EmailMessage = deps && deps.EmailMessage;
  if (!EmailMessage) {
    try {
      EmailMessage = (await import('cloudflare:email')).EmailMessage;
    } catch (_) {
      return false;
    }
  }
  const shorts = [];
  const products = d.design ? d.design.project.pieces.map((p) => p.productId) : d.dfm ? d.dfm.products : [];
  for (const id of products) {
    const short = productById(catalog, id).short;
    if (shorts.indexOf(short) < 0) shorts.push(short);
  }
  const head = {
    from: from,
    to: to,
    replyTo: d.contact.email,
    subject: encodeHeader('Design proof request: ' + (shorts.join(' + ') || 'sign') + ' (' + d.contact.name + ') ' + d.ref),
    date: d.when.toUTCString(),
    messageId: '<' + d.ref + '.' + d.when.getTime().toString(36) + '@' + from.slice(from.indexOf('@') + 1) + '>',
  };
  const raw = buildMime(head, summaryText(d), d.attach, 'seen' + d.ref.replace(/[^a-zA-Z0-9]/g, ''));
  await env.SEND_EMAIL.send(new EmailMessage(from, to, raw));
  return true;
}

// ---------- request parsing ----------

// A product by id, or by its short or full name, so a label the page shows still finds its product.
function findProduct(value) {
  const q = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (q && catalog.products.find((p) => [p.id, p.short, p.name].some((x) => x.toLowerCase() === q))) || null;
}

function readContact(req) {
  const mode = req.mode == null ? 'self' : req.mode;
  const contact = {
    name: oneLine(req.name, 120),
    email: oneLine(req.email, 200),
    phone: oneLine(req.phone, 40),
    eventDate: oneLine(req.eventDate, 40),
    hear: oneLine(req.hear, 120),
    source: oneLine(req.source, 80),
    viewport: req.viewport === 'm' || req.viewport === 'd' ? req.viewport : '',
    notes: multiLine(req.notes, 4000),
  };
  if (!contact.name || !validEmail(contact.email) || (mode !== 'self' && mode !== 'design_for_me')) throw new Reject(400, 'fields');
  let dfm = null;
  if (mode === 'design_for_me') {
    const d = req.designForMe && typeof req.designForMe === 'object' ? req.designForMe : {};
    const ids = (Array.isArray(d.products) ? d.products : []).map(findProduct).filter(Boolean).map((p) => p.id);
    dfm = { products: ids.filter((id, n) => ids.indexOf(id) === n).slice(0, 6), wording: multiLine(d.wording, 4000), siteUrl: oneLine(d.siteUrl, 200) };
  }
  const total = req.clientTotal;
  const clientTotal = typeof total === 'number' && isFinite(total) && total >= 0 && total < 1e7 ? total : null;
  return { contact: contact, mode: mode, dfm: dfm, clientTotal: clientTotal };
}

function readDesign(form, mode) {
  const raw = form.get('design');
  if (raw == null || raw === '') {
    if (mode === 'design_for_me') return null;
    throw new Reject(400, 'design');
  }
  if (typeof raw !== 'string') throw new Reject(400, 'design');
  if (raw.length > MAX_DESIGN) throw new Reject(413, 'too-large');
  try {
    const design = JSON.parse(raw);
    if (validateDocument(design, ENV).ok) return design;
  } catch (_) {
    // falls through to the same answer as an invalid document
  }
  throw new Reject(400, 'design');
}

function sniff(head) {
  const is = (sig, at) => sig.every((b, i) => head[(at || 0) + i] === b);
  if (is([137, 80, 78, 71, 13, 10, 26, 10])) return 'png';
  if (is([255, 216, 255])) return 'jpeg';
  if (is([82, 73, 70, 70]) && is([87, 69, 66, 80], 8)) return 'webp';
  return null;
}

const headOf = async (file) => new Uint8Array(await file.slice(0, 12).arrayBuffer());

// The type the browser claims; "unknown" (empty or octet-stream) is left to the bytes to decide.
function claimed(file) {
  const type = String(file.type || '').split(';')[0].trim().toLowerCase();
  return type === 'application/octet-stream' ? '' : type;
}

// Looks at every file before anything is read in full or stored, so a bad request writes nothing.
async function readFiles(form) {
  const found = { preview: [], logo: [] };
  for (const [key, file] of form.entries()) {
    const m = /^(preview|logo)-(\d{1,2})$/.exec(key);
    if (!m) continue;
    const list = found[m[1]];
    const n = Number(m[2]);
    if (typeof file === 'string' || !file.size || list.some((x) => x.n === n)) throw new Reject(400, m[1]);
    list.push({ n: n, file: file });
  }
  const previews = found.preview.sort((a, b) => a.n - b.n);
  const logos = found.logo.sort((a, b) => a.n - b.n);
  if (previews.length > MAX_PREVIEWS) throw new Reject(400, 'preview');
  if (logos.length > MAX_LOGOS) throw new Reject(400, 'logo');
  const all = previews.concat(logos);
  if (previews.some((p) => p.file.size > MAX_PREVIEW) || logos.some((l) => l.file.size > MAX_LOGO)) throw new Reject(413, 'too-large');
  if (all.reduce((sum, x) => sum + x.file.size, 0) > MAX_BODY) throw new Reject(413, 'too-large');
  for (const p of previews) {
    if ((claimed(p.file) && claimed(p.file) !== 'image/png') || sniff(await headOf(p.file)) !== 'png') throw new Reject(400, 'preview');
  }
  for (const l of logos) {
    const declared = claimed(l.file);
    if (declared && Object.values(LOGO_TYPES).indexOf(declared) < 0) throw new Reject(400, 'logo');
    l.kind = sniff(await headOf(l.file));
    if (!l.kind && (declared === '' || declared === LOGO_TYPES.svg)) {
      if (l.file.size > MAX_SVG) throw new Reject(413, 'too-large');
      const top = new TextDecoder().decode(await l.file.slice(0, 65536).arrayBuffer());
      if (SVG_ROOT.test(top)) l.kind = 'svg';
    }
    if (!l.kind) throw new Reject(400, 'logo');
  }
  return { previews: previews, logos: logos };
}

// ---------- storage ----------

async function storeAll(env, ref, when, parts) {
  const prefix = 'design-proofs/' + dayStamp(when) + '/' + ref + '/';
  const keys = [];
  const attach = [];
  const logos = [];
  const previews = [];
  let attachBytes = 0;
  const put = async (name, body, type) => {
    await env.PROOFS.put(prefix + name, body, { httpMetadata: { contentType: type } });
    keys.push(prefix + name);
  };
  const offer = (filename, type, bytes) => {
    if (attachBytes + bytes.length > ATTACH_LIMIT) return;
    attachBytes += bytes.length;
    attach.push({ filename: filename, type: type, bytes: bytes });
  };
  try {
    if (parts.design) await put('design.json', JSON.stringify(parts.design), 'application/json; charset=utf-8');
    for (const p of parts.files.previews) {
      const bytes = new Uint8Array(await p.file.arrayBuffer());
      const file = 'preview-' + p.n + '.png';
      await put(file, bytes, 'image/png');
      previews.push(file);
      offer(file, 'image/png', bytes);
    }
    for (const l of parts.files.logos) {
      let bytes = new Uint8Array(await l.file.arrayBuffer());
      if (l.kind === 'svg') {
        const clean = sanitizeSvg(new TextDecoder().decode(bytes));
        if (!SVG_ROOT.test(clean)) throw new Reject(400, 'logo');
        bytes = new TextEncoder().encode(clean);
      }
      const file = 'logo-' + l.n + '.' + (l.kind === 'jpeg' ? 'jpg' : l.kind);
      await put(file, bytes, LOGO_TYPES[l.kind]);
      logos.push({ file: file, name: oneLine(l.file.name, 120) || file, type: LOGO_TYPES[l.kind], bytes: bytes.length });
      offer(file, LOGO_TYPES[l.kind], bytes);
    }
    const record = Object.assign({ ref: ref, receivedAt: when.toISOString() }, parts.record, { files: { previews: previews, logos: logos } });
    await put('request.json', JSON.stringify(record), 'application/json; charset=utf-8');
  } catch (err) {
    try {
      if (keys.length) await env.PROOFS.delete(keys);
    } catch (_) {
      // leftovers have no request.json, so they are easy to spot
    }
    throw err;
  }
  return { keys: keys, attach: attach, logos: logos };
}

// ---------- handler ----------

async function run(request, env, when, deps) {
  if (env.DESIGN_PROOF_ENABLED !== 'true') return json({ ok: false, enabled: false }, 503);
  if (!env.PROOFS) throw new Reject(500, 'storage');
  if (limited(request.headers.get('cf-connecting-ip'), when.getTime())) return json({ ok: false, error: 'rate' }, 429, { 'Retry-After': '3600' });
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) throw new Reject(413, 'too-large');

  let form;
  try {
    form = await request.formData();
  } catch (_) {
    throw new Reject(400, 'form');
  }
  const fake = () => json({ ok: true, ref: makeRef(), emailed: true });
  const trap = form.get('_gotcha');
  if (trap && (typeof trap !== 'string' || trap.trim())) return fake();

  const rawRequest = form.get('request');
  if (typeof rawRequest !== 'string' || !rawRequest) throw new Reject(400, 'fields');
  if (rawRequest.length > MAX_REQUEST) throw new Reject(413, 'too-large');
  let req;
  try {
    req = JSON.parse(rawRequest);
  } catch (_) {
    throw new Reject(400, 'fields');
  }
  if (!req || typeof req !== 'object' || Array.isArray(req)) throw new Reject(400, 'fields');
  if (typeof req.elapsedMs === 'number' && req.elapsedMs < MIN_ELAPSED_MS) return fake();

  const who = readContact(req);
  const design = readDesign(form, who.mode);
  const files = await readFiles(form);
  if (!files.previews.length && who.mode !== 'design_for_me') throw new Reject(400, 'preview');

  const total = design ? projectTotal(catalog, design) : null;
  const serverTotal = total && total.ok ? total.total : null;
  const priceMismatch = serverTotal != null && who.clientTotal != null && Math.abs(serverTotal - who.clientTotal) > 0.005;
  const ref = makeRef();
  const record = {
    name: who.contact.name,
    email: who.contact.email,
    phone: who.contact.phone,
    eventDate: who.contact.eventDate,
    notes: who.contact.notes,
    hear: who.contact.hear,
    mode: who.mode,
    source: who.contact.source,
    viewport: who.contact.viewport,
    designForMe: who.dfm,
    clientTotal: who.clientTotal,
    serverTotal: serverTotal,
    priceMismatch: priceMismatch,
    elapsedMs: typeof req.elapsedMs === 'number' ? req.elapsedMs : null,
  };

  let stored;
  try {
    stored = await storeAll(env, ref, when, { design: design, files: files, record: record });
  } catch (err) {
    if (err instanceof Reject) throw err;
    console.error('design-proof storage failed');
    throw new Reject(500, 'storage');
  }

  const mail = {
    ref: ref,
    when: when,
    contact: who.contact,
    mode: who.mode,
    dfm: who.dfm,
    design: design,
    serverTotal: serverTotal,
    clientTotal: who.clientTotal,
    priceMismatch: priceMismatch,
    keys: stored.keys,
    attach: stored.attach,
    logos: stored.logos,
  };
  let emailed = false;
  try {
    emailed = await sendMail(env, mail, deps);
  } catch (_) {
    console.error('design-proof email failed');
  }
  return json({ ok: true, ref: ref, emailed: emailed, stored: true, serverTotal: serverTotal, priceMismatch: priceMismatch });
}

export async function handle(request, env, now, deps) {
  const when = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
  try {
    return await run(request, env, when, deps);
  } catch (err) {
    if (err instanceof Reject) return json({ ok: false, error: err.code }, err.status);
    throw err;
  }
}

export async function onRequestPost(context) {
  try {
    return await handle(context.request, context.env, new Date());
  } catch (err) {
    console.error('design-proof failed');
    return json({ ok: false, error: 'server' }, 500);
  }
}
