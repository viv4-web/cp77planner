import { buildUrl } from './store.js';

const TABS = [
  ['character', 'Character'],
  ['cyberware', 'Cyberware'],
  ['inventory', 'Inventory'],
  ['journal', 'Journal'],
  ['database', 'Database'],
];
const SOON = {
  cyberware: 'Implants, slots and mods.',
  inventory: 'Weapons, armor and gear.',
  journal: 'Quests, gigs and progress notes.',
  database: 'Every record from the game files, searchable.',
};

const safe = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
};

export function initShell({ store, D }) {
  let tab = 'character';
  const valid = (t) => TABS.some(([k]) => k === t);
  const q = new URLSearchParams(location.search).get('tab');
  if (valid(q)) tab = q;

  const nav = document.getElementById('tabs');
  nav.innerHTML = TABS.map(([k, label]) =>
    `<a class="tab" href="?tab=${k}" data-tab="${k}" data-label="${label}"><span class="t">${label}</span><i class="ul"></i></a>`).join('');

  for (const [k, label] of TABS) {
    if (k === 'character' || k === 'cyberware') continue;
    document.getElementById(`screen-${k}`).innerHTML =
      `<div class="soon cut chrome-edge boot"><span class="label">// COMING NEXT</span><h2 class="chrome-text">${label}</h2><p>${SOON[k]} This section is on the way.</p></div>`;
  }

  const toastEl = document.getElementById('toast');
  let tt = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(tt);
    tt = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  function show(next, push) {
    tab = valid(next) ? next : 'character';
    document.querySelectorAll('.screen').forEach((s) => { s.hidden = s.dataset.tab !== tab; });
    nav.querySelectorAll('.tab').forEach((a) => {
      if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    try { history[push ? 'pushState' : 'replaceState'](null, '', buildUrl(D, store.get(), tab)); } catch (e) { /* ignore */ }
  }
  nav.addEventListener('click', (e) => {
    const a = e.target.closest('a.tab');
    if (!a) return;
    e.preventDefault();
    if (a.dataset.tab !== tab) show(a.dataset.tab, true);
  });
  window.addEventListener('popstate', () => {
    const t = new URLSearchParams(location.search).get('tab');
    show(valid(t) ? t : 'character', false);
  });
  show(tab, false);

  // Copy build link: global, works from every tab.
  document.getElementById('copy-btn').addEventListener('click', async () => {
    const url = location.origin + buildUrl(D, store.get(), tab);
    try {
      await navigator.clipboard.writeText(url);
      toast('Build link copied');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) { /* ignore */ }
      ta.remove();
      toast(ok ? 'Build link copied' : 'Copy failed. Copy the address bar instead.');
    }
  });

  const dlg = document.getElementById('stats-dialog');
  document.getElementById('stats-btn').addEventListener('click', () => {
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  });

  // Motion setting
  const mo = document.getElementById('motion');
  const apply = (m) => {
    document.documentElement.setAttribute('data-motion', m);
    mo.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === m)));
  };
  apply(document.documentElement.getAttribute('data-motion') || 'full');
  mo.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-m]');
    if (!b) return;
    apply(b.dataset.m);
    safe.set('cp77.motion', b.dataset.m);
  });

  return { currentTab: () => tab, toast };
}
