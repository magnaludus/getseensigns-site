// Screenshots of the table throw for the pull request: Flat and 3D (front, back, side) at 1440x900 and 390x844.
// Usage: node tests/e2e/shots-throw.mjs <outDir> [--size=6-3|6-4|8-3|8-4] [--filled]
//   --filled  puts a logo on the top and the business name on the back and both ends first (needs the quick-fill
//             buttons), so the shots show art on every panel.
// 3D uses reduced motion and a fixed camera so the images are the same every run.
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, launch, newPage, openDesigner, root } from './helpers.mjs';

// A made-up mark for the screenshots: a dark disc with a honeycomb cell. Not a real brand.
const MARK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><circle cx="100" cy="100" r="96" fill="#1F1A17"/><polygon points="100,38 154,69 154,131 100,162 46,131 46,69" fill="#F6C445"/><polygon points="100,70 127,86 127,114 100,130 73,114 73,86" fill="#1F1A17"/></svg>';

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--')) || join(root, '.design-dev', 'out', 'shots-throw');
const flag = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : def;
};
const size = flag('size', '6-3');
const filled = args.includes('--filled');
const [length, style] = size.split('-');
mkdirSync(out, { recursive: true });

const server = await startServer();
const browser = await launch();
const failures = [];
try {
  for (const kind of ['desktop', 'phone']) {
    const { page, problems } = await newPage(browser, kind, { reducedMotion: 'reduce' });
    await openDesigner(page, server.base, `/design/table-throw/?length=${length}&style=${style}`);
    // a tap on the phone profile, a click on the desktop one
    const press = (loc) => (kind === 'phone' ? loc.tap() : loc.click());
    if (filled) {
      // the first touch on the tools slides the editor up; do that first so the next tap lands where it aims
      await page.evaluate(() => document.querySelector('.dz-app').scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(500);
      // the logo frame goes on the top panel first, so the uploaded logo lands there and not on the front
      await press(page.locator('#dz-tab-sides'));
      await press(page.getByRole('button', { name: 'Logo on top' }));
      await press(page.locator('#dz-tab-logo'));
      await page.locator('.dz-file').setInputFiles({ name: 'mark.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(MARK) });
      await page.waitForTimeout(500);
      await press(page.locator('#dz-tab-sides'));
      await press(page.getByRole('button', { name: /Business name on/ }));
      await page.waitForTimeout(600);
      await page.evaluate(() => window.GSSDesigner.store.set({ view: { si: 0 } }));
    }
    const shot = async (name) => {
      // the "added" toast fades on its own; keep it out of the pictures
      await page.evaluate(() => { const t = document.querySelector('.dz-toast'); if (t) t.hidden = true; });
      await page.evaluate(() => document.querySelector('.dz-app').scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(500);
      const file = join(out, `${kind}-${size}-${name}.png`);
      await page.screenshot({ path: file });
      if (statSync(file).size < 20000) failures.push(`${file} looks empty`);
    };
    await shot('flat');
    if (kind === 'phone' && (await page.getByRole('button', { name: 'Whole flat' }).count())) {
      // on a phone the whole flat takes the place of the editor (older builds have no such button)
      await press(page.getByRole('button', { name: 'Whole flat' }));
      await shot('flat-whole');
      await press(page.getByRole('button', { name: 'Edit panel' }));
    }
    if (filled) {
      // each panel on its own, as the customer edits it
      for (const [i, name] of ['front', 'top', 'left', 'right', 'back'].entries()) {
        if (name === 'back' && style !== '4') continue;
        await page.evaluate((si) => window.GSSDesigner.store.set({ view: { si, mode: 'flat' } }), i);
        await shot(`panel-${name}`);
      }
      await page.evaluate(() => window.GSSDesigner.store.set({ view: { si: 0, mode: 'flat' } }));
    }
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await page.waitForFunction(() => window.GSSDesigner.view3d.stage || window.GSSDesigner.view3d.failed, null, { timeout: 20000 });
    for (const preset of ['front', 'back', 'side']) {
      await page.evaluate((p) => { const s = window.GSSDesigner.view3d.stage; if (s) { s.setCameraPreset(p, { animate: false }); s.renderNow(); } }, preset);
      await page.waitForTimeout(1200);
      await shot(`3d-${preset}`);
    }
    const bad = problems.filter((p) => !/swiftshader|GPU stall|GL Driver/i.test(p));
    if (bad.length) failures.push(`${kind}: ${bad.join(' | ')}`);
    await page.context().close();
    console.log('shot', kind, size);
  }
} finally {
  await browser.close();
  server.stop();
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('screenshots in', out);
