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
// 5. Redeploy. Visit nothing special: the design form will POST here.
//
// Stored keys (private bucket):
//   design-proofs/YYYY-MM-DD/<id>/design.json
//   design-proofs/YYYY-MM-DD/<id>/preview.png
//   design-proofs/YYYY-MM-DD/<id>/logo   (only if a logo was uploaded)
//   design-proofs/YYYY-MM-DD/<id>/request.json
// The email is a text summary plus those keys. Preview and logo are attached
// when together they are under 1.5 MB and SEND_EMAIL is bound.

const MAX_PREVIEW = 6 * 1024 * 1024;
const MAX_LOGO = 8 * 1024 * 1024;
const MAX_JSON = 100000;
const ATTACH_LIMIT = 1500000;

function json(body, status) {
  return Response.json(body, { status: status || 200 });
}

function oneLine(value, max) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max || 500);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 200;
}

function dayStamp(d) {
  return d.toISOString().slice(0, 10);
}

function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function encodeHeader(value) {
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

async function fileBytes(file, limit) {
  if (!file || typeof file.arrayBuffer !== 'function' || !file.size) return null;
  if (file.size > limit) return { error: 'too-large', size: file.size };
  const buf = new Uint8Array(await file.arrayBuffer());
  return { bytes: buf, type: file.type || 'application/octet-stream', name: oneLine(file.name || 'upload', 180) };
}

function summaryText(fields, id, prefix) {
  let design = {};
  try { design = JSON.parse(fields.design); } catch (_) { design = {}; }
  const lines = [
    'Design preview request',
    'Reference: ' + id,
    '',
    'Name: ' + fields.name,
    'Email: ' + fields.email,
    'Phone: ' + fields.phone,
    'Notes: ' + (fields.notes || '-'),
    '',
    'Product: ' + (design.product || '-'),
    'Option: ' + (design.option || '-'),
    'Price shown: ' + (design.priceText || '-'),
    'Template: ' + (design.template || '-'),
    'Font: ' + (design.font || '-'),
    'Colors: ' + ((design.colors || []).join(', ') || '-'),
    'Sides: ' + (design.sidesMode || '-'),
  ];
  (design.sides || []).forEach(function (side) {
    lines.push((side.name || 'Text') + ': ' + (side.headline || '-') + ' / ' + (side.secondary || '-'));
  });
  if (design.logoFileName) lines.push('Logo file: ' + design.logoFileName);
  lines.push('', 'Files in R2:', prefix + 'design.json', prefix + 'preview.png');
  if (fields.logoStored) lines.push(prefix + 'logo');
  lines.push('', 'This is a preview, not the print file. Reply with the free proof.');
  return lines.join('\n');
}

async function sendMail(env, fields, id, prefix, preview, logo) {
  if (!env.SEND_EMAIL || !env.DESIGN_PROOF_TO || !env.DESIGN_PROOF_FROM) return false;
  const to = oneLine(env.DESIGN_PROOF_TO, 200);
  const from = oneLine(env.DESIGN_PROOF_FROM, 200);
  if (!validEmail(to) || !validEmail(from)) return false;
  let EmailMessage;
  try {
    EmailMessage = (await import('cloudflare:email')).EmailMessage;
  } catch (_) {
    return false;
  }
  const text = summaryText(fields, id, prefix);
  const attach = [];
  let attachBytes = 0;
  if (preview && preview.bytes) {
    attachBytes += preview.bytes.length;
    attach.push({ filename: 'preview.png', type: 'image/png', bytes: preview.bytes });
  }
  if (logo && logo.bytes && attachBytes + logo.bytes.length <= ATTACH_LIMIT) {
    attach.push({ filename: logo.name || 'logo', type: logo.type || 'application/octet-stream', bytes: logo.bytes });
    attachBytes += logo.bytes.length;
  }
  const useAttach = attach.length && attachBytes <= ATTACH_LIMIT;
  let raw;
  const subject = encodeHeader('Design proof request: ' + (fields.productName || 'sign') + ' (' + fields.name + ')');
  if (!useAttach) {
    raw = [
      'From: ' + from,
      'To: ' + to,
      'Reply-To: ' + fields.email,
      'Subject: ' + subject,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      text,
    ].join('\r\n');
  } else {
    const boundary = 'seen' + id.replace(/[^a-zA-Z0-9]/g, '');
    const parts = [
      'From: ' + from,
      'To: ' + to,
      'Reply-To: ' + fields.email,
      'Subject: ' + subject,
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="' + boundary + '"',
      '',
      '--' + boundary,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      text,
    ];
    attach.forEach(function (file) {
      parts.push(
        '--' + boundary,
        'Content-Type: ' + file.type + '; name="' + encodeHeader(file.filename) + '"',
        'Content-Transfer-Encoding: base64',
        'Content-Disposition: attachment; filename="' + encodeHeader(file.filename) + '"',
        '',
        wrapBase64(bytesToBase64(file.bytes))
      );
    });
    parts.push('--' + boundary + '--', '');
    raw = parts.join('\r\n');
  }
  await env.SEND_EMAIL.send(new EmailMessage(from, to, raw));
  return true;
}

async function handle(request, env) {
  if (env.DESIGN_PROOF_ENABLED !== 'true') {
    return json({ ok: false, enabled: false }, 503);
  }
  if (!env.PROOFS) return json({ ok: false, error: 'storage' }, 500);

  const length = Number(request.headers.get('content-length') || 0);
  if (length && length > MAX_PREVIEW + MAX_LOGO + MAX_JSON) return json({ ok: false, error: 'too-large' }, 413);

  let form;
  try { form = await request.formData(); }
  catch (_) { return json({ ok: false, error: 'form' }, 400); }

  if (oneLine(form.get('_gotcha'), 80)) return json({ ok: true, emailed: true });

  const name = oneLine(form.get('name'), 200);
  const email = oneLine(form.get('email'), 200);
  const phone = oneLine(form.get('phone'), 40);
  const notes = oneLine(form.get('notes'), 4000);
  const designRaw = String(form.get('design') || '');
  if (!name || !validEmail(email) || phone.length < 7 || !designRaw || designRaw.length > MAX_JSON) {
    return json({ ok: false, error: 'fields' }, 400);
  }
  let design;
  try { design = JSON.parse(designRaw); }
  catch (_) { return json({ ok: false, error: 'design' }, 400); }

  const preview = await fileBytes(form.get('preview'), MAX_PREVIEW);
  if (!preview || preview.error || !preview.bytes) return json({ ok: false, error: preview && preview.error === 'too-large' ? 'too-large' : 'preview' }, preview && preview.error === 'too-large' ? 413 : 400);
  if (preview.type && preview.type !== 'image/png') return json({ ok: false, error: 'preview' }, 400);

  const logoFile = form.get('logo');
  let logo = null;
  if (logoFile && typeof logoFile === 'object' && logoFile.size) {
    logo = await fileBytes(logoFile, MAX_LOGO);
    if (!logo || logo.error) return json({ ok: false, error: logo && logo.error === 'too-large' ? 'too-large' : 'logo' }, logo && logo.error === 'too-large' ? 413 : 400);
    if (logo.type && logo.type.indexOf('image/') !== 0) return json({ ok: false, error: 'logo' }, 400);
  }

  const id = crypto.randomUUID();
  const prefix = 'design-proofs/' + dayStamp(new Date()) + '/' + id + '/';
  const requestRecord = {
    id: id,
    receivedAt: new Date().toISOString(),
    name: name,
    email: email,
    phone: phone,
    notes: notes,
    design: design,
  };
  await env.PROOFS.put(prefix + 'design.json', JSON.stringify(design), { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
  await env.PROOFS.put(prefix + 'request.json', JSON.stringify(requestRecord), { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
  await env.PROOFS.put(prefix + 'preview.png', preview.bytes, { httpMetadata: { contentType: 'image/png' } });
  if (logo) {
    await env.PROOFS.put(prefix + 'logo', logo.bytes, { httpMetadata: { contentType: logo.type || 'application/octet-stream' } });
  }

  const fields = {
    name: name,
    email: email,
    phone: phone,
    notes: notes,
    design: designRaw,
    productName: oneLine(design.product, 120),
    logoStored: !!logo,
  };
  let emailed = false;
  try { emailed = await sendMail(env, fields, id, prefix, preview, logo); }
  catch (err) { console.error('design-proof email failed'); emailed = false; }

  return json({ ok: true, emailed: emailed, id: id, stored: true });
}

export async function onRequestPost(context) {
  try {
    return await handle(context.request, context.env);
  } catch (err) {
    console.error('design-proof failed');
    return json({ ok: false, error: 'server' }, 500);
  }
}
