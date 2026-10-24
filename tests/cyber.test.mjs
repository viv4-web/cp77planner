import test from 'node:test';
import assert from 'node:assert/strict';
import { loadD } from './helpers.mjs';
import { defaultState, setLevel, setAttr, sanitize, toRaw, hasFlag } from '../src/js/rules.js';
import { evaluate, canEquip, equip, unequip, maxCapacity, reqStatus, slotKey } from '../src/js/cyber.js';
import { encode, decode } from '../src/js/codec.js';

const { D, C } = loadD();
const imp = (id) => [...C.implants.values()].find((i) => i.id === `SAMPLE.Implant.${id}`);
const grp = (name) => C.groupById.get(`SAMPLE.Slot.${name}`);
const key = (name, pos = 0) => slotKey(grp(name).n, pos);
const withLevel = (level) => ({ ...defaultState(D), level });
const attrIdx = (k) => D.attrTrees.findIndex((t) => t.key === k);
const overcapPerk = D.perkById.get('SAMPLE.Perk.Cool.T4.A');

test('capacity math: base + level + attribute bonuses, all from data', () => {
  const r = C.rules;
  assert.equal(maxCapacity(C, D, withLevel(1)), Math.floor(r.capacityBase + r.capacityPerLevel));
  assert.equal(maxCapacity(C, D, withLevel(21)), Math.floor(r.capacityBase + 21 * r.capacityPerLevel));
  let s = withLevel(60);
  const before = maxCapacity(C, D, s);
  s = setAttr(D, s, attrIdx('technical'), D.rules.attrBase + 4).state;
  assert.equal(maxCapacity(C, D, s), before + 4 * r.attrBonus.find((b) => b.attr === 'technical').perPoint);
});

test('used capacity, armor and effects add up over the loadout', () => {
  let s = withLevel(30);
  s = equip(C, D, s, key('FrontalCortex', 0), imp('FrontalCortex.A').n).state;
  s = equip(C, D, s, key('Integumentary', 0), imp('Integumentary.C').n).state;
  const ev = evaluate(C, D, s);
  assert.equal(ev.used, imp('FrontalCortex.A').cost + imp('Integumentary.C').cost);
  assert.equal(ev.armor, (imp('FrontalCortex.A').armor || 0) + imp('Integumentary.C').armor);
  assert.equal(ev.effects.length, imp('FrontalCortex.A').effects.length + imp('Integumentary.C').effects.length);
  assert.equal(ev.exact, ev.used === ev.max);
});

test('over capacity is refused without the overcap perk and allowed with it', () => {
  let s = withLevel(1);                                    // small capacity
  const need = [['FrontalCortex', 0, 'C'], ['Skeleton', 0, 'A'], ['Skeleton', 1, 'C'], ['Skeleton', 2, 'A'], ['Face', 0, 'C'], ['Face', 1, 'C']];
  let refused = null;
  for (const [g, p, l] of need) {
    const r = equip(C, D, s, key(g, p), imp(`${g}.${l}`).n);
    if (!r.ok) { refused = { g, p, l, reason: r.reason }; break; }
    s = r.state;
  }
  assert.ok(refused, 'something must exceed the sample capacity');
  assert.equal(refused.reason, 'over-capacity');
  const ev = evaluate(C, D, s);
  assert.ok(ev.used <= ev.max);
  const withPerk = { ...s, perks: new Set([...s.perks, overcapPerk]) };
  assert.ok(hasFlag(D, withPerk, C.rules.overcapFlag));
  const ok = equip(C, D, withPerk, key(refused.g, refused.p), imp(`${refused.g}.${refused.l}`).n);
  assert.equal(ok.ok, true);
  const ev2 = evaluate(C, D, ok.state);
  assert.equal(ev2.over, true);
  assert.equal(ev2.overcapAllowed, true);
  assert.ok(!ev2.flags.some((f) => f.reason === 'over-capacity'), 'over capacity with the perk is not a conflict');
});

test('replacing an implant counts the freed capacity', () => {
  let s = withLevel(1);
  s = equip(C, D, s, key('Face', 0), imp('Face.C').n).state;      // cost 6 of 12
  const swap = canEquip(C, D, s, key('Face', 0), imp('Face.B').n);
  assert.equal(swap.ok, true);
  const unequipped = unequip(C, D, s, key('Face', 0));
  assert.equal(evaluate(C, D, unequipped.state).used, 0);
  assert.equal(unequip(C, D, defaultState(D), key('Face', 0)).ok, false);
});

