// Cloudflare Pages Function: POST /api/design-proof
//
// Where a request goes (use any mix; none of it is required for the site to deploy):
//   Storage  D1 database bound as DB (the orders database), and/or a private R2 bucket bound as PROOFS.
//   Email    Brevo (env BREVO_API_KEY): the request to sales@getseensignsco.com with previews and logos attached,
//            Reply-To the customer, plus a short confirmation to the customer. And/or Cloudflare Email Routing
//            (SEND_EMAIL binding with DESIGN_PROOF_TO and DESIGN_PROOF_FROM) for the request email only.
//
// On or off:
//   DESIGN_PROOF_ENABLED = "false"  always off (503 {enabled:false}); the page tells the visitor to try again or call or text.
//   DESIGN_PROOF_ENABLED = "true"   on (needs at least one storage binding, otherwise 500 storage).
//   anything else or unset          on when the DB binding and BREVO_API_KEY are both present, otherwise off.
//
// Turn on with D1 + Brevo (nothing new to buy): bind the orders D1 database as DB and set BREVO_API_KEY as a
// secret on the Pages project, then redeploy. The tables are created on first use (see migrations/0002).
// R2 + Email Routing still work as before: create the private bucket, bind it as PROOFS, add the send_email
// binding SEND_EMAIL and set DESIGN_PROOF_TO / DESIGN_PROOF_FROM. If both Brevo and SEND_EMAIL exist, Brevo is
// tried first and SEND_EMAIL is the fallback.
//
// Orders: a request that names what to buy becomes an order in D1 (status awaiting_proof, order id = the reference).
//   - The order panel on the product pages posts to POST /api/order-request (functions/api/order-request.js), which
//     uses this same code with an order required. request.order = {items:[{sku, quantity}], options:[{label, value}]}.
//     Only SKUs listed in assets/order/catalog.json are accepted and every price comes from functions/_lib/catalog.js,
//     so nothing the browser sends can change a price. mode is "upload" (artwork files), "design_for_me" or "self".
//   - A designer request (this endpoint) becomes an order too when every piece of the design maps to a SKU; the
//     items are derived from the design on the server, never taken from the browser.
// Nothing is charged: the customer pays from the proof link after approving the proof (see functions/proof/).
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
// Answers: 200 {ok, ref, emailed, stored, confirmed (only when Brevo is set), serverTotal, priceMismatch}; 400 {ok:false, error} with error
// fields, design, preview, logo or form; 413 too-large; 429 rate; 500 storage or server; 503 {ok:false, enabled:false}.
// emailed is true when the request email to the shop went out (the page shows its success only then). emailed
// false with stored true means the request is saved but the email did not go out. confirmed is the customer email.
//
// D1 (no IP, cookies or user agent are kept): design_proof_requests holds the request JSON, the design JSON, file
// details (name, type, size, SHA-256, whether attached) and the email status. Files that did not fit in the
// email (3 MB of attachments for Brevo) are saved in design_proof_files as base64 chunks of 256 KB, up to 10 MB
// per request; anything beyond that is only listed, and the email says to ask the customer for it. When R2 is
// bound every file goes to R2 instead and D1 keeps no file data.
// Read them back with GET /api/admin/design-proofs/<ref> (and .../<ref>/<file>) using ADMIN_TOKEN.
//
// R2 keys (private bucket):
//   design-proofs/YYYY-MM-DD/<ref>/design.json, preview-<n>.png, logo-<n>.<png|jpg|webp|svg>, request.json
// SVG logos are stored sanitized. request.json is written last, so a folder without it is a failed upload.
// The Cloudflare Email Routing message is a text summary; previews, then logos, are attached under 1.5 MB.

import catalog from '../../assets/design/catalog.json' with { type: 'json' };
import { projectTotal, productById, money } from '../../assets/design/model/pricing.js';
import { validateDocument } from '../../assets/design/model/document.js';
import orderCatalog from '../../assets/order/catalog.json' with { type: 'json' };
import { getDb } from '../_lib/db.js';
import { resolveLineItem } from '../_lib/stripe.js';
import { createPendingOrder, linksFor } from '../_lib/orders.js';
import { brevoSend, layout, button, p as para } from '../_lib/emails.js';
import { SHOP_EMAIL, SHOP_PHONE, esc, sha256Hex, money as dollars, baseUrl } from '../_lib/util.js';

