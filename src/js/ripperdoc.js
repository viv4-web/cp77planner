// Ripperdoc-style Cyberware screen: a 1920x1080 stage scaled to fit, positions and timings from data/ripperdoc/layout.json
// (numbers taken from the game's ripperdoc UI, see docs/RIPPERDOC-SPEC.md). Engine, data and URL format are untouched:
// this module only reads/writes the shared store through cyber.js (evaluate / canEquip / equip / unequip).
import { ICON_WARN } from './icons.js';
import { evaluate, canEquip, equip, unequip, slotKey, statLines, variantDiff } from './cyber.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const safe = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
};
// ink interpolation (type, mode) -> CSS timing function (docs/RIPPERDOC-SPEC.md section 6)
const BEZIER = {
  Quadratic: ['.11,0,.5,0', '.5,1,.89,1', '.45,0,.55,1'], Qubic: ['.32,0,.67,0', '.33,1,.68,1', '.65,0,.35,1'],
  Quartic: ['.5,0,.75,0', '.25,1,.5,1', '.76,0,.24,1'], Quintic: ['.64,0,.78,0', '.22,1,.36,1', '.83,0,.17,1'],
  Exponential: ['.7,0,.84,0', '.16,1,.3,1', '.87,0,.13,1'], Sinusoidal: ['.12,0,.39,0', '.61,1,.88,1', '.37,0,.63,1'],
};
const ease = (type, mode) => {
  const b = BEZIER[type];
  if (!b) return 'linear';
  return `cubic-bezier(${b[{ EasyIn: 0, EasyOut: 1, EasyInOut: 2 }[mode] ?? 2]})`;
};
const isSafari = () => /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
const motion = () => document.documentElement.getAttribute('data-motion') || 'full';
const tm = () => (motion() === 'calm' ? 0.5 : 1);      // Calm: shorter
const rarityOf = (q) => String(q).replace(/\+/g, '');
const plusOf = (q) => (String(q).match(/\+/g) || []).join('');

