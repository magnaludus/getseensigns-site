// Screenshots of every product (default template) in the Flat and 3D views at 1440x900 and 390x844.
// 3D uses the Front camera preset and reduced motion so the image is the same every run.
// Usage: node tests/e2e/shots.mjs [outDir]
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { startServer, launch, newPage, openDesigner, root } from './helpers.mjs';

const out = process.argv[2] || join(root, '.design-dev', 'out', 'shots');
mkdirSync(out, { recursive: true });
const catalog = JSON.parse(readFileSync(join(root, 'assets/design/catalog.json'), 'utf8'));
const server = await startServer();
const browser = await launch();
const failures = [];
try {
  for (const [kind, profile] of [['desktop', 'desktop'], ['phone', 'phone']]) {
    for (const product of catalog.products) {
      const { page, problems } = await newPage(browser, profile, { reducedMotion: 'reduce' });
      await openDesigner(page, server.base, `/design/${product.slug}/`);
      const shot = async (view) => {
        await page.evaluate(() => document.querySelector('.dz-app').scrollIntoView({ block: 'start' }));
        await page.waitForTimeout(400);
        const file = join(out, `${kind}-${product.slug}-${view}.png`);
        await page.screenshot({ path: file });
        if (statSync(file).size < 20000) failures.push(`${file} looks empty`);
      };
      await shot('flat');
      await page.getByRole('button', { name: '3D', exact: true }).click();
      await page.waitForFunction(() => window.GSSDesigner.view3d.stage || window.GSSDesigner.view3d.failed, null, { timeout: 20000 });
      await page.evaluate(() => { const s = window.GSSDesigner.view3d.stage; if (s) { s.setCameraPreset('front', { animate: false }); s.renderNow(); } });
      await page.waitForTimeout(1200);
      await shot('3d');
      const bad = problems.filter((p) => !/swiftshader|GPU stall|GL Driver/i.test(p));
      if (bad.length) failures.push(`${kind} ${product.slug}: ${bad.join(' | ')}`);
      await page.context().close();
      console.log('shot', kind, product.slug);
    }
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
