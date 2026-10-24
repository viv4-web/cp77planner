#!/usr/bin/env python3
"""Generate docs/RIPPERDOC-SPEC.md and docs/RIPPERDOC-ANIMATIONS.md from the ripperdoc UI export (Python 3 stdlib only).

  tools/ripperdoc_spec.py

Reads ~/work/cyber-art/raw/ui (read only, raw game content that never enters the repo) through tools/ripperdoc_data.py and writes
the two spec documents. The documents hold layout numbers, token values, widget and sequence names, and our own descriptions; no
game text (captions, descriptions) is copied. Re-run it after a game patch to refresh the numbers.
"""
import re
import sys
from collections import Counter, OrderedDict, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ripperdoc_data as rd  # noqa: E402

DOCS = Path(__file__).resolve().parent.parent / "docs"
GUI = rd.UI / rd.GUI

# ink interpolation (type, mode) -> CSS timing function. EasyOutIn has no CSS equivalent.
BEZIER = {
    ("Quadratic", "EasyIn"): "cubic-bezier(.11,0,.5,0)", ("Quadratic", "EasyOut"): "cubic-bezier(.5,1,.89,1)", ("Quadratic", "EasyInOut"): "cubic-bezier(.45,0,.55,1)",
    ("Qubic", "EasyIn"): "cubic-bezier(.32,0,.67,0)", ("Qubic", "EasyOut"): "cubic-bezier(.33,1,.68,1)", ("Qubic", "EasyInOut"): "cubic-bezier(.65,0,.35,1)",
    ("Quartic", "EasyIn"): "cubic-bezier(.5,0,.75,0)", ("Quartic", "EasyOut"): "cubic-bezier(.25,1,.5,1)", ("Quartic", "EasyInOut"): "cubic-bezier(.76,0,.24,1)",
    ("Quintic", "EasyIn"): "cubic-bezier(.64,0,.78,0)", ("Quintic", "EasyOut"): "cubic-bezier(.22,1,.36,1)", ("Quintic", "EasyInOut"): "cubic-bezier(.83,0,.17,1)",
    ("Exponential", "EasyIn"): "cubic-bezier(.7,0,.84,0)", ("Exponential", "EasyOut"): "cubic-bezier(.16,1,.3,1)", ("Exponential", "EasyInOut"): "cubic-bezier(.87,0,.13,1)",
    ("Sinusoidal", "EasyIn"): "cubic-bezier(.12,0,.39,0)", ("Sinusoidal", "EasyOut"): "cubic-bezier(.61,1,.88,1)", ("Sinusoidal", "EasyInOut"): "cubic-bezier(.37,0,.63,1)",
}
ZONES = [  # (key, woman intro, label)
    ("frontal_cortex", "frontalCortex", "Frontal cortex"), ("ocular", "ocular", "Ocular"), ("circulatory", "circlatory", "Circulatory"),
    ("hands", "hands", "Hands"), ("arms", "arms", "Arms"), ("legs", "legs", "Legs"), ("immune", "immune", "Immune"),
    ("nervous", "nervous", "Nervous"), ("integumentary", "integumentary", "Integumentary"), ("operating", "operating", "Operating system"),
    ("skeleton", "skeleton", "Skeleton"),
]
HOVER_NAME = {"immune": "imunne", "ocular": "okular"}      # the widget names carry the game's own spelling
ANCHOR_OF = {"frontal_cortex": "frontalAnchor", "arms": "armsAnchor", "skeleton": "skeletonAnchor", "nervous": "nervousAnchor",
             "integumentary": "integumentaryAnchor", "operating": "systemAnchor", "ocular": "OcularNew", "hands": "handsAnchorNew / handsAnchor",
             "circulatory": "cardiovascularAnchor", "legs": "legsAnchor"}


def md(headers, rows):
    out = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    out += ["| " + " | ".join(str(c).replace("|", "\\|") for c in r) + " |" for r in rows]
    return "\n".join(out)


def num(v):
    if isinstance(v, float) and abs(v) < 0.005:
        v = 0
    return str(int(v)) if isinstance(v, (int, float)) and float(v).is_integer() else (f"{v:.4g}" if isinstance(v, float) else str(v))


def vec(v):
    return "(" + ", ".join(num(x) for x in v) + ")"


def marg(m):
    return "-" if not any(m) else "L%s T%s R%s B%s" % tuple(num(x) for x in m)


def sz(n):
    return "-" if n["size"] == [0, 0] else f"{num(n['size'][0])}x{num(n['size'][1])}"


def uses(n):
    u = []
    if n.get("part"):
        u.append(f"`{n['part']}` @ {Path(n['atlas'] or '?').name}")
    if n.get("video"):
        u.append(f"clip `{Path(n['video']).stem}`")
    if n.get("text"):
        u.append(f"text {n['text']['fontSize']}")
    if n.get("style"):
        u.append(f"style {Path(n['style']).name}")
    if n.get("controller"):
        u.append(f"ctl {n['controller']}")
    return "; ".join(u)


def flat(root):
    out = []
    rd.walk(root, lambda n, d: out.append((n, d)))
    return out


