// The proof sheet: one 17 x 11 in landscape page, the same layout for every product (the reference proofs). This file
// turns what the tool knows about one piece into the sheet's HTML. Pure: no browser, no files, so the unit tests run
// it directly. cli.mjs renders the HTML with Chromium into a PNG at 200 dpi and a PDF.
//
//   header bar            Get Seen Signs - Proof for <customer>, <product> | Proof N | <date>, GET SEEN SIGNS at the right
//   left, about 60%       product title and quantity, a one-line description, the flat print art as the biggest thing
//                         on the page with its labels and dimension lines, and a line of sizes under it
//   top right             "How it looks set up": a SMALL mockup in a thin grey box and its caption
//   right, below          COLORS (a swatch, a name and a hex code for every printed color), NOTES
//   footer                beige, with the line about screen colors, and the red line about revisions

export const MOCKUP_HEADING = 'How it looks set up';
export const MOCKUP_CAPTION = 'Mockup for feel only. The flat art is what prints.';
export const FOOTER_NOTE = 'Colors on screen may vary slightly from print. Please review spelling and layout.';
export const revisionLine = (n) => `Proof ${n} of up to 3 free revisions. Reply "Approved" or send any changes.`;
export const FLAT_NOTE = 'Side and back art is turned on the flat so it reads right side up when the cover hangs.';
export const MOCKUP_MISSING = 'Mockup photo not added yet';
export const DRAPE_NOTE = 'Hatched corners wrap the table corners and carry no art.';
export const STRIP_NOTE = 'The short back strip is plain: a 3-sided throw is open at the back.';
export const SEAM_NOTE = 'Dashed line = roof/valance seam (proof only, does not print).';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2026-11-10" -> "Nov 10, 2026", the way the reference proofs write it. Anything else is left out.
export function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return '';
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : '';
}

export const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const fmt = (v) => (Math.abs(v - Math.round(v)) < 0.005 ? String(Math.round(v)) : String(Math.round(v * 100) / 100));
const inch = (v) => (v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10));
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

// Where a color is used, in the order the reference proofs name them.
const WHERE_ORDER = ['background', 'bars and blocks', 'text', 'logo'];

// Every printed color once: the colors the design uses, named from the brief where its hex matches, and the logo's own
// colors the brief lists. used: [{hex, where: [...]}] from the design. Returns [{hex, name, where: [...]}].
export function colorRows(used, palette, extra) {
  const names = new Map();
  for (const role of ['primary', 'accent', 'ink']) {
    const c = palette && palette[role];
    if (c && c.hex && !names.has(c.hex.toUpperCase())) names.set(c.hex.toUpperCase(), c.name);
  }
  for (const c of extra || []) if (c.hex && !names.has(c.hex.toUpperCase())) names.set(c.hex.toUpperCase(), c.name);
  const rows = new Map();
  const add = (hex, where) => {
    const key = hex.toUpperCase();
    if (!rows.has(key)) rows.set(key, { hex: key, name: names.get(key) || 'Color', where: [] });
    for (const w of where) if (!rows.get(key).where.includes(w)) rows.get(key).where.push(w);
  };
  for (const u of used || []) add(u.hex, u.where || []);
  for (const c of extra || []) add(c.hex, ['logo']);
  return [...rows.values()].map((r) => ({ ...r, where: WHERE_ORDER.filter((w) => r.where.includes(w)) }));
}

// The line or two of sizes under the art, like "Logo about 60 in wide | RHYTEC about 52 in wide | Not to scale".
export function captionLines(f) {
  if (f.panels) {
    return [
      'Panels as they read on the table: ' + f.panels.map((p) => `${p.name} ${fmt(p.w)} x ${fmt(p.h)} in`).join(' | '),
      [f.flat ? `Flat page ${fmt(f.flat.w)} x ${fmt(f.flat.h)} in` : null, 'To scale'].filter(Boolean).join(' | '),
    ];
  }
  const parts = [];
  if (f.size) parts.push(`About ${fmt(f.size.w)} x ${fmt(f.size.h)} in${f.sides > 1 ? (f.same ? ' per side' : ' each') : ''}`);
  if (f.valance_in) parts.push(`Valance ${fmt(f.valance_in)} in tall`);
  if (f.logos && f.logos.length) parts.push(`Logo about ${inch(f.logos[0].in_w)} in wide`);
  for (const w of f.words || []) parts.push(`${clip(w.text, 28)} about ${inch(w.in_w)} in wide`);
  parts.push(f.closeups ? 'Close-ups not to scale' : 'To scale');
  return [parts.join(' | ')];
}

