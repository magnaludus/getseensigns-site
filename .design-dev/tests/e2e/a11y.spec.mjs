// Accessibility: axe-core scans of the picker, every tool tab, the dialogs and the 3D view, plus a
// keyboard-only run (select, move, resize, send).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer, launch, newPage, openDesigner } from './helpers.mjs';

const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core/axe.min.js');

async function scan(page, label, context) {
  await page.addScriptTag({ path: axePath });
  const result = await page.evaluate(async (ctx) => {
    const res = await window.axe.run(ctx ? document.querySelector(ctx) : document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
    return res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 4).map((n) => n.target.join(' ') + ' :: ' + (n.failureSummary || '').split('\n').slice(1, 3).join(' ')) }));
  }, context || null);
  const bad = result.filter((v) => v.impact === 'serious' || v.impact === 'critical' || v.impact === 'moderate');
  if (bad.length) console.log(`axe ${label}:`, JSON.stringify(bad, null, 1));
  return bad;
}

test('axe: picker, editor, every tab, dialogs', async () => {
  const server = await startServer();
  const browser = await launch();
  try {
    const { page } = await newPage(browser, 'desktop');
    await openDesigner(page, server.base, '/design/');
    assert.deepEqual(await scan(page, 'hub page'), []);
    await page.locator('.dz-card').first().click();
    await page.waitForURL('**/design/canopy-tent/');
    await page.waitForFunction(() => window.GSSDesigner && window.GSSDesigner.ready && document.querySelector('.dz-app'));
    assert.deepEqual(await scan(page, 'editor'), []);
    for (const id of ['text', 'logo', 'colors', 'options', 'sides', 'layers', 'templates']) {
      await page.locator(`#dz-tab-${id}`).click();
      assert.deepEqual(await scan(page, 'tab ' + id, '.dz-app'), [], id);
    }
    // with a selection (handles and toolbar visible)
    const box = await page.locator('.dz-stage').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.45);
    assert.deepEqual(await scan(page, 'selection', '.dz-app'), []);
    await page.getByRole('button', { name: 'Get my free proof' }).first().click();
    await page.getByRole('heading', { name: 'Check your design' }).waitFor();
    assert.deepEqual(await scan(page, 'review dialog', 'dialog'), []);
    await page.getByRole('button', { name: 'Continue' }).click();
    assert.deepEqual(await scan(page, 'contact dialog', 'dialog'), []);
    await page.context().close();
  } finally {
    await browser.close();
    server.stop();
  }
});

test('axe: 3D view and phone layout', async () => {
  const server = await startServer();
  const browser = await launch();
  try {
    for (const profile of ['phone', 'pixel7', 'iphone']) {
      const { page } = await newPage(browser, profile);
      await openDesigner(page, server.base, '/design/feather-flag/');
      assert.deepEqual(await scan(page, `flat ${profile}`, '.dz-app'), []);
      await page.getByRole('button', { name: '3D', exact: true }).tap();
      await page.waitForFunction(() => window.GSSDesigner.view3d.stage || window.GSSDesigner.view3d.failed, null, { timeout: 15000 });
      await page.waitForTimeout(500);
      assert.deepEqual(await scan(page, `3d ${profile}`, '.dz-app'), []);
      await page.context().close();
    }
  } finally {
    await browser.close();
    server.stop();
  }
});

test('keyboard only: select, move, resize an element and send a proof', async () => {
  const server = await startServer();
  const browser = await launch();
  try {
    const { page } = await newPage(browser, 'desktop', { acceptDownloads: true });
    await page.route('**/api/design-proof', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"enabled":false}' }));
    await openDesigner(page, server.base, '/design/vinyl-banner/');
    await page.evaluate(() => { window.GSSDesigner.noNavigate = true; });
    const state = () => page.evaluate(() => {
      const { store } = window.GSSDesigner;
      const side = store.side();
      const sel = store.state.selection[0];
      const el = side.elements.find((e) => e.id === sel);
      return { sel, x: el && el.x, y: el && el.y, size: el && el.size, name: el && el.name };
    });
    // focus the stage by keyboard
    await page.locator('.dz-stage').focus();
    await page.keyboard.press('Tab');
    let s = await state();
    assert.ok(s.sel, 'Tab selects the first element');
    // Tab through to the headline
    for (let i = 0; i < 8 && s.name !== 'Name'; i++) {
      await page.locator('.dz-stage').focus();
      await page.keyboard.press('Tab');
      s = await state();
    }
    assert.equal(s.name, 'Name');
    const before = await state();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('+');
    const after = await state();
    assert.ok(after.x < before.x + 0.25 + 3 && after.y > before.y + 0.5, 'moved with arrow keys');
    assert.ok(after.size > before.size, 'resized with plus');
    // the live region announced the selection
    assert.match(await page.locator('.dz-live').textContent(), /inches/);
    // send, mouse-free
    await page.locator('.dz-aside button', { hasText: 'Get my free proof' }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Check your design' }).waitFor();
    await page.getByRole('button', { name: 'Continue' }).focus();
    await page.keyboard.press('Enter');
    await page.locator('input[autocomplete="name"]').focus();
    await page.keyboard.type('Key Board');
    await page.keyboard.press('Tab');
    await page.keyboard.type('keys@example.com');
    const dl = page.waitForEvent('download');
    await page.keyboard.press('Enter');
    await dl;
    await page.getByRole('heading', { name: 'One more step to send it' }).waitFor();
    await page.context().close();
  } finally {
    await browser.close();
    server.stop();
  }
});
