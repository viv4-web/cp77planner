"""Reader for the WolvenKit JSON export of the ripperdoc UI (Python 3 stdlib only).

Input is raw game content in ~/work/cyber-art/raw/ui/ (read only, never copied into the repo). This module turns the JSON into
plain Python structures: widget trees (handles resolved), animation sequences, style tokens, atlas parts. The docs and the reference
render are generated from it by tools/ripperdoc_spec.py and tools/ripperdoc_render.py.
"""
import json
from pathlib import Path

UI = Path.home() / "work" / "cyber-art" / "raw" / "ui"
GUI = "base/gameplay/gui"
RIPPER = f"{GUI}/fullscreen/ripperdoc"
COMMON = f"{GUI}/common"


def load(rel: str):
    return json.loads((UI / rel).read_text(encoding="utf-8"))["Data"]["RootChunk"]


def cname(v):
    return v.get("$value") if isinstance(v, dict) else v


def depot(ref):
    """DepotPath of a resource reference, with forward slashes."""
    if not isinstance(ref, dict):
        return None
    p = ref.get("DepotPath", ref)
    v = p.get("$value") if isinstance(p, dict) else p
    return None if v in (None, "0", 0) else str(v).replace("\\", "/")


def margin(m):
    """inkMargin -> [left, top, right, bottom]."""
    return [m.get("left", 0), m.get("top", 0), m.get("right", 0), m.get("bottom", 0)] if m else [0, 0, 0, 0]


def vec(v, default=(0, 0)):
    return [v.get("X", default[0]), v.get("Y", default[1])] if v else list(default)


def rgba(c):
    """HDRColor/Color dict -> (r, g, b, a) floats (HDR values can exceed 1)."""
    if not c:
        return None
    c = c.get("Value", c)
    return (c.get("Red", 0), c.get("Green", 0), c.get("Blue", 0), c.get("Alpha", 1))


def hexcolor(c):
    """(r, g, b, a) floats -> '#RRGGBB' / '#RRGGBBAA' clamped to sRGB range (HDR overshoot is lost: noted in the spec)."""
    if c is None:
        return None
    b = [max(0, min(255, round(x * 255))) for x in c]
    return "#%02X%02X%02X" % tuple(b[:3]) + ("" if b[3] == 255 else "%02X" % b[3])


class Chunk:
    """One library item: resolves HandleRefId -> object."""

    def __init__(self, chunk):
        self.chunk = chunk
        self.h = {}
        self._walk(chunk)

    def _walk(self, o):
        if isinstance(o, dict):
            if "HandleId" in o and "Data" in o:
                self.h[o["HandleId"]] = o["Data"]
            for v in o.values():
                self._walk(v)
        elif isinstance(o, list):
            for v in o:
                self._walk(v)

    def get(self, ref):
        if isinstance(ref, dict):
            if "HandleRefId" in ref:
                return self.h.get(ref["HandleRefId"])
            if "Data" in ref:
                return ref["Data"]
        return None


def node(ch: Chunk, w: dict, path=()):
    """Normalized widget node (a dict) with children resolved recursively. `path` is the child-index path from the item root."""
    lay = w.get("layout") or {}
    rt = w.get("renderTransform") or {}
    pm = ch.get(w.get("propertyManager")) if w.get("propertyManager") else None
    n = {
        "type": w["$type"], "name": cname(w.get("name")), "path": list(path),
        "visible": bool(w.get("visible", 1)), "opacity": w.get("opacity", 1),
        "anchor": lay.get("anchor"), "anchorPoint": vec(lay.get("anchorPoint")), "hAlign": lay.get("HAlign"), "vAlign": lay.get("VAlign"),
        "margin": margin(lay.get("margin")), "padding": margin(lay.get("padding")),
        "sizeRule": lay.get("sizeRule"), "sizeCoef": lay.get("sizeCoefficient", 1),
        "size": vec(w.get("size")), "fitToContent": bool(w.get("fitToContent", 0)),
        "scale": vec(rt.get("scale"), (1, 1)), "rotation": rt.get("rotation", 0), "translation": vec(rt.get("translation")),
        "shear": vec(rt.get("shear")), "pivot": vec(w.get("renderTransformPivot"), (0.5, 0.5)),
        "tint": rgba(w.get("tintColor")), "state": cname(w.get("state")),
        "bindings": [(cname(b.get("propertyName")), cname(b.get("stylePath"))) for b in (pm or {}).get("bindings", [])],
        "controller": (ch.get(w.get("logicController")) or {}).get("$type") if w.get("logicController") else None,
        "interactive": bool(w.get("isInteractive", 0)), "childOrder": w.get("childOrder"),
        "childMargin": margin(w.get("childMargin")) if w.get("childMargin") else None,
    }
    st = ch.get(w.get("style")) if w.get("style") else None
    if st:
        n["style"] = depot(st.get("styleResource"))
    if "textureAtlas" in w:
        n["atlas"] = depot(w["textureAtlas"])
        n["part"] = cname(w.get("texturePart"))
    if "videoResource" in w:
        n["video"] = depot(w["videoResource"])
        n["loop"] = bool(w.get("loop", 0))
    if w["$type"] == "inkTextWidget":
        n["text"] = {"fontSize": w.get("fontSize"), "fontStyle": cname(w.get("fontStyle")), "family": depot(w.get("fontFamily")),
                     "case": w.get("letterCase"), "justify": w.get("justification"), "hText": w.get("textHorizontalAlignment"),
                     "vText": w.get("textVerticalAlignment"), "key": w.get("localizationString", {}).get("value") if isinstance(w.get("localizationString"), dict) else None}
    n["children"] = []
    kids = ch.get(w.get("children")) if w.get("children") else None
    for i, c in enumerate((kids or {}).get("children", [])):
        cw = ch.get(c)
        if cw is not None:
            n["children"].append(node(ch, cw, (*path, i)))
    return n


