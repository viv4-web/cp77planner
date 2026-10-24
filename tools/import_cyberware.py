#!/usr/bin/env python3
"""Import the CET dump (cyberware + costs) into data/cyberware.json (Python 3 stdlib only).

  tools/import_cyberware.py [--extract DIR] [--out FILE] [--report FILE] [--register]

Reads <extract>/cyberware_v*.json and <extract>/costs_v*.json (read only; newest version wins) and the mapping
tables in tools/cyberware-map.json. Raw game data is never written to the repo: the output holds only normalized
planner data (names, numbers, rules). Deterministic: same input, same output.

Record numbers come only from the append-only registry (tools/ids.py). Without --register the importer lists records
that have no entry yet; with --register it adds them through ids.add (groups first, then implants sorted by id).
"""
import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import ids  # noqa: E402

DEFAULT_EXTRACT = Path.home() / "work" / "cyber-extract" / "2.5"
MAP = Path(__file__).resolve().parent / "cyberware-map.json"


def newest(folder: Path, prefix: str) -> Path:
    files = sorted(folder.glob(f"{prefix}_v*.json"), key=lambda p: int(re.search(r"_v(\d+)\.json$", p.name).group(1)))
    if not files:
        sys.exit(f"no {prefix}_v*.json in {folder}")
    return files[-1]


def clean_value(v, digits):
    """The dump carries float32 noise (0.40000000596046); round it and drop a trailing .0."""
    r = round(v, digits)
    return int(r) if r == int(r) else r


def cost_of(costs, rec_id, stat):
    c = costs.get(rec_id)
    v = c.get(stat) if isinstance(c, dict) else None
    return int(v) if isinstance(v, (int, float)) and v > 0 else None


def build(records, costs, cfg):
    """Pure transform: (dump records, costs, config) -> (data document, report dict)."""
    area_slot = {a: s for s in cfg["slots"] for a in s["areas"]}
    quality_tier = {q["key"]: i + 1 for i, q in enumerate(cfg["qualities"])}
    quality_label = {q["key"]: q["label"] for q in cfg["qualities"]}
    flag_re = [re.compile(p) for p in cfg["flagStatPatterns"]]
    excl_re = [re.compile(p) for p in cfg["excludeIdPatterns"]]
    stat_cost, digits = cfg["costStat"], cfg["valueDigits"]
    gid = lambda s: f"Slot.{s['key']}"  # noqa: E731

    rep = {"total": len(records), "noCost": [], "excluded": [], "unmapped": defaultdict(list), "nullStats": 0,
           "noIcon": [], "icons": set(), "sameQuality": []}
    items = []
    # every iconPart in the dump, imported or not, so one WolvenKit export covers records Vivek may add back later
    rep["icons"] = {r["iconPart"] for r in records if r.get("iconPart")}
    for r in sorted(records, key=lambda x: x["id"]):
        cost = cost_of(costs, r["id"], stat_cost)
        if any(p.search(r["id"]) for p in excl_re):
            rep["excluded"].append(r["id"])
            continue
        if cost is None:
            rep["noCost"].append({"id": r["id"], "name": r["name"], "area": r["area"]})
            continue
        slot = area_slot.get(r["area"])
        if slot is None:
            rep["unmapped"][r["area"]].append(r["id"])
            continue
        if r["quality"] not in quality_tier:
            raise ValueError(f"{r['id']}: quality {r['quality']!r} is not in tools/cyberware-map.json")
        stats, flags = [], []
        for m in [*r.get("stats", []), *r.get("onEquip", [])]:
            name = m.get("stat")
            if not name:
                continue
            if any(p.search(name) for p in flag_re):
                if name not in flags:
                    flags.append(name)
                continue
            if not isinstance(m.get("value"), (int, float)):
                rep["nullStats"] += 1
                continue
            stats.append({"stat": name, "op": m["op"], "value": clean_value(m["value"], digits)})
        icon = r.get("iconPart") or None
        if not icon:
            rep["noIcon"].append(r["id"])
        items.append({"id": r["id"], "name": r["name"], "group": gid(slot), "family": f"{slot['key']}/{r['name']}",
                      "quality": quality_label[r["quality"]], "tier": quality_tier[r["quality"]],
                      "cost": cost, "stats": stats, "flags": flags, "icon": icon, "req": None})

    order = {gid(s): i for i, s in enumerate(cfg["slots"])}
    items.sort(key=lambda i: (order[i["group"]], i["name"], i["tier"], i["id"]))
    seen = Counter()
    for i in items:
        k = (i["family"], i["tier"])
        seen[k] += 1
        i["variant"] = seen[k]
    rep["sameQuality"] = sorted({i["family"] for i in items if seen[(i["family"], i["tier"])] > 1})
    doc = {
        "rules": cfg["rules"],
        "groups": [{"id": gid(s), "name": s["name"], "slots": s["slots"], "locked": s["locked"]} for s in cfg["slots"]],
        "implants": items,
    }
    return doc, rep


