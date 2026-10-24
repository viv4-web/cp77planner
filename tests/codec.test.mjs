import test from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode } from '../src/js/codec.js';

const build = { level: 17, attrs: [9, 3, 12, 20, 4], perks: [111, 112, 523, 641, 211] };

test('round trip', () => {
  const r = decode(encode(build));
  assert.equal(r.ok, true);
  assert.equal(r.version, 1);
  assert.deepEqual(r.build, { ...build, perks: [...build.perks].sort((a, b) => a - b) });
});

test('round trip: empty perks and extremes', () => {
  const b = { level: 60, attrs: [20, 20, 20, 20, 20], perks: [] };
  assert.deepEqual(decode(encode(b)).build, b);
  const big = { level: 1, attrs: [3, 3, 3, 3, 3], perks: [1, 70000, 300] };
  assert.deepEqual(decode(encode(big)).build.perks, [1, 300, 70000]);
});

test('encoding is url-safe and versioned', () => {
  assert.match(encode(build), /^1\.[A-Za-z0-9_-]+$/);
});

// GOLDEN: this link format is frozen. If this test fails, you broke every shared link.
test('golden v1 link keeps decoding forever', () => {
  const r = decode('1.EQkDDAQUBX0BAQQC');
  assert.equal(r.ok, true);
  assert.deepEqual(r.build, { level: 17, attrs: [9, 3, 12, 4, 20], perks: [125, 126, 127, 131, 133] });
  assert.equal(encode(r.build), '1.EQkDDAQUBX0BAQQC');
});

test('malformed links never throw', () => {
  const bad = [undefined, null, '', '1', '1.', '.abc', 'x.y', '1.!!!', '1.A', '1.AAAA', '1.' + 'A'.repeat(5000),
    '1.EQkDDAQUBP__________', '99999.AAAA', '-1.AAAA', '1.EQkDDAQUBAN9fg', 123, {}, '1.AAAAAAAAAA/'];
  for (const s of bad) {
    const r = decode(s);
    assert.equal(r.ok, false, String(s));
    assert.ok(r.reason);
  }
});

test('unknown / future versions are reported, not crashed', () => {
  const r = decode('2.AAAAAAAAAAA');
  assert.deepEqual([r.ok, r.reason, r.version], [false, 'unknown-version', 2]);
  assert.equal(decode('0.AAAAAAAAAAA').reason, 'unknown-version');
});
