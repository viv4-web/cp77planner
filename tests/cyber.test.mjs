import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { loadD, loadReal } from './helpers.mjs';
import { defaultState, setLevel, setAttr, sanitize, toRaw, hasFlag } from '../src/js/rules.js';
import { evaluate, canEquip, equip, unequip, maxCapacity, reqStatus, slotKey, statLines } from '../src/js/cyber.js';
import { encode, decode } from '../src/js/codec.js';

// Engine tests run on the HAND-MADE fixture (tests/fixtures/cyberware.json), not on game data.
const { D, C } = loadD();
const imp = (id) => [...C.implants.values()].find((i) => i.id === `T.${id}`);
const grp = (name) => C.groupById.get(`T.Slot.${name}`);
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

test('used capacity is the per-item cost; effects come from the stats', () => {
  let s = withLevel(30);
  s = equip(C, D, s, key('Head', 0), imp('Alpha.Rare').n).state;
  s = equip(C, D, s, key('Eye', 0), imp('Delta.Cheap').n).state;
  const ev = evaluate(C, D, s);
  assert.equal(ev.used, imp('Alpha.Rare').cost + imp('Delta.Cheap').cost);
  assert.equal(ev.exact, ev.used === ev.max);
  assert.deepEqual(ev.effects.map((e) => e.text), ['Armor +3 / +9']);
});

test('quality variants of one family cost what their own record says, never derived from quality', () => {
  const fam = C.familyOf.get('Head/Alpha');
  assert.deepEqual(fam.variants.map((v) => v.id), ['T.Alpha.Common', 'T.Alpha.Rare', 'T.Alpha.Rare2']);
  assert.deepEqual(fam.variants.map((v) => v.cost), [2, 4, 4]);
  assert.equal(C.familiesByGroup.get('T.Slot.Head').length, 2);
});

test('stat lines: one line per stat, ops formatted, nothing summed', () => {
  assert.deepEqual(statLines(imp('Alpha.Rare')), ['Armor +3 / +9']);
  assert.deepEqual(statLines(imp('Beta')), ['Headshot Damage Multiplier +20%']);
  assert.deepEqual(statLines(imp('Eps')), ['Multi ×1.5']);
  assert.deepEqual(statLines(imp('Delta')), []);
});

test('over capacity is refused without the overcap perk and allowed with it', () => {
  let s = withLevel(1);                                    // capacity 12
  s = equip(C, D, s, key('Bone', 0), imp('Gamma').n).state;  // 6
  s = equip(C, D, s, key('Eye', 0), imp('Delta').n).state;   // 12 of 12
  const refused = equip(C, D, s, key('Head', 0), imp('Alpha.Common').n);
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'over-capacity');
  const withPerk = { ...s, perks: new Set([...s.perks, overcapPerk]) };
  assert.ok(hasFlag(D, withPerk, C.rules.overcapFlag));
  const ok = equip(C, D, withPerk, key('Head', 0), imp('Alpha.Common').n);
  assert.equal(ok.ok, true);
  const ev = evaluate(C, D, ok.state);
  assert.equal(ev.over, true);
  assert.equal(ev.overcapAllowed, true);
  assert.ok(!ev.flags.some((f) => f.reason === 'over-capacity'), 'over capacity with the perk is not a conflict');
});

test('overcap is a data rule: with no overcapFlag in the data nothing can allow it', () => {
  const noRule = { ...C, rules: { ...C.rules, overcapFlag: null } };
  const s = { ...withLevel(1), perks: new Set([overcapPerk]) };
  assert.equal(evaluate(noRule, D, s).overcapAllowed, false);
});

