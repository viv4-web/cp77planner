import { readFileSync } from 'node:fs';
import { buildIndex } from '../src/js/rules.js';

// n comes only from the registry (data/ids.json); mirror what tools/build.py injects.
export function loadD() {
  const reg = JSON.parse(readFileSync(new URL('../data/ids.json', import.meta.url))).ids;
  const read = (f) => {
    const doc = JSON.parse(readFileSync(new URL(`../data/sample/${f}`, import.meta.url)));
    const recs = [...(doc.trees || []).flatMap((t) => [t, ...t.perks]), ...(doc.groups || []), ...(doc.implants || [])];
    for (const r of recs) { if (!(r.id in reg)) throw new Error(`no registry entry: ${r.id}`); r.n = reg[r.id]; }
    return doc;
  };
  const D = buildIndex(read('tree.json'), read('cyberware.json'));
  return { D, C: D.cyber };
}