def find(root, name):
    for n, _ in flat(root):
        if n["name"] == name:
            return n
    return None


def css_ease(i):
    if i["type"] == "Linear":
        return "linear" if i["mode"] != "EasyOutIn" else "linear (approx.: EasyOutIn has no CSS curve)"
    return BEZIER.get((i["type"], i["mode"]), f"? {i['type']}/{i['mode']}")


def css_of(i, widget):
    k, f, t = i["kind"], i["from"], i["to"]
    timing = f"{i['duration']}s {css_ease(i)}" + (f" {i['delay']}s" if i["delay"] else "")
    if k == "Transparency":
        return f"opacity {num(f)} -> {num(t)}, {timing}"
    if k == "Translation":
        return f"translate({num(f[0])}u, {num(f[1])}u) -> ({num(t[0])}u, {num(t[1])}u), {timing}"
    if k == "Scale":
        return f"scale({num(f[0])}, {num(f[1])}) -> ({num(t[0])}, {num(t[1])}), {timing}"
    if k == "Rotation":
        return f"rotate {num(f)}deg -> {num(t)}deg, {timing} (unit assumed degrees)"
    if k == "Size":
        return f"APPROX scaleX/scaleY {vec(f)} -> {vec(t)} (size growth as a scale from the anchored edge), {timing}"
    if k == "Margin":
        return f"offset {vec(f)} -> {vec(t)} (as translate), {timing}" + (" (no change)" if f == t else "")
    if k == "Effect":
        return f"APPROX clip-path wipe, progress {num(f)} -> {num(t)} ({i['extra'].get('effectType')}), {timing}"
    if k == "Video":
        clip = Path(widget["video"]).stem if widget and widget.get("video") else None
        return (f"play `{clip}` from t={num(f)}s to {num(t)}s over {i['duration']}s" if clip
                else f"VIDEO position {num(f)}s -> {num(t)}s over {i['duration']}s (target is not a video widget)")
    return "?"


def load():
    lib = rd.widget_library(f"{rd.RIPPER}/ripperdoc.inkwidget.json")
    seqs = rd.animations(f"{rd.RIPPER}/ripperdoc_animations.inkanim.json")
    return lib, seqs


# ---------------------------------------------------------------- sections
def sec_structure(root):
    rows = []
    skipped = Counter()

    def want(n, d):
        if d == 0:
            return True
        top = n["path"][:2]
        if n["controller"] == "gameuiTutorialArea":
            skipped["tutorial highlight areas"] += 1
            return False
        if n["path"][:2] == [0, 7] and len(n["path"]) > 3 and n["path"][2] in (0, 1):
            skipped["paperdoll zone clips and hover sprites (see the zone table)"] += 1
            return False
        return True

    depth_limit = {(0, 19): 4, (3,): 3, (4,): 3, (2,): 1}

    def limit(n):
        for pre, dl in depth_limit.items():
            if tuple(n["path"][:len(pre)]) == pre:
                return dl
        return 3

    def go(n, d):
        if not want(n, d):
            return
        if d > limit(n) + (0 if n["path"][:1] != [0] else 0):
            skipped["deeper children of already listed containers"] += 1
            return
        if not n["visible"]:
            skipped["hidden widgets (listed in the hidden table)"] += 1
        rows.append((".".join(map(str, n["path"])) or "root", n["name"], n["type"].replace("ink", "").replace("Widget", ""), n["anchor"], sz(n), marg(n["margin"]),
                     marg(n["padding"]), "-" if n["visible"] else "HIDDEN", num(n["opacity"]), uses(n)))
        for c in n["children"]:
            go(c, d + 1)

    go(root, 0)
    return rows, skipped


def sec_zones(root):
    rows = []
    for key, base, label in ZONES:
        canvas = find(root, f"paperdoll_{key}_canvas")
        w = find(root, f"woman_paperdoll_{key}")
        m = find(root, f"man_paperdoll_{key}")
        hw = find(root, f"paperdoll_woman_{HOVER_NAME.get(key, key)}")
        hm = find(root, f"paperdoll_man_{HOVER_NAME.get(key, key)}")
        rows.append((label, f"`{canvas['name']}` ({marg(canvas['margin'])})" if canvas else "-",
                     f"{sz(w)} @ {marg(w['margin'])}; `{Path(w['video']).stem}`" if w else "-",
                     f"{sz(m)} @ {marg(m['margin'])}; `{Path(m['video']).stem}`" if m else "-",
                     f"`{hw['part']}` @ {marg(hw['margin'])}" if hw and hw.get("part") else "-",
                     f"`{hm['part']}` @ {marg(hm['margin'])}" if hm and hm.get("part") else "-",
                     ANCHOR_OF.get(key, "-")))
    return rows


