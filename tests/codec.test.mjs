import test from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode } from '../src/js/codec.js';

const build = { level: 17, attrs: [9, 3, 12, 20, 4], perks: [111, 112, 523, 641, 211] };

test('round trip', () => {
  const r = decode(encode(build));
  assert.equal(r.ok, true);
  assert.equal(r.version, 2);
  assert.deepEqual(r.build, { ...build, perks: [...build.perks].sort((a, b) => a - b), cyber: [] });
});

test('round trip: empty perks and extremes', () => {
  const b = { level: 60, attrs: [20, 20, 20, 20, 20], perks: [], cyber: [] };
  assert.deepEqual(decode(encode(b)).build, b);
  const big = { level: 1, attrs: [3, 3, 3, 3, 3], perks: [1, 70000, 300] };
  assert.deepEqual(decode(encode(big)).build.perks, [1, 300, 70000]);
});

test('encoding is url-safe and versioned', () => {
  assert.match(encode(build), /^2\.[A-Za-z0-9_-]+$/);
});

// GOLDEN: link formats are frozen. If these fail, you broke every shared link of that version.
test('golden v1 link (no cyberware) keeps decoding forever', () => {
  const r = decode('1.EQkDDAQUBX0BAQQC');
  assert.equal(r.ok, true);
  assert.equal(r.version, 1);
  assert.deepEqual(r.build, { level: 17, attrs: [9, 3, 12, 4, 20], perks: [125, 126, 127, 131, 133], cyber: [] });
});

test('golden v2 link (with cyberware) keeps decoding forever and re-encodes identically', () => {
  const link = '2.EQkDDAQUBX0BAQQCArwFAcYFvgUAyAU';
  const r = decode(link);
  assert.equal(r.ok, true);
  assert.equal(r.version, 2);
  assert.deepEqual(r.build, { level: 17, attrs: [9, 3, 12, 4, 20], perks: [125, 126, 127, 131, 133], cyber: [[700, 1, 710], [702, 0, 712]] });
  assert.equal(encode(r.build), link);
});

test('cyberware entries round trip in any input order', () => {
  const b = { level: 5, attrs: [3, 3, 3, 3, 3], perks: [], cyber: [[705, 0, 750], [700, 2, 711], [700, 0, 710]] };
  assert.deepEqual(decode(encode(b)).build.cyber, [[700, 0, 710], [700, 2, 711], [705, 0, 750]]);
});

test('malformed links never throw', () => {
  const bad = [undefined, null, '', '1', '1.', '.abc', 'x.y', '1.!!!', '1.A', '1.AAAA', '1.' + 'A'.repeat(5000),
    '1.EQkDDAQUBP__________', '99999.AAAA', '-1.AAAA', '1.EQkDDAQUBAN9fg', 123, {}, '1.AAAAAAAAAA/', '2.', '2.EQkDDAQUBX0BAQQCAg', '2.EQkDDAQUBX0BAQQCArwFAcYFvgUAyAUA'];
  for (const s of bad) {
    const r = decode(s);
    assert.equal(r.ok, false, String(s));
    assert.ok(r.reason);
  }
});

test('unknown / future versions are reported, not crashed', () => {
  const r = decode('3.AAAAAAAAAAA');
  assert.deepEqual([r.ok, r.reason, r.version], [false, 'unknown-version', 3]);
  assert.equal(decode('0.AAAAAAAAAAA').reason, 'unknown-version');
});
