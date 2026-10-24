import { commitLevel, stepLevel, canStep } from './level.js';
import {
  pools, perkStatus, canInstall, canRefund, install, refund, setAttr, setLevel, minLevel,
} from './rules.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ICON_LOCK = '<svg class="mi" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 7V5a3.5 3.5 0 017 0v2M3 7h10v7H3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
const ICON_CHECK = '<svg class="mi" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const REASON = {
  locked: 'Locked: requirement not met.',
  'no-points': 'No points left to spend.',
  owned: 'Already installed.',
  required: 'Other installed perks depend on this one.',
};

export function initCharacter({ root, store, D, art }) {
  const sel = { tree: D.trees[0].key, perk: D.trees[0].perks[0].n };
  let justInstalled = null;
  let first = true;

  root.innerHTML = `
    <div class="stack">
      <div class="page-head boot" style="--i:0">
        <div>
          <span class="label">01 // CHARACTER</span>
          <h1 class="chrome-text" id="c-title">V · Level 1</h1>
        </div>
        <div class="pts" id="c-pts"></div>
      </div>
      <div class="lvl boot" style="--i:1">
        <label for="c-level-box" class="lvl-label">Level</label>
        <div class="lvl-ctl">
          <button type="button" class="btn ghost cutline chrome stp" id="c-level-dec" aria-label="Decrease level">−</button>
          <span class="lbox-wrap"><span class="lbox cutline"><input id="c-level-box" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="off" value="1" aria-describedby="c-level-hint"></span></span>
          <button type="button" class="btn ghost cutline chrome stp" id="c-level-inc" aria-label="Increase level">+</button>
        </div>
        <input id="c-level" class="lvl-slider" type="range" min="1" max="${D.rules.maxLevel}" step="1" value="1" aria-label="Level slider" aria-describedby="c-level-hint">
        <p class="lvl-hint mono" id="c-level-hint">1–${D.rules.maxLevel}</p>
      </div>
      <div class="rail" id="c-rail" aria-label="Attributes"></div>
      <div class="work">
        <section class="panel cut boot" style="--i:7" id="c-tree" aria-label="Perk tree"></section>
        <aside class="panel cut detail boot" style="--i:8" id="c-detail" aria-label="Perk detail"></aside>
      </div>
    </div>`;
  const $ = (id) => root.querySelector(id);
  const slider = $('#c-level');
  const box = $('#c-level-box');
  const decBtn = $('#c-level-dec');
  const incBtn = $('#c-level-inc');

  const treeOf = (key) => D.trees.find((t) => t.key === key);

  function renderHead(state) {
    const p = pools(D, state);
    $('#c-title').textContent = `V · Level ${state.level}`;
    if (!(document.activeElement === box && box.dataset.dirty)) box.value = state.level;   // never jump while typing
    const cs = canStep(D, state);
    for (const [btn, ok] of [[decBtn, cs.dec], [incBtn, cs.inc]]) {
      btn.disabled = !ok;
      if (ok) btn.removeAttribute('aria-disabled'); else btn.setAttribute('aria-disabled', 'true');
    }
    slider.value = state.level;
    slider.setAttribute('aria-valuetext', `Level ${state.level}`);
    $('#c-pts').innerHTML = `
      <div class="pt attr"><small>Attribute pts</small><b>${p.attrFree}</b></div>
      <div class="pt perk"><small>Perk pts</small><b>${p.perkFree}</b></div>
      <div class="pt relic"><small>Relic pts</small><b>${p.relicFree}</b></div>`;
  }

  function renderRail(state) {
    const rail = $('#c-rail');
    const left = rail.scrollLeft;
    const p = pools(D, state);
    rail.innerHTML = D.trees.map((t, i) => {
      const isAttr = t.kind === 'attribute';
      const idx = D.attrTrees.indexOf(t);
      const v = isAttr ? state.attrs[idx] : p.relicSpent;
      const max = isAttr ? D.rules.attrMax : p.relicTotal;
      const on = sel.tree === t.key;
      const step = isAttr ? `
        <span class="step">
          <button type="button" data-attr="${idx}" data-d="-1" aria-label="Decrease ${esc(t.name)}" ${setAttrBlocked(state, idx, -1) ? 'disabled aria-disabled="true"' : ''}>−</button>
          <button type="button" data-attr="${idx}" data-d="1" aria-label="Increase ${esc(t.name)}" ${setAttrBlocked(state, idx, 1) ? 'disabled aria-disabled="true"' : ''}>+</button>
        </span>` : '';
      return `
        <div class="acard ${on ? 'on cutline chrome' : 'cut'} ${first ? 'boot' : ''}" data-k="${t.key}" style="--i:${i + 2};--p:${(v / max).toFixed(3)}">
          <button type="button" class="sel" data-tree="${t.key}" aria-pressed="${on}" aria-label="${esc(t.name)} tree"></button>
          <i class="shine"></i><i class="brk"></i>
          <span class="idx">${String(i + 1).padStart(2, '0')}${t.kind === 'relic' ? ' · PL' : ''}</span>
          <span class="nm">${esc(t.name)}</span>
          <span class="val">${v}<small>/${max}</small></span>
          <span class="bar"><i></i></span>
          ${step}
        </div>`;
    }).join('');
    rail.scrollLeft = left;
  }

  function setAttrBlocked(state, idx, d) {
    const r = setAttr(D, state, idx, state.attrs[idx] + d);
    return !r.ok;
  }

  function renderTree(state) {
    const t = treeOf(sel.tree);
    const tiers = t.tierReq.map((req, ti) => {
      const nodes = t.perks.filter((p) => p.tier === ti).map((p) => {
        const s = perkStatus(D, state, p.n);
        const on = sel.perk === p.n;
        return `
          <div class="nodewrap" data-s="${s}">
            <i class="ping"></i>
            <span class="nbox" data-sel="${on}">
              <button type="button" class="node cutline ${justInstalled === p.n ? 'installing' : ''}" data-s="${s}" data-perk="${p.n}" aria-pressed="${on}" aria-label="${esc(p.name)}, ${s}">
                ${art.html(p.id)}<i class="plate"></i>
              </button>
            </span>
            <span class="pn">${esc(p.name)}${p.new ? '<span class="newb">NEW</span>' : ''}</span>
          </div>`;
      }).join('');
      const reqTxt = t.gate === 'value' ? `REQ <b>${req}</b>` : `SPENT <b>${req}</b>`;
      return `<div class="tier"><h3>${reqTxt}</h3><div class="nodes">${nodes}</div></div>`;
    }).join('');
    const n = t.tierReq.length;
    $('#c-tree').innerHTML = `
      <svg class="trace tree" viewBox="0 0 200 70" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 62H46L66 42H120L140 22H200"/><path class="pulse" pathLength="100" d="M0 62H46L66 42H120L140 22H200"/>
        <path d="M30 70V54L50 34H90"/><path class="pulse p2" pathLength="100" d="M30 70V54L50 34H90"/>
      </svg>
      <span class="tree-name" aria-hidden="true">${esc(t.name)}</span>
      <span class="label">02 // PERK TREE</span>
      <h2 class="tree-title chrome-text">${esc(t.name)}</h2>
      <div class="tiers ${n === 3 ? 't3' : ''}">${tiers}</div>`;
  }

  function renderDetail(state) {
    const e = D.perks.get(sel.perk);
    if (!e) { $('#c-detail').innerHTML = '<span class="label">03 // IMPLANT SOCKET</span><p class="empty">Select a perk.</p>'; return; }
    const { perk, tree, req } = e;
    const s = perkStatus(D, state, perk.n);
    const ins = canInstall(D, state, perk.n);
    const ref = canRefund(D, state, perk.n);
    const reqLabel = tree.gate === 'value' ? `REQ ${req} ${tree.name.toUpperCase()}` : `REQ ${req} SPENT`;
    const hint = s === 'owned' ? (ref.ok ? REASON.owned : REASON[ref.reason] || '') : (ins.ok ? '' : REASON[ins.reason] || '');
    $('#c-detail').innerHTML = `
      <svg class="trace det" viewBox="0 0 300 150" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 18H50L80 48H100L116 84H126"/><path class="pulse" pathLength="100" d="M0 18H50L80 48H100L116 84H126"/>
        <path d="M300 18H250L220 48H200L184 84H174"/><path class="pulse p2" pathLength="100" d="M300 18H250L220 48H200L184 84H174"/>
      </svg>
      <span class="label">03 // IMPLANT SOCKET</span>
      <div class="socket" aria-hidden="true">
        <i class="ring"></i><i class="ring r2"></i><i class="hex"></i>
        <div class="core">${art.html(perk.id)}<i class="scan"></i></div>
      </div>
      <h2 class="pname chrome-text">${esc(perk.name)}</h2>
      ${perk.new ? '<div><span class="badge-new">NEW</span></div>' : ''}
      <div class="meta">
        <span class="cutline ${s === 'locked' ? 'unmet' : 'met'}">${s === 'locked' ? ICON_LOCK : ICON_CHECK}${reqLabel}</span>
        <span class="cutline">TIER ${perk.tier + 1}/${tree.tierReq.length}</span>
        <span class="cutline">${s.toUpperCase()}</span>
      </div>
      <p class="desc">${esc(perk.desc)}</p>
      <div class="actions">
        <button type="button" class="btn primary cutline" data-act="install" aria-describedby="c-hint" ${ins.ok ? '' : 'disabled aria-disabled="true"'}>Install</button>
        <button type="button" class="btn ghost cutline chrome" data-act="refund" aria-describedby="c-hint" ${ref.ok ? '' : 'disabled aria-disabled="true"'}>Refund</button>
      </div>
      <p class="hint" id="c-hint">${esc(hint)}</p>`;
  }

  function renderAll(state) {
    renderHead(state); renderRail(state); renderTree(state); renderDetail(state);
    first = false;
  }

  // ---- events ----
  slider.addEventListener('input', () => {
    store.set(setLevel(D, store.get(), Number(slider.value)));
  });

  // ---- typed level box + steppers ----
  const setLv = (next) => { store.set(next); };
  function applyBox() {
    delete box.dataset.dirty;
    setLv(commitLevel(D, store.get(), box.value));
    box.value = store.get().level;                       // empty/invalid reverts; out-of-range shows the clamped value
  }
  box.addEventListener('input', () => {
    const digits = box.value.replace(/\D/g, '');
    if (digits !== box.value) box.value = digits;        // digits only
    box.dataset.dirty = '1';
  });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyBox(); return; }
    const step = { ArrowUp: 1, ArrowDown: -1 }[e.key];
    if (step || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();                                // only while the box has focus: no global handlers
      delete box.dataset.dirty;
      const st = store.get();
      const typed = commitLevel(D, st, box.value);       // start from what is typed, if valid
      if (e.key === 'Home') setLv(commitLevel(D, st, '1'));
      else if (e.key === 'End') setLv(commitLevel(D, st, String(D.rules.maxLevel)));
      else setLv(stepLevel(D, typed, step * (e.shiftKey ? 5 : 1)));
      box.value = store.get().level;
    }
  });
  box.addEventListener('blur', () => { if (box.dataset.dirty || box.value === '') applyBox(); });

  // Press-and-hold: one step on press, repeat after 400 ms.
  function bindStepper(btn, delta) {
    let t1 = 0, t2 = 0;
    const once = () => { const before = store.get().level; setLv(stepLevel(D, store.get(), delta)); return store.get().level !== before; };
    const stop = () => { clearTimeout(t1); clearInterval(t2); };
    btn.addEventListener('pointerdown', (e) => {
      if (btn.disabled || e.button > 0) return;
      once();
      t1 = setTimeout(() => { t2 = setInterval(() => { if (!once()) stop(); }, 70); }, 400);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) btn.addEventListener(ev, stop);
    btn.addEventListener('click', (e) => { if (e.detail === 0 && !btn.disabled) once(); });   // keyboard activation
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  bindStepper(decBtn, -1);
  bindStepper(incBtn, 1);

  function selectTree(key) {
    sel.tree = key;
    sel.perk = treeOf(key).perks[0].n;
    renderAll(store.get());
  }

  $('#c-rail').addEventListener('click', (e) => {
    const stepBtn = e.target.closest('button[data-attr]');
    if (stepBtn) {
      const idx = Number(stepBtn.dataset.attr);
      const st = store.get();
      const r = setAttr(D, st, idx, st.attrs[idx] + Number(stepBtn.dataset.d));
      if (r.ok) store.set(r.state);
      return;
    }
    const b = e.target.closest('button[data-tree]');
    if (b && b.dataset.tree !== sel.tree) selectTree(b.dataset.tree);
  });

  $('#c-tree').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-perk]');
    if (!b) return;
    sel.perk = Number(b.dataset.perk);
    renderTree(store.get()); renderDetail(store.get());
  });

  $('#c-detail').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b || b.disabled) return;
    const st = store.get();
    if (b.dataset.act === 'install') {
      const r = install(D, st, sel.perk);
      if (!r.ok) return;
      justInstalled = sel.perk;
      store.set(r.state);
      setTimeout(() => { justInstalled = null; root.querySelector('.node.installing')?.classList.remove('installing'); }, 1000);
    } else {
      const r = refund(D, st, sel.perk);
      if (r.ok) store.set(r.state);
    }
  });

  store.subscribe((state) => {
    // Level can't go below what is already spent; keep the slider honest.
    if (state.level < minLevel(D, state)) return;
    renderAll(state);
  });
}