def sec_zone_anim(root, seqs):
    by = {s["name"]: s for s in seqs}
    rows = []
    for key, base, label in ZONES:
        for who, pre in (("woman", ""), ("man", "M_")):
            for kind in ("intro", "outro"):
                s = by.get(f"{pre}{base}_{kind}")
                if not s:
                    continue
                tab = canvas = None
                clip = None
                for d in s["defs"]:
                    try:
                        n = rd.by_path(root, d["path"])
                    except Exception:
                        continue
                    for i in d["interpolators"]:
                        if n["name"] == "Paperdoll_default_tab" and i["kind"] == "Scale":
                            tab = i
                        if n["name"] == f"paperdoll_{key}_canvas" and i["kind"] == "Scale":
                            canvas = i
                        if i["kind"] == "Video" and n.get("video") and key in n["name"]:
                            clip = (Path(n["video"]).stem, i)
                rows.append((label, who, kind, s["name"],
                             f"{num(tab['from'][0])} -> {num(tab['to'][0])} over {tab['duration']}s ({css_ease(tab)})" if tab else "-",
                             f"{num(canvas['from'][0])} -> {num(canvas['to'][0])}" if canvas else "-",
                             f"`{clip[0]}` {num(clip[1]['from'])} -> {num(clip[1]['to'])}s" if clip else "-"))
    return rows


def tokens():
    main = rd.styles(f"{rd.COMMON}/main_colors.inkstyle.json")
    rare = rd.styles(f"{rd.COMMON}/rarity_menus.inkstyle.json")
    poor = rd.styles(f"{rd.RIPPER}/ripperdoc_poor.inkstyle.json")
    slots = rd.styles(f"{rd.COMMON}/components/slots_style.inkstyle.json")
    return main, rare, poor, slots


def token_value(v, main):
    if isinstance(v, tuple) and len(v) == 4 and all(isinstance(x, (int, float)) for x in v):
        hdr = " (HDR)" if max(v[:3]) > 1.0001 else ""
        return f"`{rd.hexcolor(v)}`{hdr}"
    if isinstance(v, tuple) and v[0] == "ref":
        tgt = main.get(v[1], {}).get("Default")
        return f"-> `{v[1]}`" + (f" = {token_value(tgt, main)}" if tgt is not None and not (isinstance(tgt, tuple) and tgt[0] == "ref") else "")
    if isinstance(v, tuple) and v[0] == "atlas":
        return f"atlas `{Path(v[1] or '?').name}`"
    return f"`{v}`"


def sec_tokens():
    main, rare, poor, slots = tokens()
    default = {k: v for k, v in main.items() if "Default" in v}
    colours = [(k, token_value(v["Default"], main)) for k, v in default.items() if isinstance(v["Default"], tuple) and len(v["Default"]) == 4]
    refs = [(k, token_value(v["Default"], main)) for k, v in default.items() if isinstance(v["Default"], tuple) and v["Default"][0] == "ref"]
    nums = [(k, token_value(v["Default"], main)) for k, v in default.items() if not isinstance(v["Default"], tuple)]
    r_rows = [(k, st, token_value(val, main)) for k, v in rare.items() for st, val in v.items() if k.startswith("Rarity.")]
    p_rows = [(k, st, token_value(val, main)) for k, v in poor.items() for st, val in v.items()
              if k.split(".")[0] in ("NewMeter", "CapacityOverchargeGlow", "MetersLabels", "MetersLabels_ARMOR", "AttributeAllocation", "PreviewItem", "PerkPreview")]
    s_rows = [(k, st, token_value(val, main)) for k, v in slots.items() for st, val in v.items() if k.split(".")[0] in ("ItemDisplay",)]
    return colours, refs, nums, r_rows, p_rows, s_rows


def text_styles(root):
    rows = []
    for n, d in flat(root):
        if n["type"] == "inkTextWidget" and n.get("text"):
            t = n["text"]
            b = {a: b for a, b in n["bindings"]}
            rows.append((n["name"], ".".join(map(str, n["path"])), t["fontSize"], b.get("fontSize", "-"), t["fontStyle"], b.get("fontStyle", "-"), t["case"],
                         t["justify"], rd.hexcolor(n["tint"]), b.get("tintColor", "-")))
    return rows


def asset_map(libs):
    """(atlas, part) -> {'users': set of 'item/widget'}"""
    m = defaultdict(set)
    for item, root in libs:
        for n, _ in flat(root):
            if n.get("part") and n.get("atlas"):
                m[(n["atlas"], n["part"])].add(f"{item}/{n['name']}")
    return m


def exported(atlas, part):
    base = rd.UI / atlas
    hits = []
    for res in ("2160p", "1080p"):
        p = base.parent / base.name / res / f"{part}.png"
        if p.is_file():
            hits.append(f"{atlas}/{res}/{part}.png")
    return hits