const MAX_DESIGN = 200000;
const MAX_REQUEST = 32000;
const MAX_PREVIEW = 6 * 1024 * 1024;
const MAX_LOGO = 25 * 1024 * 1024;
const MAX_SVG = 8 * 1024 * 1024;
const MAX_BODY = 40 * 1024 * 1024;
const MAX_PREVIEWS = 12;
const MAX_LOGOS = 4;
const ATTACH_LIMIT = 1500000;
const BREVO_ATTACH_LIMIT = 3000000;
const D1_FILE_CAP = 10 * 1024 * 1024;
const D1_CHUNK = 256 * 1024;
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
    d.order ? 'New order request (awaiting proof)' : 'Design proof request',
    'Reference: ' + d.ref,
    'Mode: ' + (d.mode === 'design_for_me' ? 'Design it for me' : d.mode === 'upload' ? 'Uploaded artwork' : 'Self-designed'),
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
  if (d.order) {
    lines.push('', 'Order ' + d.order.id + ' (nothing charged yet)');
    for (const it of d.order.items) lines.push('  - ' + it.name + ' x ' + it.quantity + ' = ' + dollars(it.unit_amount_cents * it.quantity) + (it.description ? ' (' + it.description + ')' : ''));
    lines.push('  Subtotal before tax: ' + dollars(d.order.subtotal) + ', free shipping');
    lines.push('  Next: send the proof for order ' + d.order.id + ' on the /admin/ page. The customer approves it and pays from the proof link.');
  }
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
  lines.push('', 'Attached: ' + (attached.join(', ') || 'none'));
  const rest = d.fileNames.filter((f) => attached.indexOf(f) < 0);
  if (d.keys.length) {
    if (rest.length) lines.push('Only in R2: ' + rest.join(', '));
  } else if (rest.length) {
    const saved = rest.filter((f) => d.d1Saved.indexOf(f) >= 0);
    const lost = rest.filter((f) => saved.indexOf(f) < 0);
    if (saved.length) lines.push('Saved in the orders database (too big for the email): ' + saved.join(', '));
    if (lost.length) lines.push('NOT saved (too big): ' + lost.join(', ') + '. Ask the customer to reply with these files.');
  }
  if (d.keys.length) lines.push('', 'Files in R2:', ...d.keys);
  if (d.d1) lines.push('', 'Saved in D1: design_proof_requests, ref ' + d.ref);
  lines.push('', 'This is a preview, not the print file. Reply with the free proof.');
  return lines.join('\n');
}

function productShorts(d) {
  const shorts = [];
  const products = d.design ? d.design.project.pieces.map((p) => p.productId) : d.dfm ? d.dfm.products : [];
  for (const id of products) {
    const short = productById(catalog, id).short;
    if (shorts.indexOf(short) < 0) shorts.push(short);
  }
  if (!shorts.length && d.order) for (const it of d.order.items) if (shorts.indexOf(it.name) < 0 && shorts.length < 2) shorts.push(it.name);
  return shorts;
}

const subjectOf = (d) => (d.order ? 'New order request: ' : 'Design proof request: ') + (productShorts(d).join(' + ') || 'sign') + ' (' + d.contact.name + ') ' + d.ref;

// Brevo: the request to the shop, customer as Reply-To, previews and logos attached (d.attach).
async function sendBrevoMail(env, d) {
  const configured = oneLine(env.DESIGN_PROOF_TO, 200);
  const to = validEmail(configured) ? configured : SHOP_EMAIL;
  const text = summaryText(d);
  await brevoSend(env, {
    to: to,
    subject: subjectOf(d),
    html: '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap">' + esc(text) + '</div>',
    text: text,
    replyTo: { email: d.contact.email, name: d.contact.name },
    attachments: d.attach.map((a) => ({ name: a.filename, content: bytesToBase64(a.bytes) })),
    tags: ['design-proof'],
  });
  return true;
}

