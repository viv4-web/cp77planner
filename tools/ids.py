#!/usr/bin/env python3
"""Append-only ID registry helper (Python 3 stdlib only).

  tools/ids.py add NAME [NAME...]   register new record names with the next free n
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


def add(names):
    reg = load()
    for name in names:
        if name in reg["ids"]:
            print(f"{name}: already n={reg['ids'][name]}")
            continue
        reg["ids"][name] = reg["next"]
        print(f"{name}: n={reg['next']}")
        reg["next"] += 1
    REG.write_text(json.dumps(reg, indent=1) + "\n")


def records(tree_file):
    d = json.loads(tree_file.read_text())
    for t in d["trees"]:
        yield t["id"], t["n"]
        for p in t["perks"]:
            yield p["id"], p["n"]


def check():
    reg, bad = load(), []
    for f in sorted((ROOT / "data").rglob("tree.json")):
        for name, n in records(f):
            if reg["ids"].get(name) != n:
                bad.append(f"{f.relative_to(ROOT)}: {name} has n={n}, registry says {reg['ids'].get(name)}")
    print("\n".join(bad) or "ok")
    return 1 if bad else 0


if __name__ == "__main__":
    if sys.argv[1:2] == ["add"] and len(sys.argv) > 2:
        add(sys.argv[2:])
    elif sys.argv[1:2] == ["check"]:
        sys.exit(check())
    else:
        sys.exit(__doc__)
