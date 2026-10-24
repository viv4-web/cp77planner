#!/usr/bin/env python3
"""Static reference render of the ripperdoc Root widget tree at 1920x1080 (Python 3 stdlib + ffmpeg).

  tools/ripperdoc_render.py [--gender woman|man] [--out FILE]

Lays out the Root library item of ripperdoc.inkwidget (design grid 3840x2160, drawn at half size) with a simplified version of the
ink layout rules and draws it with ffmpeg, using the real atlas parts that were exported (~/work/cyber-art/raw/ui). It is a check
that the layout was understood, not a pixel match:
  - text is drawn as thin bars of the text box (no font renderer in the static ffmpeg build), videos are replaced by the poster
    of the idle body loop (~/work/cyber-art/out/paperdoll), atlas parts that were not exported are drawn as faint boxes;
  - the opacity-0 start state of capacity_bar and armor_bar (they are faded in by an animation) is overridden to 1;
  - hidden widgets, tutorial areas, the warning popup and the zone clips/hover sprites (shown only during interaction) are skipped;
  - small yellow squares mark where the slot panels (frontalAnchor, armsAnchor, ...) attach.
Output goes to incoming/screens/ (gitignored); raw game art is never committed.
"""
import argparse
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ripperdoc_data as rd  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = Path.home() / "work" / "cyber-art" / "out" / "paperdoll"
GUI = rd.UI / rd.GUI
SCALE = 0.5            # 3840x2160 design grid -> 1920x1080
# anchor -> (x fraction, y fraction, fill horizontally, fill vertically)
ANCHORS = {
    "TopLeft": (0, 0, 0, 0), "TopCenter": (.5, 0, 0, 0), "TopRight": (1, 0, 0, 0),
    "CenterLeft": (0, .5, 0, 0), "Centered": (.5, .5, 0, 0), "CenterRight": (1, .5, 0, 0),
    "BottomLeft": (0, 1, 0, 0), "BottomCenter": (.5, 1, 0, 0), "BottomRight": (1, 1, 0, 0),
    "LeftFillVerticaly": (0, 0, 0, 1), "CenterFillVerticaly": (.5, 0, 0, 1), "RightFillVerticaly": (1, 0, 0, 1),
    "TopFillHorizontaly": (0, 0, 1, 0), "CenterFillHorizontaly": (0, .5, 1, 0), "BottomFillHorizontaly": (0, 1, 1, 0),
    "Fill": (0, 0, 1, 1),
}
SKIP_CONTROLLERS = {"gameuiTutorialArea"}
SKIP_NAMES = {"Paperdoll_Item_tab", "tooltipAnchors", "tooltipContainer", "warnning"}
FORCE_VISIBLE = {"capacity_bar", "armor_bar"}


class Aff:
    """scale + translate only (rotation and shear are ignored)."""

    def __init__(self, sx=1, sy=1, tx=0, ty=0):
        self.sx, self.sy, self.tx, self.ty = sx, sy, tx, ty

    def pt(self, x, y):
        return x * self.sx + self.tx, y * self.sy + self.ty

    def rect(self, r):
        x, y = self.pt(r[0], r[1])
        return (x, y, r[2] * self.sx, r[3] * self.sy)

    def then_local(self, n, r):
        """Transform of the widget's own render transform (about its pivot), composed after this one."""
        sx, sy = n["scale"]
        px, py = r[0] + r[2] * n["pivot"][0], r[1] + r[3] * n["pivot"][1]
        tx, ty = n["translation"]
        local = Aff(sx, sy, px - sx * px + tx, py - sy * py + ty)
        return Aff(self.sx * local.sx, self.sy * local.sy, self.sx * local.tx + self.tx, self.sy * local.ty + self.ty)


def part_png(atlas, part, cache={}):
    """Exported PNG of an atlas part (2160p preferred), or None when that atlas was not exported."""
    if not atlas or not part:
        return None
    base = GUI.parent.parent.parent / atlas.replace("\\", "/")
    for res in ("2160p", "1080p"):
        p = base.parent / f"{base.name}" / res / f"{part}.png"
        if p.is_file():
            return p
    return None