def render_report(doc, rep):
    n_fam = len({i["family"] for i in doc["implants"]})
    lines = [f"records in dump: {rep['total']}", f"imported: {len(doc['implants'])} implants in {n_fam} families",
             f"no cost (excluded, Vivek decides): {len(rep['noCost'])}"]
    by_area = Counter(x["area"] for x in rep["noCost"])
    lines += [f"  {a}: {n}" for a, n in sorted(by_area.items())]
    lines += [f"  {x['id']}  {x['name']}  [{x['area']}]" for x in rep["noCost"]]
    lines.append(f"excluded by id pattern (debug/test/tutorial): {len(rep['excluded'])}")
    lines += [f"  {i}" for i in rep["excluded"]]
    lines.append(f"unmapped areas with a cost: {sum(len(v) for v in rep['unmapped'].values())}")
    lines += [f"  {a}: {', '.join(v)}" for a, v in sorted(rep["unmapped"].items())]
    lines.append("slots with no source area (no items): " + ", ".join(g["name"] for g in doc["groups"] if not any(i["group"] == g["id"] for i in doc["implants"])))
    lines.append(f"stats without a value (dropped): {rep['nullStats']}")
    lines.append(f"records without iconPart: {len(rep['noIcon'])}")
    lines += [f"  {i}" for i in rep["noIcon"]]
    lines.append(f"families with several records at one quality (variant 2, 3, ...): {len(rep['sameQuality'])}")
    lines += [f"  {f}" for f in rep["sameQuality"]]
    lines.append(f"distinct iconPart names in the whole dump: {len(rep['icons'])}")
    lines += [f"  {i}" for i in sorted(rep["icons"])]
    return "\n".join(lines) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--extract", default=str(DEFAULT_EXTRACT))
    ap.add_argument("--out", default=str(ROOT / "data" / "cyberware.json"))
    ap.add_argument("--report", help="write the report here as well as to stdout")
    ap.add_argument("--map", default=str(MAP))
    ap.add_argument("--register", action="store_true", help="add unregistered records to data/ids.json via tools/ids.py")
    a = ap.parse_args(argv)
    ex = Path(a.extract)
    records = json.loads(newest(ex, "cyberware").read_text(encoding="utf-8"))
    costs = json.loads(newest(ex, "costs").read_text(encoding="utf-8"))
    doc, rep = build(records, costs, json.loads(Path(a.map).read_text(encoding="utf-8")))
    Path(a.out).write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    text = render_report(doc, rep)
    missing = [r["id"] for r in [*doc["groups"], *sorted(doc["implants"], key=lambda i: i["id"])] if r["id"] not in ids.load()["ids"]]
    if missing and a.register:
        ids.add(missing)
        missing = []
    text += f"records without a registry entry: {len(missing)}" + ("  (run with --register)" if missing else "") + "\n"
    if a.report:
        Path(a.report).write_text(text, encoding="utf-8")
    print(text)
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
