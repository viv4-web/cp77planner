#!/usr/bin/env python3
"""Build dist/live and dist/offline from the same source (Python 3 stdlib only).

Both outputs are a copy of src/ + data/. The ONLY difference is the art resolver map
(art-map.json: record ID -> art path):
  dist/live     maps record IDs to files found in art/ (copied to img/game/); empty art/ => {} => placeholders
  dist/offline  always {}  => original placeholder glyphs only; art/ is never read

The ripperdoc screen has a second, separate set of game art: atlas parts and paperdoll clips from ~/work/cyber-art/out (written by
tools/art.py and tools/paperdoll_video.py). dist/live gets only the files data/ripperdoc/layout.json references, copied to img/ui/ and
media/, and ui-art.json (key -> path). dist/offline always gets an empty ui-art.json. Without that folder the screen uses placeholders.
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
UI_OUT = Path.home() / "work" / "cyber-art" / "out"
UI_EXTRA_PARTS = ["background/background", "cw_bars_assets/cw_barbg", "cw_bars_assets/bar_long2", "cw_bars_assets/perk_highlight_nottransparent"]  # besides the hover sprites named in the layout
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
        for f in sorted(p for p in (out / "data").rglob("*.json") if p.name != "ids.json"):
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


def build_ui_art(ui_out: Path, out: Path) -> dict:
    """Copy the ripperdoc art the layout references (sprites, background, body loops, zone clips) and return the ui-art.json document."""
    doc = {"parts": {}, "clips": {}, "icons": {}}
    lay_file = ROOT / "data" / "ripperdoc" / "layout.json"
    if not lay_file.is_file() or not ui_out.is_dir():
        return doc
    layout = json.loads(lay_file.read_text())
    parts = list(UI_EXTRA_PARTS)
    wfile, ifile = ROOT / "data" / "ripperdoc" / "widgets.json", ROOT / "data" / "ripperdoc" / "icons.json"
    if wfile.is_file():
        parts += json.loads(wfile.read_text())["parts"]                       # slot tile / tooltip frame parts
    if ifile.is_file():
        used = {i.get("icon") or i.get("iconName") for i in json.loads((ROOT / "data" / "cyberware.json").read_text())["implants"]}
        icons = json.loads(ifile.read_text())["map"]
        doc["icons"] = {k: v for k, v in sorted(icons.items()) if k in used}   # only the icons our data references
        parts += list(doc["icons"].values())
    clips = []
    for gender, g in sorted(layout["genders"].items()):
        clips.append((gender, g["loop"]))
        for z in g["zones"].values():
            parts.append(f"{gender}_body/{z['sprite']['part']}")
            clips.append((gender, z["clip"]["name"]))
    for key in sorted(set(parts)):
        src = ui_out / "ui" / f"{key}.webp"
        if src.is_file():
            dst = out / "img" / "ui" / f"{key}.webp"
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            doc["parts"][key] = f"img/ui/{key}.webp"
    for gender, clip in sorted(set(clips)):
        base = ui_out / "paperdoll" / gender / clip
        have = {"webm": base.with_suffix(".webm"), "sm": base.parent / f"{clip}_sm.webm", "poster": base.with_suffix(".webp")}
        if not all(p.is_file() for p in have.values()):
            continue
        entry = {}
        for k, p in have.items():
            dst = out / "media" / gender / p.name
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, dst)
            entry[k] = f"media/{gender}/{p.name}"
        doc["clips"][f"{gender}/{clip}"] = entry
    return doc


def write_ui_art(out: Path, doc: dict):
    (out / "ui-art.json").write_text(json.dumps(doc, indent=1, sort_keys=True) + "\n")


def build(dist: Path, art_dir: Path, ui_out: Path = None):
    live, offline = dist / "live", dist / "offline"
    copy_site(live)
    write_map(live, build_art_map(art_dir, live))
    write_ui_art(live, build_ui_art(UI_OUT if ui_out is None else ui_out, live))
    copy_site(offline)
    write_map(offline, {})
    write_ui_art(offline, {"parts": {}, "clips": {}, "icons": {}})
    return live, offline


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=str(ROOT / "dist"), help="output directory (default: dist/)")
    ap.add_argument("--art", default=str(ROOT / "art"), help="game art directory (default: art/)")
    ap.add_argument("--ui-art", default=str(UI_OUT), help="ripperdoc art folder (default: ~/work/cyber-art/out)")
    a = ap.parse_args(argv)
    try:
        live, offline = build(Path(a.out), Path(a.art), Path(a.ui_art))
    except ids.MissingIds as e:
        print(f"BUILD FAILED, registry problem:\n{e}", file=sys.stderr)
        return 1
    n = len(json.loads((live / "art-map.json").read_text()))
    ui = json.loads((live / "ui-art.json").read_text())
    print(f"built {live} ({n} art files, {len(ui['parts'])} ui parts, {len(ui['clips'])} clips) and {offline} (placeholders only)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
