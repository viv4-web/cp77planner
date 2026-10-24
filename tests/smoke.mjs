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

const OFF_PORT = PORT + 1;
const offline = spawn('python3', ['-m', 'http.server', String(OFF_PORT), '--bind', '127.0.0.1', '-d', 'dist/offline'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 300));
const browser = await chromium.launch();
const results = [];
async function t(name, fn, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  page.on('request', (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith(`http://127.0.0.1:${OFF_PORT}/`) && !r.url().startsWith('data:')) problems.push(`external request: ${r.url()}`); });
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
}, { viewport: { width: 800, height: 1000 } });

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
}, { viewport: { width: 800, height: 1000 } });

await t('Arms is marked pending data, with the reason in the picker', async (page) => {
  await page.goto(`${BASE}?tab=cyberware`);
  await page.click('.sock[data-key="1001.0"]');
  assert.match(await page.locator('#cw-picker .cw-pending').innerText(), /pending data.*CET probe/i);
  assert.match(await page.locator('.cw-group', { hasText: 'Arms' }).locator('.cw-pend').innerText(), /pending data/i);
}, { viewport: { width: 800, height: 1000 } });

await t('same-quality variants show what differs', async (page) => {
  await page.goto(`${BASE}?tab=cyberware`);
  await page.click('.sock[data-key="1002.0"]');
  const li = page.locator('.cw-li', { has: page.locator('.cw-quals .cw-q[title]') }).first();
  await li.locator('.cw-q[title]').first().click();
  assert.match(await li.locator('.cw-diff').innerText(), /^vs #\d: /);
}, { viewport: { width: 800, height: 1000 } });

await t('locked slots are shown, not selectable', async (page) => {
  await page.goto(`${BASE}?tab=cyberware`);
  await page.waitForSelector('.sock');
  const locked = page.locator('.sock[data-s=locked]');
  assert.equal(await locked.count(), 2);                    // Skeleton + Hands
  assert.equal(await locked.first().isDisabled(), true);
}, { viewport: { width: 800, height: 1000 } });

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
}, { viewport: { width: 800, height: 1000 } });

await t('capacity is provisional until growth is known (level changes do not move it)', async (page) => {
  await page.goto(BASE);
  await page.fill('#c-level', '40');
  await page.click('.tab[data-tab=cyberware]');
  assert.equal((await capText(page)).replace(/\s/g, ''), '0/27');
  assert.match(await page.locator('#cw-summary .cap-note').innerText(), /provisional/i);
}, { viewport: { width: 800, height: 1000 } });

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
}, { viewport: { width: 800, height: 1000 } });

await t('old v2 links (retired SAMPLE implants) still load, with those implants dropped', async (page) => {
  await page.goto(`${BASE}?b=2.EQkDDAQUBX0BAQQCArwFAcYFvgUAyAU&tab=cyberware`);
  await page.waitForSelector('.sock');
  assert.equal(await page.locator('.sock[data-s=filled]').count(), 0);
  assert.equal((await capText(page)).replace(/\s/g, ''), '0/27');
  await page.click('.tab[data-tab=character]');
  assert.equal(await page.locator('.acard[data-k=cool] .val').innerText().then((x) => x.split('/')[0].trim()), '20');
}, { viewport: { width: 800, height: 1000 } });

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

// ---- ripperdoc stage (desktop, >= 900px) ----
const hasArt = (page) => page.evaluate(() => document.getElementById('rd')?.dataset.art === 'on');
const rdCap = async (page) => (await page.locator('#rd-cap .rd-lab.cur').innerText()).trim();
const openRdZone = async (page, zone, picker) => { await page.goto(`${BASE}?tab=cyberware&zone=${zone}${picker ? '&picker=1' : ''}`); await page.waitForSelector('#rd-panel:not([hidden])'); };
const openRd = async (page, query = '') => { await page.goto(`${BASE}?tab=cyberware${query}`); await page.waitForSelector('#rd .rd-tag'); };

await t('ripperdoc: the stage is 16:9, scaled to fit, and fully inside the viewport', async (page) => {
  await openRd(page);
  const b = await page.locator('#rd-fit').boundingBox();
  assert.ok(Math.abs(b.width / b.height - 16 / 9) < 0.02, `aspect ${b.width / b.height}`);
  assert.ok(b.x >= 0 && b.x + b.width <= 1440 + 1, 'fits the width');
  assert.equal(await noHScroll(page), true);
  assert.equal(await page.locator('.cw-legacy').isVisible(), false, 'older layout hidden on desktop');
});

