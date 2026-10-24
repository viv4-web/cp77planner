// Cyberware rules. ONE function (evaluate) owns every capacity / requirement check; equip/unequip and the UI only call it.
// All numbers come from data (cyberware.json "rules"), nothing is hard-coded here.
// Nothing is ever auto-removed: conflicts (over capacity, unmet requirements) are flagged, not silently fixed.
import { hasFlag } from './rules.js';

export const slotKey = (groupN, pos) => `${groupN}.${pos}`;

export function buildCyberIndex(data) {
  const groups = data.groups.map((g) => ({ ...g }));
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const implants = new Map();
  const byGroup = new Map(groups.map((g) => [g.id, []]));
  for (const imp of data.implants) {
    if (!groupById.has(imp.group)) continue;
    implants.set(imp.n, imp);
    byGroup.get(imp.group).push(imp);
  }
  const groupByN = new Map(groups.map((g) => [g.n, g]));
  return { rules: data.rules, groups, groupById, groupByN, implants, byGroup };
}

export const maxCapacity = (C, D, state) => {
  const r = C.rules;
  let max = r.capacityBase + state.level * r.capacityPerLevel;
  for (const b of r.attrBonus || []) {
    const idx = D.attrTrees.findIndex((t) => t.key === b.attr);
    if (idx >= 0) max += (state.attrs[idx] - D.rules.attrBase) * b.perPoint;
  }
  return Math.floor(max);
};

// Requirement of an implant against the current Character: { kind: 'none'|'met'|'unmet', label }
export function reqStatus(C, D, state, imp) {
  const q = imp.req;
  if (!q) return { kind: 'none', label: '' };
  if (q.type === 'attr') {
    const idx = D.attrTrees.findIndex((t) => t.key === q.attr);
    const tree = D.attrTrees[idx];
    return { kind: idx >= 0 && state.attrs[idx] >= q.value ? 'met' : 'unmet', label: `REQ ${q.value} ${(tree ? tree.name : q.attr).toUpperCase()}` };
  }
  const n = D.perkById.get(q.perk);
  const name = n ? D.perks.get(n).perk.name : q.perk;
  return { kind: n && state.perks.has(n) ? 'met' : 'unmet', label: `REQ ${name.toUpperCase()}` };
}

// Everything the UI shows, in one pass.
export function evaluate(C, D, state) {
  const max = maxCapacity(C, D, state);
  const overcapAllowed = hasFlag(D, state, C.rules.overcapFlag);
  let used = 0, armor = 0;
  const effects = [], flags = [], slots = new Map();
  for (const [key, n] of state.cyber) {
    const imp = C.implants.get(n);
    if (!imp) continue;
    used += imp.cost;
    armor += imp.armor || 0;
    for (const text of imp.effects || []) effects.push({ text, source: imp.name });
    const req = reqStatus(C, D, state, imp);
    slots.set(key, { implant: imp, req });
    if (req.kind === 'unmet') flags.push({ key, implant: imp, reason: 'req-unmet', text: `${imp.name}: ${req.label} not met` });
  }
  const over = used > max;
  if (over && !overcapAllowed) {
    flags.push({ key: null, implant: null, reason: 'over-capacity', text: `Over capacity by ${used - max} and no overcap perk` });
  }
  return { max, used, over, overcapAllowed, exact: used === max, armor, effects, flags, slots };
}

// Can this implant go into this slot? Over capacity is refused unless the build has the overcap perk.
export function canEquip(C, D, state, key, n) {
  const imp = C.implants.get(n);
  if (!imp) return { ok: false, reason: 'unknown' };
  const slot = parseKey(C, key);
  if (!slot || imp.group !== slot.group.id) return { ok: false, reason: 'wrong-slot' };
  const cur = C.implants.get(state.cyber.get(key));
  const ev = evaluate(C, D, state);
  const after = ev.used - (cur ? cur.cost : 0) + imp.cost;
  if (after > ev.max && !ev.overcapAllowed) {
    return { ok: false, reason: 'over-capacity', need: after - ev.max, text: `Over capacity by ${after - ev.max}` };
  }
  return { ok: true };
}

export function equip(C, D, state, key, n) {
  const c = canEquip(C, D, state, key, n);
  if (!c.ok) return { ok: false, reason: c.reason, state };
  return { ok: true, state: { ...state, cyber: new Map(state.cyber).set(key, n) } };
}

export function unequip(C, D, state, key) {
  if (!state.cyber.has(key)) return { ok: false, reason: 'empty', state };
  const cyber = new Map(state.cyber);
  cyber.delete(key);
  return { ok: true, state: { ...state, cyber } };
}

function parseKey(C, key) {
  const m = /^(\d+)\.(\d+)$/.exec(key);
  const group = m && C.groupByN.get(Number(m[1]));
  const pos = m && Number(m[2]);
  return group && pos < group.slots ? { group, pos } : null;
}

// ---- link <-> state ----
export const cyberToRaw = (state) =>
  [...state.cyber].map(([key, n]) => [...key.split('.').map(Number), n]);

// Untrusted raw entries -> valid slots only. Capacity/requirements are NOT enforced here (they are flags, not removals).
export function sanitizeCyber(D, state, raw) {
  const C = D.cyber;
  if (!C || !Array.isArray(raw)) return state;
  const cyber = new Map();
  for (const e of raw) {
    if (!Array.isArray(e) || e.length !== 3) continue;
    const [g, pos, n] = e;
    const key = slotKey(g, pos);
    const slot = parseKey(C, key);
    const imp = C.implants.get(n);
    if (slot && imp && imp.group === slot.group.id && !cyber.has(key)) cyber.set(key, n);
  }
  return { ...state, cyber };
}
