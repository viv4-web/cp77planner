#!/usr/bin/env python3
"""Build dist/live and dist/offline from the same source (Python 3 stdlib only).

Both outputs are a copy of src/ + data/. The ONLY difference is the art resolver map
(art-map.json: record ID -> art path):
  dist/live     maps record IDs to files found in art/ (copied to img/game/); empty art/ => {} => placeholders
  dist/offline  always {}  => original placeholder glyphs only; art/ is never read
"""
import argparse
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import ids  # noqa: E402
ART_EXT = {".png", ".webp", ".jpg", ".jpeg", ".svg"}
SAFE_ID = re.compile(r"^[A-Za-z0-9_.\-]+$")


def copy_site(out: Path):
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ROOT / "src", out)
    data = ROOT / "data"
    if data.exists():
        shutil.copytree(data, out / "data", ignore=shutil.ignore_patterns("ids.json"))
        # n comes ONLY from the append-only registry (data/ids.json), injected here, never at page load.
        # A record without a registry entry fails the build.
        registry = json.loads((data / "ids.json").read_text())["ids"]
        for f in sorted((out / "data").rglob("tree.json")):
            doc = ids.inject(json.loads(f.read_text()), registry, str(f.relative_to(out)))
            f.write_text(json.dumps(doc, indent=1) + "\n")


def build_art_map(art_dir: Path, out: Path) -> dict:
    """Files in art/ are named <record id>.<ext>. Returns {record id: relative path}."""
    mapping = {}
    if not art_dir.is_dir():
        return mapping
    dest = out / "img" / "game"
    for f in sorted(art_dir.iterdir()):
        if not f.is_file() or f.suffix.lower() not in ART_EXT or not SAFE_ID.match(f.stem):
            continue
        dest.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, dest / f.name)
        mapping[f.stem] = f"img/game/{f.name}"
    return mapping


def write_map(out: Path, mapping: dict):
    (out / "art-map.json").write_text(json.dumps(mapping, indent=1, sort_keys=True) + "\n")


def build(dist: Path, art_dir: Path):
    live, offline = dist / "live", dist / "offline"
    copy_site(live)
    write_map(live, build_art_map(art_dir, live))
    copy_site(offline)
    write_map(offline, {})
    return live, offline


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=str(ROOT / "dist"), help="output directory (default: dist/)")
    ap.add_argument("--art", default=str(ROOT / "art"), help="game art directory (default: art/)")
    a = ap.parse_args(argv)
    try:
        live, offline = build(Path(a.out), Path(a.art))
    except ids.MissingIds as e:
        print(f"BUILD FAILED, registry problem:\n{e}", file=sys.stderr)
        return 1
    n = len(json.loads((live / "art-map.json").read_text()))
    print(f"built {live} ({n} art files) and {offline} (placeholders only)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