// d: {customer, proofNo, date, title, qty, description, figures: [{svg, x, y, w, h, label, labelAbove}], caption: [lines],
//     colors: [{hex, name, where}], notes: [text], mockup: {dataUrl} | null}
export function buildSheetHtml(d) {
  const sub = [d.title, `Proof ${d.proofNo}`, formatDate(d.date)].filter(Boolean).join(' | ');
  const figs = (d.figures || []).map((f) => {
    const box = `left:${f.x}in;top:${f.y}in;width:${f.w}in;height:${f.h}in`;
    const text = f.label ? `<div class="figlabel" style="left:${f.x}in;width:${f.w}in;top:${f.labelAbove ? f.y - 0.28 : f.y + f.h + 0.02}in">${esc(f.label)}</div>` : '';
    return `<div class="fig" style="${box}">${f.svg}</div>${text}`;
  }).join('');
  const colors = (d.colors || []).map((c) => {
    const where = c.where && c.where.length ? ` (${esc(c.where.join(', '))})` : '';
    return `<div class="crow"><span class="sw" style="background:${esc(c.hex)}"></span><span>${esc(c.name)}${where} <b>${esc(c.hex)}</b></span></div>`;
  }).join('');
  const notes = (d.notes || []).map((t) => `<li>${esc(t)}</li>`).join('');
  const mockup = d.mockup && d.mockup.dataUrl
    ? `<img alt="Mockup" src="${esc(d.mockup.dataUrl)}">`
    : `<div class="ph">${esc(MOCKUP_MISSING)}</div>`;
  const caption = (d.caption || []).map((l) => `<div>${esc(l)}</div>`).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(`Proof for ${d.customer}`)}</title>
