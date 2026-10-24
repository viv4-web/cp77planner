#!/usr/bin/env python3
"""Generic inkatlas cutter: <atlas>.inkatlas.json + the full <atlas>.png -> one WebP per part (Python 3 stdlib + ffmpeg).

  tools/atlas_cut.py [--raw DIR] [--out DIR] [--atlas NAME|PATH-SUBSTRING ...] [--all] [--keep-going]

Reads the atlases under ~/work/cyber-art/raw/ui (read only; the *.xbm.json dumps and the WolvenKit per-part folders are ignored) and
writes ~/work/cyber-art/out/ui/<atlas>/<part>.webp plus out/ui/atlas-index.json (atlas -> part -> file, w, h, rect in px, sha256 of the
source PNG). Part rectangles are the UV rectangles times the PNG size (rounded to whole pixels). Deterministic and re-runnable: the
same input gives byte-identical output, and a part whose file already exists with the same rect is skipped.
tools/art.py still writes the ripperdoc folders (man_body, woman_body, cw_bars_assets, background); this tool owns the others.
Game art never enters the repo: tools/build.py copies only the parts the data references into dist/live.
"""
import argparse
import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HOME = Path.home() / "work" / "cyber-art"
GUI = "base/gameplay/gui"
MIN_FREE_GB = 20
# Atlases cut by default (relative to the gui folder, without .inkatlas.json); --atlas adds/selects others, --all cuts every atlas.
DEFAULT = ["common/icons/items/item_icons*", "common/icons/item_icons", "common/icons/atlas_common", "common/icons/mappin_icons", "common/icons/attributes_icons",
           "common/icons/weapon_types", "common/icons/weapon_manufacturers", "common/icons/atlas_damage_types_icons",
           "common/icons/quickhacks_icons", "common/icons/atlas_inventory_fallback", "common/icons/atlas_tabs",
           "common/masks_slots", "common/shadow_blobs", "common/shapes/atlas_shapes_sync", "fullscreen/inventory/inventory4_atlas"]


def png_size(p: Path):
    return struct.unpack(">II", p.read_bytes()[16:24])


def parts_of(d):
    """[(name, (l, t, r, b) UV)] of an inkTextureAtlas chunk (slots[].parts[] and, when present, the single-mode parts[])."""
    ch = d["Data"]["RootChunk"]
    out = []
    for slot in (ch.get("slots") or {}).get("Elements", []):
        for p in slot.get("parts", []):
            r = p["clippingRectInUVCoords"]
            out.append((p["partName"]["$value"], (r["Left"], r["Top"], r["Right"], r["Bottom"])))
    for p in ch.get("parts", []):
        r = p["clippingRectInUVCoords"]
        out.append((p["partName"]["$value"], (r["Left"], r["Top"], r["Right"], r["Bottom"])))
    return out


def pixel_rect(uv, w, h):
    l, t, r, b = uv
    x0, y0 = max(0, round(l * w)), max(0, round(t * h))
    x1, y1 = min(w, round(r * w)), min(h, round(b * h))
    return x0, y0, x1 - x0, y1 - y0


def encode_args(w, h):
    # libwebp lossy at level 6 is ~50x slower for no visible gain here
    return ["-lossless", "1", "-compression_level", "6"] if w * h <= 20000 else ["-quality", "90", "-compression_level", "4"]


def decode(png: Path, w, h):
    """The whole atlas as raw RGBA bytes (decoded once; each part is then a row slice piped to its own encoder)."""
    r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(png), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
                       check=True, stdout=subprocess.PIPE)
    if len(r.stdout) != w * h * 4:
        raise RuntimeError(f"{png}: decoded {len(r.stdout)} bytes, expected {w * h * 4}")
    return r.stdout


