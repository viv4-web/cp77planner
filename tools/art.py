#!/usr/bin/env python3
"""Site-ready UI art for the ripperdoc screen: atlas part PNGs -> WebP in ~/work/cyber-art/out/ui/ (Python 3 stdlib + ffmpeg).

  tools/art.py [--raw DIR] [--out DIR]

The only writer of ~/work/cyber-art/out/ui/. Reads the exported atlas parts under ~/work/cyber-art/raw/ui (read only) and writes
<atlas>/<part>.webp plus manifest.json (key -> file, size, sha256, source path, game version note). Game art never enters the repo:
tools/build.py copies the files the layout references into dist/live only. Deterministic and re-runnable.
"""
import argparse
import hashlib
import json
import os
import struct
import subprocess
import sys
from pathlib import Path

HOME = Path.home() / "work" / "cyber-art"
GUI = "base/gameplay/gui/fullscreen/ripperdoc"
# (atlas folder under GUI, resolution folder, parts or None for all except the listed skips)
SOURCES = [
    ("man_body.inkatlas", "1080p", None, {"ma_ocular_mask"}),
    ("woman_body.inkatlas", "1080p", None, {"wo_ocular_mask"}),
    ("assets/cw_bars_assets.inkatlas", "1080p",
     {"cw_barbg", "armor_barbg", "bar", "bar_long1", "bar_long2", "perk_glow", "perk_highlight", "perk_highlight_nottransparent", "armorLimiter",
      "counterLabel", "counterLabel_stroke", "upgrade_corner"}, set()),
    ("background.inkatlas", "2160p", {"background"}, set()),
]


def png_size(p: Path):
    h = p.read_bytes()[:24]
    return struct.unpack(">II", h[16:24])


def to_webp(src: Path, dst: Path):
    w, h = png_size(src)
    lossless = w * h <= 20000
    q = ["-lossless", "1"] if lossless else ["-quality", "90"]
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), "-frames:v", "1", "-c:v", "libwebp", *q,
                    "-compression_level", "6", "-fflags", "+bitexact", "-map_metadata", "-1", str(dst)], check=True)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", default=str(HOME / "raw" / "ui"))
    ap.add_argument("--out", default=str(HOME / "out" / "ui"))
    a = ap.parse_args(argv)
    os.environ["PATH"] = f"{Path.home() / 'bin'}{os.pathsep}{os.environ.get('PATH', '')}"
    raw, out = Path(a.raw), Path(a.out)
    files = {}
    for atlas, res, parts, skip in SOURCES:
        folder = raw / "base" / "gameplay" / "gui" / "fullscreen" / "ripperdoc" / atlas / res
        if not folder.is_dir():
            sys.exit(f"missing {folder}")
        for png in sorted(folder.glob("*.png")):
            part = png.stem
            if (parts is not None and part not in parts) or part in skip:
                continue
            name = Path(atlas).name.replace(".inkatlas", "")
            dst = out / name / f"{part}.webp"
            to_webp(png, dst)
            w, h = png_size(png)
            files[f"{name}/{part}"] = {"file": f"{name}/{part}.webp", "w": w, "h": h, "bytes": dst.stat().st_size,
                                       "sha256": hashlib.sha256(png.read_bytes()).hexdigest(),
                                       "source": f"{GUI}/{atlas}/{res}/{part}.png"}
    (out / "manifest.json").write_text(json.dumps({"gameVersion": "2.5 (WolvenKit header GameVersion 2310)", "files": files}, indent=1, sort_keys=True) + "\n")
    print(f"{len(files)} parts, {sum(f['bytes'] for f in files.values()) // 1024} KB -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