await t('ripperdoc: selecting a zone opens that zone\'s slot panel at its anchor, with locked slots shown', async (page) => {
  await openRd(page);
  assert.equal(await page.locator('.rd-tag').count(), 10);
  await page.click('.rd-tag[data-zone=skeleton]');
  await page.waitForSelector('#rd-panel:not([hidden])');
  assert.equal(await page.locator('#rd').getAttribute('data-open'), 'skeleton');
  assert.match(await page.locator('#rd-panel h2').innerText(), /skeleton/i);
  assert.equal(await page.locator('#rd-panel .rd-cell[data-slot]').count(), 2);
  assert.equal(await page.locator('#rd-panel .rd-cell.locked').count(), 1);
  const lay = await page.evaluate(() => fetch('data/ripperdoc/layout.json').then((r) => r.json()));
  const anchor = lay.panel.origin;      // one left column for every zone
  await page.waitForTimeout(1000);                       // the panel fades in with a short slide
  const st = await page.locator('#rd').boundingBox(), pb = await page.locator('#rd-panel').boundingBox();
  const sc = st.width / 1920;
  assert.ok(Math.abs((pb.x - st.x) / sc - anchor[0]) < 3 && Math.abs((pb.y - st.y) / sc - anchor[1]) < 3, 'panel is the left column at the inventory origin');
  await page.click('#rd-panel .rd-back');
  await page.waitForSelector('#rd-panel', { state: 'hidden' });
  await page.click('.rd-tag[data-zone=hands]');
  assert.match(await page.locator('#rd-panel h2').innerText(), /hands/i);
});

await t('ripperdoc: picking an implant fills the slot and updates the capacity meter', async (page) => {
  await openRd(page);
  assert.equal(await rdCap(page), '0');
  await page.click('.rd-tag[data-zone=frontal_cortex]');
  await page.click('#rd-panel .rd-cell[data-slot="0"]');
  await page.waitForSelector('#rd-picker:not([hidden]) .rd-gbtn');
  const btn = page.locator('.rd-gcell:not(.blocked) .rd-gbtn').first();
  const cost = Number(await btn.getAttribute('data-cost'));
  await btn.hover();
  assert.equal((await page.locator('#rd-cap .rd-lab.add').innerText()).trim(), `+${cost}`, 'preview has a text cue');
  assert.equal(await page.locator('#rd-cap .rd-over-mark').count(), 0);
  await btn.click();
  assert.equal(await page.locator('#rd-panel .rd-cell[data-slot="0"]').getAttribute('class').then((c) => c.includes('full')), true);
  assert.equal(await rdCap(page), String(cost));
  assert.equal(await page.locator('#rd-cap .rd-seg.safe').count(), cost, 'one lit segment per capacity point');
  await btn.hover();
  assert.match(await page.locator('#rd-tip').innerText(), /capacity/i);       // tooltip: name, quality, capacity, stats
  await page.keyboard.press('Escape');                                      // unpin the tooltip the click pinned
  await page.click('#rd-picker [data-act=remove]');
  assert.equal(await rdCap(page), '0');
  await page.click('#rd-panel .rd-back');
  await page.waitForSelector('.rd-tag');
  assert.equal(await page.locator('.rd-grp[data-zone=frontal_cortex] .rd-tile:not(.full)').count(), 3, 'the overview shows the slot tiles, all empty again');
  assert.equal(await page.locator('.rd-tag-n').count(), 0, 'no n/m counter on the label');
});

