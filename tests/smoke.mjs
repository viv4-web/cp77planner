// Browser smoke suite (Playwright, dev dependency only). Run: npm run smoke   (or: python3 tests/run.py, which includes it when installed)
// Builds dist/live, serves it on a throwaway local port, and drives the real page. No network beyond localhost.
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}/`;

const build = spawnSync('python3', ['tools/build.py'], { cwd: ROOT, encoding: 'utf8' });
assert.equal(build.status, 0, build.stderr);
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '-d', 'dist/live'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

const browser = await chromium.launch();
const results = [];
async function t(name, fn, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  page.on('request', (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith('data:')) problems.push(`external request: ${r.url()}`); });
  try {
    await fn(page);
    assert.deepEqual(problems, [], 'console errors or external requests');
    results.push([name, true]);
  } catch (e) {
    results.push([name, false, e.message.split('\n')[0]]);
  } finally { await ctx.close(); }
}

const capText = (page) => page.locator('#cw-summary .cap-top b').innerText();
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

await t('loads the Character screen', async (page) => {
  await page.goto(BASE);
  await page.waitForSelector('#c-rail .acard');
  assert.match(await page.locator('#c-title').innerText(), /LEVEL 1/i);
});

await t('pick an implant: socket fills and capacity updates', async (page) => {
  await page.goto(`${BASE}?tab=cyberware`);
  await page.waitForSelector('.sock');
  assert.equal((await capText(page)).replace(/\s/g, ''), '0/12');
  await page.click('.sock[data-key="700.0"]');
  await page.click('.cw-row[data-imp="710"]');
  assert.equal(await page.locator('.sock[data-key="700.0"]').getAttribute('data-s'), 'filled');
  assert.equal((await capText(page)).replace(/\s/g, ''), '2/12');
  await page.click('.cw-remove');
  assert.equal((await capText(page)).replace(/\s/g, ''), '0/12');
});

await t('over-capacity implants are disabled with a reason', async (page) => {
  await page.goto(`${BASE}?tab=cyberware`);
  for (const [key, imp] of [['700.0', 712], ['702.0', 718]]) {          // 6 + 6 fills the sample capacity of 12 exactly
    await page.click(`.sock[data-key="${key}"]`);
    await page.click(`.cw-row[data-imp="${imp}"]`);
  }
  assert.equal((await capText(page)).replace(/\s/g, ''), '12/12');
  assert.equal(await page.locator('#cw-summary .capbar').getAttribute('data-state'), 'full');
  await page.click('.sock[data-key="705.0"]');
  const disabled = page.locator('.cw-row:disabled').first();
  await disabled.waitFor();
  assert.equal(await disabled.getAttribute('aria-disabled'), 'true');
  assert.match(await disabled.locator('.cw-reason').innerText(), /over capacity/i);
});

await t('Character changes recompute Cyberware live (level -> capacity)', async (page) => {
  await page.goto(BASE);
  await page.fill('#c-level', '40');
  await page.click('.tab[data-tab=cyberware]');
  const hi = (await capText(page)).replace(/\s/g, '');
  assert.equal(hi, '0/32');
});

await t('copy build link includes the loadout and it restores', async (page) => {
  await page.goto(`${BASE}?tab=cyberware`);
  await page.click('.sock[data-key="700.0"]');
  await page.click('.cw-row[data-imp="711"]');
  await page.click('#copy-btn');
  const link = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(link, /[?&]b=2\./);
  assert.match(link, /tab=cyberware/);
  await page.goto(link);
  await page.waitForSelector('.sock');
  assert.equal(await page.locator('.sock[data-key="700.0"]').getAttribute('data-s'), 'filled');
  assert.equal((await capText(page)).replace(/\s/g, ''), '4/12');
});

await t('old v1 links still load', async (page) => {
  await page.goto(`${BASE}?b=1.EQkDDAQUBX0BAQQC`);
  await page.waitForSelector('#c-rail .acard');
  const lv = Number(/LEVEL (\d+)/i.exec(await page.locator('#c-title').innerText())[1]);
  assert.ok(lv >= 17, 'level raised to pay for the attributes in the link');
  assert.equal(await page.locator('.acard[data-k=cool] .val').innerText().then((x) => x.split('/')[0].trim()), '20');
});

await t('390px: no horizontal scroll, picker opens as a sheet, compact bar visible', async (page) => {
  await page.goto(`${BASE}?tab=cyberware`);
  await page.waitForSelector('.sock');
  assert.equal(await noHScroll(page), true, 'cyberware list');
  assert.equal(await page.locator('#cw-picker').isVisible(), false);
  await page.click('.sock[data-key="700.0"]');
  await page.waitForTimeout(450);
  assert.equal(await page.locator('#cw-picker').isVisible(), true);
  await page.click('.cw-row[data-imp="710"]');
  await page.click('.cw-close');
  await page.waitForTimeout(450);
  assert.equal(await page.locator('#cw-picker').isVisible(), false);
  assert.equal(await page.locator('#cw-bar').isVisible(), true);
  assert.match((await page.locator('#cw-bar .cap-top b').innerText()).replace(/\s/g, ''), /2\/12/);
  assert.equal(await noHScroll(page), true, 'after equipping');
  await page.goto(BASE);
  await page.waitForSelector('#c-rail .acard');
  assert.equal(await noHScroll(page), true, 'character');
}, { viewport: { width: 390, height: 844 } });

await browser.close();
server.kill();
for (const [name, ok, why] of results) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     ${why}`}`);
const failed = results.filter((r) => !r[1]).length;
console.log(`\nsmoke: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