def png_wh(p):
    import struct
    h = p.read_bytes()[:24]
    return struct.unpack(">II", h[16:24])


def place(n, pr, natural):
    """Rect (x, y, w, h) of widget n inside parent rect pr, design pixels."""
    ax, ay, fx, fy = ANCHORS.get(n["anchor"], ANCHORS["TopLeft"])
    l, t, r, b = n["margin"]
    w, h = n["size"]
    if natural and n["fitToContent"]:
        w, h = natural
    pxp, pyp = n["anchorPoint"]
    if fx:
        x, w = pr[0] + l, pr[2] - l - r
    else:
        x = pr[0] + pr[2] * ax + (l - r) - w * pxp
    if fy:
        y, h = pr[1] + t, pr[3] - t - b
    else:
        y = pr[1] + pr[3] * ay + (t - b) - h * pyp
    return (x, y, w, h)


def collect(root, gender):
    ops = []          # draw operations in z order
    marks = []

    def visit(n, pr, aff, opacity, is_root=False):
        if n["name"] == ("maleHovers" if gender == "woman" else "femaleHovers") or n["name"].startswith(("paperdoll_woman_", "paperdoll_man_")) and n["type"] == "inkImageWidget":
            return          # other gender, and the per-zone hover sprites (only shown while hovering)
        if (not n["visible"] and n["name"] not in FORCE_VISIBLE) or n["controller"] in SKIP_CONTROLLERS or n["name"] in SKIP_NAMES:
            return
        png = part_png(n.get("atlas"), n.get("part")) if n["type"] in ("inkImageWidget",) else None
        natural = png_wh(png) if png else None
        r = (pr[0], pr[1], n["size"][0], n["size"][1]) if is_root else place(n, pr, natural)
        op = 1 if n["name"] in FORCE_VISIBLE else n["opacity"]
        total = opacity * op
        a2 = aff.then_local(n, r)
        dr = a2.rect(r)
        tint = n["tint"] or (1, 1, 1, 1)
        if n["type"] == "inkImageWidget" and n.get("part"):
            ops.append({"kind": "img", "png": png, "rect": dr, "tint": tint, "a": total * tint[3], "name": n["name"], "part": n["part"]})
        elif n["type"] == "inkRectangleWidget":
            ops.append({"kind": "rect", "rect": dr, "tint": tint, "a": total * tint[3], "name": n["name"]})
        elif n["type"] == "inkTextWidget":
            fs = (n.get("text") or {}).get("fontSize") or 40
            ops.append({"kind": "text", "rect": (dr[0], dr[1] + dr[3] / 2 - fs * .08 * a2.sy, dr[2], max(2, fs * .16 * a2.sy)), "tint": tint, "a": total * .8,
                        "name": n["name"]})
        elif n["type"] == "inkVideoWidget":
            vid = n.get("video") or ""
            if "body_loop" in vid and ("female" in vid) == (gender == "woman"):
                ops.append({"kind": "video", "rect": dr, "a": total, "name": n["name"], "clip": vid.split("/")[-1]})
        elif n["type"] == "inkMaskWidget":
            pass
        if n["name"].endswith("Anchor") or n["name"] in ("OcularNew", "handsAnchorNew"):
            marks.append((n["name"], dr))
        # children
        pad = n["padding"]
        inner = (r[0] + pad[0], r[1] + pad[1], r[2] - pad[0] - pad[2], r[3] - pad[1] - pad[3])
        kids = n["children"]
        if n["type"] in ("inkVerticalPanelWidget", "inkHorizontalPanelWidget"):
            cur = 0
            vertical = n["type"] == "inkVerticalPanelWidget"
            for c in kids:
                if not c["visible"]:
                    continue
                cw, ch = c["size"]
                cr = (inner[0] + (cur if not vertical else 0), inner[1] + (cur if vertical else 0), cw, ch)
                cur += (ch if vertical else cw)
                visit_panel_child(c, cr, a2, total)
            return
        for c in kids:
            visit(c, inner, a2, total)

    def visit_panel_child(c, cr, aff, opacity):
        c2 = dict(c)
        c2["anchor"], c2["margin"], c2["anchorPoint"] = "TopLeft", [0, 0, 0, 0], [0, 0]
        visit(c2, cr, aff, opacity)

    visit(root, (0, 0, 3840, 2160), Aff(), 1.0, is_root=True)
    return ops, marks