test('replacing an implant (another quality of the same item) counts the freed capacity', () => {
  let s = withLevel(1);
  s = equip(C, D, s, key('Head', 0), imp('Alpha.Rare').n).state;
  s = equip(C, D, s, key('Bone', 0), imp('Gamma').n).state;   // 4 + 6 = 10 of 12
  assert.equal(canEquip(C, D, s, key('Head', 0), imp('Alpha.Common').n).ok, true);
  assert.equal(canEquip(C, D, s, key('Head', 1), imp('Alpha.Rare').n).ok, false, 'a second copy would be 14');
  assert.equal(evaluate(C, D, unequip(C, D, s, key('Head', 0)).state).used, 6);
  assert.equal(unequip(C, D, defaultState(D), key('Eye', 0)).ok, false);
});

test('a wrong-group implant, a locked slot or an unknown slot is refused', () => {
  assert.equal(canEquip(C, D, withLevel(60), key('Eye', 0), imp('Eps').n).reason, 'wrong-slot');
  assert.equal(canEquip(C, D, withLevel(60), key('Leg', 5), imp('Eps').n).reason, 'wrong-slot');
  assert.equal(canEquip(C, D, withLevel(60), key('Bone', 2), imp('Gamma').n).reason, 'wrong-slot', 'slot 3 of Bone is locked');
  assert.equal(canEquip(C, D, withLevel(60), key('Eye', 0), 999999).reason, 'unknown');
});

test('REQ states: attribute and perk, unmet can still be picked but is flagged', () => {
  const b = imp('Beta');
  let s = withLevel(60);
  assert.equal(reqStatus(C, D, s, b).kind, 'unmet');
  assert.equal(reqStatus(C, D, s, imp('Alpha.Common')).kind, 'none');
  s = equip(C, D, s, key('Head', 0), b.n).state;           // allowed while unmet
  let ev = evaluate(C, D, s);
  assert.deepEqual(ev.flags.map((f) => f.reason), ['req-unmet']);
  assert.equal(ev.slots.get(key('Head', 0)).req.kind, 'unmet');
  s = setAttr(D, s, attrIdx('intelligence'), b.req.value).state;
  assert.equal(reqStatus(C, D, s, b).kind, 'met');
  assert.equal(evaluate(C, D, s).flags.length, 0);
  const p = imp('Eps');
  assert.equal(reqStatus(C, D, s, p).kind, 'unmet');
  assert.equal(reqStatus(C, D, { ...s, perks: new Set([D.perkById.get(p.req.perk)]) }, p).kind, 'met');
});

test('Character -> Cyberware recompute: nothing is auto-removed, conflicts are flagged', () => {
  let s = withLevel(60);
  s = setAttr(D, s, attrIdx('intelligence'), 9).state;
  for (const [g, p, id] of [['Head', 0, 'Beta'], ['Bone', 0, 'Gamma'], ['Eye', 0, 'Delta']]) s = equip(C, D, s, key(g, p), imp(id).n).state;
  const placed = s.cyber.size;
  const hi = evaluate(C, D, s);
  assert.equal(hi.flags.length, 0);
  const lowered = { ...s, level: 1, attrs: s.attrs.map(() => D.rules.attrBase) };
  const lo = evaluate(C, D, lowered);
  assert.ok(lo.max < hi.max);
  assert.equal(lowered.cyber.size, placed, 'nothing auto-removed');
  assert.ok(lo.flags.some((f) => f.reason === 'req-unmet'));
  assert.ok(lo.flags.some((f) => f.reason === 'over-capacity'));
  assert.ok(evaluate(C, D, setLevel(D, lowered, 60)).max > lo.max);
});

test('link round trip: every fixture implant in every slot, plus a mixed loadout', () => {
  const states = [];
  for (const g of C.groups) for (let p = 0; p < g.slots; p++) for (const i of C.byGroup.get(g.id)) {
    states.push({ ...withLevel(33), cyber: new Map([[slotKey(g.n, p), i.n]]) });
  }
  states.push({ ...withLevel(60), cyber: new Map([[key('Head', 0), imp('Alpha.Rare2').n], [key('Head', 2), imp('Beta').n], [key('Leg', 0), imp('Eps').n]]) }, withLevel(1));
  for (const s of states) {
    const link = encode(toRaw(s));
    const back = sanitize(D, decode(link).build);
    assert.deepEqual([...back.cyber].sort(), [...s.cyber].sort(), link);
    assert.equal(encode(toRaw(back)), link, 'decode -> encode is stable');
  }
});