def widget_library(rel: str):
    """{item name: {'root': node, 'controller': type, 'resolution': str}} for an .inkwidget export."""
    R = load(rel)
    out = {}
    for it in R["libraryItems"]:
        ch = Chunk(it["packageData"]["Data"]["Chunks"][0])
        rootw = ch.get(ch.chunk["rootWidget"])
        ctl = ch.chunk.get("gameController")
        out[cname(it["name"])] = {"root": node(ch, rootw), "resolution": ch.chunk.get("rootResolution"),
                                  "controller": (ctl.get("Data") or {}).get("$type") if isinstance(ctl, dict) else None}
    return out


def walk(n, fn, depth=0):
    fn(n, depth)
    for c in n["children"]:
        walk(c, fn, depth + 1)


def by_path(root, path):
    n = root
    for i in path:
        n = n["children"][i]
    return n


# ---- animations ----
def _val(v):
    if isinstance(v, dict):
        if "$type" in v and v["$type"] == "Vector2":
            return [v.get("X"), v.get("Y")]
        if "$type" in v and v["$type"] == "inkMargin":
            return margin(v)
        if "$type" in v and v["$type"] == "HDRColor":
            return list(rgba(v))
        if "$type" in v and v["$type"] == "Color":
            return [v.get("Red"), v.get("Green"), v.get("Blue"), v.get("Alpha")]
    return v


def animations(rel: str):
    """List of sequences: {name, defs: [{path, interpolators: [{kind, ...}], events: [...]}]}."""
    R = load(rel)
    seqs = []
    for s in R["sequences"]:
        s = s.get("Data", s)
        tg = [t.get("Data", t).get("path", []) for t in s["targets"]]
        defs = []
        for i, d in enumerate(s["definitions"]):
            d = d.get("Data", d)
            ips = []
            for ip in d["interpolators"]:
                ip = ip.get("Data", ip)
                kind = ip["$type"].replace("inkanim", "").replace("Interpolator", "")
                e = {"kind": kind, "duration": round(ip.get("duration", 0), 4), "delay": round(ip.get("startDelay", 0), 4),
                     "mode": ip.get("interpolationMode"), "type": ip.get("interpolationType"), "dir": ip.get("interpolationDirection"),
                     "additive": bool(ip.get("isAdditive", 0)), "from": _val(ip.get("startValue")), "to": _val(ip.get("endValue"))}
                for k in ("videoPath", "videoResource", "effectName", "effectType", "effectTag", "playbackRate", "stopVideo", "loop"):
                    if k in ip:
                        e[k] = depot(ip[k]) if isinstance(ip[k], dict) and "DepotPath" in ip[k] else cname(ip[k])
                e["extra"] = {k: (cname(v) if isinstance(v, dict) and v.get("$type") == "CName" else depot(v) if isinstance(v, dict) and "DepotPath" in v else v)
                              for k, v in ip.items() if k not in ("$type", "duration", "startDelay", "interpolationMode", "interpolationType",
                                                                   "interpolationDirection", "isAdditive", "startValue", "endValue", "useRelativeDuration")
                              and not isinstance(v, (list,))}
                ips.append(e)
            evs = []
            for ev in d["events"]:
                ev = ev.get("Data", ev)
                evs.append({"kind": ev["$type"].replace("inkanim", "").replace("Event", ""), "time": round(ev.get("startTime", 0), 4),
                            "extra": {k: (cname(v) if isinstance(v, dict) and v.get("$type") == "CName" else v) for k, v in ev.items()
                                      if k not in ("$type", "startTime") and not isinstance(v, (list, dict))}})
            defs.append({"path": tg[i] if i < len(tg) else None, "interpolators": ips, "events": evs})
        seqs.append({"name": cname(s["name"]), "defs": defs})
    return seqs


# ---- styles ----
def styles(rel: str):
    """{ 'Group.property': {state: value} } flattening inkStyle sets; HDR colors as rgba tuples, references as ('ref', path)."""
    R = load(rel)
    out = {}
    for s in R["styles"]:
        state = cname(s.get("state")) or "Default"
        for p in s["properties"]:
            v = p["value"]
            t = v["$type"]
            val = v["Value"]
            if t == "HDRColor":
                val = rgba(v)
            elif t == "inkStylePropertyReference":
                val = ("ref", cname(val["referencedPath"]))
            elif t.startswith("raRef"):
                val = ("atlas", depot(val))
            else:
                val = cname(val)
            out.setdefault(cname(p["propertyPath"]), {})[state] = val
    return out


# ---- atlas ----
def atlas(rel: str):
    """{'texture': depot path or None, 'parts': {name: (left, top, right, bottom) in UV 0..1}}."""
    R = load(rel)
    parts = {}
    for sl in R["slots"]["Elements"] if isinstance(R["slots"], dict) else R["slots"]:
        for p in sl["parts"]:
            r = p["clippingRectInUVCoords"]
            parts[cname(p["partName"])] = (r["Left"], r["Top"], r["Right"], r["Bottom"])
    return {"texture": depot(R.get("texture")), "parts": parts}
