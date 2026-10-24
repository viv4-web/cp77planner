#!/usr/bin/env python3
"""Encode the ripperdoll paperdoll PNG frame sequences to VP9+alpha WebM (Python 3 stdlib + ffmpeg/ffprobe).

  tools/paperdoll_video.py [--raw DIR] [--out DIR] [--clip NAME ...] [--force] [--dry-run]

Input  (read only): ~/work/cyber-art/raw/paperdoll/{man,woman}/<clip>NNN.png   (PNG frames with alpha, 30 fps, from RAD Video Tools)
Output: ~/work/cyber-art/out/paperdoll/{man,woman}/<clip>.webm        full size
                                                       <clip>_sm.webm     half width (phone)
                                                       <clip>.png         poster (middle frame): Safari / motion-off fallback
        ~/work/cyber-art/out/paperdoll/manifest.json                    clip -> files, sizes, frame count, alpha check

Raw game content stays in ~/work/cyber-art; nothing here is committed. Re-runnable and deterministic: a clip whose frames (content hash)
and encoder settings match the manifest is skipped unless --force; the manifest holds no timestamps. ffmpeg cannot decode Bink 2,
so the .bk2 -> PNG step is done on Windows first (tools/windows/convert_paperdoll.bat).

Every output is verified: the alpha plane is decoded back with libvpx-vp9 (ffmpeg's native vp9 decoder ignores alpha) and must not
be all 255; the frame count is read back with ffprobe.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import sys
from pathlib import Path

HOME = Path.home() / "work" / "cyber-art"
# ffmpeg/ffprobe: the static builds in ~/bin (no sudo) are found even when ~/bin is not on PATH.
os.environ["PATH"] = f"{Path.home() / 'bin'}{os.pathsep}{os.environ.get('PATH', '')}"
# Clips the ripperdoc screen does not reference (ripperdoc.inkwidget uses man/male_body_loop and woman/female_body_loop). Still encoded.
UNUSED = {"man/man_body_loop": "not referenced by ripperdoc.inkwidget (it uses man/male_body_loop)"}
FRAME_RE = re.compile(r"^(.+)(\d{3})\.png$")
FPS = 30
SETTINGS = {
    "fps": FPS,
    "full": {"crf": 34},
    "small": {"crf": 36, "width": "half of the frame width (253 for 506)"},
    "codec": "libvpx-vp9", "pix_fmt": "yuva420p", "extra": "-b:v 0 -row-mt 1 -auto-alt-ref 0 -an",
}
# Determinism: no metadata/dates in the container, bit-exact flags.
DETERMINISTIC = ["-fflags", "+bitexact", "-flags:v", "+bitexact", "-map_metadata", "-1"]


def png_size(path: Path):
    """(width, height, color type) from the PNG header; color type 6 is RGBA."""
    head = path.read_bytes()[:33]
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path}: not a PNG")
    w, h, _depth, ctype = struct.unpack(">IIBB", head[16:26])
    return w, h, ctype


def discover(raw: Path):
    """{ 'man/<clip>': {'dir', 'clip', 'files': [Path ...], 'problems': [...]} } for every frame sequence under raw/{man,woman}."""
    clips = {}
    for sub in sorted(p for p in raw.iterdir() if p.is_dir()):
        seqs = {}
        for f in sorted(sub.glob("*.png")):
            m = FRAME_RE.match(f.name)
            if m:
                seqs.setdefault(m.group(1), {})[int(m.group(2))] = f
        for clip, frames in sorted(seqs.items()):
            idx = sorted(frames)
            problems = []
            if idx[0] != 0 or idx != list(range(idx[0], idx[-1] + 1)):
                problems.append(f"frame numbers are not 000..N contiguous (first {idx[0]}, last {idx[-1]}, {len(idx)} files)")
            if len(idx) > 1000:
                problems.append("more than 1000 frames: %03d pattern cannot address them")
            clips[f"{sub.name}/{clip}"] = {"dir": sub, "clip": clip, "files": [frames[i] for i in idx], "problems": problems}
    return clips


def fingerprint(files, settings=SETTINGS):
    h = hashlib.sha256(json.dumps(settings, sort_keys=True).encode())
    for f in files:
        h.update(f.name.encode())
        h.update(hashlib.sha256(f.read_bytes()).digest())
    return h.hexdigest()


def encode_cmd(src_dir: Path, clip: str, out: Path, crf: int, width=None):
    """The ffmpeg command line for one WebM. width=None keeps the frame size; otherwise scale to that width (height even, aspect kept)."""
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-framerate", str(FPS), "-start_number", "0",
           "-i", str(src_dir / f"{clip}%03d.png")]
    if width:
        cmd += ["-vf", f"scale={width}:-2:flags=lanczos"]
    cmd += ["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", str(crf), "-row-mt", "1", "-auto-alt-ref", "0", "-an",
            *DETERMINISTIC, str(out)]
    return cmd


def poster_cmd(frame: Path, out: Path):
    return ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(frame), "-frames:v", "1", "-pix_fmt", "rgba",
            "-compression_level", "9", *DETERMINISTIC, str(out)]


def alpha_stats(source, frame_index, decoder=None):
    """(min, max, % of pixels below 255) of the alpha plane of one frame. For a WebM, decode with libvpx-vp9 (it is the one that keeps alpha)."""
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error"]
    if decoder:
        cmd += ["-c:v", decoder]
    sel = f"select=eq(n\\,{frame_index}),format=yuva420p,alphaextract" if decoder else "format=rgba,alphaextract"
    cmd += ["-i", str(source), "-vf", sel, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"]
    data = subprocess.run(cmd, capture_output=True, check=True).stdout
    if not data:
        raise RuntimeError(f"no alpha data decoded from {source}")
    return min(data), max(data), round(100 * sum(1 for b in data if b < 255) / len(data), 2)


def probe(path: Path):
    out = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries",
                          "stream=width,height,nb_read_frames", "-of", "json", str(path)], capture_output=True, check=True, text=True).stdout
    s = json.loads(out)["streams"][0]
    return int(s["width"]), int(s["height"]), int(s["nb_read_frames"])


def run(cmd):
    subprocess.run(cmd, check=True, capture_output=True, text=True)


def process(key, info, out_root: Path):
    """Encode one clip; return its manifest entry. Raises on a failed check."""
    files, clip = info["files"], info["clip"]
    w, h, ctype = png_size(files[0])
    if ctype != 6:
        raise ValueError(f"{key}: frames are not RGBA (PNG color type {ctype}), alpha would be lost")
    sizes = {png_size(f)[:2] for f in files}
    if len(sizes) != 1:
        raise ValueError(f"{key}: frame sizes differ: {sorted(sizes)}")
    n, mid = len(files), len(files) // 2
    dest = out_root / info["dir"].name
    dest.mkdir(parents=True, exist_ok=True)
    full, small, poster = dest / f"{clip}.webm", dest / f"{clip}_sm.webm", dest / f"{clip}.png"
    sw = round(w / 2)
    run(encode_cmd(info["dir"], clip, full, SETTINGS["full"]["crf"]))
    run(encode_cmd(info["dir"], clip, small, SETTINGS["small"]["crf"], width=sw))
    run(poster_cmd(files[mid], poster))
    src_alpha = alpha_stats(files[mid], 0)
    entry = {"frames": n, "fps": FPS, "width": w, "height": h, "posterFrame": mid,
             "alpha": {"source": src_alpha}}
    for name, path in (("full", full), ("small", small)):
        pw, ph, pn = probe(path)
        if pn != n:
            raise RuntimeError(f"{key} {name}: {pn} frames decoded, expected {n}")
        a = alpha_stats(path, mid, decoder="libvpx-vp9")
        if a[0] == 255 and src_alpha[0] < 255:
            raise RuntimeError(f"{key} {name}: alpha was lost (decoded alpha is all 255, source alpha min {src_alpha[0]})")
        entry[name] = {"file": str(path.relative_to(out_root)), "bytes": path.stat().st_size, "width": pw, "height": ph}
        entry["alpha"][name] = a
    entry["poster"] = {"file": str(poster.relative_to(out_root)), "bytes": poster.stat().st_size}
    if src_alpha[0] == 255:
        entry["warning"] = "source frame has no transparency (alpha is all 255)"
    return entry


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", default=str(HOME / "raw" / "paperdoll"))
    ap.add_argument("--out", default=str(HOME / "out" / "paperdoll"))
    ap.add_argument("--clip", nargs="*", help="only these clips (name or man/name)")
    ap.add_argument("--force", action="store_true", help="re-encode even when the manifest says the clip is up to date")
    ap.add_argument("--dry-run", action="store_true", help="list clips, frame counts and problems; encode nothing")
    a = ap.parse_args(argv)
    raw, out = Path(a.raw), Path(a.out)
    clips = discover(raw)
    if a.clip:
        clips = {k: v for k, v in clips.items() if k in a.clip or v["clip"] in a.clip}
    counts = sorted(len(v["files"]) for v in clips.values())
    median = counts[len(counts) // 2] if counts else 0
    for k, v in clips.items():
        n = len(v["files"])
        w, h, _ = png_size(v["files"][0])
        note = [*v["problems"]] + ([f"odd frame count (median {median})"] if n != median else [])
        print(f"{k:34s} {n:4d} frames {w}x{h}" + (f"   !! {'; '.join(note)}" if note else ""))
    if a.dry_run:
        return 0
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            sys.exit(f"{tool} not found: install ffmpeg (with libvpx-vp9) first")
    mpath = out / "manifest.json"
    old = json.loads(mpath.read_text())["clips"] if mpath.is_file() else {}
    manifest, failed = {}, []
    for k, v in clips.items():
        if v["problems"]:
            failed.append((k, "; ".join(v["problems"])))
            continue
        fp = fingerprint(v["files"])
        prev = old.get(k)
        outputs = [out / prev[x]["file"] for x in ("full", "small", "poster")] if prev else []
        if prev and prev.get("inputSha") == fp and not a.force and all(p.is_file() for p in outputs):
            manifest[k] = prev
            print(f"{k}: up to date")
            continue
        try:
            manifest[k] = {**process(k, v, out), "inputSha": fp}
            print(f"{k}: full {manifest[k]['full']['bytes'] // 1024} KB, small {manifest[k]['small']['bytes'] // 1024} KB")
        except (subprocess.CalledProcessError, RuntimeError, ValueError) as e:
            detail = getattr(e, "stderr", "") or str(e)
            failed.append((k, str(detail).strip().splitlines()[-1] if str(detail).strip() else repr(e)))
    for k, v in old.items():           # clips not touched this run (--clip) keep their entry
        manifest.setdefault(k, v)
    usual = max(set(c["frames"] for c in manifest.values()), key=[c["frames"] for c in manifest.values()].count) if manifest else 0
    for k, c in manifest.items():
        c.pop("note", None)
        c.pop("unused", None)
        if c["frames"] != usual:
            c["note"] = f"{c['frames']} frames; most clips have {usual}"
        if k in UNUSED:
            c["unused"] = True
            c["unusedReason"] = UNUSED[k]
    totals = {x: sum(c[x]["bytes"] for c in manifest.values()) for x in ("full", "small", "poster")}
    out.mkdir(parents=True, exist_ok=True)
    mpath.write_text(json.dumps({"settings": SETTINGS, "clips": dict(sorted(manifest.items())), "totals": totals}, indent=1) + "\n")
    for k, why in failed:
        print(f"FAILED {k}: {why}", file=sys.stderr)
    print(f"manifest: {len(manifest)} clips, full {totals['full'] // 1024} KB, small {totals['small'] // 1024} KB")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
