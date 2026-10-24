import { buildCyberIndex, cyberToRaw, sanitizeCyber } from './cyber.js';

// Pure perk/attribute rules. All numbers come from data (rules block), nothing is hard-coded here.
// State: { level, attrs: number[] (one per attribute tree, in data order), perks: Set<number>, cyber: Map<slotKey, implant n> }
// slotKey = `${group n}.${slot position}` (see cyber.js)

export function buildIndex(data, cyberData = null) {
  const trees = data.trees;
  const attrTrees = trees.filter((t) => t.kind === 'attribute');
  const perks = new Map();
  for (const tree of trees) {
    for (const perk of tree.perks) perks.set(perk.n, { perk, tree, req: tree.tierReq[perk.tier] });
  }
  const perkById = new Map([...perks.values()].map((e) => [e.perk.id, e.perk.n]));
  const D = { rules: data.rules, trees, attrTrees, perks, perkById, cyber: null };
  if (cyberData) D.cyber = buildCyberIndex(cyberData);
  return D;
}

export function defaultState(D) {
  return { level: 1, attrs: D.attrTrees.map(() => D.rules.attrBase), perks: new Set(), cyber: new Map() };
}

const owned = (state, tree) => tree.perks.filter((p) => state.perks.has(p.n));

export function pools(D, state) {
  const r = D.rules;
  const attrTotal = (state.level - 1) * r.attrPointsPerLevel;
  const attrSpent = state.attrs.reduce((s, v) => s + Math.max(0, v - r.attrBase), 0);
  const perkTotal = r.perkPointsStart + (state.level - 1) * r.perkPointsPerLevel;
  let perkSpent = 0, relicSpent = 0;
  for (const n of state.perks) {
    const e = D.perks.get(n);
    if (!e) continue;
    if (e.tree.kind === 'relic') relicSpent++; else perkSpent++;
  }
  return {
    attrTotal, attrSpent, attrFree: attrTotal - attrSpent,
    perkTotal, perkSpent, perkFree: perkTotal - perkSpent,
    relicTotal: r.relicPoints, relicSpent, relicFree: r.relicPoints - relicSpent,
  };
}

// Does this perk's requirement hold given the state (ignoring points)?
export function gateMet(D, state, n) {
  const e = D.perks.get(n);
  if (!e) return false;
  if (e.tree.gate === 'value') return state.attrs[D.attrTrees.indexOf(e.tree)] >= e.req;
  const lower = e.tree.perks.filter((p) => p.tier < e.perk.tier && state.perks.has(p.n)).length;
  return lower >= e.req;
}

export function perkStatus(D, state, n) {
  if (state.perks.has(n)) return 'owned';
  return gateMet(D, state, n) ? 'available' : 'locked';
}

export function canInstall(D, state, n) {
  const e = D.perks.get(n);
  if (!e) return { ok: false, reason: 'unknown' };
  if (state.perks.has(n)) return { ok: false, reason: 'owned' };
  if (!gateMet(D, state, n)) return { ok: false, reason: 'locked' };
  const p = pools(D, state);
  if ((e.tree.kind === 'relic' ? p.relicFree : p.perkFree) < 1) return { ok: false, reason: 'no-points' };
  return { ok: true };
}

export function install(D, state, n) {
  const c = canInstall(D, state, n);
  if (!c.ok) return { ok: false, reason: c.reason, state };
  return { ok: true, state: { ...state, perks: new Set([...state.perks, n]) } };
}

function ownedStillValid(D, state, tree) {
  return owned(state, tree).every((p) => gateMet(D, state, p.n));
}

export function canRefund(D, state, n) {
  if (!state.perks.has(n)) return { ok: false, reason: 'not-owned' };
  const next = { ...state, perks: new Set([...state.perks].filter((x) => x !== n)) };
  const tree = D.perks.get(n).tree;
  if (tree.gate === 'spent' && !ownedStillValid(D, next, tree)) return { ok: false, reason: 'required' };
  return { ok: true, state: next };
}

export function refund(D, state, n) {
  const c = canRefund(D, state, n);
  return c.ok ? { ok: true, state: c.state } : { ok: false, reason: c.reason, state };
}

// Lowest value an attribute may take: base, or the highest requirement among its owned perks.
export function minAttr(D, state, idx) {
  const tree = D.attrTrees[idx];
  return owned(state, tree).reduce((m, p) => Math.max(m, tree.tierReq[p.tier]), D.rules.attrBase);
}

export function setAttr(D, state, idx, value) {
  const r = D.rules;
  const v = Math.max(minAttr(D, state, idx), Math.min(r.attrMax, Math.round(value)));
  if (v === state.attrs[idx]) return { ok: false, reason: 'unchanged', state };
  const attrs = state.attrs.slice();
  attrs[idx] = v;
  const next = { ...state, attrs };
  if (pools(D, next).attrFree < 0) return { ok: false, reason: 'no-points', state };
  return { ok: true, state: next };
}

// Lowest level that still pays for everything spent.
export function minLevel(D, state) {
  for (let l = 1; l <= D.rules.maxLevel; l++) {
    const p = pools(D, { ...state, level: l });
    if (p.attrFree >= 0 && p.perkFree >= 0) return l;
  }
  return D.rules.maxLevel;
}

export function setLevel(D, state, level) {
  const l = Math.max(minLevel(D, state), Math.min(D.rules.maxLevel, Math.round(level)));
  return { ...state, level: l };
}

// Build a valid state from an untrusted raw build (decoded link). Unknown IDs are dropped,
// values are clamped, perks that break a rule are skipped. Never throws.
export function sanitize(D, raw) {
  const r = D.rules;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
  let state = defaultState(D);
  const attrs = D.attrTrees.map((_, i) => clamp(raw.attrs?.[i], r.attrBase, r.attrMax));
  // Level high enough to pay for the attributes asked for; spend attrs in order as far as points allow.
  let level = clamp(raw.level, 1, r.maxLevel);
  state = { ...state, level, attrs };
  const need = attrs.reduce((s, v) => s + (v - r.attrBase), 0);
  const needLevel = 1 + Math.ceil(need / Math.max(1, r.attrPointsPerLevel));
  if (needLevel > level) state = { ...state, level: Math.min(r.maxLevel, needLevel) };
  // Install perks lowest tier first so gates can be satisfied; skip any that fail.
  const wanted = (Array.isArray(raw.perks) ? raw.perks : []).filter((n) => D.perks.has(n))
    .sort((a, b) => D.perks.get(a).perk.tier - D.perks.get(b).perk.tier || a - b);
  for (const n of wanted) {
    let res = install(D, state, n);
    if (!res.ok && res.reason === 'no-points') {
      const lv = state.level + 1;
      if (lv <= r.maxLevel) res = install(D, { ...state, level: lv }, n);
    }
    if (res.ok) state = res.state;
  }
  return sanitizeCyber(D, state, raw.cyber);
}

// Does the build own a perk that carries this flag (e.g. 'overcap', SAMPLE)?
export function hasFlag(D, state, flag) {
  for (const n of state.perks) if (D.perks.get(n)?.perk.flags?.includes(flag)) return true;
  return false;
}

export function toRaw(state) {
  return { level: state.level, attrs: state.attrs.slice(), perks: [...state.perks], cyber: cyberToRaw(state) };
}