test('a wrong-group implant or an unknown slot is refused', () => {
  assert.equal(canEquip(C, D, withLevel(60), key('Face', 0), imp('Legs.A').n).reason, 'wrong-slot');
  assert.equal(canEquip(C, D, withLevel(60), key('Legs', 5), imp('Legs.A').n).reason, 'wrong-slot');
  assert.equal(canEquip(C, D, withLevel(60), key('Face', 0), 999999).reason, 'unknown');
});

test('REQ states: attribute and perk, unmet can still be picked but is flagged', () => {
  const c = imp('FrontalCortex.C');                         // needs attribute
  let s = withLevel(60);
  assert.equal(reqStatus(C, D, s, c).kind, 'unmet');
  assert.equal(reqStatus(C, D, s, imp('FrontalCortex.A')).kind, 'none');
  s = equip(C, D, s, key('FrontalCortex', 0), c.n).state;      // allowed while unmet
  let ev = evaluate(C, D, s);
  assert.deepEqual(ev.flags.map((f) => f.reason), ['req-unmet']);
  assert.equal(ev.slots.get(key('FrontalCortex', 0)).req.kind, 'unmet');
  s = setAttr(D, s, attrIdx('intelligence'), c.req.value).state;
  assert.equal(reqStatus(C, D, s, c).kind, 'met');
  assert.equal(evaluate(C, D, s).flags.length, 0);
  const p = imp('NervousSystem.C');                          // needs a perk
  assert.equal(reqStatus(C, D, s, p).kind, 'unmet');
  const perk = D.perkById.get(p.req.perk);
  assert.equal(reqStatus(C, D, { ...s, perks: new Set([perk]) }, p).kind, 'met');
});

test('Character -> Cyberware recompute: nothing is auto-removed, conflicts are flagged', () => {
  let s = withLevel(60);
  s = setAttr(D, s, attrIdx('intelligence'), 9).state;
  for (const [g, p, l] of [['FrontalCortex', 0, 'C'], ['Skeleton', 0, 'A'], ['Face', 0, 'B'], ['Face', 1, 'A']]) s = equip(C, D, s, key(g, p), imp(`${g}.${l}`).n).state;
  const placed = s.cyber.size;
  const hi = evaluate(C, D, s);
  assert.equal(hi.flags.length, 0);
  const lowered = { ...s, level: 1, attrs: s.attrs.map(() => D.rules.attrBase) };   // as if Character was changed
  const lo = evaluate(C, D, lowered);
  assert.ok(lo.max < hi.max);
  assert.equal(lowered.cyber.size, placed, 'nothing auto-removed');
  assert.ok(lo.flags.some((f) => f.reason === 'req-unmet'), 'requirement conflict flagged');
  assert.ok(lo.flags.some((f) => f.reason === 'over-capacity'), 'capacity conflict flagged');
  const raised = setLevel(D, lowered, 60);
  assert.ok(evaluate(C, D, raised).max > lo.max);
});

test('link round trip: every SAMPLE implant in every slot, plus mixed loadouts, decode identically', () => {
  const states = [];
  for (const g of C.groups) for (let p = 0; p < g.slots; p++) for (const i of C.byGroup.get(g.id)) {
    states.push({ ...withLevel(33), cyber: new Map([[slotKey(g.n, p), i.n]]) });
  }
  const mixed = new Map();
  for (const g of C.groups) for (let p = 0; p < g.slots; p++) mixed.set(slotKey(g.n, p), C.byGroup.get(g.id)[(p + g.slots) % 3].n);
  states.push({ ...withLevel(60), cyber: mixed }, withLevel(1));
  for (const s of states) {
    const link = encode(toRaw(s));
    const back = sanitize(D, decode(link).build);
    assert.deepEqual([...back.cyber].sort(), [...s.cyber].sort(), link);
    assert.equal(encode(toRaw(back)), link, 'decode -> encode is stable');
  }
});

test('sanitize drops invalid cyberware entries and never throws', () => {
  const f = grp('Face'), l = grp('Legs');
  const s = sanitize(D, { level: 20, attrs: [3, 3, 3, 3, 3], perks: [], cyber: [
    [f.n, 0, imp('Face.A').n], [f.n, 0, imp('Face.B').n],        // duplicate slot: first wins
    [f.n, 9, imp('Face.A').n], [l.n, 0, imp('Face.A').n],        // bad position, wrong group
    [999999, 0, 1], [f.n, 1, 424242], 'junk', [1, 2], null,
  ] });
  assert.deepEqual([...s.cyber], [[key('Face', 0), imp('Face.A').n]]);
  for (const bad of [undefined, null, 5, 'x', {}]) assert.doesNotThrow(() => sanitize(D, { level: 1, attrs: [], perks: [], cyber: bad }));
});
