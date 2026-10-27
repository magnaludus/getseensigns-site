// The Terms of Service as the customer sees them on /terms: read from the live page, reduced to plain text,
// and hashed. The hash is shown on the proof form and recorded with the approval; the text itself is kept in
// terms_versions so the exact words behind any hash can be produced later.

import { sha256Hex, nowIso, SITE } from './util.js';
import { run } from './db.js';

export const TERMS_PATH = '/terms';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c', ndash: '\u2013', mdash: '\u2014' };

export function textOfMain(htmlText) {
  const m = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(htmlText);
  if (!m) return '';
  return m[1]
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|h[1-6]|li|div|tr|br)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:#(\d{1,6})|#x([0-9a-f]{1,5})|([a-z]+));/gi, (all, dec, hex, name) => {
      if (dec) return String.fromCodePoint(Number(dec));
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      return ENTITIES[name.toLowerCase()] != null ? ENTITIES[name.toLowerCase()] : all;
    })
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export function versionLabel(text) {
  const m = /Last updated:?\s*([A-Za-z]+ \d{1,2}, \d{4})/i.exec(text);
  return m ? m[1] : 'unlabeled';
}

export async function readTerms(request, env) {
  const url = new URL(TERMS_PATH, request.url);
  let res;
  if (env.ASSETS && typeof env.ASSETS.fetch === 'function') res = await env.ASSETS.fetch(url.toString());
  else res = await fetch(url.toString(), { headers: { Accept: 'text/html' } });
  if (!res || !res.ok) throw new Error('terms page unavailable');
  const text = textOfMain(await res.text());
  if (text.length < 200) throw new Error('terms text not found');
  return { text: text, hash: await sha256Hex(text), version: versionLabel(text), url: SITE + TERMS_PATH };
}

export async function rememberTerms(db, terms, now) {
  await run(db, 'INSERT OR IGNORE INTO terms_versions (hash, version_label, text, first_seen_at) VALUES (?, ?, ?, ?)', [terms.hash, terms.version, terms.text, nowIso(now)]);
}