test('sanitize drops invalid cyberware entries and never throws', () => {
  const f = grp('Eye'), l = grp('Leg'), b = grp('Bone');
  const s = sanitize(D, { level: 20, attrs: [3, 3, 3, 3, 3], perks: [], cyber: [
    [f.n, 0, imp('Delta').n], [f.n, 0, imp('Delta.Cheap').n],       // duplicate slot: first wins
    [f.n, 9, imp('Delta').n], [l.n, 0, imp('Delta').n], [b.n, 2, imp('Gamma').n],   // bad position, wrong group, locked slot
    [999999, 0, 1], [f.n, 1, 424242], 'junk', [1, 2], null,
  ] });
  assert.deepEqual([...s.cyber], [[key('Eye', 0), imp('Delta').n]]);
  for (const bad of [undefined, null, 5, 'x', {}]) assert.doesNotThrow(() => sanitize(D, { level: 1, attrs: [], perks: [], cyber: bad }));
});

test('no source file hard-codes a perk or record id (game rules live in data)', () => {
  const dir = new URL('../src/js/', import.meta.url);
  for (const f of readdirSync(dir)) {
    const text = readFileSync(new URL(f, dir), 'utf8');
    assert.ok(!/SAMPLE\.|\bItems\.|Perk\.[A-Z]/.test(text), `${f} contains a record id`);
  }
});

// ---- the real shipped data ----
test('real data: builds an index, every record is wired up, families have one slot', () => {
  const { C: R, doc } = loadReal();
  assert.equal(R.groups.length, 10);
  assert.equal(R.implants.size, doc.implants.length);
  for (const fam of R.familyOf.values()) assert.equal(new Set(fam.variants.map((v) => v.group)).size, 1, fam.key);
  assert.deepEqual(R.groups.map((g) => [g.name, g.slots, g.locked]), [
    ['Frontal Cortex', 3, 0], ['Arms', 1, 0], ['Skeleton', 2, 1], ['Nervous System', 3, 0], ['Integumentary', 3, 0],
    ['Operating System', 1, 0], ['Face', 1, 0], ['Hands', 1, 1], ['Circulatory', 3, 0], ['Legs', 1, 0]]);
  assert.equal(maxCapacity(R, loadD().D, { ...defaultState(loadD().D), level: 2 }), 27);
});

test('real data: golden v1 and v2 links still load; retired SAMPLE implants are dropped, nothing throws', () => {
  const { D: RD } = loadReal();
  for (const link of ['1.EQkDDAQUBX0BAQQC', '2.EQkDDAQUBX0BAQQCArwFAcYFvgUAyAU']) {
    const r = decode(link);
    assert.equal(r.ok, true, link);
    const s = sanitize(RD, r.build);
    assert.equal(s.cyber.size, 0);
    assert.equal(s.attrs[4], 20);
    assert.ok(s.level >= 17);
  }
});

test('real data: a loadout of real implants round-trips through the link', () => {
  const { D: RD, C: R } = loadReal();
  const cyber = new Map();
  for (const g of R.groups) for (let p = 0; p < g.slots; p++) {
    const fams = R.familiesByGroup.get(g.id);
    if (fams.length) cyber.set(slotKey(g.n, p), fams[p % fams.length].variants.at(-1).n);
  }
  const s = { ...defaultState(RD), level: 40, cyber };
  const back = sanitize(RD, decode(encode(toRaw(s))).build);
  assert.deepEqual([...back.cyber], [...cyber]);
});