def main():
    lib, seqs = load()
    root = lib["Root"]["root"]
    struct_rows, skipped = sec_structure(root)
    hidden = [(".".join(map(str, n["path"])), n["name"]) for n, _ in flat(root) if not n["visible"]]
    zones = sec_zones(root)
    zanim = sec_zone_anim(root, seqs)
    colours, refs, nums, r_rows, p_rows, s_rows = sec_tokens()
    texts = text_styles(root)
    libs = [(name, it["root"]) for name, it in lib.items() if name != "Root"] + [("Root", root)]
    for f in ("components/slots.inkwidget.json", "tooltip/itemtooltip.inkwidget.json"):
        for name, it in rd.widget_library(f"{rd.COMMON}/{f}").items():
            if name in ("itemDisplay", "itemTooltip", "itemCapacityStat", "itemHeader"):
                libs.append((f"{Path(f).stem}:{name}", it["root"]))
    am = asset_map(libs)
    seq_by_name = {s["name"]: s for s in seqs}

    L = []
    w = L.append
    w("# Ripperdoc screen specification")
    w("")
    w("Generated by `tools/ripperdoc_spec.py` from the game's ripperdoc UI export (WolvenKit JSON, read only, kept in `~/work/cyber-art/raw/ui/`, never in this repo). "
      "It holds layout numbers, token values, widget and sequence names, and our own descriptions. No game text is copied: captions and descriptions are not quoted, "
      "our UI gets its own strings. Companion file: `docs/RIPPERDOC-ANIMATIONS.md` (all 69 sequences). Reference render: `tools/ripperdoc_render.py`.")
    w("")
    w("> **Source version.** The export headers report WolvenKit 9.1.0 and `GameVersion 2310`. The project targets game 2.5 + Phantom Liberty; "
      "please confirm that the extracted archives are the 2.5 install (see Unclear).")
    w("")
    w("## 1. Reading the numbers")
    w("- The library resolution is `UltraHD_3840_2160`: **every px value is on a 3840x2160 design grid.** At 1920x1080 multiply by 0.5. "
      "For CSS use one unit `--u: calc(100vw / 3840)` (or a container-relative equivalent) and write sizes as `calc(N * var(--u))`; this keeps fonts and gaps proportional.")
    w("- **Anchor** = the point of the parent the widget hangs from (TopLeft, Centered, BottomRight, ...; the `...Fill...` anchors stretch along one axis, `Fill` along both). "
      "**Margin** = L T R B offsets from that point: the widget is shifted by (L - R, T - B); for Fill axes the margins shrink the box. "
      "**Padding** insets the children. `fitToContent` images take the natural size of their atlas part.")
    w("- Opacity multiplies down the tree. Each widget has its own render transform (scale, translation, rotation about a pivot, default centre), which animations drive. "
      "Anything with `visible = false` or opacity 0 at rest is an animation start state, not absent.")
    w("")
    w("## 2. Screen structure (Root library item)")
    w("Root is a 3840x2160 canvas. Its eight children, in z order (first = back):")
    w("")
    w(md(["#", "Child", "What it is"], [
        (0, "`wrapper`", "everything interactive: paperdoll, zone anchors, inventory list, tutorial areas, tooltip anchors"),
        (1, "`button_hints`", "bottom-right key hints (spawned content, empty here)"),
        (2, "`warnning`", "bottom-centre warning popup (hidden at rest; sequence `warnning`)"),
        (3, "`capacity_bar`", "left meter: capacity (starts at opacity 0; intro sequences fade it in)"),
        (4, "`armor_bar`", "right meter: armor (starts at opacity 0)"),
        (5, "`tooltipContainer`", "tooltip host (items are spawned into it at runtime)"),
        (6, "`capacity_tutorial_popup_anchor`", "hidden anchor of the first-time capacity popup"),
        (7, "`armor_tutorial_popup_anchor`", "hidden anchor of the first-time armor popup"),
    ]))
    w("")
    w("Meaningful containers (path = child indexes from Root; `Hidden` is HIDDEN when `visible = false`; skipped nodes are listed below the table):")
    w("")
    w(md(["Path", "Name", "Type", "Anchor", "Size", "Margin", "Padding", "Hidden", "Opacity", "Uses"], struct_rows))
    w("")
    w("**Skipped in the table above** (counts): " + "; ".join(f"{k}: {v}" for k, v in skipped.items()) + ". Per-widget detail for the paperdoll is in section 3; "
      "the tutorial areas are `gameuiTutorialArea` logic nodes (highlight rectangles for first-time help) and are not part of the planner.")
    w("")
    w("Hidden widgets in Root (all `visible = false`): " + ", ".join(f"`{n}` ({p})" for p, n in hidden) + ".")
    w("")
    w("## 3. Paperdoll")
    w("`paperDollWrapper` (Centered, 1300x1800, margin T100) holds two tabs: **`Paperdoll_Item_tab`** (path 0.7.0: one canvas per zone with the zone clip, man and woman side by side) and "
      "**`Paperdoll_default_tab`** (path 0.7.1: the idle body loop plus one hover sprite per zone). Only the chosen gender is meant to be shown; both are built in the tree. "
      "Idle body loops: woman `female_body_loop` (1080x1920, scale 0.9, margin L27 T-111), man `male_body_loop` (1080x1920, scale 0.92, margin L52 T-98); both use an autoplay controller, i.e. they loop.")
    w("")
    w("Per zone (clip size @ margin on the zone canvas; hover sprite = atlas part drawn on top of the idle loop; slot panel anchor = where that zone's slot list attaches in `wrapper`, see section 4):")
    w("")
    w(md(["Zone", "Zone canvas", "Woman clip", "Man clip", "Woman hover sprite", "Man hover sprite", "Slot panel anchor"], zones))
    w("")
    w("Slot panel anchors (children of `wrapper`, empty `VerticalPanel`s at fixed margins; the slot widgets are spawned into them by script): " +
      "; ".join(f"`{n['name']}` ({marg(n['margin'])})" for n, _ in flat(root) if n["path"][:1] == [0] and len(n["path"]) == 2 and n["name"].endswith(("Anchor", "New"))) + ".")
    w("")
    w("Zoom and clip timing per zone sequence (`Paperdoll_default_tab` scale = camera zoom into the body; canvas scale = the clip window growing in; clip = the video that plays). "
      "Full interpolator lists are in the animations document.")
    w("")
    w(md(["Zone", "Gender", "Phase", "Sequence", "Default-tab scale (x)", "Zone canvas scale (x)", "Clip played"], zanim))
    w("")
    w("## 4. Library items that matter for the planner")
    items = [
        ("previewPanel", "1300x1800 canvas with one `Fill` image (part `preview` of `preview.inkatlas`, 1500x2048). The slot used by the character puppet render; our equivalent is the paperdoll video area (section 3)."),
        ("slotRipperdocDisplay", "224x202 empty canvas: the placeholder the slot widgets are spawned into. The real slot look is `itemDisplay` in `slots.inkwidget` (below)."),
        ("inventoryItem", "224x202 canvas (margin R8 B8) with the inventory item controller; a list cell of the left-hand grid."),
        ("cyberwareInventoryMiniGridLeft / Right", "Side grids: a header text, an optional NEW marker (`asterix` icon) and a `grid` (UniformGrid) of small cells. Left variant is right-aligned (`GridsHolder` TopRight), right variant is a vertical panel 300x350. Cell = `smallGridItem`: 32x32 canvas, a 2%-opacity dark background rectangle and a one-colour item rectangle (tinted by `PreviewItem.itemColor`)."),
        ("CWInventoryMiniGridLeft / Right (+ BACKUP)", "Slimmer duplicates of the two grids above (header + NEW marker + grid); the `...BACKUP` items are older copies. Treat the non-backup pair as current."),
        ("RipperdocNewMeterBar", "One meter segment: `Container` (horizontal panel, BottomLeft) with `left` and `right` flex halves, each a 56x9 bar rectangle plus a 4x9 accent; `middleBar` 36x9 at 2% opacity marks the centre. Colour and opacity come from `NewMeter.*` tokens (states Safe/Unsafe x Default/Add/Remove)."),
        ("CapacityMeterBar", "Capacity segment: `bar` image (`bar_long2`, 129x9) + `highlight` image (`perk_highlight_nottransparent`, 165x11), both driven by `NewMeter.BarColor` / `NewMeter.opacity`."),
        ("ArmorMeterBar", "Armor segment: single `bar` image (`bar`, 59x9) driven by `NewMeter.*`."),
        ("tutorial_popup_capacity / _armor", "First-time help popups (17 widgets each). Not needed for the planner."),
        ("purchase_popup (+ _button)", "Buy confirmation popup (52 widgets). Not needed (no shop in a planner)."),
        ("attributeSkillController / perkSlot / shardSlot / craftingMaterialItem / inventoryHeader / inventorySpacer", "Attribute, perk and crafting-material display cells and list spacing; only `inventoryHeader` (a list section header) is likely useful."),
    ]
    w(md(["Library item", "What it is / layout"], items))
    w("")
    w("### Meters (in `Root`)")
    cap = find(root, "capacity_bar")
    arm = find(root, "armor_bar")
    w(f"- **`capacity_bar`** ({marg(cap['margin'])}, TopLeft): `background` image `cw_barbg` at 22% opacity; `icon` (mappin `ripperdoc`, yellow); `barsContainer` (empty vertical panel: capacity segments `CapacityMeterBar` are spawned stacked here); "
      "`currentCapacityLabel` 90x50 filled yellow label (black number, size 50) at L286; `costCapacityLabel` the same size, outlined, shown while hovering an item (preview of the added cost); "
      "`maxCapacityLabel` + a `thresholdLine` / `limitbar_*` pair that marks the limit, tinted with the danger colour `AttributeAllocation.dangerZone`; "
      "`overchargeBox` (lock icon + glow images, tokens `CapacityOverchargeGlow.*`) for the overcap state; `capacityHoverArea` 300x1100 is the hover target.")
    w(f"- **`armor_bar`** ({marg(arm['margin'])}, TopRight): `background` `armor_barbg` at 22%; `icon` (mappin `armor`, blue); `barsContainer` for `ArmorMeterBar` segments (L70); "
      "`currentArmorLabel` (filled, `NewMeter.BarColor`), `costArmorLabel` (outlined, the hover preview, colour `MetersLabels_ARMOR.*`), `maxCapacityLabel` with the `armorLimiter` line (colour `MainColors.SupBlue`); `armorHoverArea` 400x1300.")
    w("- Both meters are vertical stacks of 9-px-high segments spawned into `barsContainer`. `RipperdocNewMeterBar` is built from a left and a right half bar (two columns); `CapacityMeterBar` and `ArmorMeterBar` are single images. Fill, preview-add and preview-remove are style states of the same segment (`Safe_*`, `Unsafe_*`), so the planner can render a segment as one element with a state class.")
    w("")
    w("### Slot display (`itemDisplay`, slots.inkwidget)")
    w("216x194 cell: `upgradeCanvas` (corner/arrow/frame/background images, hidden unless upgradable), `backgroundEquippedFrame` (`corners_equipped`, tinted `ItemDisplay.equippedColor`), "
      "`itemWrapper` (horizontal panel: a 23x195 `rarityContainer` strip on the left, a 2 px spacer, the content flex) and `transmogControls`. Its states (Default, Hover, Locked, Unavailable, Selected, ...) are the `ItemDisplay.*` tokens below. "
      "The rarity strip colour comes from `Rarity.*` tokens.")
    w("")
    w("### Item tooltip (`itemTooltip`, itemtooltip.inkwidget)")
    w("A flex with `backgroundFlex` (a `wrapper` plus the `frame` outline image `unified_tooltip_outline`, tinted `Tooltip.frameEquippedColor`), `contentWrapper` (vertical panel, margins L15 T6 R6 B6, min width 710) and containers for the equipped-item comparison and a recipe block; a `cornerWrapper` accent is hidden by default. "
      "The body is assembled from sub-items: `itemHeader` (654 wide), `itemDetails` / `itemDetailsStat`, `itemCapacityStat` (a horizontal row for the capacity cost), `itemRequirements`, `itemEvolution`, `itemBottom`. Everything is 654-710 px wide on the 3840 grid, i.e. about 330-355 px at 1080p.")
    w("")
    w("## 5. Colors and text")
    w("Tokens are the game's style properties, flattened. Colors are stored as linear **HDR** floats; a value above 1 is a bloom/emissive overshoot that CSS cannot express, so the hex below is clamped to sRGB and flagged `(HDR)` (the glow must be recreated with `box-shadow`/`filter`). "
      "`MainColors` has theme variants (Johnny, plus class and colour-blind themes); only the Default theme is listed. A reference (`->`) points at another token.")
    w("")
    w("### MainColors (Default theme)")
    w(md(["Token", "Value"], colours))
    w("")
    w("References inside MainColors: " + "; ".join(f"`{k}` {v}" for k, v in refs) + ".")
    w("")
    w("### Sizes, weights and misc (MainColors)")
    w("The font family used by the ripperdoc text widgets is the Rajdhani-based `raj` family (weights Regular, Medium, Semi-Bold, Bold are in the export as TTF; a separate digital readout font exists). "
      "Sizes are on the 3840 grid: at 1080p halve them (50 -> 25 px, 42 -> 21 px, 38 -> 19 px, 30 -> 15 px).")
    w("")
    w(md(["Token", "Value"], nums))
    w("")
    w("### Text widgets in Root")
    w(md(["Widget", "Path", "Size", "Size token", "Weight", "Weight token", "Case", "Justify", "Color", "Color token"], texts))
    w("")
    w("### Rarity")
    w(md(["Token", "State", "Value"], r_rows))
    w("")
    w("### Ripperdoc meters, glow and labels (`ripperdoc_poor.inkstyle`)")
    w(md(["Token", "State", "Value"], p_rows))
    w("")
    w("### Slot display states (`slots_style.inkstyle`, ItemDisplay)")
    w("References into `main_style.inkstyle` could not be resolved (that file is not part of the export).")
    w("")
    w(md(["Token", "State", "Value"], s_rows))
    w("")
    w("## 6. Animations")
    n_int = Counter(i["kind"] for s in seqs for d in s["defs"] for i in d["interpolators"])
    w(f"69 sequences, {sum(len(s['defs']) for s in seqs)} target definitions, interpolators: " + ", ".join(f"{k} {v}" for k, v in n_int.most_common()) + ". "
      "All are `FromTo`. The full table (target widget, from -> to, duration, delay, easing, CSS) is in `docs/RIPPERDOC-ANIMATIONS.md`. Mapping rules:")
    w("")
    w(md(["ink", "CSS", "Note"], [
        ("Transparency", "`opacity`", "exact; our rule: transform/opacity only"),
        ("Translation / Scale", "`transform: translate() scale()`", "exact; translate values are design px (`u`), scale about the widget pivot (default centre) -> `transform-origin`"),
        ("Rotation", "`transform: rotate()`", "only `BG_animation`: 3 endless rotations (360/720/1080 over 18 s); unit assumed degrees"),
        ("Size", "scaleX/scaleY from the anchored edge", "approximate: the game animates the box size (wipe-in of panels); CSS-only rule avoids animating width/height"),
        ("Margin", "translate by the margin delta", "one use (`HideTooltip`) and it does not change (from = to)"),
        ("Effect (LinearWipe)", "`clip-path: inset()` or a gradient `mask`", "approximate: 21 interpolators drive a wipe `transition` 0 -> 1; the wipe angle/direction is not in the data"),
        ("Video", "`<video>` play from t0 to t1", "name of the clip is given in the table; see section 8 for timings"),
        ("Events", "Marker = script callback; StopVideo = pause; SetVisibility; PlaySound", "22 markers (all at t = 1 s in the zone intros: the 'intro done' signal), 22 StopVideo, 2 SetVisibility, 1 PlaySound"),
    ]))
    w("")
    w("Easing: `Linear` -> `linear`; the others map as in the table below (standard ease curves); `EasyOutIn` (4 uses) has no CSS equivalent and is approximated by `linear`. "
      "ink `Qubic` is a cubic curve; `Quintic` a quintic one.")
    w("")
    w(md(["ink type / mode", "CSS timing function"], [(f"{t} / {m}", b) for (t, m), b in BEZIER.items()]))
    w("")
    w("Sequence groups: intro/outro of the screen (`ripper_intro`, `ripper_choice_intro`, `HideTooltip`), tabs (`default_tab_intro/outro`, `item_tab_intro`, `item_tab_miniGrid_intro`, `Paperdoll_default_tab_intro`), "
      "paperdoll zones (`<zone>_intro/_outro`, man `M_<zone>_intro/_outro`), hover (`hover_area`, `hoverover_area`), meters (`capacity_meter_bars_intro`, `meter_intro_*`, `overchargeGlow_pulse`), "
      "popups (`purchase_popup_intro`, `warnning`, `ripper_id`), crafting materials, and the background (`BG_animation`).")
    w("")
    w("## 7. Asset map")
    w("Atlas part -> exported PNG (paths relative to `~/work/cyber-art/raw/ui/`; `2160p` matches the 3840 grid, `1080p` the half size) -> widgets that use it (library item / widget name). "
      "`not exported` = the atlas texture is not in the export yet. Video clips are listed after the table.")
    w("")
    rows = []
    for (atlas, part), users in sorted(am.items(), key=lambda kv: (kv[0][0], kv[0][1])):
        ex = exported(atlas, part)
        rows.append((Path(atlas).name, f"`{part}`", "<br>".join(ex) if ex else ("set at runtime (no part named in the data)" if part in ("None", "undefined") else "not exported"), f"{len(users)}: " + ", ".join(sorted(users)[:4]) + (" ..." if len(users) > 4 else "")))
    w(md(["Atlas", "Part", "Exported PNG", "Used by"], rows))
    w("")
    vids = sorted({(Path(n["video"]).stem, n["name"]) for n, _ in flat(root) if n.get("video")})
    w("Video widgets in Root: " + ", ".join(f"`{n}` -> `{c}`" for c, n in vids) + ". Encoded web versions: `~/work/cyber-art/out/paperdoll/{man,woman}/<clip>.webm` (+ `_sm`, `.webp`), see `tools/paperdoll_video.py`.")
    w("")
    w("## 8. Paperdoll flow")
    w("What the data proves, then what is inferred (the controller scripts are not part of the export).")
    w("")
    w("**From the data**")
    w("1. Idle: `Paperdoll_default_tab` shows the body loop (`female_body_loop` / `male_body_loop`, looping, autoplay controller) and one hover sprite per zone (atlas parts `wo_*` / `ma_*` of `woman_body` / `man_body`, sized to the zone and offset to sit on it).")
    w("2. Hover: `hover_area` fades a sprite from opacity 0 to 1 in 0.233 s (linear), `hoverover_area` fades it back out over the same time. The two sequences are keyed on a single sprite in the file (the woman arms sprite), so the game must retarget them per zone at runtime.")
    w("3. Select: the zone's intro sequence runs. Default tab: translate and scale up (x2.9 for the man operating system up to x9 for the woman integumentary, 0.9 s, exponential in-out) while fading out (0.17-0.33 s, delayed 0.2-0.4 s); the zone canvas translates and scales in from 0.21-0.7 to 2 (1.8 for the man's body-wide zones; 0.9 s, exponential in-out) and fades in (0.1 s, delayed 0.3-0.4 s); the zone clip plays from 0 (5.033 s window, real time; our clips are 3.6-4.0 s, so they end on their last frame and hold). A Marker event at 1 s signals that the intro finished.")
    w("4. Leave: the outro reverses the zoom (0.533 s, quartic in-out): default tab and canvas return to their rest transform, the canvas fades out (0.167 s) and a StopVideo event at 0.533 s stops the clip.")
    w("5. Man vs woman: identical structure; the man sequences are prefixed `M_` and use slightly different zoom/translate numbers (and different clips, `man_*`).")
    w("6. Entering the screen: `Paperdoll_default_tab_intro` slides the default tab in from 550 design px below while it scales 2 -> 1 (0.9 s, exponential out) and fades in (0.3 s, delayed 0.133 s, sine out).")
    w("")
    w("**Inferred (needs a game check)**")
    w("- Which zone is hovered or selected is decided by the controller from the slot list the player hovers; each zone has a slot panel anchor (section 3) and presumably the sprite, intro and outro with the same name stem.")
    w("- While a zone is open the slot panel for that zone is shown and the other sprites stay hidden; the hover sprites are at opacity 1 in the file but must start hidden (only the woman arms sprite is stored at 0.5).")
    w("- The capacity and armor meters are at opacity 0 at rest and are faded in by intro sequences (`purchase_popup_intro` touches both; `capacity_meter_bars_intro` and `meter_intro_*` animate the bars).")
    w("")
    w("**Planner mapping (proposal, no code yet).** Idle = `<video loop>` of the body loop + CSS-hidden hover sprites; hover = opacity transition 0.233 s linear; select = one CSS class that runs the zone zoom as `transform` transitions (0.9 s `cubic-bezier(.87,0,.13,1)`) and starts the zone `<video>` from 0; "
      "leave = reverse over 0.533 s (`cubic-bezier(.76,0,.24,1)`) and `pause()`. Motion 'Off' / reduced motion: show the `.webp` poster of the clip and cut instead of zoom. Phone: use the `_sm.webm` clips.")
    w("")
    w("## 9. Unclear")
    w("1. **Game version.** All exports say `GameVersion 2310`; confirm this is the 2.5 install (WolvenKit's number looks like a 2.31-style tag).")
    w("2. **Video interpolator semantics.** `Video from -> to` over a duration looks like a playback window in seconds (0 -> 5.033 in 5.033 s = play once in real time). Some entries are odd: `frontalCortex_intro` plays the woman clip 0 -> 0.068 s in 5.033 s (looks like a leftover), and several Video definitions target `Root` (no video there). Needs a look at the running game.")
    w("3. **Targets that are not in Root (16 definitions)** in `ripper_id`, `warnning`, popups and a few others use child paths that exist only in other library items (tutorial/purchase popups) or are resolved by script; they are listed with their raw path.")
    w("4. **Where the background art is attached.** `background.inkatlas` (1080p/2160p) is exported but no widget in Root uses it; `BG_animation` rotates things at the root level. The background is presumably set by the screen script.")
    w("5. **Start states.** Several widgets are stored at opacity 1 but must start hidden (hover sprites, zone canvases); `capacity_bar` and `armor_bar` are stored at 0. The actual initial state is set by script.")
    w("6. **LinearWipe effect.** Only the progress value (0 -> 1) is in the data, not its angle or softness.")
    w("7. **Layout engine details.** The simplified rules in section 1 reproduce the idle screen (see `incoming/screens/ripperdoc-reference.png`), but panel sizing for `fitToContent` panels and uniform grids is approximate; real inventory cell sizes (224x202 / 216x194) are known, cell counts and wrapping are script-driven.")
    w("8. **Slot ordering and counts** per zone panel are not in the widget tree (panels are empty); they come from the game data (`docs/GAME-DATA.md`).")
    w("9. **HDR colors.** Several tokens exceed 1.0 (emissive); CSS needs a glow substitute.")
    w("10. **Fonts.** The family looks like Rajdhani (open-licence on Google Fonts, SIL OFL) but the exported TTFs are game assets: check the licence before using them. The planner uses the fonts in docs/STYLE.md; size and weight mapping is in section 5.")
    w("11. **Which library item a sequence plays on.** Paths are child indexes; I resolved them against Root. Many sequences (e.g. `default_tab_intro`, 25 definitions, all path `[]`) probably play on other library items (list rows, popups), so their target names are only reliable for the paperdoll, meter and `warnning` sequences.")
    (DOCS / "RIPPERDOC-SPEC.md").write_text("\n".join(L) + "\n", encoding="utf-8")

    # ---- animations document
    A = ["# Ripperdoc animations", "",
         "All 69 sequences of `ripperdoc_animations.inkanim`, generated by `tools/ripperdoc_spec.py`. Target = widget reached by the child-index path from the Root library item "
         "(`!` = the path does not exist in Root: it belongs to another library item or is resolved by script). Values are on the 3840x2160 design grid (`u` = 1 design px). "
         "Time in seconds. `CSS` column: our mapping (see RIPPERDOC-SPEC.md section 6); *APPROX* marks approximate mappings; Video rows name the clip.", ""]
    for s in seqs:
        A.append(f"## {s['name']}")
        A.append("")
        rows = []
        for d in s["defs"]:
            path = d["path"]
            try:
                n = rd.by_path(root, path)
                tname = n["name"]
            except Exception:
                n = None
                tname = f"! {path}"
            tp = ".".join(map(str, path)) if path else "root"
            for i in d["interpolators"]:
                fr = vec(i["from"]) if isinstance(i["from"], list) else num(i["from"])
                to = vec(i["to"]) if isinstance(i["to"], list) else num(i["to"])
                rows.append((f"`{tname}` ({tp})", i["kind"], f"{fr} -> {to}", i["duration"], i["delay"], f"{i['type']} {i['mode']}", css_of(i, n)))
            for e in d["events"]:
                rows.append((f"`{tname}` ({tp})", f"event {e['kind']}", "-", "-", e["time"], "-", {"Marker": "script callback marker", "StopVideo": "pause the clip", "SetVisibility": f"set visibility {e['extra']}", "PlaySound": "play a UI sound (none)"}.get(e["kind"], "?")))
        A.append(md(["Target", "Interpolator", "From -> to", "Dur", "Delay", "Easing", "CSS"], rows))
        A.append("")
    (DOCS / "RIPPERDOC-ANIMATIONS.md").write_text("\n".join(A) + "\n", encoding="utf-8")
    print(f"wrote RIPPERDOC-SPEC.md ({len(L)} lines) and RIPPERDOC-ANIMATIONS.md ({len(A)} lines)")


if __name__ == "__main__":
    main()