def hex6(c):
    return "0x%02X%02X%02X" % tuple(max(0, min(255, round(v * 255))) for v in c[:3])


def render(ops, marks, out: Path):
    W, H = int(3840 * SCALE), int(2160 * SCALE)
    inputs, chains, last = [], [], "base"
    chains.append(f"color=c=0x0B0B14:s={W}x{H},format=rgba[base]")
    k = 0

    def put(label, x, y):
        nonlocal last, k
        k += 1
        nxt = f"o{k}"
        chains.append(f"[{last}][{label}]overlay={x}:{y}:format=auto[{nxt}]")
        last = nxt

    for i, op in enumerate(ops):
        x, y, w, h = [v * SCALE for v in op["rect"]]
        a = max(0.0, min(1.0, op["a"]))
        if a <= 0.004 or w < 1 or h < 1:
            continue
        w, h = max(1, round(w)), max(1, round(h))
        t = op.get("tint") or (1, 1, 1, 1)
        if op["kind"] == "img" and op["png"]:
            idx = len(inputs)
            inputs.append(str(op["png"]))
            chains.append(f"[{idx}:v]format=rgba,scale={w}:{h}:flags=lanczos,colorchannelmixer=rr={min(t[0], 1):.3f}:gg={min(t[1], 1):.3f}:bb={min(t[2], 1):.3f}:aa={a:.3f}[l{i}]")
        elif op["kind"] == "video":
            poster = OUT / ("woman" if "female" in op["clip"] else "man") / (op["clip"].replace(".bk2", "") + ".webp")
            if not poster.is_file():
                continue
            idx = len(inputs)
            inputs.append(str(poster))
            chains.append(f"[{idx}:v]format=rgba,scale={w}:{h}:flags=lanczos,colorchannelmixer=aa={a:.3f}[l{i}]")
        else:
            col = hex6(t) if op["kind"] != "img" else "0x5EF6FF"
            alpha = a if op["kind"] != "img" else min(a, 1) * 0.18      # parts that were not exported: faint box
            chains.append(f"color=c={col}:s={w}x{h},format=rgba,colorchannelmixer=aa={alpha:.3f}[l{i}]")
        put(f"l{i}", round(x), round(y))
    for j, (name, r) in enumerate(marks):
        x, y = r[0] * SCALE, r[1] * SCALE
        chains.append(f"color=c=0xFFD741:s=10x10,format=rgba[m{j}]")
        put(f"m{j}", round(x - 5), round(y - 5))
    graph = ";".join(chains) + f";[{last}]format=rgb24[out]"
    script = ROOT / "incoming" / "ripperdoc_render.filter"
    script.parent.mkdir(exist_ok=True)
    script.write_text(graph)
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
    for p in inputs:
        cmd += ["-i", p]
    cmd += ["-/filter_complex", str(script), "-map", "[out]", "-frames:v", "1", str(out)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        sys.exit(r.stderr[-2000:])
    return len(inputs)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--gender", choices=["woman", "man"], default="woman")
    ap.add_argument("--out", default=str(ROOT / "incoming" / "screens" / "ripperdoc-reference.png"))
    a = ap.parse_args(argv)
    import os
    os.environ["PATH"] = f"{Path.home() / 'bin'}{os.pathsep}{os.environ.get('PATH', '')}"
    lib = rd.widget_library(f"{rd.RIPPER}/ripperdoc.inkwidget.json")
    ops, marks = collect(lib["Root"]["root"], a.gender)
    n = render(ops, marks, Path(a.out))
    kinds = {}
    for o in ops:
        kinds[o["kind"]] = kinds.get(o["kind"], 0) + 1
    print(f"drew {len(ops)} widgets {kinds}, {n} image inputs -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
