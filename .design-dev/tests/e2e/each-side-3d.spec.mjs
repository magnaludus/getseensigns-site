// Acceptance 3: with "each side different" the canopy shows four different art panels in 3D, each
// on the side it belongs to.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, newPage, openDesigner } from './helpers.mjs';

const SIDES = [
  { name: 'Front', color: '#E02020', hue: 'red' },
  { name: 'Right', color: '#20B020', hue: 'green' },
  { name: 'Back', color: '#2020E0', hue: 'blue' },
  { name: 'Left', color: '#E020E0', hue: 'magenta' },
];

function hueOf([r, g, b]) {
  const max = Math.max(r, g, b);
  if (r - g > 40 && b - g > 40) return 'magenta';
  if (max === r && r - Math.max(g, b) > 40) return 'red';
  if (max === g && g - Math.max(r, b) > 40) return 'green';
  if (max === b && b - Math.max(r, g) > 40) return 'blue';
  return 'other';
}

// Looks at the tent from side i and returns the colour at two points on the roof.
async function sampleRoof(page, i) {
  await page.evaluate((i) => window.GSSDesigner.view3d.stage.focusSide(i, { animate: false }), i);
  await page.waitForTimeout(700);
  return page.evaluate(() => {
    const stage = window.GSSDesigner.view3d.stage;
    const c = stage.screenshot();
    const tmp = document.createElement('canvas');
    tmp.width = c.width;
    tmp.height = c.height;
    const g = tmp.getContext('2d', { willReadFrequently: true });
    g.drawImage(c, 0, 0);
    const at = (fx, fy) => [...g.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data].slice(0, 3);
    return { roof: at(0.5, 0.42), roof2: at(0.5, 0.36), valance: at(0.4, 0.56), state: stage.getState() };
  });
}

test('four different sides show on the four faces of the tent', async () => {
  const server = await startServer();
  const browser = await launch();
  try {
    const { page, problems } = await newPage(browser, 'desktop');
    await openDesigner(page, server.base, '/design/canopy-tent/');
    await page.locator('#dz-tab-sides').click();
    await page.getByRole('button', { name: 'Each side different' }).click();
    await page.evaluate(async (sides) => {
      const { setBackground, removeElements, getSide } = await import('/assets/design/model/document.js');
      const { store } = window.GSSDesigner;
      let doc = store.state.doc;
      sides.forEach((s, i) => {
        doc = setBackground(doc, 0, i, { type: 'solid', color: s.color });
        doc = removeElements(doc, 0, i, getSide(doc, 0, i).elements.map((e) => e.id));
      });
      store.commit(doc);
    }, SIDES);
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await page.waitForFunction(() => window.GSSDesigner.view3d.stage, null, { timeout: 15000 });
    for (let i = 0; i < 4; i++) {
      const seen = await sampleRoof(page, i);
      assert.equal(hueOf(seen.roof), SIDES[i].hue, `${SIDES[i].name} roof ${seen.roof}`);
      assert.equal(hueOf(seen.roof2), SIDES[i].hue, `${SIDES[i].name} roof (upper) ${seen.roof2}`);
    }
    assert.deepEqual(problems.filter((p) => !/swiftshader|GPU stall|GL Driver/i.test(p)), []);
    await page.context().close();
  } finally {
    await browser.close();
    server.stop();
  }
});

test('edits made in Flat show up when the 3D view is opened again', async () => {
  const server = await startServer();
  const browser = await launch();
  try {
    const { page, problems } = await newPage(browser, 'desktop');
    await openDesigner(page, server.base, '/design/canopy-tent/');
    const paint = (color) => page.evaluate(async (color) => {
      const { setBackground, removeElements, getSide } = await import('/assets/design/model/document.js');
      const { store } = window.GSSDesigner;
      let doc = setBackground(store.state.doc, 0, 0, { type: 'solid', color });
      doc = removeElements(doc, 0, 0, getSide(doc, 0, 0).elements.map((e) => e.id));
      store.commit(doc);
    }, color);
    await paint('#E02020');
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await page.waitForFunction(() => window.GSSDesigner.view3d.stage, null, { timeout: 15000 });
    assert.equal(hueOf((await sampleRoof(page, 0)).roof), 'red');
    await page.getByRole('button', { name: 'Flat', exact: true }).click();
    await paint('#20B020');
    await page.getByRole('button', { name: '3D', exact: true }).click();
    assert.equal(hueOf((await sampleRoof(page, 0)).roof), 'green', 'the tent should show the colour chosen while the 3D view was closed');
    assert.deepEqual(problems.filter((p) => !/swiftshader|GPU stall|GL Driver/i.test(p)), []);
    await page.context().close();
  } finally {
    await browser.close();
    server.stop();
  }
});