// Short confirmation to the customer. Get Seen Signs only: no personal names, no legal name, city and state only.
async function sendConfirmation(env, d) {
  const first = d.contact.name.split(/\s+/)[0];
  const shorts = productShorts(d);
  const order = d.order;
  const lead = order
    ? d.mode === 'design_for_me' ? 'Thanks for your order request. We will design it for you.' : 'Thanks for your order request.'
    : d.mode === 'design_for_me' ? 'Thanks for sending your request. We will design it for you.' : 'Thanks for sending your design to Get Seen Signs.';
  const proof = 'Your free proof will be in your inbox within 12 hours, 7 days a week. Three revisions are included.';
  const nothing = 'Nothing is charged and nothing prints until you approve your proof and pay from your proof link.';
  const lines = order ? order.items.map((it) => it.name + ' x ' + it.quantity + ': ' + dollars(it.unit_amount_cents * it.quantity)) : [];
  const itemsHtml = order
    ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:6px 0 4px;font-size:15px">' +
      order.items.map((it) => '<tr><td style="padding:8px 0;border-bottom:1px solid #E4DFD2">' + esc(it.name) + (it.description ? '<br><span style="color:#5B5F66;font-size:13px">' + esc(it.description) + '</span>' : '') + '<br><span style="color:#5B5F66;font-size:13px">Qty ' + esc(it.quantity) + '</span></td><td align="right" style="padding:8px 0;border-bottom:1px solid #E4DFD2;font-weight:700;white-space:nowrap">' + esc(dollars(it.unit_amount_cents * it.quantity)) + '</td></tr>').join('') +
      '</table><p style="margin:6px 0 12px;font-weight:700">Total before sales tax: ' + esc(dollars(order.subtotal)) + ' (free shipping in the lower 48)</p>'
    : '';
  const html = layout({
    heading: order ? 'We got your order request' : 'We got your request',
    preheader: 'Reference ' + d.ref + '. Your free proof is coming within 12 hours.',
    bodyHtml:
      para('Hi ' + esc(first) + ',') + para(esc(lead)) +
      '<p style="margin:0 0 12px;font-size:20px"><strong>Reference ' + esc(d.ref) + '</strong></p>' +
      itemsHtml +
      para(esc(proof)) +
      (order ? para('<strong>' + esc(nothing) + '</strong>') : '') +
      (order ? button(order.url, 'See your order status') : '') +
      (!order && shorts.length ? para('You asked about: ' + esc(shorts.join(', ')) + '.') : '') +
      para('Want to add a logo file or change something? Just reply to this email and mention your reference.') +
      (order ? '' : '<p style="margin:14px 0 0;font-size:13px;color:#5B5F66">This was a preview request, not an order. Prices and details are confirmed on your proof.</p>'),
  });
  const text = ['Hi ' + first + ',', '', lead, '', 'Reference ' + d.ref, '', ...lines, order ? 'Total before sales tax: ' + dollars(order.subtotal) + ' (free shipping in the lower 48)' : '', order ? '' : '', proof, order ? nothing : '', order ? 'Order status: ' + order.url : '', !order && shorts.length ? 'You asked about: ' + shorts.join(', ') + '.' : '', 'Want to add a logo file or change something? Just reply to this email and mention your reference.', '', '--', 'Get Seen Signs', 'Smiths Station, AL', SHOP_PHONE + ' | ' + SHOP_EMAIL + ' | getseensignsco.com']
    .filter((l, i, a) => l !== '' || (a[i - 1] !== '' && i > 0))
    .join('\n');
  await brevoSend(env, { to: d.contact.email, toName: d.contact.name, subject: order ? 'We got your order request (reference ' + d.ref + ')' : 'We got your proof request (reference ' + d.ref + ')', html: html, text: text, tags: ['design-proof', 'confirmation'] });
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
  const head = {
    from: from,
    to: to,
    replyTo: d.contact.email,
    subject: encodeHeader(subjectOf(d)),
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
  if (!contact.name || !validEmail(contact.email) || (mode !== 'self' && mode !== 'design_for_me' && mode !== 'upload')) throw new Reject(400, 'fields');
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

// ---------- orders ----------

const MAX_ORDER_LINES = 6;
const MAX_NOTE = 120;

// Items the browser asked for. Only the sku and the quantity are read; a price, name or total in the request is
// ignored, and the amount comes from the server's catalog through resolveLineItem. Unknown or non-public SKUs
// (the shipping line, anything not in assets/order/catalog.json) are refused.
export function itemsFromRequest(req) {
  const order = req.order;
  if (order == null) return null;
  if (typeof order !== 'object' || !Array.isArray(order.items) || !order.items.length || order.items.length > MAX_ORDER_LINES) throw new Reject(400, 'order');
  const items = [];
  for (const raw of order.items) {
    const sku = raw && typeof raw.sku === 'string' ? raw.sku : '';
    const quantity = raw ? Number(raw.quantity) : NaN;
    if (!Object.prototype.hasOwnProperty.call(orderCatalog.skus, sku)) throw new Reject(400, 'order');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > orderCatalog.maxQty) throw new Reject(400, 'order');
    const res = resolveLineItem({ sku: sku, quantity: quantity });
    if (res.error) throw new Reject(400, 'order');
    items.push(res.item);
  }
  // Wording choices (finish, style, layout) are notes on the first line. They never change a price.
  const notes = (Array.isArray(order.options) ? order.options : [])
    .slice(0, 4)
    .map((o) => (o && typeof o === 'object' ? oneLine(o.label, 30) + ': ' + oneLine(o.value, 50) : ''))
    .filter((t) => t.length > 2);
  if (notes.length) items[0].description = notes.join(', ').slice(0, MAX_NOTE);
  return items;
}

// The items a design stands for, from the designer's own price rows. Returns null when any piece has no SKU.
export function itemsFromDesign(design) {
  const items = [];
  for (const piece of design.project.pieces) {
    const product = productById(catalog, piece.productId);
    const row = product.prices.find((r) => Object.keys(r.when).every((k) => r.when[k] === piece.choices[k]));
    const sku = row && orderCatalog.offers[row.source + '|' + row.offer];
    if (!sku) return null;
    const quantity = product.qty ? Math.min(orderCatalog.maxQty, Math.max(1, piece.qty | 0)) : 1;
    const res = resolveLineItem({ sku: sku, quantity: quantity });
    if (res.error) return null;
    const same = items.find((it) => it.sku === sku);
    if (same) same.quantity = Math.min(orderCatalog.maxQty, same.quantity + quantity);
    else items.push(res.item);
  }
  return items.length ? items : null;
}

function readDesign(form, mode) {
  if (mode === 'upload') return null;
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

// Reads every accepted file in full and sanitizes SVG logos, before anything is stored or sent.
async function prepareFiles(files) {
  const out = [];
  for (const pv of files.previews) {
    out.push({ file: 'preview-' + pv.n + '.png', label: 'preview-' + pv.n + '.png', type: 'image/png', bytes: new Uint8Array(await pv.file.arrayBuffer()) });
  }
  for (const l of files.logos) {
    let bytes = new Uint8Array(await l.file.arrayBuffer());
    if (l.kind === 'svg') {
      const clean = sanitizeSvg(new TextDecoder().decode(bytes));
      if (!SVG_ROOT.test(clean)) throw new Reject(400, 'logo');
      bytes = new TextEncoder().encode(clean);
    }
    const file = 'logo-' + l.n + '.' + (l.kind === 'jpeg' ? 'jpg' : l.kind);
    out.push({ file: file, label: oneLine(l.file.name, 120) || file, type: LOGO_TYPES[l.kind], bytes: bytes });
  }
  return out;
}

// Previews first, then logos, while the total stays within the limit. A file that does not fit is skipped and
// a later, smaller one may still go in.
function pickAttachments(prepared, limit) {
  const attach = [];
  let used = 0;
  for (const f of prepared) {
    if (used + f.bytes.length > limit) continue;
    used += f.bytes.length;
    attach.push({ filename: f.file, type: f.type, bytes: f.bytes });
  }
  return attach;
}

async function storeR2(env, ref, when, parts, prepared) {
  const prefix = 'design-proofs/' + dayStamp(when) + '/' + ref + '/';
  const keys = [];
  const logos = [];
  const previews = [];
  const put = async (name, body, type) => {
    await env.PROOFS.put(prefix + name, body, { httpMetadata: { contentType: type } });
    keys.push(prefix + name);
  };
  try {
    if (parts.design) await put('design.json', JSON.stringify(parts.design), 'application/json; charset=utf-8');
    for (const f of prepared) {
      await put(f.file, f.bytes, f.type);
      if (f.file.startsWith('preview-')) previews.push(f.file);
      else logos.push({ file: f.file, name: f.label, type: f.type, bytes: f.bytes.length });
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
  return { keys: keys, logos: logos };
}

const toBase64 = (bytes) => bytesToBase64(bytes);

// The request, the design and the file details go in one row. Without R2, files that did not fit in the email
// are saved as base64 chunks (10 MB per request at most); the rest are only listed.
async function storeD1(env, ref, when, parts, prepared, attachNames, hasR2) {
  const db = await getDb(env);
  const stamp = when.toISOString();
  const meta = [];
  const chunks = [];
  let budget = D1_FILE_CAP;
  for (const f of prepared) {
    const info = { name: f.file, label: f.label, type: f.type, bytes: f.bytes.length, sha256: await sha256Hex(f.bytes), attached: attachNames.indexOf(f.file) >= 0, saved: hasR2 ? 'r2' : 'none' };
    if (!hasR2 && !info.attached && f.bytes.length <= budget) {
      budget -= f.bytes.length;
      info.saved = 'd1';
      for (let at = 0, seq = 0; at < f.bytes.length; at += D1_CHUNK, seq++) {
        chunks.push(db.prepare('INSERT INTO design_proof_files (ref, name, seq, type, bytes, data) VALUES (?, ?, ?, ?, ?, ?)').bind(ref, f.file, seq, f.type, f.bytes.length, toBase64(f.bytes.subarray(at, at + D1_CHUNK))));
      }
    }
    meta.push(info);
  }
  const wipe = () => db.prepare('DELETE FROM design_proof_files WHERE ref = ?').bind(ref).run().catch(() => {});
  try {
    for (let i = 0; i < chunks.length; i += 8) await db.batch(chunks.slice(i, i + 8));
  } catch (_) {
    await wipe();
    for (const m of meta) if (m.saved === 'd1') m.saved = 'none';
  }
  const record = Object.assign({ ref: ref, receivedAt: stamp }, parts.record, { files: meta });
  try {
    await db
      .prepare('INSERT INTO design_proof_requests (ref, created_at, updated_at, status, mode, customer_name, customer_email, request_json, design_json, files_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(ref, stamp, stamp, 'new', parts.record.mode, parts.record.name, parts.record.email, JSON.stringify(record), parts.design ? JSON.stringify(parts.design) : null, JSON.stringify(meta))
      .run();
  } catch (err) {
    await wipe();
    throw err;
  }
  return { saved: meta.filter((m) => m.saved === 'd1').map((m) => m.name) };
}

async function markEmail(env, ref, when, shop, customer, error) {
  try {
    const db = await getDb(env);
    await db
      .prepare('UPDATE design_proof_requests SET shop_email = ?, customer_email_status = ?, email_error = ?, updated_at = ? WHERE ref = ?')
      .bind(shop, customer, String(error || '').slice(0, 300), when.toISOString(), ref)
      .run();
  } catch (_) {
    console.error('design-proof status failed');
  }
}

// ---------- handler ----------

// "false" is the off switch, "true" forces on, anything else turns on once D1 and Brevo are both set up.
export function proofEnabled(env) {
  const flag = env.DESIGN_PROOF_ENABLED;
  if (flag === 'false') return false;
  if (flag === 'true') return true;
  return !!(env.DB && env.BREVO_API_KEY);
}

async function run(request, env, when, deps, options) {
  const orderRequired = !!(options && options.orderRequired);
  if (!proofEnabled(env) || (orderRequired && !env.DB)) return json({ ok: false, enabled: false }, 503);
  if (!env.PROOFS && !env.DB) throw new Reject(500, 'storage');
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
  if (who.mode === 'upload' && !files.logos.length) throw new Reject(400, 'logo');
  if (!files.previews.length && who.mode === 'self') throw new Reject(400, 'preview');
  const explicit = itemsFromRequest(req);
  const items = explicit || (design && env.DB ? itemsFromDesign(design) : null);
  if (orderRequired && !explicit) throw new Reject(400, 'order');

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
  if (items) record.order = { items: items.map((it) => ({ sku: it.sku, quantity: it.quantity, note: it.description || '' })) };

  const prepared = await prepareFiles(files);
  const primaryLimit = env.BREVO_API_KEY ? BREVO_ATTACH_LIMIT : ATTACH_LIMIT;
  const primaryNames = pickAttachments(prepared, primaryLimit).map((a) => a.filename);
  const parts = { design: design, record: record };

  let r2 = null;
  let d1 = null;
  if (env.PROOFS) {
    try {
      r2 = await storeR2(env, ref, when, parts, prepared);
    } catch (_) {
      console.error('design-proof storage failed');
    }
  }
  if (env.DB) {
    try {
      d1 = await storeD1(env, ref, when, parts, prepared, primaryNames, !!r2);
    } catch (_) {
      console.error('design-proof database failed');
    }
  }
  if (!r2 && !d1) throw new Reject(500, 'storage');

  let order = null;
  if (items && d1) {
    try {
      const made = await createPendingOrder(await getDb(env), { id: ref, email: who.contact.email, name: who.contact.name, items: items, notes: who.contact.notes }, when);
      if (made.order) order = { id: made.order.id, items: items, subtotal: made.subtotal, url: linksFor(baseUrl(request, env), made.order).order };
    } catch (_) {
      console.error('design-proof order failed');
    }
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
    keys: r2 ? r2.keys : [],
    logos: r2 ? r2.logos : [],
    fileNames: prepared.map((f) => f.file),
    d1: !!d1,
    d1Saved: d1 ? d1.saved : [],
    order: order,
  };
  let emailed = false;
  let confirmed = false;
  let shopStatus = 'skipped';
  let error = '';
  if (env.BREVO_API_KEY) {
    try {
      emailed = await sendBrevoMail(env, Object.assign({}, mail, { attach: pickAttachments(prepared, BREVO_ATTACH_LIMIT) }));
      shopStatus = 'sent';
    } catch (err) {
      console.error('design-proof email failed');
      shopStatus = 'failed';
      error = err.message;
    }
  }
  if (!emailed) {
    try {
      emailed = await sendMail(env, Object.assign({}, mail, { attach: pickAttachments(prepared, ATTACH_LIMIT) }), deps);
      if (emailed) shopStatus = 'sent';
    } catch (_) {
      console.error('design-proof email failed');
      shopStatus = 'failed';
    }
  }
  let customerStatus = 'skipped';
  if (emailed && env.BREVO_API_KEY) {
    try {
      await sendConfirmation(env, mail);
      confirmed = true;
      customerStatus = 'sent';
    } catch (err) {
      console.error('design-proof confirmation failed');
      customerStatus = 'failed';
      error = error || err.message;
    }
  }
  if (d1) await markEmail(env, ref, when, shopStatus, customerStatus, error);
  const answer = { ok: true, ref: ref, emailed: emailed, stored: true, serverTotal: serverTotal, priceMismatch: priceMismatch };
  if (env.BREVO_API_KEY) answer.confirmed = confirmed;
  if (order) answer.order = { id: order.id, url: order.url, subtotal: order.subtotal };
  return json(answer);
}

export async function handle(request, env, now, deps, options) {
  const when = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
  try {
    return await run(request, env, when, deps, options);
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
