import test from 'node:test';
import assert from 'node:assert/strict';
import { makeResolver } from '../src/js/art.js';

test('empty map (offline build) always yields placeholder glyphs', () => {
  const r = makeResolver({});
  for (const id of ['A.B', 'SAMPLE.Perk.Body.T1.A', '', 'x'.repeat(100)]) {
    const a = r.resolve(id);
    assert.equal(a.kind, 'glyph');
    assert.deepEqual(r.resolve(id), a, 'deterministic');
    assert.match(r.html(id), /img\/placeholder\/glyphs\.svg#g\d/);
    assert.doesNotMatch(r.html(id), /<img|(^|[^a-z])art\//);
  }
});

test('live map returns art for mapped ids, glyph for the rest', () => {
  const r = makeResolver({ 'Perk.X': 'img/game/Perk.X.png' });
  assert.deepEqual(r.resolve('Perk.X'), { kind: 'art', src: 'img/game/Perk.X.png' });
  assert.equal(r.resolve('Perk.Y').kind, 'glyph');
  assert.equal(r.resolve('constructor').kind, 'glyph');
  assert.equal(makeResolver(null ?? undefined).resolve('a').kind, 'glyph');
});
