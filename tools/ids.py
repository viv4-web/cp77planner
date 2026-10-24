#!/usr/bin/env python3
"""Append-only ID registry helper (Python 3 stdlib only).

  tools/ids.py add NAME [NAME...]   register new record names with the next free n
  tools/ids.py add --sample NAME... register SAMPLE records from the reserved sample range (1..999)
  tools/ids.py check                verify data files against the registry

data/ids.json maps record name -> n. An n is never changed, reused or renumbered.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REG = ROOT / "data" / "ids.json"


def load():
    return json.loads(REG.read_text())


def add(names, sample=False):
    reg = load()
    key = "nextSample" if sample else "next"
    for name in names:
        if name in reg["ids"]:
            print(f"{name}: already n={reg['ids'][name]}")
            continue
        if sample and not name.startswith("SAMPLE."):
            sys.exit(f"{name}: --sample is only for SAMPLE.* records")
        if sample and reg[key] > 999:
            sys.exit("sample range (1..999) is full")
        reg["ids"][name] = reg[key]
        print(f"{name}: n={reg[key]}")
        reg[key] += 1
    REG.write_text(json.dumps(reg, indent=1) + "\n")


class MissingIds(Exception):
    pass


def inject(doc, ids, where="data"):
    """Set `n` on every tree and perk from the registry. Data files must not carry their own n.
    Raises MissingIds listing every record that has no registry entry (or that carries an inline n)."""
    problems = []
    recs = [r for t in doc.get("trees", []) for r in [t, *t.get("perks", [])]]
    recs += doc.get("groups", []) + doc.get("implants", [])
    if True:
        for rec in recs:
            name = rec.get("id")
            if "n" in rec:
                problems.append(f"{where}: {name} has an inline n; the registry (data/ids.json) is the only source")
            if name not in ids:
                problems.append(f"{where}: {name} has no entry in data/ids.json (python3 tools/ids.py add {name})")
            else:
                rec["n"] = ids[name]
    if problems:
        raise MissingIds("\n".join(problems))
    return doc


def check():
    reg, bad = load(), []
    for f in sorted(p for p in (ROOT / "data").rglob("*.json") if p.name != "ids.json"):
        try:
            inject(json.loads(f.read_text()), reg["ids"], str(f.relative_to(ROOT)))
        except MissingIds as e:
            bad.append(str(e))
    print("\n".join(bad) or "ok")
    return 1 if bad else 0


if __name__ == "__main__":
    if sys.argv[1:3] == ["add", "--sample"] and len(sys.argv) > 3:
        add(sys.argv[3:], sample=True)
    elif sys.argv[1:2] == ["add"] and len(sys.argv) > 2:
        add(sys.argv[2:])
    elif sys.argv[1:2] == ["check"]:
        sys.exit(check())
    else:
        sys.exit(__doc__)
