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

const FC = '.sock[data-key="1000.0"]';             // Frontal Cortex slot 1 (registry n 1000)
const chipCap = async (row) => Number((await row.locator('.cw-chips .chipx').nth(1).innerText()).replace(/\D/g, ''));
const enabledRows = (page) => page.locator('.cw-row:not(:disabled)');

await t('pick an implant: socket fills and capacity updates', async (page) => {
  await page.goto(`${BASE}?tab=cyberware`);
  await page.waitForSelector('.sock');
  assert.equal((await capText(page)).replace(/\s/g, ''), '0/27');
  await page.click(FC);
  const row = enabledRows(page).first();
  const cost = await chipCap(row);
  await row.click();
  assert.equal(await page.locator(FC).getAttribute('data-s'), 'filled');
  assert.equal((await capText(page)).replace(/\s/g, ''), `${cost}/27`);
  await page.click('.cw-remove');
  assert.equal((await capText(page)).replace(/\s/g, ''), '0/27');
});

await t('quality picker: one row per item, switching quality swaps the equipped variant', async (page) => {
  await page.goto(`${BASE}?tab=cyberware`);
  await page.click(FC);
  const li = page.locator('.cw-li', { has: page.locator('.cw-quals') }).filter({ has: page.locator('.cw-row:not(:disabled)') }).first();
  const quals = li.locator('.cw-q');
  assert.ok((await quals.count()) >= 2);
  await li.locator('.cw-row').click();
  assert.equal(await page.locator(FC).getAttribute('data-s'), 'filled');
  const first = await quals.nth(0).getAttribute('aria-pressed');
  assert.equal(first, 'true');
  await quals.nth(1).click();
  assert.equal(await quals.nth(1).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator(FC).getAttribute('data-s'), 'filled', 'still equipped after switching quality');
  assert.equal(await page.locator('.cw-remove').count(), 1, 'one equipped row');
});

await t('locked slots are shown, not selectable', async (page) => {
  await page.goto(`${BASE}?tab=cyberware`);
  await page.waitForSelector('.sock');
  const locked = page.locator('.sock[data-s=locked]');
  assert.equal(await locked.count(), 2);                    // Skeleton + Hands
  assert.equal(await locked.first().isDisabled(), true);
});

await t('over-capacity implants are disabled with a reason', async (page) => {
  await page.goto(`${BASE}?tab=cyberware`);
  const keys = await page.$$eval('.sock[data-key]', (els) => els.map((e) => e.dataset.key));
  let seen = null;
  for (const key of keys) {
    await page.click(`.sock[data-key="${key}"]`);
    const disabled = page.locator('.cw-row:disabled').first();
    if (await disabled.count()) { seen = disabled; break; }
    const rows = enabledRows(page);
    const n = await rows.count();
    if (!n) continue;
    let best = rows.first(), bestCost = -1;
    for (let i = 0; i < n; i++) { const c = await chipCap(rows.nth(i)); if (c > bestCost) { best = rows.nth(i); bestCost = c; } }
    await best.click();
  }
  assert.ok(seen, 'filling the sockets with the dearest implants must hit the capacity limit');
  assert.equal(await seen.getAttribute('aria-disabled'), 'true');
  assert.match(await seen.locator('.cw-reason').innerText(), /over capacity/i);
  assert.equal(await page.locator('#cw-summary .capbar').getAttribute('data-state') !== 'over', true, 'refused, so never over');
});

await t('capacity is provisional until growth is known (level changes do not move it)', async (page) => {
  await page.goto(BASE);
  await page.fill('#c-level', '40');
  await page.click('.tab[data-tab=cyberware]');
  assert.equal((await capText(page)).replace(/\s/g, ''), '0/27');
  assert.match(await page.locator('#cw-summary .cap-note').innerText(), /provisional/i);
});

await t('copy build link includes the loadout and it restores', async (page) => {
  await page.goto(`${BASE}?tab=cyberware`);
  await page.click(FC);
  const row = enabledRows(page).first();
  const cost = await chipCap(row);
  await row.click();
  await page.click('#copy-btn');
  const link = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(link, /[?&]b=2\./);
  assert.match(link, /tab=cyberware/);
  await page.goto(link);
  await page.waitForSelector('.sock');
  assert.equal(await page.locator(FC).getAttribute('data-s'), 'filled');
  assert.equal((await capText(page)).replace(/\s/g, ''), `${cost}/27`);
});

await t('old v2 links (retired SAMPLE implants) still load, with those implants dropped', async (page) => {
  await page.goto(`${BASE}?b=2.EQkDDAQUBX0BAQQCArwFAcYFvgUAyAU&tab=cyberware`);
  await page.waitForSelector('.sock');
  assert.equal(await page.locator('.sock[data-s=filled]').count(), 0);
  assert.equal((await capText(page)).replace(/\s/g, ''), '0/27');
  await page.click('.tab[data-tab=character]');
  assert.equal(await page.locator('.acard[data-k=cool] .val').innerText().then((x) => x.split('/')[0].trim()), '20');
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
  await page.click(FC);
  await page.waitForTimeout(450);
  assert.equal(await page.locator('#cw-picker').isVisible(), true);
  const cost = await chipCap(enabledRows(page).first());
  await enabledRows(page).first().click();
  await page.click('.cw-close');
  await page.waitForTimeout(450);
  assert.equal(await page.locator('#cw-picker').isVisible(), false);
  assert.equal(await page.locator('#cw-bar').isVisible(), true);
  assert.match((await page.locator('#cw-bar .cap-top b').innerText()).replace(/\s/g, ''), new RegExp(`${cost}/27`));
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