await t('ripperdoc: over capacity is refused with a tooltip warning, never over 27 without a perk', async (page) => {
  await openRd(page);
  await page.click('.rd-tag[data-zone=operating]');
  await page.click('#rd-panel .rd-cell[data-slot="0"]');
  const costs = await page.$$eval('.rd-gcell:not(.blocked) .rd-gbtn', (els) => els.map((e) => Number(e.dataset.cost)));
  assert.ok(costs.length > 0);
  await page.locator(`.rd-gcell:not(.blocked) .rd-gbtn[data-cost="${Math.max(...costs)}"]`).first().click();
  const used = Number(await rdCap(page));
  assert.ok(used > 0 && used <= 27);
  await page.click('#rd-panel .rd-back');
  await page.click('.rd-tag[data-zone=skeleton]');
  await page.click('#rd-panel .rd-cell[data-slot="0"]');
  const blocked = page.locator('.rd-gcell.blocked .rd-gbtn').first();
  await blocked.waitFor();
  assert.equal(await blocked.getAttribute('aria-disabled'), 'true');
  await blocked.hover();
  assert.match(await page.locator('#rd-tip .rd-tip-warn').innerText(), /over by \d+/i);
  // the over-capacity preview is never color alone: a text cue, a warning shape and a marker at the limit
  assert.match(await page.locator('#rd-cap .rd-lab.add').innerText(), /OVER BY \d+/);
  assert.equal(await page.locator('#rd-cap .rd-lab.add svg').count(), 1, 'warning shape in the label');
  assert.equal(await page.locator('#rd-cap .rd-over-mark').count(), 1, 'marker at the limit line');
  assert.ok(await page.locator('#rd-cap .rd-seg.unsafe-add').count() > 0);
  assert.match(await page.locator('#rd-cap [aria-live]').innerText(), /over by \d+/);
  const before = await rdCap(page);
  await blocked.click({ force: true });
  assert.equal(await rdCap(page), before, 'a refused pick changes nothing');
});

await t('ripperdoc: hovering a body zone shows its sprite (alpha hit test)', async (page) => {
  await openRd(page);
  if (!(await hasArt(page))) return;                       // placeholders only: nothing to hit-test
  await page.waitForFunction(() => document.querySelectorAll('.rd-sprite img').length > 0);
  await page.waitForTimeout(400);
  const lay = await page.evaluate(() => fetch('data/ripperdoc/layout.json').then((r) => r.json()));
  const r = lay.genders.woman.zones.legs.sprite.rect;
  const st = await page.locator('#rd').boundingBox(), sc = st.width / 1920;
  await page.mouse.move(st.x + (r[0] + r[2] / 2) * sc, st.y + (r[1] + r[3] * 0.6) * sc);
  await page.waitForSelector('.rd-sprite.hot');
  assert.ok(await page.locator('.rd-sprite.hot').count() >= 1);
  await page.mouse.move(st.x + 5, st.y + 5);
  await page.waitForFunction(() => document.querySelectorAll('.rd-sprite.hot').length === 0);
});

await t('ripperdoc: selecting a zone plays its clip; the body loop loops in Full, not in Calm', async (page) => {
  await openRd(page);
  if (!(await hasArt(page))) return;
  await page.waitForFunction(() => document.querySelector('#rd-body video')?.src);
  assert.equal(await page.evaluate(() => document.querySelector('#rd-body video').loop), true);
  await page.click('.rd-tag[data-zone=ocular]');
  await page.waitForFunction(() => { const v = document.querySelector('.rd-clip[data-zone=ocular] video'); return v && v.src && !v.paused; });
  await page.click('#rd-panel .rd-back');
  await page.click('#motion [data-m=calm]');
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(() => document.querySelector('#rd-body video').loop), false, 'Calm: no loops');
});

await t('ripperdoc: motion Off shows the posters, nothing plays, and the zone state is applied at once', async (page) => {
  await page.goto(`${BASE}?tab=cyberware`);
  await page.click('#motion [data-m=off]');
  await page.waitForSelector('#rd .rd-tag');
  if (await hasArt(page)) {
    assert.equal(await page.locator('.rd-media.live').count(), 0, 'no live video in Off');
    assert.ok(await page.locator('#rd-body .rd-poster').isVisible(), 'body poster shown');
  }
  await page.click('.rd-tag[data-zone=legs]');
  await page.waitForSelector('#rd-panel:not([hidden])');
  const tab = await page.evaluate(() => { const e = document.getElementById('rd-tab'); const c = getComputedStyle(e); return { opacity: c.opacity, t: c.transitionDuration }; });
  assert.equal(tab.opacity, '0', 'the default tab is already gone (no animation)');
  assert.ok(/^0s(, 0s)*$/.test(tab.t), `transitions off: ${tab.t}`);
  if (await hasArt(page)) {
    assert.equal(await page.locator('.rd-media.live').count(), 0);
    assert.ok(await page.locator('.rd-clip[data-zone=legs] .rd-poster').isVisible(), 'zone poster shown');
  }
});

