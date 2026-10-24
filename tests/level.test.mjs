import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildIndex, defaultState, setLevel, setAttr, minLevel, pools, sanitize, toRaw } from '../src/js/rules.js';
import { encode, decode } from '../src/js/codec.js';
import { parseLevelText, clampLevel, commitLevel, stepLevel, canStep } from '../src/js/level.js';

const reg = JSON.parse(readFileSync(new URL('../data/ids.json', import.meta.url))).ids;
const doc = JSON.parse(readFileSync(new URL('../data/sample/tree.json', import.meta.url)));
for (const t of doc.trees) for (const r of [t, ...t.perks]) r.n = reg[r.id];
const D = buildIndex(doc);
const MAX = D.rules.maxLevel;
const at = (level) => ({ ...defaultState(D), level });

test('parse: digits only, empty/invalid is null', () => {
  assert.equal(parseLevelText('50'), 50);
  assert.equal(parseLevelText(' 7 '), 7);
  for (const bad of ['', '  ', 'abc', '5a', '-3', '1.5', '1e2', '+4', null, undefined, '12345']) assert.equal(parseLevelText(bad), null, String(bad));
});

test('typed value clamps to 1..max (max comes from the data)', () => {
  assert.equal(commitLevel(D, at(10), '9999').level, MAX);
  assert.equal(commitLevel(D, at(10), '0').level, 1);
  assert.equal(commitLevel(D, at(10), '000').level, 1);
  assert.equal(commitLevel(D, at(10), String(MAX + 1)).level, MAX);
  assert.equal(commitLevel(D, at(10), '33').level, 33);
  assert.equal(clampLevel(D, 99999), MAX);
});

test('empty or invalid input reverts to the last valid level', () => {
  const s = at(42);
  for (const bad of ['', 'abc', '1.5', '-3', ' ']) assert.equal(commitLevel(D, s, bad), s, JSON.stringify(bad));
});

test('slider, box and steppers share one rule (never below what is spent)', () => {
  let s = { ...at(60) };
  for (let i = 0; i < 6; i++) s = setAttr(D, s, 0, s.attrs[0] + 1).state;       // spend 6 attribute points
  const min = minLevel(D, s);
  assert.ok(min > 1);
  assert.equal(setLevel(D, s, 1).level, min);                                 // slider
  assert.equal(commitLevel(D, s, '1').level, min);                            // typed
  assert.equal(stepLevel(D, { ...s, level: min }, -1).level, min);            // stepper
  assert.equal(stepLevel(D, { ...s, level: min }, -5).level, min);            // shift+arrow
  for (const v of ['1', '5', String(min), '40', '999']) {                      // always a valid build
    const r = commitLevel(D, s, v);
    assert.ok(pools(D, r).attrFree >= 0 && pools(D, r).perkFree >= 0);
  }
});

test('box and slider stay in sync: same input gives the same state', () => {
  for (let n = 1; n <= MAX; n++) assert.deepEqual(commitLevel(D, at(7), String(n)), setLevel(D, at(7), n));
});

test('arrow/step keys: +-1, shift +-5, clamped; Home/End = min/max', () => {
  assert.equal(stepLevel(D, at(10), 1).level, 11);
  assert.equal(stepLevel(D, at(10), -1).level, 9);
  assert.equal(stepLevel(D, at(10), 5).level, 15);
  assert.equal(stepLevel(D, at(10), -5).level, 5);
  assert.equal(stepLevel(D, at(MAX), 1).level, MAX);
  assert.equal(stepLevel(D, at(2), -5).level, 1);
  assert.equal(commitLevel(D, at(10), '1').level, 1);
  assert.equal(commitLevel(D, at(10), String(MAX)).level, MAX);
});

test('steppers are disabled at min and max', () => {
  assert.deepEqual(canStep(D, at(1)), { dec: false, inc: true });
  assert.deepEqual(canStep(D, at(MAX)), { dec: true, inc: false });
  assert.deepEqual(canStep(D, at(10)), { dec: true, inc: true });
  let s = at(60);
  for (let i = 0; i < 6; i++) s = setAttr(D, s, 0, s.attrs[0] + 1).state;
  const low = setLevel(D, s, 1);
  assert.equal(canStep(D, low).dec, false, 'min is the lowest level the build allows');
});

test('level goes into the build link and survives a round trip', () => {
  const s = commitLevel(D, at(1), '37');
  const back = sanitize(D, decode(encode(toRaw(s))).build);
  assert.equal(back.level, 37);
  const typedHigh = commitLevel(D, at(1), '5000');
  assert.equal(decode(encode(toRaw(typedHigh))).build.level, MAX);
});