export async function initRipperdoc({ root, store, D, art, ui }) {
  const C = D.cyber;
  const L = await fetch('data/ripperdoc/layout.json').then((r) => r.json());
  const urls = ui || { parts: {}, clips: {} };
  const grpKey = (g) => g.id.replace(/^Slot\./, '');
  const zones = L.zones.map((z) => ({ ...z, g: C.groups.find((g) => grpKey(g) === z.group) })).filter((z) => z.g);
  const S = { gender: safe.get('cp77.gender') === 'man' ? 'man' : 'woman', open: null, hover: null, slot: 0, pick: new Map(), tip: null, pinned: false, prev: null, fresh: new Set() };
  const hitData = new Map();                              // `${gender}/${zone}` -> {w,h,data} alpha of the hover sprite

  root.innerHTML = `
    <div class="rd-fit" id="rd-fit"><div class="rd" id="rd" data-art="${Object.keys(urls.parts).length ? 'on' : 'off'}">
      <div class="rd-bg" id="rd-bg"></div>
      <div class="rd-layer rd-tab" id="rd-tab"></div>
      <div id="rd-canvases"></div>
      <div class="rd-tags" id="rd-tags"></div>
      <div class="rd-panel" id="rd-panel" hidden></div>
      <div class="rd-picker" id="rd-picker" hidden></div>
      <div class="rd-meter rd-cap" id="rd-cap"></div>
      <div class="rd-meter rd-armor" id="rd-arm"></div>
      <div class="rd-gender" id="rd-gender" role="group" aria-label="Body"><button type="button" data-g="woman">Woman</button><button type="button" data-g="man">Man</button></div>
      <div class="rd-tip" id="rd-tip" hidden role="tooltip"></div>
    </div></div>`;
  const $ = (id) => root.querySelector(id);
  const stage = $('#rd');
  for (const [k, v] of Object.entries(urls.parts)) stage.style.setProperty(`--p-${k.replace('/', '-')}`, `url("${new URL(v, document.baseURI).href}")`);      // atlas parts as mask images (absolute: a url() in a custom property resolves against the stylesheet)
  const bgPart = urls.parts['background/background'];
  if (bgPart) $('#rd-bg').style.backgroundImage = `url(${bgPart})`;

  // ---------- fit the 1920x1080 stage into the available area (letterbox)
  function fit() {
    const host = $('#rd-fit');
    const w = document.documentElement.clientWidth;
    const h = Math.max(320, window.innerHeight - root.getBoundingClientRect().top - 12);
    const s = Math.min(w / 1920, h / 1080);
    stage.style.setProperty('--rs', s.toFixed(4));
    stage.style.transform = `scale(${s})`;
    host.style.width = `${1920 * s}px`;
    host.style.height = `${1080 * s}px`;
    stage._s = s;
  }
  new ResizeObserver(fit).observe(root);
  window.addEventListener('resize', fit);

  // ---------- media
  const noAlpha = isSafari();
  const small = () => matchMedia('(max-width:1100px)').matches || navigator.connection?.saveData;
  function mediaOf(gender, clip) {
    const m = urls.clips[`${gender}/${clip}`];
    if (!m) return null;
    return { src: small() && m.sm ? m.sm : m.webm, poster: m.poster };
  }
  const usePoster = () => motion() === 'off' || noAlpha;
  function mount(el, gender, clip, { loop, autoplay }) {
    const m = mediaOf(gender, clip);
    el.innerHTML = '';
    if (!m) return null;
    const img = document.createElement('img');
    img.className = 'rd-poster'; img.alt = ''; img.src = m.poster; img.decoding = 'async';
    el.appendChild(img);
    const v = document.createElement('video');
    v.className = 'rd-video'; v.muted = true; v.playsInline = true; v.preload = 'none'; v.setAttribute('aria-hidden', 'true');
    v.dataset.src = m.src; v.loop = loop; v.disablePictureInPicture = true;
    v.addEventListener('playing', () => el.classList.add('live'));
    el.appendChild(v);
    el._v = v; el._autoplay = autoplay;
    return v;
  }
  function play(el, restart) {
    const v = el && el._v;
    if (!v || usePoster()) { el && el.classList.remove('live'); return; }
    if (!v.src) { v.src = v.dataset.src; }
    if (restart) { try { v.currentTime = 0; } catch (e) { /* not seekable yet */ } }
    v.loop = el._loop && motion() === 'full';
    const p = v.play(); if (p && p.catch) p.catch(() => el.classList.remove('live'));
  }
  function stop(el) { if (el && el._v) { el._v.pause(); } }
  function refreshMedia() {
    const body = $('#rd-body');
    if (usePoster()) { root.querySelectorAll('.rd-media').forEach((e) => { e.classList.remove('live'); stop(e); }); return; }
    if (body && !S.open) { body._loop = true; play(body, false); }
    if (S.open) { const c = root.querySelector(`.rd-clip[data-zone="${S.open}"]`); if (c) play(c, false); }
  }
  new MutationObserver(refreshMedia).observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });

  // ---------- doll layers (rebuilt when the body changes)
  const rect = (r) => `left:${r[0]}px;top:${r[1]}px;width:${r[2]}px;height:${r[3]}px`;
  function buildDoll() {
    const G = L.genders[S.gender];
    const piv = L.tabPivot;
    const tab = $('#rd-tab');
    tab.style.transformOrigin = `${piv[0]}px ${piv[1]}px`;
    tab.innerHTML = `<div class="rd-media rd-body" id="rd-body" style="${rect(G.body.rect)}"></div>` +
      zones.map((z) => {
        const sp = G.zones[z.key].sprite;
        const src = urls.parts[`${S.gender}_body/${sp.part}`];
        return `<div class="rd-sprite" data-zone="${z.key}" style="${rect(sp.rect)}">${src ? `<img alt="" src="${src}" draggable="false">` : ''}</div>`;
      }).join('');
    const body = $('#rd-body');
    body._loop = true;
    mount(body, S.gender, G.loop, { loop: true, autoplay: true });
    $('#rd-canvases').innerHTML = zones.map((z) => {
      const zi = G.zones[z.key];
      const cp = zi.canvasPivot;
      return `<div class="rd-layer rd-canvas" data-zone="${z.key}" style="transform-origin:${cp[0]}px ${cp[1]}px"><div class="rd-media rd-clip" data-zone="${z.key}" style="${rect(zi.clip.rect)}"></div></div>`;
    }).join('');
    for (const z of zones) {
      const el = root.querySelector(`.rd-clip[data-zone="${z.key}"]`);
      mount(el, S.gender, G.zones[z.key].clip.name, { loop: false, autoplay: false });
      if (el) el._loop = false;
      resetCanvas(z.key);
    }
    loadHit();
    refreshMedia();
    root.querySelectorAll('#rd-gender button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.g === S.gender)));
  }

  // ---------- zoom / fade transitions straight from the sequences
  const pick = (list, kind) => list.find((i) => i.kind === kind);
  const tf = (tr, sc) => `translate(${tr[0]}px,${tr[1]}px) scale(${sc[0]},${sc[1]})`;
  function transition(list) {
    const k = tm();
    const parts = [];
    const sc = pick(list, 'Scale') || pick(list, 'Translation');
    if (sc) parts.push(`transform ${(sc.dur * k).toFixed(3)}s ${ease(sc.type, sc.mode)} ${(sc.delay * k).toFixed(3)}s`);
    const op = pick(list, 'Transparency');
    if (op) parts.push(`opacity ${(op.dur * k).toFixed(3)}s ${ease(op.type, op.mode)} ${(op.delay * k).toFixed(3)}s`);
    return parts.join(',');
  }
  function endState(list, which) {      // which: 'from' | 'to'
    const t = pick(list, 'Translation'), s = pick(list, 'Scale'), o = pick(list, 'Transparency');
    return { transform: tf(t ? t[which] : [0, 0], s ? s[which] : [1, 1]), opacity: o ? o[which] : 1 };
  }
  function resetCanvas(key) {
    const el = root.querySelector(`.rd-canvas[data-zone="${key}"]`);
    const z = L.genders[S.gender].zones[key];
    const st = endState(z.intro.canvas, 'from');
    el.style.transition = 'none';
    el.style.transform = st.transform;
    el.style.opacity = 0;
    el.style.pointerEvents = 'none';
    el.classList.remove('on');
  }
  function openZone(key, instant) {
    if (S.open === key) return;
    if (S.open) closeNow();
    const z = L.genders[S.gender].zones[key];
    S.open = key; S.slot = 0;
    const tab = $('#rd-tab');
    const cv = root.querySelector(`.rd-canvas[data-zone="${key}"]`);
    void cv.offsetWidth;
    tab.style.transition = transition(z.intro.tab);
    const te = endState(z.intro.tab, 'to');
    tab.style.transform = te.transform; tab.style.opacity = te.opacity;
    cv.style.transition = transition(z.intro.canvas);
    const ce = endState(z.intro.canvas, 'to');
    cv.style.transform = ce.transform; cv.style.opacity = ce.opacity;
    cv.classList.add('on');
    stop($('#rd-body'));
    const clip = root.querySelector(`.rd-clip[data-zone="${key}"]`);
    play(clip, true);
    stage.dataset.open = key;
    render();
  }
  let closeTimer = 0;
  function closeZone() {
    if (!S.open) return;
    const key = S.open;
    const z = L.genders[S.gender].zones[key];
    const tab = $('#rd-tab');
    const cv = root.querySelector(`.rd-canvas[data-zone="${key}"]`);
    tab.style.transition = transition(z.outro.tab);
    tab.style.transform = 'none'; tab.style.opacity = 1;
    cv.style.transition = transition(z.outro.canvas);
    const ce = endState(z.outro.canvas, 'to');
    cv.style.transform = ce.transform; cv.style.opacity = ce.opacity;
    const clip = root.querySelector(`.rd-clip[data-zone="${key}"]`);
    const stopAt = (z.outro.clip ? z.outro.clip.dur : 0.5333) * tm() * 1000;      // StopVideo event of the outro
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { stop(clip); if (!S.open) { cv.classList.remove('on'); cv.style.pointerEvents = 'none'; } refreshMedia(); }, stopAt + 30);
    S.open = null; S.tip = null;
    delete stage.dataset.open;
    render();
  }
  function closeNow() {      // used when switching zone: snap the old one back, no animation
    const key = S.open;
    if (!key) return;
    const tab = $('#rd-tab');
    tab.style.transition = 'none'; tab.style.transform = 'none'; tab.style.opacity = 1;
    stop(root.querySelector(`.rd-clip[data-zone="${key}"]`));
    resetCanvas(key);
    S.open = null;
  }

  // ---------- hover sprites + hit testing on the sprite alpha
  function loadHit() {
    const G = L.genders[S.gender];
    for (const z of zones) {
      const k = `${S.gender}/${z.key}`;
      const src = urls.parts[`${S.gender}_body/${G.zones[z.key].sprite.part}`];
      if (!src || hitData.has(k)) continue;
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
          const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
          hitData.set(k, { w: c.width, h: c.height, data: x.getImageData(0, 0, c.width, c.height).data });
        } catch (e) { hitData.set(k, null); }
      };
      img.src = src;
    }
  }
  function zoneAt(x, y) {
    const G = L.genders[S.gender];
    const order = zones.slice().sort((a, b) => G.zones[a.key].sprite.rect[2] * G.zones[a.key].sprite.rect[3] - G.zones[b.key].sprite.rect[2] * G.zones[b.key].sprite.rect[3]);
    for (const z of order) {
      const r = G.zones[z.key].sprite.rect;
      if (x < r[0] || y < r[1] || x > r[0] + r[2] || y > r[1] + r[3]) continue;
      const h = hitData.get(`${S.gender}/${z.key}`);
      if (!h) continue;
      const px = Math.floor(((x - r[0]) / r[2]) * h.w), py = Math.floor(((y - r[1]) / r[3]) * h.h);
      if (h.data[(py * h.w + px) * 4 + 3] > 40) return z.key;
    }
    return null;
  }
  function setHover(key) {
    if (S.hover === key) return;
    S.hover = key;
    root.querySelectorAll('.rd-sprite').forEach((e) => e.classList.toggle('hot', e.dataset.zone === key));
    root.querySelectorAll('.rd-tag').forEach((e) => e.classList.toggle('hot', e.dataset.zone === key));
    stage.classList.toggle('over-zone', !!key);
  }
  const stagePoint = (e) => { const b = stage.getBoundingClientRect(); return [(e.clientX - b.left) / (stage._s || 1), (e.clientY - b.top) / (stage._s || 1)]; };
  stage.addEventListener('pointermove', (e) => {
    if (S.open) return;
    const [x, y] = stagePoint(e);
    const tag = e.target.closest('.rd-tag');
    setHover(tag ? tag.dataset.zone : zoneAt(x, y));
  });
  stage.addEventListener('pointerleave', () => { if (!S.open) setHover(null); });

  // ---------- state-driven parts
  const slotsOf = (g) => Array.from({ length: g.slots }, (_, p) => ({ p, key: slotKey(g.n, p) }));
  const qColor = (q) => `var(--t-Rarity-${rarityOf(q)},var(--t-MainColors-Grey,#A09A96))`;
  const glow = (name) => `var(--t-${name}-glow,none)`;

  function tagsHtml(ev) {
    return zones.map((z) => {
      const filled = slotsOf(z.g).filter((s) => ev.slots.has(s.key)).length;
      const pend = z.g.pendingData ? ' data-pending="1"' : '';
      return `<button type="button" class="rd-tag" data-zone="${z.key}"${pend} style="left:${z.anchor[0]}px;top:${z.anchor[1]}px" aria-label="${esc(z.g.name)}, ${filled} of ${z.g.slots} slots filled${z.g.pendingData ? ', pending data' : ''}">
        <i class="rd-tag-line"></i><span class="rd-tag-name">${esc(z.g.name)}</span><b class="rd-tag-n">${filled}/${z.g.slots}</b></button>`;
    }).join('');
  }

  // game item icon (cut from the item atlases) for a record; the legacy per-record art / placeholder glyph when there is none
  function iconHtml(imp) {
    const key = imp.icon || imp.iconName;
    const part = urls.icons && urls.icons[key];
    const src = part && urls.parts[part];
    return src ? `<img alt="" src="${src}" draggable="false" loading="lazy" decoding="async">` : art.html(imp.icon || imp.id);
  }
  // the slot tile layers of slots.inkwidget itemDisplay: background, lines, hover, frames, rarity strip, selected frames, equipped marker
  const TILE = '<i class="rd-m bg"></i><i class="rd-m ln"></i><i class="rd-m hv"></i><i class="rd-m fr"></i><i class="rd-m fe"></i><i class="rd-m side"></i><i class="rd-m sidefr"></i><i class="rd-m fl"></i><i class="rd-m sel"></i><i class="rd-m sel2"></i>';
  const cost = (n) => `<b class="rd-cost">${n}</b>`;

  const RL = { Common: 'C', Uncommon: 'U', Rare: 'R', Epic: 'E', Legendary: 'L', Iconic: 'I' };
  const rlabel = (imp) => `<i class="rd-rl" aria-hidden="true">${RL[rarityOf(imp.quality)] || ''}</i>`;
  const tileLabel = (imp, extra = '') => esc(`${imp.name}, ${imp.quality}${imp.variant > 1 ? ` #${imp.variant}` : ''}, capacity ${imp.cost}${extra}`);

  function cellHtml(s, ev, sel) {
    const e = ev.slots.get(s.key);
    const imp = e && e.implant;
    const flag = e && e.req.kind === 'unmet';
    const just = imp && S.fresh.has(s.key) ? ' just' : '';
    const fam = imp && C.familyOf.get(imp.family || imp.id);
    return `<button type="button" class="rd-tile rd-cell${imp ? ' full' : ''}${flag ? ' flag' : ''}${just}" data-slot="${s.p}" aria-pressed="${sel}" ${imp ? `data-imp="${imp.n}" data-fam="${esc(fam.key)}" data-cost="${imp.cost}"` : ''}
      style="--q:${imp ? qColor(imp.quality) : 'transparent'}" aria-label="${imp ? tileLabel(imp, `, slot ${s.p + 1}`) : esc(`Empty slot ${s.p + 1}`)}">${TILE}<i class="rd-m eqm"></i>
      ${imp ? `<span class="rd-ico">${iconHtml(imp)}</span>${rlabel(imp)}` : '<i class="rd-m rd-add"></i>'}</button>`;
  }
  function lockedHtml(g) {
    return Array.from({ length: g.locked || 0 }, (_, i) => `<span class="rd-tile rd-cell locked" role="img" aria-label="${esc(g.name)} slot ${g.slots + i + 1}, locked">${TILE}<i class="rd-lock"></i><span class="rd-locktxt">Locked</span></span>`).join('');
  }

  // left column: header "< ZONE >", one dash per body zone, the zone's slot tiles in a row
  function panelHtml(z, ev) {
    const s = slotsOf(z.g);
    const idx = zones.findIndex((x) => x.key === z.key);
    const dashes = zones.map((x, i) => `<button type="button" class="${i === idx ? 'on' : ''}" data-zone-go="${x.key}" aria-label="${esc(x.g.name)}" ${i === idx ? 'aria-current="true"' : ''}></button>`).join('');
    return `<button type="button" class="rd-back" data-act="back" aria-label="Back to the body">&larr;</button>
      <div class="rd-hdr"><button type="button" class="rd-arrow" data-zone-step="-1" aria-label="Previous body zone"><i class="chev l"></i></button><h2>${esc(z.g.name)}</h2><button type="button" class="rd-arrow" data-zone-step="1" aria-label="Next body zone"><i class="chev r"></i></button></div>
      <div class="rd-dots">${dashes}</div>
      <div class="rd-cells">${s.map((x) => cellHtml(x, ev, x.p === S.slot)).join('')}${lockedHtml(z.g)}</div>`;
  }

  function famCell(fam, chosen, state, key, equippedN) {
    const isEq = equippedN === chosen.n;
    const can = canEquip(C, D, state, key, chosen.n);
    const blocked = !isEq && !can.ok;
    return `<div class="rd-gcell${isEq ? ' eq' : ''}${blocked ? ' blocked' : ''}" style="--q:${qColor(chosen.quality)}">
      <button type="button" class="rd-tile rd-gbtn${isEq ? ' full' : ''}" data-imp="${chosen.n}" data-fam="${esc(fam.key)}" data-cost="${chosen.cost}" ${blocked ? 'aria-disabled="true"' : ''} ${isEq ? 'aria-pressed="true"' : ''} aria-label="${tileLabel(chosen, blocked ? ', over capacity' : '')}">${TILE}<i class="rd-m eqm"></i><span class="rd-ico">${iconHtml(chosen)}</span>${rlabel(chosen)}${blocked ? '<i class="rd-x" aria-hidden="true">&times;</i>' : ''}</button></div>`;
  }
  const GRID_MIN = 20;                          // the grid area is always drawn: 4 columns x 5 rows, "+" marks on the empty cells
  function pickerHtml(z, state) {
    const key = slotKey(z.g.n, S.slot);
    const equippedN = state.cyber.get(key);
    const fams = C.familiesByGroup.get(z.g.id);
    const cells = fams.map((fam) => {
      const chosen = fam.variants.find((v) => v.n === equippedN) || fam.variants.find((v) => v.n === S.pick.get(fam.key)) || fam.variants[0];
      return famCell(fam, chosen, state, key, equippedN);
    });
    const total = Math.max(GRID_MIN, Math.ceil(cells.length / 4) * 4);
    const empties = Array.from({ length: total - cells.length }, () => '<div class="rd-gempty" aria-hidden="true"></div>').join('');
    return `<div class="rd-pdiv"><i></i>${equippedN ? '<button type="button" class="rd-remove" data-act="remove">Remove</button>' : ''}</div>
      <div class="rd-grid" role="group" aria-label="${esc(z.g.name)} implants, slot ${S.slot + 1}">${cells.join('')}${empties}</div>
      ${cells.length ? '' : `<p class="rd-empty">${ICON_WARN}<span>${z.g.pendingData ? `Pending data: ${esc(z.g.pendingData)}` : 'No implants for this slot in the data yet.'}</span></p>`}`;
  }

  // ---------- capacity meter (left) and armor meter (right): one construction, two-column bars stacked from the bottom
  const SEG_H = 13.5, SEG_W = 98;
  const warnSvg = '<svg class="mi" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2l7 12H1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6.5v3.5M8 11.6v.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  const seg = (cls, y, x) => `${cls === 'e' ? '' : `<i class="rd-seghl ${cls}" style="top:${y}px;left:${x}px"></i>`}<i class="rd-seg ${cls}" style="top:${y}px;left:${x}px"><i></i><i></i></i>`;
  function capHtml(ev, preview) {
    const m = L.meters.capacity;
    const max = ev.max;
    const bg = urls.parts['cw_bars_assets/cw_barbg'];
    const top = m.origin[1] + 22, left = m.origin[0] + m.bgOffset[0] + (123 - SEG_W) / 2;
    const bottom = top + max * SEG_H;
    const capLeft = m.origin[0] + m.bgOffset[0];
    const segs = [];
    // the meter keeps its height: rows are clamped to the limit and the amount over is carried by the "OVER BY n" text and the marker
    const afterAll = ev.used + Math.max(0, preview), overUsed = Math.max(0, ev.used - max), overAll = Math.max(0, afterAll - max);
    const litTo = Math.min(ev.used, max), addTo = Math.min(afterAll, max);
    for (let i = 0; i < max; i++) {            // i = 0 is the bottom segment
      let cls = 'e';
      if (i < litTo) cls = i >= max - overUsed ? 'unsafe' : 'safe';
      else if (preview > 0 && i < addTo) cls = overAll > 0 ? 'unsafe-add' : 'safe-add';
      else if (preview > 0 && overAll > 0 && i === max - 1) cls = 'unsafe-add';      // already full: the top row hints at the overflow
      segs.push(seg(cls, bottom - (i + 1) * SEG_H, left));
    }
    const labelY = bottom - Math.min(ev.used, max) * SEG_H - 17;
    const over = ev.used > max;
    const after = ev.used + Math.max(0, preview);
    const overBy = Math.max(0, after - max);          // shown as text and a marker shape, never by color alone
    return `<div class="rd-capbg" style="left:${capLeft}px;top:${m.origin[1] + m.bgOffset[1]}px">${bg ? `<img alt="" src="${bg}">` : ''}</div>
      <i class="rd-mico cap" style="left:${left + SEG_W / 2 - 14}px;top:${top - 50}px" aria-hidden="true"></i>
      ${segs.join('')}
      <span class="rd-limit" style="left:${left}px;top:${top - 1}px;width:${SEG_W}px"></span>
      <b class="rd-lab max" style="left:${left + SEG_W + 8}px;top:${top - 12}px" title="Capacity (provisional: growth by level is pending data)">${max}</b>
      <b class="rd-lab cur${over ? ' unsafe' : ''}" style="left:${left + SEG_W + 8}px;top:${labelY}px" data-over="${over}">${ev.used}</b>
      ${overBy > 0 ? `<i class="rd-over-mark" style="left:${left - 14}px;top:${top - 7}px" aria-hidden="true"></i>` : ''}
      ${preview > 0 ? `<b class="rd-lab add${overBy > 0 ? ' unsafe' : ''}" style="left:${capLeft}px;top:${bottom + 54 + (over ? 34 : 0)}px">${overBy > 0 ? `${warnSvg}OVER BY ${overBy}` : `+${preview}`}</b>` : ''}
      ${over ? `<b class="rd-lab over" style="left:${capLeft}px;top:${bottom + 54}px">${warnSvg}OVER BY ${ev.used - max}</b>` : ''}
      <span class="sr" aria-live="polite">Capacity ${ev.used} of ${max}${preview > 0 ? (overBy > 0 ? `, this pick would be over by ${overBy}` : `, this pick adds ${preview}`) : ''}${over ? `, over by ${ev.used - max}` : ''}</span>
      <span class="rd-captitle" style="left:${capLeft}px;top:${bottom + 14}px">Capacity<small>provisional</small></span>`;
  }
  // armor (cyan): same construction, no value until the armor rules are decoded
  function armHtml() {
    const m = L.meters.armor, max = 27;
    const bg = urls.parts['cw_bars_assets/armor_barbg'];
    const top = L.meters.capacity.origin[1] + 22, armLeft = m.origin[0] + m.bgOffset[0], left = armLeft + (123 - SEG_W) / 2;
    const bottom = top + max * SEG_H;
    const segs = Array.from({ length: max }, (_, i) => seg('e', bottom - (i + 1) * SEG_H, left)).join('');
    return `<div class="rd-capbg arm" style="left:${armLeft}px;top:${m.origin[1] + m.bgOffset[1]}px">${bg ? `<img alt="" src="${bg}">` : ''}</div>
      <i class="rd-mico arm" style="left:${left + SEG_W / 2 - 14}px;top:${top - 50}px" aria-hidden="true"></i>
      ${segs}
      <span class="rd-limit arm" style="left:${left}px;top:${top - 1}px;width:${SEG_W}px"></span>
      <b class="rd-lab max arm" style="left:${left - 62}px;top:${top - 12}px" title="Armor total: pending data">&mdash;</b>
      <span class="rd-captitle arm" style="left:${armLeft}px;top:${bottom + 14}px">Armor<small>pending data</small></span>
      <span class="sr">Armor: pending data, not decoded yet</span>`;
  }

  // ---------- tooltip (itemtooltip layout) with the planner extras: capacity, stats, quality / variant choice, over-capacity cue
  const openZoneDef = () => zones.find((x) => x.key === S.open);
  function tipExtra(imp) {
    const z = openZoneDef(), key = slotKey(z.g.n, S.slot);
    const cur = C.implants.get(store.get().cyber.get(key));
    if (cur && cur.n === imp.n) return '';
    const can = canEquip(C, D, store.get(), key, imp.n);
    return can.ok ? '' : `OVER BY ${can.need}`;
  }
  const qlabel = (v) => `${rarityOf(v.quality)}${plusOf(v.quality)}`;
  function tipHtml(imp, extra, groupName) {
    const lines = statLines(imp);
    const fam = C.familyOf.get(imp.family || imp.id);
    const sibs = fam.variants.filter((o) => o.tier === imp.tier);                 // same quality: the #1 / #2 variants
    const diff = sibs.filter((o) => o.n !== imp.n).map((o) => `vs #${o.variant}: ${variantDiff(imp, o).join(' · ') || 'same stats'}`);
    // quality stepper: one entry per quality, in order; stepping keeps the variant number when the next quality has it
    const quals = [...new Map(fam.variants.slice().sort((x, y) => x.tier - y.tier || x.variant - y.variant).map((v) => [v.tier, v])).keys()];
    const qi = quals.indexOf(imp.tier);
    const pickQ = (tier) => { const o = fam.variants.filter((v) => v.tier === tier); return o.find((v) => v.variant === imp.variant) || o[0]; };
    const prev = qi > 0 ? pickQ(quals[qi - 1]) : null, next = qi < quals.length - 1 ? pickQ(quals[qi + 1]) : null;
    const costs = new Set(fam.variants.map((v) => v.cost));
    const step = (v, cls, label) => `<button type="button" class="${cls}" ${v ? `data-pip="${v.n}" aria-label="${esc(`${label} quality: ${qlabel(v)}, capacity ${v.cost}`)}"` : `disabled aria-label="${label} quality: none"`}><i></i></button>`;
    const stepper = quals.length > 1 ? `<div class="rd-qstep" role="group" aria-label="Quality">${step(prev, 'p', 'Lower')}<span style="--q:${qColor(imp.quality)}">${esc(qlabel(imp))}<small>${qi + 1}/${quals.length}</small></span>${step(next, 'n', 'Higher')}</div>` : '';
    const qcost = quals.length > 1 && costs.size > 1 ? `<span class="rd-qcost">${prev ? `${prev.cost} &larr; ` : ''}<b>${imp.cost}</b>${next ? ` &rarr; ${next.cost}` : ''}</span>` : '';
    const tog = sibs.length > 1 ? `<div class="rd-vtog" role="group" aria-label="Variant">${sibs.map((o) => `<button type="button" data-pip="${o.n}" class="${o.n === imp.n ? 'on' : ''}" aria-pressed="${o.n === imp.n}">#${o.variant}</button>`).join('')}</div>` : '';
    return `<i class="rd-tipstroke"></i><i class="rd-tipfill"></i><div class="rd-tipc" style="--q:${qColor(imp.quality)}">
      <div class="rd-tip-band"><div class="rd-tip-name">${esc(imp.name)}</div></div>
      <div class="rd-tip-sub">${esc(qlabel(imp))}${imp.variant > 1 || sibs.length > 1 ? ` #${imp.variant}` : ''} &middot; ${esc(groupName || 'Cyberware')}</div>
      <div class="rd-tip-cap"><i class="ric"></i><b>${imp.cost}</b><span class="lbl">Capacity</span>${extra ? `<span class="rd-tip-over rd-tip-warn" role="status">${ICON_WARN}<span>${esc(extra)}</span></span>` : ''}</div>
      ${stepper || tog ? `<div class="rd-tip-q">${stepper}${qcost}${tog}</div>` : ''}
      ${lines.length ? `<ul class="rd-tip-stats">${lines.slice(0, 8).map((l) => `<li>${esc(l)}</li>`).join('')}${lines.length > 8 ? `<li class="more">+${lines.length - 8} more</li>` : ''}</ul>` : '<p class="rd-tip-none">No stat modifiers in the data.</p>'}
      ${diff.length ? `<p class="rd-tip-diff"><i class="cmp"></i><span>${esc(diff.join(' | '))}</span></p>` : ''}</div>`;
  }
  let hideT = 0;
  function showTip(target, imp) {
    clearTimeout(hideT);
    const tip = $('#rd-tip');
    const zg = openZoneDef();
    const extra = tipExtra(imp);
    S.tip = { fam: C.familyOf.get(imp.family || imp.id).key, slot: !!target.closest('#rd-panel') };
    tip.innerHTML = tipHtml(imp, extra, zg && zg.g.name);
    tip.classList.toggle('over', !!extra);
    tip.classList.toggle('pinned', !!S.pinned);
    tip.hidden = false;
    const b = stage.getBoundingClientRect(), t = target.getBoundingClientRect(), sc = stage._s || 1;
    const y = (t.top - b.top) / sc;
    // the empty space between the left column and the body: just right of the grid, never over it
    tip.style.left = `${L.panel.origin[0] + L.inventory.grid[0] + 24}px`;
    tip.style.top = `${Math.max(110, Math.min(y - 8, 1060 - tip.offsetHeight))}px`;
  }
  const hideTip = () => { $('#rd-tip').hidden = true; S.tip = null; S.pinned = false; };
  const hideSoon = () => { if (S.pinned) return; clearTimeout(hideT); hideT = setTimeout(hideTip, 180); };
  function tileOf(fam, inPanel) {
    return [...root.querySelectorAll(inPanel ? '#rd-panel .rd-cell[data-fam]' : '#rd-picker .rd-gbtn[data-fam]')].find((e) => e.dataset.fam === fam);
  }
  function refreshTip() {      // tiles are rebuilt on every render: put the open tooltip back on the same item
    if (!S.tip || $('#rd-tip').hidden) return;
    const el = tileOf(S.tip.fam, S.tip.slot);
    if (!el) { hideTip(); return; }
    showTip(el, C.implants.get(Number(el.dataset.imp)));
  }

  // ---------- render
  function render() {
    const state = store.get();
    const ev = evaluate(C, D, state);
    const cur = new Map([...ev.slots].filter(([, e]) => e.implant).map(([k, e]) => [k, e.implant.n]));
    S.fresh = new Set(S.prev ? [...cur].filter(([k, n]) => S.prev.get(k) !== n).map(([k]) => k) : []);      // slots filled since the last render: the equip flash
    S.prev = cur;
    $('#rd-tags').innerHTML = S.open ? '' : tagsHtml(ev);
    $('#rd-cap').innerHTML = capHtml(ev, S.preview || 0);
    $('#rd-arm').innerHTML = armHtml();
    const panel = $('#rd-panel'), picker = $('#rd-picker');
    const z = openZoneDef();
    panel.hidden = picker.hidden = !z;
    if (z) {
      const [px, py] = L.panel.origin;
      panel.style.left = picker.style.left = `${px}px`;
      panel.style.top = `${py}px`;
      picker.style.top = `${py + L.panel.gridTop}px`;
      picker.style.width = `${L.inventory.grid[0] + 8}px`;
      panel.innerHTML = panelHtml(z, ev);
      const sc = picker.querySelector('.rd-grid')?.scrollTop || 0;
      picker.innerHTML = pickerHtml(z, state);
      const g = picker.querySelector('.rd-grid'); if (g) g.scrollTop = sc;
    }
    root.querySelectorAll('#rd-gender button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.g === S.gender)));
    refreshTip();
  }

  // ---------- events
  root.addEventListener('click', (e) => {
    if (!e.target.closest('#rd-tip,.rd-gbtn,.rd-cell')) { S.pinned = false; if (!$('#rd-tip').hidden) hideTip(); }
    const g = e.target.closest('#rd-gender button');
    if (g) { if (g.dataset.g !== S.gender) { closeNow(); S.gender = g.dataset.g; safe.set('cp77.gender', S.gender); S.open = null; delete stage.dataset.open; hideTip(); buildDoll(); render(); } return; }
    const tag = e.target.closest('.rd-tag');
    if (tag) { openZone(tag.dataset.zone); return; }
    const back = e.target.closest('[data-act=back]');
    if (back) { hideTip(); closeZone(); return; }
    const step = e.target.closest('[data-zone-step]');
    const go = e.target.closest('[data-zone-go]');
    if (step || go) {
      const i = zones.findIndex((x) => x.key === S.open);
      const k = go ? go.dataset.zoneGo : zones[(i + Number(step.dataset.zoneStep) + zones.length) % zones.length].key;
      hideTip(); closeNow(); openZone(k); return;
    }
    const cell = e.target.closest('.rd-panel .rd-cell[data-slot]');
    if (cell) { S.slot = Number(cell.dataset.slot); render(); return; }
    if (e.target.closest('[data-act=remove]')) {
      const z = openZoneDef();
      const r = unequip(C, D, store.get(), slotKey(z.g.n, S.slot));
      if (r.ok) store.set(r.state);
      return;
    }
    const pip = e.target.closest('[data-pip]');
    if (pip) {
      const n = Number(pip.dataset.pip), imp = C.implants.get(n);
      const fam = C.familyOf.get(imp.family || imp.id);
      S.pick.set(fam.key, n);
      const z = openZoneDef(), key = slotKey(z.g.n, S.slot);
      if (fam.variants.some((v) => v.n === store.get().cyber.get(key))) { const r = equip(C, D, store.get(), key, n); if (r.ok) { store.set(r.state); return; } }
      render(); return;
    }
    const gb = e.target.closest('.rd-gbtn');
    if (gb) {
      S.pinned = true;                                  // a click or tap pins the tooltip so its quality choice can be used
      if (gb.getAttribute('aria-disabled') !== 'true') {
        const z = openZoneDef();
        const r = equip(C, D, store.get(), slotKey(z.g.n, S.slot), Number(gb.dataset.imp));
        if (r.ok) { store.set(r.state); return; }
      }
      showTip(gb, C.implants.get(Number(gb.dataset.imp)));
    }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !$('#rd-tip').hidden && (S.pinned || $('#rd-tip').contains(document.activeElement))) {
      const b = $('#rd-tip').querySelector(e.key === 'ArrowLeft' ? '.rd-qstep .p' : '.rd-qstep .n');
      if (b && !b.disabled) { e.preventDefault(); b.click(); }
      return;
    }
    if (e.key === 'Escape' && S.pinned) { hideTip(); return; }
    if (e.key === 'Escape' && S.open) { hideTip(); closeZone(); }
  });
  // sprite click (alpha hit test) and tooltips / capacity preview
  stage.addEventListener('click', (e) => {
    if (S.open || e.target.closest('button,.rd-tag')) return;
    const [x, y] = stagePoint(e);
    const k = zoneAt(x, y);
    if (k) openZone(k);
  });
  function previewFor(imp) {
    const z = openZoneDef(), key = slotKey(z.g.n, S.slot);
    const cur = C.implants.get(store.get().cyber.get(key));
    S.preview = cur && cur.n === imp.n ? 0 : imp.cost - (cur ? cur.cost : 0);
    $('#rd-cap').innerHTML = capHtml(evaluate(C, D, store.get()), Math.max(0, S.preview));
  }
  const tileEl = (t) => t.closest('.rd-gbtn,.rd-panel .rd-cell.full');
  function over(e) {
    if (e.target.closest('#rd-tip')) { clearTimeout(hideT); return; }
    const el = tileEl(e.target);
    if (!el || !S.open) return;
    const imp = C.implants.get(Number(el.dataset.imp));
    if (S.pinned && S.tip && S.tip.fam !== C.familyOf.get(imp.family || imp.id).key) S.pinned = false;      // hovering another item replaces a pinned tooltip
    if (el.classList.contains('rd-gbtn')) previewFor(imp);
    showTip(el, imp);
  }
  stage.addEventListener('pointerover', over);
  root.addEventListener('focusin', (e) => { const el = tileEl(e.target); if (el && S.open) over(e); });
  const leave = (e) => {
    if (e.target.closest('.rd-gbtn,.rd-panel .rd-cell,#rd-tip')) {
      if (S.preview && e.target.closest('.rd-gbtn')) { S.preview = 0; $('#rd-cap').innerHTML = capHtml(evaluate(C, D, store.get()), 0); }
      hideSoon();
    }
  };
  stage.addEventListener('pointerout', leave);
  root.addEventListener('focusout', leave);

  store.subscribe(render);
  fit();
  buildDoll();
  render();
  if (new URLSearchParams(location.search).get('zone')) {      // deep link for screenshots and tests: ?tab=cyberware&zone=frontal_cortex
    const q = new URLSearchParams(location.search).get('zone');
    if (zones.some((z) => z.key === q)) { openZone(q); }
  }
  return { open: openZone, close: closeZone, state: S };
}