<style>
@font-face{font-family:'Barlow';font-weight:400;src:url(/assets/fonts/barlow-400.woff2) format('woff2')}
@font-face{font-family:'Barlow';font-weight:500;src:url(/assets/fonts/barlow-500.woff2) format('woff2')}
@font-face{font-family:'Barlow';font-weight:600;src:url(/assets/fonts/barlow-600.woff2) format('woff2')}
@font-face{font-family:'Barlow';font-weight:700;src:url(/assets/fonts/barlow-700.woff2) format('woff2')}
@font-face{font-family:'Barlow Condensed';font-weight:800;src:url(/assets/fonts/barlow-condensed-800.woff2) format('woff2')}
@font-face{font-family:'Barlow Condensed';font-weight:900;src:url(/assets/fonts/barlow-condensed-900.woff2) format('woff2')}
@font-face{font-family:'Oswald';font-weight:700;src:url(/assets/fonts/oswald-700.woff2) format('woff2')}
@font-face{font-family:'Archivo Black';font-weight:400;src:url(/assets/fonts/archivo-black-400.woff2) format('woff2')}
@page{size:17in 11in;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:17in;height:11in;background:#fff}
body{font-family:'Barlow',Arial,sans-serif;color:#14161A;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{position:relative;width:17in;height:11in;overflow:hidden;background:#fff}
.a{position:absolute}
.hdr{left:0;top:0;width:17in;height:1.15in;background:#14161A}
.hdr .t{position:absolute;left:.5in;top:.14in;width:12in;height:.5in;color:#fff;font-weight:700;font-size:28pt;line-height:.5in;white-space:nowrap;overflow:hidden}
.hdr .s{position:absolute;left:.5in;top:.68in;width:12in;height:.34in;color:#D9DBDF;font-weight:500;font-size:14pt;line-height:.34in;white-space:nowrap;overflow:hidden}
.hdr .w{position:absolute;right:.5in;top:.28in;height:.6in;color:#fff;font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:30pt;letter-spacing:.06em;line-height:.6in;white-space:nowrap}
.ptitle{left:.5in;top:1.36in;width:9.6in;height:.5in;font-weight:700;font-size:24pt;line-height:.5in;white-space:nowrap;overflow:hidden}
.pdesc{left:.5in;top:1.86in;width:9.6in;height:.44in;font-size:13.5pt;line-height:.22in;color:#3A3E45;overflow:hidden}
.hero{left:.5in;top:2.4in;width:9.6in;height:6.75in}
.fig{position:absolute}
.figlabel{position:absolute;text-align:center;font-weight:700;font-size:9.5pt;letter-spacing:.07em;color:#3A3E45;white-space:nowrap}
.caption{left:.5in;top:9.2in;width:9.6in;height:.68in;font-size:10.5pt;line-height:.2in;color:#3A3E45;overflow:hidden}
.mh{left:10.9in;top:1.36in;width:5.6in;height:.3in;font-weight:700;font-size:13pt}
.mbox{left:10.9in;top:1.75in;width:5.1in;height:3.2in;border:1px solid #B9BCC2;background:#F2F3F5;overflow:hidden}
.mbox img{width:100%;height:100%;object-fit:cover;display:block}
.mbox .ph{display:flex;height:100%;align-items:center;justify-content:center;text-align:center;color:#7A7F87;font-weight:600;font-size:12pt;padding:.3in}
.mcap{left:10.9in;top:4.98in;width:5.1in;height:.3in;font-size:9.5pt;font-style:italic;color:#5B5F66}
.low{left:10.9in;top:5.5in;width:5.6in;height:4.3in;display:flex;flex-direction:column}
.h3{font-weight:800;font-size:12pt;letter-spacing:.08em;margin-bottom:.07in}
.colors{margin-bottom:.16in}
.colors.two{display:grid;grid-template-columns:1fr 1fr;column-gap:.2in}
.crow{display:flex;align-items:center;height:.32in;font-size:12pt;white-space:nowrap}
.sw{width:.24in;height:.24in;border:1px solid #8D9097;margin-right:.12in;flex:none}
.notes{flex:1;min-height:0;overflow:hidden}
.notes ul{list-style:disc;margin-left:.2in;font-size:12pt;line-height:1.28}
.notes li{margin-bottom:.06in}
.ftr{left:0;top:9.95in;width:17in;height:1.05in;background:#E9E3D6}
.ftr .n{position:absolute;left:.5in;top:.2in;width:16in;font-size:12pt;color:#3A3E45}
.ftr .r{position:absolute;left:.5in;top:.55in;width:16in;font-size:15pt;font-weight:700;color:#C8102E}
</style></head>
<body><div class="sheet">
<div class="a hdr"><div class="t" id="t">${esc(`Get Seen Signs - Proof for ${d.customer}`)}</div><div class="s" id="s">${esc(sub)}</div><div class="w">GET SEEN SIGNS</div></div>
<div class="a ptitle" id="pt">${esc(`${d.title} (Qty ${d.qty})`)}</div>
<div class="a pdesc" id="pd">${esc(d.description)}</div>
<div class="a hero">${figs}</div>
<div class="a caption" id="cap">${caption}</div>
<div class="a mh">${esc(MOCKUP_HEADING)}</div>
<div class="a mbox">${mockup}</div>
<div class="a mcap">${esc(MOCKUP_CAPTION)}</div>
<div class="a low"><div class="h3">COLORS</div><div class="colors${(d.colors || []).length > 5 ? ' two' : ''}" id="colors">${colors}</div><div class="h3">NOTES</div><div class="notes" id="notes"><ul>${notes}</ul></div></div>
<div class="a ftr"><div class="n">${esc(FOOTER_NOTE)}</div><div class="r">${esc(revisionLine(d.proofNo))}</div></div>
</div>
<script>
(async () => {
  await Promise.all([...document.fonts].map((f) => f.load().catch(() => null)));
  await document.fonts.ready;
  const over = [];
  const size = (el) => parseFloat(getComputedStyle(el).fontSize);
  // one line that has to stay on one line: shrink to fit the width
  const fitW = (id, name) => { const el = document.getElementById(id); const min = size(el) * 0.55; let s = size(el); while (el.scrollWidth > el.clientWidth + 1 && s > min) { s -= 0.5; el.style.fontSize = s + 'px'; } if (el.scrollWidth > el.clientWidth + 1) over.push(name); };
  // a block that has to stay in its box: shrink to fit the height
  const fitH = (el, name, root) => { const min = size(root || el) * 0.6; let s = size(root || el); while (el.scrollHeight > el.clientHeight + 1 && s > min) { s -= 0.25; (root || el).style.fontSize = s + 'px'; } if (el.scrollHeight > el.clientHeight + 1) over.push(name); };
  fitW('t', 'header title'); fitW('s', 'header line'); fitW('pt', 'product title');
  fitH(document.getElementById('pd'), 'description');
  fitH(document.getElementById('cap'), 'sizes line');
  const notes = document.getElementById('notes'); fitH(notes, 'notes', notes.querySelector('ul'));
  window.__sheet = { overflow: over, text: document.body.innerText };
})();
</script></body></html>`;
}
