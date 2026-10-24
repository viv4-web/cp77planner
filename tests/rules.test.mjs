import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildIndex, defaultState, pools, perkStatus, install, refund, setAttr, setLevel, minLevel, sanitize, toRaw,
} from '../src/js/rules.js';
import { encode, decode } from '../src/js/codec.js';

// n comes only from the registry (data/ids.json); mirror what tools/build.py injects.
const reg = JSON.parse(readFileSync(new URL('../data/ids.json', import.meta.url))).ids;
const doc = JSON.parse(readFileSync(new URL('../data/sample/tree.json', import.meta.url)));
for (const t of doc.trees) for (const r of [t, ...t.perks]) { assert.ok(r.id in reg, r.id); r.n = reg[r.id]; }
const D = buildIndex(doc);
const body = D.trees[0];
const t1 = body.perks.find((p) => p.tier === 0).n;
const t2 = body.perks.find((p) => p.tier === 1).n;

function withAttr(s, idx, v) {
  const r = setAttr(D, { ...s, level: 60 }, idx, v);
  assert.ok(r.ok);
  return r.state;
}

test('locked perks cannot be installed', () => {
  let s = { ...defaultState(D), level: 10 };
  assert.equal(perkStatus(D, s, t1), 'locked');
  const r = install(D, s, t1);
  assert.deepEqual([r.ok, r.reason], [false, 'locked']);
  assert.equal(r.state.perks.size, 0);
});

test('requirement met => available; install spends a point; refund gives it back', () => {
  let s = withAttr(defaultState(D), 0, 4);
  assert.equal(perkStatus(D, s, t1), 'available');
  const before = pools(D, s).perkFree;
  const r = install(D, s, t1);
  assert.ok(r.ok);
  assert.equal(perkStatus(D, r.state, t1), 'owned');
  assert.equal(pools(D, r.state).perkFree, before - 1);
  const back = refund(D, r.state, t1);
  assert.ok(back.ok);
  assert.equal(pools(D, back.state).perkFree, before);
  assert.equal(perkStatus(D, back.state, t1), 'available');
});

test('cannot install without points', () => {
  let s = withAttr(defaultState(D), 0, 4);
  s = { ...s, level: minLevel(D, s) };          // exactly enough level for the attribute points
  const free = pools(D, s).perkFree;
  let cur = s, bought = 0;
  for (const p of body.perks.filter((x) => x.tier === 0)) {
    const r = install(D, cur, p.n);
    if (r.ok) { cur = r.state; bought++; }
  }
  assert.equal(bought, Math.min(free, 3));
  if (free < 3) assert.equal(pools(D, cur).perkFree, 0);
  // a fresh level-1 state has 1 perk point; with the gate met but 0 points left it must refuse
  let z = withAttr(defaultState(D), 0, 4);
  z = { ...z, level: minLevel(D, z), perks: new Set() };
  while (pools(D, z).perkFree > 0) {
    const nxt = body.perks.find((p) => p.tier === 0 && !z.perks.has(p.n));
    if (!nxt) break;
    z = install(D, z, nxt.n).state;
  }
  if (pools(D, z).perkFree === 0) {
    const left = body.perks.find((p) => p.tier === 0 && !z.perks.has(p.n));
    if (left) assert.deepEqual(install(D, z, left.n).reason, 'no-points');
  }
});

test('cannot lower an attribute below an owned perk requirement; cannot refund away a dependency', () => {
  let s = withAttr(defaultState(D), 0, 9);
  s = install(D, s, t2).state;
  assert.ok(s.perks.has(t2));
  assert.equal(setAttr(D, s, 0, 8).ok, false);
  assert.equal(setAttr(D, s, 0, 9).ok, false); // unchanged
  assert.equal(s.attrs[0], 9);
});

test('relic tree: tier gate counts owned lower-tier perks; refund blocked if it breaks a dependency', () => {
  const relic = D.trees.find((t) => t.kind === 'relic');
  const a = relic.perks.filter((p) => p.tier === 0).map((p) => p.n);
  const b = relic.perks.find((p) => p.tier === 1).n;
  let s = { ...defaultState(D), level: 1 };
  assert.equal(perkStatus(D, s, b), 'locked');
  for (const n of a) s = install(D, s, n).state;
  assert.equal(perkStatus(D, s, b), 'available');
  s = install(D, s, b).state;
  assert.equal(refund(D, s, a[0]).ok, false);
  assert.equal(refund(D, s, b).ok, true);
  assert.equal(pools(D, s).relicSpent, 3);
});

test('level can not drop below what has been spent', () => {
  let s = withAttr(defaultState(D), 0, 12);
  const min = minLevel(D, s);
  assert.equal(setLevel(D, s, 1).level, min);
});

test('sanitize drops unknown ids, clamps values, and survives garbage', () => {
  const s = sanitize(D, { level: 9999, attrs: [99, -5, NaN, 7, undefined], perks: [999999, 111, 111] });
  assert.equal(s.level <= D.rules.maxLevel, true);
  assert.deepEqual(s.attrs.map((v) => v >= D.rules.attrBase && v <= D.rules.attrMax), [true, true, true, true, true]);
  assert.ok(pools(D, s).perkFree >= 0 && pools(D, s).attrFree >= 0);
  assert.doesNotThrow(() => sanitize(D, {}));
  assert.doesNotThrow(() => sanitize(D, { perks: 'nope', attrs: 5 }));
});

test('state -> link -> state is stable', () => {
  let s = withAttr(defaultState(D), 0, 9);
  s = install(D, s, t1).state;
  s = install(D, s, t2).state;
  const back = sanitize(D, decode(encode(toRaw(s))).build);
  assert.deepEqual([...back.perks].sort(), [...s.perks].sort());
  assert.deepEqual(back.attrs, s.attrs);
});
