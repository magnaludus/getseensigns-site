// Fakes and builders for functions.test.mjs: an in-memory R2 bucket, a SEND_EMAIL that keeps what it is
// given, multipart requests like the designer sends, and a small MIME reader.

export const IP = '203.0.113.7';
export const UA = 'Mozilla/5.0 (test browser)';

export function fakeR2(opts) {
  const failOn = (opts && opts.failOn) || null;
  const objects = new Map();
  const order = [];
  const bucket = {
    objects,
    order,
    async put(key, body, options) {
      if (failOn && failOn(key)) throw new Error('R2 is down');
      let bytes;
      if (typeof body === 'string') bytes = new TextEncoder().encode(body);
      else if (body instanceof ArrayBuffer) bytes = new Uint8Array(body);
      else if (ArrayBuffer.isView(body)) bytes = new Uint8Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
      else bytes = new Uint8Array(await body.arrayBuffer());
      objects.set(key, { bytes, options });
      order.push(key);
    },
    async delete(keys) {
      for (const key of [].concat(keys)) objects.delete(key);
    },
    keys: () => [...objects.keys()].sort(),
    bytes: (key) => objects.get(key).bytes,
    text: (key) => new TextDecoder().decode(objects.get(key).bytes),
    json: (key) => JSON.parse(bucket.text(key)),
    type: (key) => objects.get(key).options.httpMetadata.contentType,
  };
  return bucket;
}

// What cloudflare:email provides in a Worker; the tests hand this class to the function.
export class FakeEmailMessage {
  constructor(from, to, raw) {
    this.from = from;
    this.to = to;
    this.raw = raw;
  }
}

export function fakeMail(opts) {
  const fail = opts && opts.fail;
  return {
    sent: [],
    async send(message) {
      if (fail) throw new Error('mail is down');
      this.sent.push(message);
    },
  };
}

export const DEPS = { EmailMessage: FakeEmailMessage };

export function bytesOf(kind, size) {
  const heads = {
    png: [137, 80, 78, 71, 13, 10, 26, 10],
    jpeg: [255, 216, 255, 224],
    webp: [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80],
    gif: [71, 73, 70, 56, 57, 97],
    pdf: [37, 80, 68, 70, 45],
  };
  const out = new Uint8Array(Math.max(size, heads[kind].length));
  out.set(heads[kind]);
  for (let i = heads[kind].length; i < out.length; i++) out[i] = (i * 31) & 255;
  return out;
}

export const png = (size) => bytesOf('png', size || 400);

export function file(bytes, name, type) {
  return new File([bytes], name, { type });
}

export const pngFile = (n, size) => file(png(size), 'preview-' + n + '.png', 'image/png');

// Builds the multipart body. `parts` may hold design (object or string), request (object or string),
// previews and logos (arrays of Files, numbered from 0), gotcha and extra [name, value] pairs.
export function formOf(parts) {
  const fd = new FormData();
  if (parts.design !== undefined) fd.set('design', typeof parts.design === 'string' ? parts.design : JSON.stringify(parts.design));
  if (parts.request !== undefined) fd.set('request', typeof parts.request === 'string' ? parts.request : JSON.stringify(parts.request));
  (parts.previews || []).forEach((f, n) => fd.set('preview-' + n, f));
  (parts.logos || []).forEach((f, n) => fd.set('logo-' + n, f));
  if (parts.gotcha !== undefined) fd.set('_gotcha', parts.gotcha);
  for (const [key, value] of parts.extra || []) fd.append(key, value);
  return fd;
}

// A header set to null is left out.
function withHeaders(base, extra) {
  const out = Object.assign({ 'cf-connecting-ip': IP, 'user-agent': UA, cookie: 'session=secret-cookie' }, base, extra);
  for (const key of Object.keys(out)) if (out[key] == null) delete out[key];
  return out;
}

export function postOf(form, headers) {
  return new Request('https://getseensignsco.com/api/design-proof', { method: 'POST', body: form, headers: withHeaders({}, headers) });
}

export function jsonPost(body, headers) {
  return new Request('https://getseensignsco.com/api/design-event', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: withHeaders({ 'content-type': 'text/plain;charset=UTF-8' }, headers),
  });
}

// Reads the raw message the function handed to EmailMessage.
export function readMime(raw) {
  const splitHead = (block) => {
    const at = block.indexOf('\r\n\r\n');
    return [block.slice(0, at), block.slice(at + 4)];
  };
  const headersOf = (head) => {
    const out = {};
    for (const line of head.split('\r\n')) out[line.slice(0, line.indexOf(':')).toLowerCase()] = line.slice(line.indexOf(':') + 1).trim();
    return out;
  };
  const decode = (b64) => Buffer.from(b64.replace(/\s+/g, ''), 'base64');
  const [head, body] = splitHead(raw);
  const headers = headersOf(head);
  if (!/^multipart\/mixed/.test(headers['content-type'])) {
    return { headerNames: head.split('\r\n').map((l) => l.slice(0, l.indexOf(':')).toLowerCase()), headers, text: decode(body).toString('utf8'), attachments: [], multipart: false };
  }
  const boundary = /boundary="([^"]+)"/.exec(headers['content-type'])[1];
  const parts = body.split('--' + boundary).slice(1, -1).map((p) => splitHead(p.replace(/^\r\n/, '')));
  const [textHead, textBody] = parts[0];
  const attachments = parts.slice(1).map(([partHead, partBody]) => {
    const h = headersOf(partHead);
    return { filename: /filename="([^"]*)"/.exec(h['content-disposition'])[1], type: h['content-type'].split(';')[0], bytes: decode(partBody) };
  });
  return {
    headerNames: head.split('\r\n').map((l) => l.slice(0, l.indexOf(':')).toLowerCase()),
    headers,
    text: decode(textBody).toString('utf8'),
    textType: headersOf(textHead)['content-type'],
    attachments,
    multipart: true,
  };
}

export function decodeSubject(subject) {
  const m = /^=\?UTF-8\?B\?([^?]+)\?=$/.exec(subject);
  return m ? Buffer.from(m[1], 'base64').toString('utf8') : subject;
}

// Collects console output so tests can prove nothing personal is logged.
export function spyConsole() {
  const seen = [];
  const saved = {};
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    saved[level] = console[level];
    console[level] = (...args) => seen.push(args.map(String).join(' '));
  }
  return {
    seen,
    restore() {
      for (const level of Object.keys(saved)) console[level] = saved[level];
    },
  };
}