def cut_one(raw, aw, name, rect, outdir: Path):
    x, y, w, h = rect
    rows = b"".join(raw[((y + j) * aw + x) * 4:((y + j) * aw + x + w) * 4] for j in range(h))
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{w}x{h}", "-i", "-",
                    "-frames:v", "1", "-c:v", "libwebp", *encode_args(w, h), "-fflags", "+bitexact",
                    "-map_metadata", "-1", str(outdir / f"{name}.webp")], input=rows, check=True)


def cut_atlas(png: Path, aw, ah, rects, outdir: Path):
    """rects: [(part, (x, y, w, h))] -> outdir/<part>.webp, encoded in parallel."""
    outdir.mkdir(parents=True, exist_ok=True)
    raw = decode(png, aw, ah)
    with ThreadPoolExecutor(max_workers=os.cpu_count() or 4) as ex:
        for f in [ex.submit(cut_one, raw, aw, n, r, outdir) for n, r in rects]:
            f.result()


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", default=str(HOME / "raw" / "ui"))
    ap.add_argument("--out", default=str(HOME / "out" / "ui"))
    ap.add_argument("--atlas", action="append", help="atlas path (relative to the gui folder, glob ok) or name; default: the planner set")
    ap.add_argument("--all", action="store_true", help="cut every atlas under the gui folder")
    a = ap.parse_args(argv)
    os.environ["PATH"] = f"{Path.home() / 'bin'}{os.pathsep}{os.environ.get('PATH', '')}"
    gui = Path(a.raw) / GUI
    out = Path(a.out)
    if not gui.is_dir():
        sys.exit(f"missing {gui}")
    free_gb = shutil.disk_usage(out if out.exists() else out.parent).free / 2**30
    if free_gb < MIN_FREE_GB:
        sys.exit(f"only {free_gb:.1f} GB free, stopping (the rule is {MIN_FREE_GB} GB)")
    pats = ["**/*"] if a.all else [p if "/" in p or "*" in p else f"**/{p}" for p in (a.atlas or DEFAULT)]
    jsons = sorted({j for p in pats for j in gui.glob(p + ".inkatlas.json")})
    if not jsons:
        sys.exit("no atlas matched")
    idx_path = out / "atlas-index.json"
    index = json.loads(idx_path.read_text())["atlases"] if idx_path.exists() else {}
    total = 0
    for j in jsons:
        name = j.name[: -len(".inkatlas.json")]
        png = j.with_name(name + ".png")
        if not png.exists():
            print(f"skip {name}: no full-size PNG", file=sys.stderr)
            continue
        w, h = png_size(png)
        seen, rects = {}, []
        for part, uv in parts_of(json.loads(j.read_text())):
            if part in seen:  # duplicate part name inside one atlas: the first one wins (reported)
                continue
            r = pixel_rect(uv, w, h)
            if r[2] <= 0 or r[3] <= 0:
                continue
            seen[part] = r
            rects.append((part, r))
        old = index.get(name, {}).get("parts", {})
        todo = [(p, r) for p, r in rects if old.get(p, {}).get("rect") != list(r) or not (out / name / f"{p}.webp").exists()]
        if todo:
            cut_atlas(png, w, h, todo, out / name)
        sha = hashlib.sha256(png.read_bytes()).hexdigest()
        index[name] = {"source": f"{GUI}/{j.relative_to(gui).as_posix()[: -len('.inkatlas.json')]}.png", "w": w, "h": h, "sha256": sha,
                       "parts": {p: {"file": f"{name}/{p}.webp", "w": r[2], "h": r[3], "rect": list(r)} for p, r in sorted(rects)}}
        total += len(rects)
        print(f"{name}: {len(rects)} parts ({len(todo)} cut)")
    out.mkdir(parents=True, exist_ok=True)
    idx_path.write_text(json.dumps({"gameVersion": "2.5 (WolvenKit header GameVersion 2310)", "atlases": index}, indent=1, sort_keys=True) + "\n")
    print(f"{total} parts in {len(jsons)} atlases -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
