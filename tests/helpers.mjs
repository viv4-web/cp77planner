import { readFileSync } from 'node:fs';
import { buildIndex } from '../src/js/rules.js';

// n comes only from the registry (data/ids.json); mirror what tools/build.py injects.
export function loadD() {
  const reg = JSON.parse(readFileSync(new URL('../data/ids.json', import.meta.url))).ids;
  const read = (f, dir = 'data/sample') => {
    const doc = JSON.parse(readFileSync(new URL(`../${dir}/${f}`, import.meta.url)));
    const recs = [...(doc.trees || []).flatMap((t) => [t, ...t.perks]), ...(doc.groups || []), ...(doc.implants || [])];
    if (dir === 'tests/fixtures') return doc;                       // hand-made fixture carries its own test-only n
    for (const r of recs) { if (!(r.id in reg)) throw new Error(`no registry entry: ${r.id}`); r.n = reg[r.id]; }
    return doc;
  };
  const D = buildIndex(read('tree.json'), read('cyberware.json', 'tests/fixtures'));
  return { D, C: D.cyber };
}

// The real shipped data (data/cyberware.json), with n from the registry like the build does.
export function loadReal() {
  const reg = JSON.parse(readFileSync(new URL('../data/ids.json', import.meta.url))).ids;
  const doc = JSON.parse(readFileSync(new URL('../data/cyberware.json', import.meta.url)));
  for (const r of [...doc.groups, ...doc.implants]) { if (!(r.id in reg)) throw new Error(`no registry entry: ${r.id}`); r.n = reg[r.id]; }
  const tree = JSON.parse(readFileSync(new URL('../data/sample/tree.json', import.meta.url)));
  const recs = tree.trees.flatMap((t) => [t, ...t.perks]);
  for (const r of recs) r.n = reg[r.id];
  const D = buildIndex(tree, doc);
  return { D, C: D.cyber, doc };
}
