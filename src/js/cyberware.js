import { ICON_LOCK, ICON_CHECK, ICON_PLUS, ICON_WARN } from './icons.js';
import { evaluate, canEquip, equip, unequip, slotKey, reqStatus, statLines, variantDiff } from './cyber.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const REASON = { 'over-capacity': 'Over capacity' };

export function initCyberware({ root, store, D, art }) {
  const C = D.cyber;
  const first = C.groups[0];
  const sel = { key: slotKey(first.n, 0), open: false, pick: new Map() };   // pick: family key -> chosen variant n

  const cur = () => store.get();
  const slotInfo = (key) => {
    const [g, p] = key.split('.').map(Number);
    return { group: C.groupByN.get(g), pos: p };
  };

  function socket(key, group, pos, ev) {
    const s = ev.slots.get(key);
    const on = sel.key === key;
    const state = !s ? 'empty' : s.req.kind === 'unmet' ? 'flag' : 'filled';
    const label = `${group.name} slot ${pos + 1}, ${s ? `${s.implant.name}${state === 'flag' ? ', requirement not met' : ''}` : 'empty'}`;
    return `<span class="nbox" data-sel="${on}" style="--nb:56px"><button type="button" class="sock cutline ${state === 'filled' ? 'chrome' : ''}" data-key="${key}" data-s="${state}" aria-pressed="${on}" aria-label="${esc(label)}">${s ? art.html(s.implant.icon || s.implant.id) : ICON_PLUS}</button></span>`;
  }

  function groupsHtml(ev) {
    const sil = art.resolve('UI.BodySilhouette');
    const silHtml = sil.kind === 'art'
      ? `<img class="cw-sil" src="${sil.src}" alt="">`
      : '<img class="cw-sil" src="img/placeholder/silhouette.svg" alt="">';
    const groups = C.groups.map((g) => {
      let filled = 0;
      const socks = [];
      for (let p = 0; p < g.slots; p++) {
        const key = slotKey(g.n, p);
        if (ev.slots.has(key)) filled++;
        socks.push(socket(key, g, p, ev));
      }
      for (let l = 0; l < (g.locked || 0); l++) {
        socks.push(`<span class="nbox" style="--nb:56px"><button type="button" class="sock cutline dashed" data-s="locked" disabled aria-disabled="true" aria-label="${esc(g.name)} slot ${g.slots + l + 1}, locked">${ICON_LOCK}</button></span>`);
      }
      return `<div class="cw-group"><h3><span>${esc(g.name)}</span>${g.pendingData ? '<em class="cw-pend mono">pending data</em>' : ''}<b class="mono">${filled}/${g.slots}</b></h3><div class="cw-socks">${socks.join('')}</div></div>`;
    }).join('');
    return `${silHtml}<span class="label">02 // SLOTS</span><div class="cw-groups">${groups}</div>`;
  }

  function reqChip(req) {
    if (req.kind === 'none') return '';
    return `<span class="chipx cutline ${req.kind}">${req.kind === 'met' ? ICON_CHECK : ICON_LOCK}${esc(req.label)}</span>`;
  }

  const qualLabel = (fam, imp) => {
    const dup = fam.variants.filter((v) => v.tier === imp.tier).length > 1;
    return dup ? `${imp.quality} #${imp.variant}` : imp.quality;
  };

  const SHOWN = 4;
  const effLine = (imp) => {
    const lines = statLines(imp);
    return lines.slice(0, SHOWN).join(' · ') + (lines.length > SHOWN ? ` · +${lines.length - SHOWN} more` : '');
  };

  function pickerHtml(state, ev) {
    const { group, pos } = slotInfo(sel.key);
    const equippedN = state.cyber.get(sel.key);
    const fams = C.familiesByGroup.get(group.id);
    const rows = fams.map((fam) => {
      const chosen = fam.variants.find((v) => v.n === equippedN) || fam.variants.find((v) => v.n === sel.pick.get(fam.key)) || fam.variants[0];
      const isEq = equippedN === chosen.n;
      const can = canEquip(C, D, state, sel.key, chosen.n);
      const blocked = !isEq && !can.ok;
      const req = reqStatus(C, D, state, chosen);
      const reason = blocked ? `${REASON[can.reason] || 'Unavailable'}${can.need ? ` by ${can.need}` : ''}` : (isEq ? 'Equipped' : '');
      // same-quality siblings (#1 / #2): show what differs, on each button's tooltip and for the chosen one under the picker
      const sibs = (v) => fam.variants.filter((o) => o.tier === v.tier && o.n !== v.n);
      const diffText = (v) => sibs(v).map((o) => `vs #${o.variant}: ${variantDiff(v, o).join(' · ') || 'same stats'}`).join(' | ');
      const quals = fam.variants.length > 1
        ? `<div class="cw-quals" role="group" aria-label="${esc(fam.name)} quality">${fam.variants.map((v) => `<button type="button" class="cw-q cutline" data-q="${v.n}" aria-pressed="${v.n === chosen.n}"${sibs(v).length ? ` title="${esc(diffText(v))}"` : ''}>${esc(qualLabel(fam, v))}</button>`).join('')}</div>${sibs(chosen).length ? `<p class="cw-diff mono">${esc(diffText(chosen))}</p>` : ''}`
        : '';
      return `
        <li class="cw-li">
          <div class="cw-fam">
            <button type="button" class="cw-row cutline ${isEq ? 'chrome' : ''} ${blocked ? 'dashed' : ''}" data-imp="${chosen.n}" ${blocked ? 'disabled aria-disabled="true"' : ''} ${isEq ? 'aria-pressed="true"' : ''}>
              <span class="cw-ico">${art.html(chosen.icon || chosen.id)}</span>
              <span class="cw-main">
                <b class="cw-name">${esc(fam.name)}</b>
                <span class="cw-eff">${esc(effLine(chosen))}</span>
                ${reason ? `<span class="cw-reason">${esc(reason)}</span>` : ''}
              </span>
              <span class="cw-chips"><span class="chipx cutline">${esc(qualLabel(fam, chosen))}</span><span class="chipx cutline">CAP ${chosen.cost}</span>${reqChip(req)}</span>
            </button>
            ${quals}
          </div>
          ${isEq ? '<button type="button" class="btn ghost cutline chrome sm cw-remove" data-act="remove">Remove</button>' : ''}
        </li>`;
    }).join('');
    return `
      <div class="cw-pick-head"><span class="label">03 // IMPLANTS</span><button type="button" class="btn ghost cutline chrome sm cw-close" data-act="close">Close</button></div>
      <h2 class="tree-title chrome-text">${esc(group.name)} · slot ${pos + 1}</h2>
      ${group.pendingData ? `<p class="cw-pending mono">${ICON_WARN}<span>Pending data: ${esc(group.pendingData)}</span></p>` : ''}
      ${rows ? `<ul class="cw-list">${rows}</ul>` : '<p class="empty">No implants for this slot in the data yet.</p>'}`;
  }

  let lastP = 0;
  function capHtml(ev, compact, from) {
    const state = ev.over ? 'over' : ev.exact ? 'full' : 'ok';
    const p = ev.max > 0 ? Math.min(1, ev.used / ev.max) : 1;
    const pend = C.rules.pending?.length ? ' · provisional (level 2)' : '';
    const note = ev.over ? `+${ev.used - ev.max} over${ev.overcapAllowed ? ' (overcap perk)' : ''}` : `${ev.max - ev.used} free${pend}`;
    return `<div class="cap${compact ? ' compact' : ''}"><div class="cap-top"><span>Capacity</span><b class="mono">${ev.used} / ${ev.max}</b></div>
      <div class="capbar" data-state="${state}" role="img" aria-label="Capacity ${ev.used} of ${ev.max}"><i style="--p:${from.toFixed(3)}" data-to="${p.toFixed(3)}"></i></div>
      <p class="cap-note mono">${note}</p></div>`;
  }

  function summaryHtml(ev) {
    const flags = ev.flags.map((f) => `<li>${ICON_WARN}<span>${esc(f.text)}</span></li>`).join('');
    const eff = ev.effects.map((e) => `<li>${esc(e.text)}<small>${esc(e.source)}</small></li>`).join('');
    return `
      <span class="label">04 // LOADOUT</span>
      ${capHtml(ev, false, lastP)}
      ${flags ? `<div class="cw-flagbox"><h3 class="mono">Flagged</h3><ul class="cw-flags">${flags}</ul></div>` : ''}
      <h3 class="mono cw-h">Granted effects</h3>
      ${eff ? `<ul class="cw-effects">${eff}</ul>` : '<p class="empty">No implants equipped.</p>'}`;
  }

  root.innerHTML = `
    <div class="stack">
      <div class="page-head boot" style="--i:0">
        <div><span class="label">01 // CYBERWARE</span><h1 class="chrome-text">Loadout</h1></div>
      </div>
      <div class="cw">
        <section class="panel cut cw-slots boot" style="--i:1" id="cw-slots" aria-label="Slots"></section>
        <section class="panel cut cw-picker boot" style="--i:2" id="cw-picker" aria-label="Implant picker"></section>
        <aside class="panel cut cw-summary boot" style="--i:3" id="cw-summary" aria-label="Loadout summary"></aside>
      </div>
    </div>
    <div class="cw-bar" id="cw-bar"></div>`;
  const $ = (id) => root.querySelector(id);

  function render() {
    const state = cur();
    const ev = evaluate(C, D, state);
    const active = document.activeElement && root.contains(document.activeElement) ? document.activeElement : null;
    const memo = active && { key: active.dataset.key, imp: active.dataset.imp, act: active.dataset.act, q: active.dataset.q };
    const scroll = $('#cw-picker').querySelector('.cw-list')?.scrollTop || 0;
    $('#cw-slots').innerHTML = groupsHtml(ev);
    $('#cw-picker').innerHTML = pickerHtml(state, ev);
    $('#cw-picker').classList.toggle('open', sel.open);
    $('#cw-summary').innerHTML = summaryHtml(ev);
    $('#cw-bar').innerHTML = `${capHtml(ev, true, lastP)}`;
    const list = $('#cw-picker').querySelector('.cw-list');
    if (list) list.scrollTop = scroll;
    // the bars are re-created each render: start from the previous fill and let the CSS transition run to the new one
    lastP = ev.max > 0 ? Math.min(1, ev.used / ev.max) : 1;
    requestAnimationFrame(() => root.querySelectorAll('.capbar i').forEach((i) => i.style.setProperty('--p', i.dataset.to)));
    if (memo) {
      const sel2 = memo.key ? `[data-key="${memo.key}"]` : memo.q ? `[data-q="${memo.q}"]` : memo.imp ? `[data-imp="${memo.imp}"]` : memo.act ? `[data-act="${memo.act}"]` : null;
      const el = sel2 && root.querySelector(sel2);
      if (el && !el.disabled) el.focus({ preventScroll: true });
    }
  }

  root.addEventListener('click', (e) => {
    const sock = e.target.closest('button[data-key]');
    if (sock) {
      sel.key = sock.dataset.key;
      sel.open = true;
      render();
      if (matchMedia('(max-width:720px)').matches) $('#cw-picker .cw-close')?.focus();
      return;
    }
    const act = e.target.closest('button[data-act]');
    if (act && act.dataset.act === 'close') {
      sel.open = false;
      render();
      root.querySelector(`[data-key="${sel.key}"]`)?.focus();
      return;
    }
    if (act && act.dataset.act === 'remove') {
      const r = unequip(C, D, cur(), sel.key);
      if (r.ok) store.set(r.state);
      return;
    }
    const q = e.target.closest('button[data-q]');
    if (q) {
      const n = Number(q.dataset.q);
      const fam = C.familyOf.get(C.implants.get(n).family || C.implants.get(n).id);
      sel.pick.set(fam.key, n);
      const inSlot = fam.variants.some((v) => v.n === cur().cyber.get(sel.key));
      if (inSlot) { const r = equip(C, D, cur(), sel.key, n); if (r.ok) { store.set(r.state); return; } }
      render();
      return;
    }
    const row = e.target.closest('button[data-imp]');
    if (row && !row.disabled) {
      const r = equip(C, D, cur(), sel.key, Number(row.dataset.imp));
      if (r.ok) store.set(r.state);
    }
  });

  store.subscribe(render);
  render();
}
