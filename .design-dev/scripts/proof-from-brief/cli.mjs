#!/usr/bin/env node
// Brief to proof pictures. Takes the brief the proof bot wrote and the customer's real logo files, builds the design in
// the Designer itself (headless Chromium, the real fonts), runs the Designer's own checks, and saves what the proof
// request would carry: design.json, the whole flat and one picture per panel, and a report.
// It never sends anything: every request that is not to the local copy of the site is refused, and so is /api.
//
//   node scripts/proof-from-brief/cli.mjs --brief reply.json --logos ./logos --out ./out/proof-1
//
// stdout is one JSON object (the result); progress and plain words go to stderr.
// Exit codes: 0 done, 1 bad brief or bad usage, 2 the reply was not "ready", 3 the render failed, 4 --strict and a check failed.
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, statSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { checkBrief, loadData, CHECK_KEYS, logoTypeOf, mockupTypeOf } from './brief.mjs';
import { buildSheetHtml, captionLines, colorRows, FLAT_NOTE, DRAPE_NOTE, STRIP_NOTE, SEAM_NOTE } from './sheet.mjs';
import { startServer, launch, newPage, openDesigner } from '../../tests/e2e/helpers.mjs';

const HELP = `Usage: node scripts/proof-from-brief/cli.mjs --brief <file.json> --out <dir> [--logos <dir>] [--mockups <dir>] [--no-sheet] [--strict]

  --brief    the bot's reply (the whole {status:"ready", brief:{...}} object) or just the brief
  --logos    a folder with the customer's logo files, named as in brief.logos (needed when the brief lists logos)
  --mockups  a folder with the mockup photos, named as in each piece's mockup_file (the sheet has an empty box without one)
  --out      where to write design.json, report.json, summary.txt, previews/ and the proof sheets (created if needed)
  --no-sheet skip the proof sheets (the 17 x 11 in PNG and PDF for each piece)
  --strict   exit 4 when any check fails or something needs a look

Nothing is sent anywhere. Needs Node, Python 3 (a local file server) and Chromium (Playwright).`;

const MAX_LOGO_BYTES = 25 * 1024 * 1024; // the Designer's own limit
const MAX_MOCKUP_BYTES = 15 * 1024 * 1024;
const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const log = (...a) => process.stderr.write(a.join(' ') + '\n');
// The result goes out whole before the process ends, even when stdout is a pipe.
function done(code, result) {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n', () => process.exit(code));
}

// width and height of a PNG from its header
const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

function readLogos(brief, dir) {
  const files = [];
  if (!brief.logos.length) return files;
  if (!dir) throw new Error('The brief lists logo files, so --logos <folder> is needed.');
  const base = resolve(dir) + sep;
  for (const l of brief.logos) {
    const path = resolve(dir, l.file);
    if (!path.startsWith(base)) throw new Error(`${l.file} is outside the logos folder.`);
    let size;
    try { size = statSync(path).size; } catch (_) { throw new Error(`Logo file ${l.file} is not in ${dir}.`); }
    if (size > MAX_LOGO_BYTES) throw new Error(`${l.file} is over 25 MB.`);
    files.push({ file: l.file, type: logoTypeOf(l.file), base64: readFileSync(path).toString('base64') });
  }
  return files;
}

// piece index -> data URL of its mockup photo
function readMockups(brief, dir) {
  const out = new Map();
  const need = brief.pieces.filter((p) => p.mockup_file);
  if (!need.length) return out;
  if (!dir) throw new Error('A piece names a mockup file, so --mockups <folder> is needed.');
  const base = resolve(dir) + sep;
  brief.pieces.forEach((p, i) => {
    if (!p.mockup_file) return;
    const path = resolve(dir, p.mockup_file);
    if (!path.startsWith(base)) throw new Error(`${p.mockup_file} is outside the mockups folder.`);
    let size;
    try { size = statSync(path).size; } catch (_) { throw new Error(`Mockup file ${p.mockup_file} is not in ${dir}.`); }
    if (size > MAX_MOCKUP_BYTES) throw new Error(`${p.mockup_file} is over 15 MB.`);
    out.set(i, `data:${mockupTypeOf(p.mockup_file)};base64,${readFileSync(path).toString('base64')}`);
  });
  return out;
}

