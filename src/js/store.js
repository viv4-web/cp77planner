import { encode } from './codec.js';
import { toRaw } from './rules.js';

export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(next) { state = next; subs.forEach((f) => f(state)); },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
    emit() { subs.forEach((f) => f(state)); },
  };
}

// Keeps ?b= (and ?tab=) in the address bar in sync, without adding history entries.
export function buildUrl(D, state, tab) {
  const p = new URLSearchParams(location.search);
  p.set('b', encode(toRaw(state)));
  if (tab && tab !== 'character') p.set('tab', tab); else p.delete('tab');
  return `${location.pathname}?${p}${location.hash}`;
}

export function urlStateWriter(D, getTab) {
  let t = 0;
  return (state) => {
    clearTimeout(t);
    t = setTimeout(() => {
      try { history.replaceState(null, '', buildUrl(D, state, getTab())); } catch (e) { /* ignore */ }
    }, 120);
  };
}