await t('ripperdoc: the man/woman switch swaps the body and keeps the build', async (page) => {
  await openRd(page);
  await page.click('.rd-tag[data-zone=legs]');
  await page.click('#rd-panel .rd-cell[data-slot="0"]');
  await page.locator('.rd-gcell:not(.blocked) .rd-gbtn').first().click();
  const cap = await rdCap(page);
  await page.click('#rd-panel .rd-back');
  await page.click('#rd-gender [data-g=man]');
  assert.equal(await page.locator('#rd-gender [data-g=man]').getAttribute('aria-pressed'), 'true');
  assert.equal(await rdCap(page), cap);
  if (await hasArt(page)) assert.match(await page.locator('#rd-body .rd-poster').getAttribute('src'), /male_body_loop/);
});

await t('ripperdoc: picker tiles are the game slot tile with the real item icon in every zone (no placeholder glyphs)', async (page) => {
  const keys = ['frontal_cortex', 'ocular', 'circulatory', 'hands', 'arms', 'legs', 'nervous', 'integumentary', 'operating', 'skeleton'];
  for (const k of keys) {
    await openRdZone(page, k, true);
    await page.waitForSelector('#rd-picker:not([hidden])');
    const tiles = await page.locator('#rd-picker .rd-gbtn').count();
    if (!tiles) continue;                                   // Arms: pending data, no implants yet
    assert.equal(await page.locator('#rd-picker .rd-gbtn .rd-ico img').count(), tiles, `${k}: every tile has a game icon`);
    assert.equal(await page.locator('#rd-picker .rd-gbtn .rd-ico .glyph').count(), 0, `${k}: no placeholder glyph`);
  }
  await openRdZone(page, 'frontal_cortex', true);
  await page.waitForSelector('#rd-picker .rd-gbtn');
  const src = await page.locator('#rd-picker .rd-gbtn .rd-ico img').first().getAttribute('src');
  assert.match(src, /^img\/ui\/item_icons\d*\/.+\.webp$/);
  assert.ok(await page.locator('#rd-picker .rd-gbtn .rd-ico img').first().evaluate((i) => i.complete && i.naturalWidth > 0), 'icon loaded');
  assert.ok(await page.evaluate(() => document.getElementById('rd').style.getPropertyValue('--p-atlas_shapes_sync-item_bg').includes('item_bg.webp')), 'game shape part available');
  const mask = await page.locator('#rd-picker .rd-tile .bg').first().evaluate((e) => getComputedStyle(e).webkitMaskImage || getComputedStyle(e).maskImage);
  assert.match(mask, /item_bg\.webp/, 'tile background is the game item_bg part');
  const lab = await page.locator('#rd-picker .rd-gbtn').first().getAttribute('aria-label');
  assert.match(lab, /, (Common|Uncommon|Rare|Epic|Legendary|Iconic)\+*( #\d)?, capacity \d+/, 'name, rarity and capacity are in the label');
  assert.equal(await page.locator('#rd-picker .rd-cost, #rd-picker .rd-cname, #rd-picker .rd-pip').count(), 0, 'tiles are icon only');
});

await t('ripperdoc: slot cell states are shapes and words, not color alone (empty plus, filled marker, locked icon + text, selected frame)', async (page) => {
  await openRdZone(page, 'skeleton', false);
  await page.waitForSelector('#rd-panel:not([hidden]) .rd-cell');
  assert.equal(await page.locator('#rd-panel .rd-cell.locked .rd-lock').count(), 1);
  assert.equal((await page.locator('#rd-panel .rd-cell.locked .rd-locktxt').innerText()).trim().toLowerCase(), 'locked');
  assert.equal(await page.locator('#rd-panel .rd-cell[data-slot="0"] .rd-add').count(), 1, 'empty slot shows the plus part');
  await page.click('#rd-panel .rd-cell[data-slot="0"]');
  assert.equal(await page.locator('#rd-panel .rd-cell[data-slot="0"]').getAttribute('aria-pressed'), 'true');
  const o = await page.locator('#rd-panel .rd-cell[data-slot="0"] .sel').evaluate((e) => getComputedStyle(e).getPropertyValue('opacity'));
  assert.equal(Number(o), 0.8, 'selected frame at the game opacity');
  await page.locator('.rd-gcell:not(.blocked) .rd-gbtn').first().click();
  const full = page.locator('#rd-panel .rd-cell[data-slot="0"]');
  assert.ok((await full.getAttribute('class')).includes('full'));
  assert.match(await full.getAttribute('aria-label'), /capacity \d+/, 'name and capacity are in the label');
  assert.equal(await full.locator('.eqm').count(), 1, 'equipped marker shape');
});

await t('ripperdoc: item tooltip follows the game layout: name, rarity, type, capacity row, stats; over capacity has an icon and words', async (page) => {
  await openRdZone(page, 'frontal_cortex', true);
  const g = page.locator('#rd-picker .rd-gcell:not(.blocked) .rd-gbtn').first();
  await g.waitFor();
  await g.hover();
  const tip = page.locator('#rd-tip');
  await tip.waitFor({ state: 'visible' });
  assert.ok((await tip.locator('.rd-tip-name').innerText()).trim().length > 0);
  assert.match(await tip.locator('.rd-tip-sub').innerText(), /^(Common|Uncommon|Rare|Epic|Legendary|Iconic)\+*( #\d)? \u00b7 Frontal Cortex$/, 'one muted line: rarity \u00b7 slot');
  assert.equal(await tip.locator('.rd-tip-band').evaluate((e) => getComputedStyle(e).borderLeftWidth), '5px', 'rarity band');
  const cost = await g.getAttribute('data-cost');
  assert.equal((await tip.locator('.rd-tip-cap b').innerText()).trim(), cost, 'capacity row equals the tile chip');
  assert.equal(await tip.locator('.rd-tipfill').count(), 1);
  assert.equal(await tip.evaluate((e) => e.offsetWidth), 380, 'fixed width');
  const tb = await tip.boundingBox(), gbx = await page.locator('#rd-picker .rd-grid').boundingBox();
  assert.ok(tb.x >= gbx.x + gbx.width, 'the tooltip never covers the grid');
  assert.equal(await tip.locator('.rd-var').count(), 0, 'no full variant list');
  assert.ok((await tip.locator('.rd-tip-cap b').evaluate((e) => parseFloat(getComputedStyle(e).fontSize))) >= 40, 'capacity number is large');
  assert.equal(await tip.locator('.rd-tip-warn').count(), 0, 'no warning when it fits');
  await openRdZone(page, 'skeleton', true);
  const blocked = page.locator('#rd-picker .rd-gcell.blocked .rd-gbtn').first();
  await blocked.waitFor();
  await blocked.hover();
  assert.equal(await page.locator('#rd-tip .rd-tip-cap .rd-tip-warn svg').count(), 1, 'warning icon in the capacity row');
  assert.match(await page.locator('#rd-tip .rd-tip-cap .rd-tip-warn').innerText(), /over by \d+/i);
  assert.equal(await page.locator('#rd-cap .rd-seg').count(), 27, 'the meter keeps its height: rows are clamped to the limit');
});

await t('ripperdoc: capacity segments are the cw_bars_assets parts and keep the text and shape cues', async (page) => {
  await openRdZone(page, 'frontal_cortex', true);
  await page.locator('#rd-picker .rd-gcell:not(.blocked) .rd-gbtn').first().click();
  const seg = page.locator('#rd-cap .rd-seg.safe').first();
  await seg.waitFor();
  assert.equal(await seg.locator('i').count(), 2, 'two-column bar');
  assert.match(await seg.locator('i').first().evaluate((e) => getComputedStyle(e).webkitMaskImage || getComputedStyle(e).maskImage), /bar_long1\.webp/);
  assert.ok(await page.locator('#rd-cap .rd-seghl.safe').count() > 0, 'highlight glow part under lit segments');
  assert.equal(await page.locator('#rd-cap .rd-capbg img').getAttribute('src'), 'img/ui/cw_bars_assets/cw_barbg.webp');
});

await t('ripperdoc: tile hover plays the game flicker in Full, nothing in Off', async (page) => {
  await openRdZone(page, 'frontal_cortex', true);
  const g = page.locator('#rd-picker .rd-gcell:not(.blocked) .rd-gbtn').first();
  await g.hover();
  assert.equal(await g.locator('.rd-ico').evaluate((e) => getComputedStyle(e).animationName), 'rdflick');
  await page.click('#motion [data-m=off]');
  await page.mouse.move(5, 5);
  await g.hover();
  assert.equal(await g.locator('.rd-ico').evaluate((e) => getComputedStyle(e).animationName), 'none');
});

await t('ripperdoc: zone panel is a left column without a box; header arrows and dashes switch zones; the body stays uncovered', async (page) => {
  await openRdZone(page, 'ocular', false);
  assert.match(await page.locator('#rd-panel h2').innerText(), /face/i);
  assert.equal(await page.locator('#rd-panel .rd-dots button').count(), 10, 'one dash per body zone');
  assert.equal(await page.locator('#rd-panel .rd-dots button.on').count(), 1);
  for (const sel of ['#rd-panel', '#rd-picker']) assert.equal(await page.locator(sel).evaluate((e) => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)', `${sel} has no box`);
  const st = await page.locator('#rd').boundingBox(), sc = st.width / 1920;
  const pb = await page.locator('#rd-panel').boundingBox(), gb = await page.locator('#rd-picker .rd-grid').boundingBox();
  assert.ok((pb.x + pb.width - st.x) / sc < 880 && (gb.x + gb.width - st.x) / sc < 880, 'panel and grid stay in the left column (x < ~875)');
  assert.ok(gb.y > pb.y + 150 * sc, 'grid is below the slot row');
  await page.click('#rd-panel [data-zone-step="1"]');
  assert.match(await page.locator('#rd-panel h2').innerText(), /circulatory/i);
  await page.click('#rd-panel [data-zone-go="skeleton"]');
  assert.match(await page.locator('#rd-panel h2').innerText(), /skeleton/i);
  assert.equal(await page.locator('#rd-panel .rd-cells .rd-tile').count(), 3, 'two slots and the locked one in one row');
});

await t('ripperdoc: the inventory grid area is always drawn, with plus marks on the empty cells; tiles are icon only', async (page) => {
  await openRdZone(page, 'legs', false);
  await page.waitForSelector('#rd-picker .rd-grid');
  const cells = await page.locator('#rd-picker .rd-grid > *').count();
  assert.ok(cells >= 20 && cells % 4 === 0, `${cells} cells (4 columns, at least 5 rows)`);
  assert.ok(await page.locator('#rd-picker .rd-gempty').count() > 0);
  assert.equal(await page.locator('#rd-picker .rd-gempty').first().evaluate((e) => getComputedStyle(e, '::before').content), '""');
  assert.equal(await page.locator('#rd-picker .rd-grid').evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length), 4);
});

await t('ripperdoc: the tooltip pins on click, offers the quality choice, and Escape unpins it', async (page) => {
  await openRdZone(page, 'ocular', false);
  const tile = page.locator('#rd-picker .rd-gcell:not(.blocked) .rd-gbtn').first();
  await tile.click();
  const tip = page.locator('#rd-tip');
  await tip.waitFor({ state: 'visible' });
  assert.ok((await tip.getAttribute('class')).includes('pinned'));
  assert.equal(await tip.locator('.rd-qstep').count(), 1, 'quality stepper');
  const q0 = await tip.locator('.rd-qstep span').innerText();
  const before = await page.locator('#rd-panel .rd-cell[data-slot="0"]').getAttribute('data-imp');
  await tip.locator('.rd-qstep .n').click();
  const after = await page.locator('#rd-panel .rd-cell[data-slot="0"]').getAttribute('data-imp');
  assert.notEqual(after, before, 'the equipped quality changed');
  assert.notEqual(await tip.locator('.rd-qstep span').innerText(), q0);
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('#rd-panel .rd-cell[data-slot="0"]').getAttribute('data-imp'), before, 'ArrowLeft steps back');
  if (await tip.locator('.rd-vtog').count()) {
    const v = await tip.locator('.rd-vtog button:not(.on)').first();
    await v.click();
    assert.notEqual(await page.locator('#rd-panel .rd-cell[data-slot="0"]').getAttribute('data-imp'), before, 'variant toggle');
  }
  assert.equal(await tip.isVisible(), true, 'tooltip stays open after the choice');
  assert.ok(await tip.locator('.rd-tip-cap b').innerText());
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  assert.equal(await tip.isVisible(), true, 'pinned: stays when the pointer leaves');
  await page.keyboard.press('Escape');
  assert.equal(await tip.isVisible(), false);
});

await t('ripperdoc: the armor meter is built like the capacity meter and says pending data', async (page) => {
  await openRd(page);
  assert.equal((await page.locator('#rd-arm .rd-lab.max').innerText()).trim(), '—');
  assert.match(await page.locator('#rd-arm .rd-captitle').innerText(), /pending data/i);
  assert.equal(await page.locator('#rd-arm .rd-seg').count(), 27);
  assert.equal(await page.locator('#rd-arm .rd-seg.safe').count(), 0, 'no lit bars without data');
  assert.equal(await page.locator('#rd-cap .rd-mico.cap').count(), 1, 'body icon on top of the capacity meter');
  const cap = await page.locator('#rd-cap .rd-capbg').boundingBox(), arm = await page.locator('#rd-arm .rd-capbg').boundingBox();
  assert.ok(arm.x > cap.x + 800, 'armor is on the right');
});

await t('ripperdoc: the overview is the game layout: each zone label has its slot tiles, left zones grow left, right zones grow right', async (page) => {
  await openRd(page);
  const counts = { frontal_cortex: [3, 0], arms: [1, 0], skeleton: [2, 1], nervous: [3, 0], integumentary: [3, 0], operating: [1, 0], ocular: [1, 0], hands: [1, 1], circulatory: [3, 0], legs: [1, 0] };
  for (const [k, [n, locked]] of Object.entries(counts)) {
    const g = page.locator(`.rd-grp[data-zone=${k}]`);
    assert.equal(await g.locator('.rd-tile').count(), n + locked, `${k} tiles`);
    assert.equal(await g.locator('.rd-tile.locked').count(), locked, `${k} locked`);
    assert.equal(await g.locator('.rd-tag').count(), 1);
  }
  const sbox = await page.locator('#rd').boundingBox(), sc = sbox.width / 1920;
  const x = async (sel) => ((await page.locator(sel).first().boundingBox()).x - sbox.x) / sc;
  for (const k of ['frontal_cortex', 'arms', 'skeleton', 'nervous', 'integumentary']) assert.ok((await x(`.rd-grp[data-zone=${k}] .rd-tile`)) < 800, `${k} is left of the body`);
  for (const k of ['operating', 'ocular', 'hands', 'circulatory', 'legs']) assert.ok((await x(`.rd-grp[data-zone=${k}] .rd-tile`)) > 1100, `${k} is right of the body`);
  // locked tile leftmost on the skeleton row, rightmost on the hands row
  const sk = await page.locator('.rd-grp[data-zone=skeleton] .rd-row > *').evaluateAll((e) => e.map((n) => n.classList.contains('locked')));
  assert.deepEqual(sk, [true, false, false]);
  const hd = await page.locator('.rd-grp[data-zone=hands] .rd-row > *').evaluateAll((e) => e.map((n) => n.classList.contains('locked')));
  assert.deepEqual(hd, [false, true]);
  assert.equal(await page.locator('.rd-grp[data-zone=skeleton] .rd-tile.locked .rd-lock').count(), 1);
  assert.equal(await page.locator('.rd-grp[data-zone=frontal_cortex] .rd-add').count(), 3, 'empty = socket mark');
  // the group never sits over the capacity meter
  const cap = await page.locator('#rd-cap .rd-capbg').boundingBox();
  for (const k of ['skeleton', 'frontal_cortex']) assert.ok((await page.locator(`.rd-grp[data-zone=${k}] .rd-tile`).first().boundingBox()).x > cap.x + cap.width + 40 * sc, `${k} clear of the meter`);
});

await t('ripperdoc: an equipped tile shows the icon, rarity strip and the upgrade corner; a tile click opens that zone with the slot selected; hover links tile and body zone', async (page) => {
  await openRdZone(page, 'frontal_cortex', false);
  await page.locator('#rd-picker .rd-gcell:not(.blocked) .rd-gbtn').first().click();
  await page.keyboard.press('Escape');
  await page.click('#rd-panel .rd-cell[data-slot="1"]');
  await page.locator('#rd-picker .rd-gcell:not(.blocked) .rd-gbtn').nth(2).click();
  await page.keyboard.press('Escape');
  await page.click('#rd-panel .rd-back');
  await page.waitForSelector('.rd-grp[data-zone=frontal_cortex]');
  const eq = page.locator('.rd-grp[data-zone=frontal_cortex] .rd-tile.full');
  assert.equal(await eq.count(), 2);
  assert.equal(await eq.first().locator('.rd-ico img, .rd-ico svg').count(), 1, 'item icon');
  assert.equal(await eq.first().locator('.upc').evaluate((e) => getComputedStyle(e).opacity), '1', 'upgrade corner on an equipped tile');
  assert.equal(await page.locator('.rd-grp[data-zone=frontal_cortex] .rd-tile:not(.full) .upc').count(), 0, 'no corner on an empty tile');
  // hover a tile: its body zone lights up
  await page.locator('.rd-grp[data-zone=circulatory] .rd-tile').first().hover();
  await page.waitForFunction(() => document.querySelector('.rd-sprite[data-zone=circulatory].hot') && document.querySelector('.rd-grp[data-zone=circulatory].hot'));
  // click the third tile: the zone opens with that slot selected (frontal cortex row is reversed: slot 1 is the right-most)
  await page.locator('.rd-grp[data-zone=frontal_cortex] .rd-tile[data-slot="2"]').click();
  await page.waitForSelector('#rd-panel:not([hidden])');
  assert.equal(await page.locator('#rd-panel .rd-cell[data-slot="2"]').getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('#rd-panel h2').innerText(), /frontal/i);
});

await t('ripperdoc: the zone clip keeps looping while the zone is open in Full; Calm plays once and holds', async (page) => {
  await openRd(page, '');
  if (!(await hasArt(page))) return;
  await page.click('.rd-grp[data-zone=ocular] .rd-tag');
  await page.waitForFunction(() => { const v = document.querySelector('.rd-clip[data-zone=ocular] video'); return v && v.src && !v.paused; });
  assert.equal(await page.evaluate(() => document.querySelector('.rd-clip[data-zone=ocular] video').loop), true, 'zone clip loops in Full');
  const loops = await page.evaluate(() => fetch('data/ripperdoc/loops.json').then((r) => r.json()));
  assert.ok(loops.clips['woman/woman_ocular'] && Number.isInteger(loops.clips['woman/woman_ocular'].loopStart));
  await page.click('#rd-panel .rd-back');
  await page.click('#motion [data-m=calm]');
  await page.click('.rd-grp[data-zone=ocular] .rd-tag');
  await page.waitForFunction(() => { const v = document.querySelector('.rd-clip[data-zone=ocular] video'); return v && v.src; });
  assert.equal(await page.evaluate(() => document.querySelector('.rd-clip[data-zone=ocular] video').loop), false, 'Calm: once and hold');
});

await t('ripperdoc: the woman floats gently at idle in Full (our approximation); not in Calm, with a zone open, or for the man', async (page) => {
  await openRd(page);
  const name = () => page.evaluate(() => getComputedStyle(document.getElementById('rd-tab')).animationName);
  assert.equal(await name(), 'rdfloat');
  await page.click('.rd-grp[data-zone=legs] .rd-tag');
  await page.waitForSelector('#rd-panel:not([hidden])');
  assert.equal(await name(), 'none', 'no float while a zone is open');
  await page.click('#rd-panel .rd-back');
  await page.click('#rd-gender [data-g=man]');
  assert.equal(await name(), 'none', 'the man does not float (no float in the data)');
  await page.click('#rd-gender [data-g=woman]');
  assert.equal(await name(), 'rdfloat');
  await page.click('#motion [data-m=calm]');
  assert.equal(await name(), 'none', 'Calm: no float');
});

await t('ripperdoc: a wide window and a 1920 window both fit the stage with no horizontal scroll', async (page) => {
  await openRd(page);
  assert.equal(await noHScroll(page), true);
}, { viewport: { width: 1920, height: 1080 } });

await t('ripperdoc: the offline build (no game art) still works with placeholders and loads no media', async (page) => {
  const reqs = [];
  page.on('request', (r) => reqs.push(r.url()));
  await page.goto(`http://127.0.0.1:${OFF_PORT}/?tab=cyberware`);
  await page.waitForSelector('#rd .rd-tag');
  assert.equal(await page.locator('#rd').getAttribute('data-art'), 'off');
  await page.click('.rd-tag[data-zone=legs]');
  await page.click('#rd-panel .rd-cell[data-slot="0"]');
  await page.locator('.rd-gcell:not(.blocked) .rd-gbtn').first().click();
  assert.notEqual(await rdCap(page), '0');
  assert.deepEqual(reqs.filter((u) => /\.(webm|webp)(\?|$)/.test(u)), [], 'no media or art requested');
});

await t('below 900px the stacked fallback is shown and the stage is not built into view', async (page) => {
  await page.goto(`${BASE}?tab=cyberware`);
  await page.waitForSelector('.sock');
  assert.equal(await page.locator('#rd-root').isVisible(), false);
  assert.equal(await noHScroll(page), true);
}, { viewport: { width: 700, height: 900 } });

await browser.close();
server.kill();
offline.kill();
for (const [name, ok, why] of results) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     ${why}`}`);
const failed = results.filter((r) => !r[1]).length;
console.log(`\nsmoke: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
