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
import { checkBrief, loadData, CHECK_KEYS, logoTypeOf } from './brief.mjs';
import { startServer, launch, newPage, openDesigner } from '../../tests/e2e/helpers.mjs';

const HELP = `Usage: node scripts/proof-from-brief/cli.mjs --brief <file.json> --out <dir> [--logos <dir>] [--strict]

  --brief   the bot's reply (the whole {status:"ready", brief:{...}} object) or just the brief
  --logos   a folder with the customer's logo files, named as in brief.logos (needed when the brief lists logos)
  --out     where to write design.json, report.json, summary.txt and previews/ (created if needed)
  --strict  exit 4 when any check fails or something needs a look

Nothing is sent anywhere. Needs Node, Python 3 (a local file server) and Chromium (Playwright).`;

const MAX_LOGO_BYTES = 25 * 1024 * 1024; // the Designer's own limit

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

async function main() {
  let args;
  try {
    args = parseArgs({ options: { brief: { type: 'string' }, logos: { type: 'string' }, out: { type: 'string' }, strict: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } }).values;
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
  try {
    logoFiles = readLogos(brief, args.logos);
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
  return done(args.strict && failed ? 4 : 0, { ok: true, out, verdict: report.verdict, checks: report.checks, attention, files: ['design.json', 'brief.json', 'report.json', 'summary.txt', ...previews.map((p) => p.file)] });
}

main().catch((e) => {
  log('unexpected error: ' + (e && e.stack ? e.stack : e));
  done(3, { ok: false, stage: 'crash', error: String(e && e.message ? e.message : e) });
});
