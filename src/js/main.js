import { loadResolver } from './art.js';
import { buildIndex, defaultState, sanitize } from './rules.js';
import { decode } from './codec.js';
import { initCharacter } from './character.js';
import { initCyberware } from './cyberware.js';
import { initRipperdoc } from './ripperdoc.js';
import { initShell } from './shell.js';
import { createStore, urlStateWriter } from './store.js';

async function boot() {
  const [art, data, cyberData] = await Promise.all([
    loadResolver(),
    fetch('data/sample/tree.json').then((r) => r.json()),
    fetch('data/cyberware.json').then((r) => r.json()),
  ]);
  const D = buildIndex(data, cyberData);

  const params = new URLSearchParams(location.search);
  let state = defaultState(D);
  let notice = '';
  if (params.has('b')) {
    const res = decode(params.get('b'));
    if (res.ok) state = sanitize(D, res.build);
    else notice = res.reason === 'unknown-version'
      ? 'This link was made with a newer planner version. Starting a fresh build.'
      : "That build link couldn't be read. Starting a fresh build.";
  }

  const store = createStore(state);
  const shell = initShell({ store, D });
  initCharacter({ root: document.getElementById('screen-character'), store, D, art });
  initCyberware({ root: document.getElementById('cw-legacy'), store, D, art });
  const ui = await fetch('ui-art.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  initRipperdoc({ root: document.getElementById('rd-root'), store, D, art, ui: ui || { parts: {}, clips: {} } })
    .catch((e) => { console.error(e); document.getElementById('rd-root').insertAdjacentHTML('afterbegin', '<p class="empty">Could not load the ripperdoc screen.</p>'); });
  store.subscribe(urlStateWriter(D, shell.currentTab));
  if (notice) shell.toast(notice);
  store.emit();
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('main').insertAdjacentHTML('afterbegin', '<p class="empty">Could not load planner data.</p>');
});