// Each piece's sheet: the HTML from the art and the brief, rendered to a PNG at 200 dpi and a PDF, both 17 x 11 in.
// Nothing leaves this machine here either: only the local copy of the site (its fonts) is reachable.
async function renderSheets({ browser, server, blocked, brief, data, result, mockups, out }) {
  const done = [];
  const context = await browser.newContext({ viewport: { width: 1632, height: 1056 }, deviceScaleFactor: 3400 / 1632 });
  const url = `${server.base}/__proof-sheet.html`;
  let html = '';
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin === server.base && !u.pathname.startsWith('/api/')) return route.continue();
    blocked.push(`${route.request().method()} ${u.origin}${u.pathname}`);
    return route.abort();
  });
  await context.route(url, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  const page = await context.newPage();
  for (const sheet of result.sheets) {
    const piece = brief.pieces[sheet.piece];
    const product = data.catalog.products.find((p) => p.id === piece.product);
    const notes = brief.notes.slice();
    const has = (t) => notes.some((x) => x.trim().toLowerCase() === t.toLowerCase());
    if (sheet.facts.panels && !has(FLAT_NOTE)) notes.push(FLAT_NOTE);
    if (sheet.facts.drape && !has(DRAPE_NOTE)) notes.push(DRAPE_NOTE);
    if (sheet.facts.strip && !has(STRIP_NOTE)) notes.push(STRIP_NOTE);
    if (sheet.facts.valance_in && !has(SEAM_NOTE)) notes.push(SEAM_NOTE);
    if (brief.not_included.length) notes.push(`Not included: ${brief.not_included.join('; ')}.`);
    const figures = sheet.hero.figures;
    const facts = { ...sheet.facts, closeups: figures.some((f) => /close-up/i.test(f.label || '')) };
    html = buildSheetHtml({
      customer: brief.customer, proofNo: brief.proof_no, date: brief.date,
      title: piece.title || product.name, qty: piece.qty, description: piece.description,
      figures, caption: captionLines(facts), colors: colorRows(sheet.used_colors, brief.palette, brief.extra_colors), notes,
      mockup: mockups.has(sheet.piece) ? { dataUrl: mockups.get(sheet.piece) } : null,
    });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__sheet, null, { timeout: 30000 });
    const info = await page.evaluate(() => window.__sheet);
    const base = `proof-sheet-${sheet.piece + 1}-${slug(product.short)}`;
    await page.screenshot({ path: join(out, base + '.png') });
    await page.pdf({ path: join(out, base + '.pdf'), width: '17in', height: '11in', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' }, pageRanges: '1' });
    const size = pngSize(readFileSync(join(out, base + '.png')));
    done.push({ piece: sheet.piece, png: base + '.png', pdf: base + '.pdf', width: size.w, height: size.h, overflow: info.overflow, mockup: mockups.has(sheet.piece), notes, text: info.text });
  }
  await context.close();
  return done;
}

async function main() {
  let args;
  try {
    args = parseArgs({ options: { brief: { type: 'string' }, logos: { type: 'string' }, mockups: { type: 'string' }, out: { type: 'string' }, 'no-sheet': { type: 'boolean' }, strict: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } }).values;
  } catch (e) {
    log(e.message + '\n\n' + HELP);
    return done(1, { ok: false, stage: 'usage', errors: [{ path: 'args', message: e.message }] });
  }
  if (args.help) {
    log(HELP);
    return process.exit(0);
  }
  if (!args.brief || !args.out) {
    log(HELP);
    return done(1, { ok: false, stage: 'usage', errors: [{ path: 'args', message: '--brief and --out are required.' }] });
  }

  // ---- the brief ----
  let input;
  try {
    input = JSON.parse(readFileSync(args.brief, 'utf8'));
  } catch (e) {
    return done(1, { ok: false, stage: 'brief', errors: [{ path: args.brief, message: `Could not read the brief as JSON: ${e.message}` }] });
  }
  const data = loadData();
  const checked = checkBrief(input, data);
  if (!checked.ok) {
    for (const e of checked.errors) log(`brief: ${e.path}: ${e.message}`);
    return done(checked.notReady ? 2 : 1, { ok: false, stage: 'brief', status: checked.status, errors: checked.errors, warnings: checked.warnings });
  }
  const { brief } = checked;
  let logoFiles;
  let mockups = new Map();
  try {
    logoFiles = readLogos(brief, args.logos);
    if (!args['no-sheet']) mockups = readMockups(brief, args.mockups);
  } catch (e) {
    return done(1, { ok: false, stage: 'logos', errors: [{ path: 'logos', message: e.message }] });
  }

  // ---- the render ----
  const out = resolve(args.out);
  mkdirSync(join(out, 'previews'), { recursive: true });
  // pictures from an earlier run in the same folder would look like part of this one
  for (const f of readdirSync(join(out, 'previews'))) if (/^preview-\d+-.+\.png$/.test(f)) rmSync(join(out, 'previews', f));
  const product = data.catalog.products.find((p) => p.id === brief.pieces[0].product);
  const server = await startServer();
  const browser = await launch();
  const blocked = [];
  let result;
  let problems = [];
  let timer;
  let sheetsOut = [];
  try {
    const made = await newPage(browser, 'desktop');
    problems = made.problems;
    // nothing leaves this machine: only the local copy of the site is reachable, and not its /api
    await made.context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin === server.base && !url.pathname.startsWith('/api/')) return route.continue();
      blocked.push(`${route.request().method()} ${url.origin}${url.pathname}`);
      return route.abort();
    });
    await openDesigner(made.page, server.base, product.designPage);
    log(`building ${brief.pieces.length} piece${brief.pieces.length > 1 ? 's' : ''} for ${brief.customer} in the Designer`);
    result = await Promise.race([
      made.page.evaluate(async ({ b, l }) => (await import('/.design-dev/scripts/proof-from-brief/in-page.mjs')).run(b, l), { b: brief, l: logoFiles }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The render took over 2 minutes.')), 120000); }),
    ]);
    clearTimeout(timer);
    if (result.report.doc_valid.ok && !args['no-sheet']) {
      log('drawing the proof sheets');
      sheetsOut = await renderSheets({ browser, server, blocked, brief, data, result, mockups, out });
    }
  } catch (e) {
    log('render failed: ' + e.message);
    return done(3, { ok: false, stage: 'render', error: e.message, blocked_requests: blocked, page_problems: problems });
  } finally {
    clearTimeout(timer);
    await browser.close();
    server.stop();
  }

  // ---- the files ----
  if (!result.report.doc_valid.ok) {
    writeFileSync(join(out, 'design.json'), JSON.stringify(result.doc, null, 2) + '\n');
    log('the design this tool built fails the Designer\'s own validator: ' + result.report.doc_valid.errors.join(', '));
    return done(3, { ok: false, stage: 'validate', error: 'The built design fails validateDocument.', errors: result.report.doc_valid.errors.map((m) => ({ path: 'design', message: m })) });
  }
  const previews = result.previews.map((p) => {
    const buf = Buffer.from(p.base64, 'base64');
    writeFileSync(join(out, 'previews', p.file), buf);
    const { w, h } = pngSize(buf);
    return { file: `previews/${p.file}`, label: p.label, kind: p.kind, piece: p.piece, width: w, height: h };
  });
  writeFileSync(join(out, 'design.json'), JSON.stringify(result.doc, null, 2) + '\n');
  writeFileSync(join(out, 'brief.json'), JSON.stringify(brief, null, 2) + '\n');

  const r = result.report;
  // plain sentences for the bot and for Scott: what needs a look
  const attention = [];
  // the Designer's own words, minus its "(Left end panel)" tail (the panel leads the line) and minus the logo sharpness
  // line, which is written here with the numbers
  for (const w of r.warnings) if (w.kind !== 'dpi') attention.push(`${w.panel}: ${w.message.replace(/\s*\([^()]*\)\.?$/, '.')}`);
  for (const l of r.logos) {
    if (!l.vector && l.level !== 'green') attention.push(`${l.panel}: ${l.file} is about ${l.dpi} dpi at ${l.placed_in_w} in wide (green is ${l.green_min}+, amber ${l.amber_min}+). ${l.level === 'red' ? 'That is too low to print well.' : 'It may print soft.'}`);
  }
  for (const f of r.unplaced_fields) attention.push(`The ${f.field} "${f.value}" is not printed on any panel.`);
  for (const f of r.empty_logo_frames) attention.push(`${f.panel}: an empty logo frame, no logo was placed.`);
  for (const f of r.unused_logos) attention.push(`${f} is in the brief but is not on any panel.`);
  for (const m of r.manual) attention.push(`${m.panel}: needs a manual layout${m.note ? ` (${m.note})` : ''}. It is plain in these pictures.`);
  for (const l of r.logo_files) if (l.claimed_vector != null && l.vector != null && l.claimed_vector !== l.vector) attention.push(`${l.file}: the brief says ${l.claimed_vector ? 'vector' : 'raster'} but the file is ${l.vector ? 'vector' : 'raster'}.`);
  for (const sh of sheetsOut) {
    if (!sh.mockup) attention.push(`Proof sheet ${sh.piece + 1}: no mockup photo, so its mockup box is empty. Add the photo (mockup_file) before the sheet goes to a customer.`);
    for (const name of sh.overflow) attention.push(`Proof sheet ${sh.piece + 1}: the ${name} did not fit and is cut off. Shorten it.`);
    // a note that still hands a question to Scott is not ready for a customer
    for (const note of sh.notes.filter((t) => /to confirm|tbd|\?\s*$/i.test(t))) attention.push(`Proof sheet ${sh.piece + 1}: a note still has a question in it ("${note}"). Settle it before the sheet goes out.`);
  }

  const report = {
    ok: true,
    tool: 'proof-from-brief',
    customer: brief.customer,
    proof_no: brief.proof_no,
    date: brief.date,
    verdict: attention.length ? 'needs_attention' : 'clean',
    checks: Object.fromEntries(CHECK_KEYS.map((k) => [k, r.checks[k]])),
    attention,
    warnings: r.warnings,
    text_sizes: r.text_sizes,
    logos: r.logos,
    logo_files: r.logo_files,
    empty_logo_frames: r.empty_logo_frames,
    unplaced_fields: r.unplaced_fields,
    unused_logos: r.unused_logos,
    manual: r.manual,
    pieces: r.summary,
    previews,
    sheets: sheetsOut,
    brief_warnings: checked.warnings,
    blocked_requests: blocked,
    page_problems: problems.filter((p) => !/swiftshader|GPU stall|GL Driver/i.test(p)),
  };
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const lines = [];
  for (const p of r.summary) {
    lines.push(`${p.product}`);
    for (const s of p.sides) lines.push(`  ${s.name}${s.reads && s.reads !== 'upright on the flat' ? ` (${s.reads})` : ''}: ${s.text}`);
  }
  lines.push('', ...CHECK_KEYS.map((k) => `${k}: ${r.checks[k]}`), '', ...(attention.length ? ['Needs a look:', ...attention.map((a) => `  - ${a}`)] : ['Nothing needs a look.']));
  writeFileSync(join(out, 'summary.txt'), lines.join('\n') + '\n');

  log(`${previews.length} pictures, design.json and report.json are in ${out}`);
  log(`checks: ${CHECK_KEYS.map((k) => `${k} ${r.checks[k]}`).join(', ')}${attention.length ? `. ${attention.length} thing${attention.length > 1 ? 's' : ''} to look at.` : '.'}`);
  const failed = CHECK_KEYS.some((k) => r.checks[k] === 'fail') || attention.length > 0;
  return done(args.strict && failed ? 4 : 0, { ok: true, out, verdict: report.verdict, checks: report.checks, attention, files: ['design.json', 'brief.json', 'report.json', 'summary.txt', ...previews.map((p) => p.file), ...sheetsOut.flatMap((x) => [x.png, x.pdf])] });
}

main().catch((e) => {
  log('unexpected error: ' + (e && e.stack ? e.stack : e));
  done(3, { ok: false, stage: 'crash', error: String(e && e.message ? e.message : e) });
});
