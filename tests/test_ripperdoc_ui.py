"""Checks on the generated ripperdoc layout and tokens (numbers only) and their link to our data."""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LAYOUT = json.loads((ROOT / "data" / "ripperdoc" / "layout.json").read_text())
CYBER = json.loads((ROOT / "data" / "cyberware.json").read_text())
TOKENS = (ROOT / "src" / "styles" / "ripperdoc-tokens.css").read_text()


class LayoutTests(unittest.TestCase):
    def test_every_zone_maps_to_a_slot_group_and_has_both_genders(self):
        groups = {g["id"].removeprefix("Slot.") for g in CYBER["groups"]}
        keys = [z["key"] for z in LAYOUT["zones"]]
        self.assertEqual(len(keys), 10)
        self.assertEqual({z["group"] for z in LAYOUT["zones"]}, groups, "one zone per slot group; the legacy Immune zone is left out")
        for gender in ("woman", "man"):
            self.assertEqual(sorted(LAYOUT["genders"][gender]["zones"]), sorted(keys))

    def test_anchors_and_rects_are_on_the_1920_stage_grid(self):
        self.assertEqual(LAYOUT["stage"], [1920, 1080])
        for z in LAYOUT["zones"]:
            x, y = z["anchor"]
            self.assertTrue(0 <= x < 1920 and 0 <= y < 1080, z)
        for g in LAYOUT["genders"].values():
            x, y, w, h = g["body"]["rect"]
            self.assertTrue(w > 300 and h > 700 and 0 <= x < 1920)

    def test_zone_sequences_carry_the_timings_the_ui_needs(self):
        for g in LAYOUT["genders"].values():
            for key, z in g["zones"].items():
                for phase in ("intro", "outro"):
                    kinds = {i["kind"] for i in z[phase]["tab"]}
                    self.assertTrue({"Translation", "Scale", "Transparency"} <= kinds, (key, phase, "tab"))
                    ckinds = {i["kind"] for i in z[phase]["canvas"]}
                    self.assertTrue({"Translation", "Scale", "Transparency"} <= ckinds, (key, phase, "canvas"))
                self.assertGreater(max(i["dur"] for i in z["intro"]["tab"]), 0.5)
                self.assertEqual(len(z["canvasPivot"]), 2)

    def test_tokens_css_has_what_the_stylesheet_uses(self):
        css = (ROOT / "src" / "styles" / "ripperdoc.css").read_text()
        used = set(re.findall(r"var\((--t-[A-Za-z0-9_-]+)\)", css))      # a var() with a fallback may name a token that lives elsewhere
        defined = set(re.findall(r"^\s*(--t-[A-Za-z0-9_-]+):", TOKENS, re.M))
        missing = {u for u in used if u not in defined and not u.endswith("-glow")}
        self.assertEqual(missing, set(), "tokens used in ripperdoc.css but not generated")

    def test_hdr_colors_become_a_clamped_color_plus_a_glow(self):
        self.assertRegex(TOKENS, r"--t-MainColors-Red:#FF6159;")
        self.assertRegex(TOKENS, r"--t-MainColors-Red-glow:0 0 6px rgba\(")
        self.assertNotRegex(TOKENS, r"--t-MainColors-Blue-glow")        # not HDR: no glow

    def test_no_game_text_or_art_in_the_generated_files(self):
        text = json.dumps(LAYOUT) + TOKENS
        self.assertNotIn(".bk2", text)
        self.assertNotIn("\\\\", text)


class FontTests(unittest.TestCase):
    def test_open_fonts_self_hosted_with_licences(self):
        for f in ("rajdhani-500.woff2", "rajdhani-600.woff2", "rajdhani-700.woff2", "sharetechmono-400.woff2"):
            self.assertEqual((ROOT / "src" / "fonts" / f).read_bytes()[:4], b"wOF2", f)
        for lic in ("LICENSE-Rajdhani.txt", "LICENSE-ShareTechMono.txt"):
            self.assertIn("SIL OPEN FONT LICENSE", (ROOT / "src" / "fonts" / lic).read_text().upper())


if __name__ == "__main__":
    unittest.main()


WIDGETS = json.loads((ROOT / "data" / "ripperdoc" / "widgets.json").read_text())
ICONS = json.loads((ROOT / "data" / "ripperdoc" / "icons.json").read_text())


class WidgetTests(unittest.TestCase):
    def test_every_cyberware_record_has_an_icon_key_that_maps_to_a_cut_part(self):
        for i in CYBER["implants"]:
            key = i.get("icon") or i.get("iconName")
            self.assertTrue(key, f"{i['id']} has neither icon nor iconName")
            self.assertIn(key, ICONS["map"], f"{i['id']}: icon {key} not mapped")
        self.assertEqual(ICONS["missing"], [])
        self.assertEqual(ICONS["noKey"], [])
        for part in ICONS["map"].values():
            self.assertRegex(part, r"^(item_icons\d*|inventory4_atlas)/[A-Za-z0-9_.\-]+$")

    def test_the_fifteen_operating_system_decks_use_the_documented_fallback(self):
        decks = [i for i in CYBER["implants"] if not i.get("icon")]
        self.assertEqual(len(decks), 15)
        self.assertEqual({i["iconName"] for i in decks}, {"militech_paraline"})
        self.assertEqual(ICONS["approximated"], {"militech_paraline": "item_icons/icon_cyberdeck"})

    def test_css_only_uses_parts_the_build_copies(self):
        import sys
        sys.path.insert(0, str(ROOT / "tools"))
        import build
        wanted = {"/".join(m.split("-", 1)) for m in re.findall(r"--p-([A-Za-z0-9_]+-[A-Za-z0-9_]+)", (ROOT / "src" / "styles" / "ripperdoc-widgets.css").read_text())}
        have = set(WIDGETS["parts"]) | set(build.UI_EXTRA_PARTS)
        self.assertEqual(sorted(wanted - have), [], "a CSS mask part that build.py would not copy")

    def test_widget_numbers_are_the_game_grid_halved(self):
        self.assertEqual(WIDGETS["cell"]["size"], [108.0, 97.0])
        self.assertEqual(WIDGETS["tooltip"]["width"], 355.0)  # the game's width; our tooltip is 380 (docs/RIPPERDOC-SPEC.md 10.3)
        self.assertEqual(WIDGETS["hover"]["flicker"]["count"], 8)
        self.assertEqual(WIDGETS["absentParts"], ["atlas_inventory/corners_equipped", "atlas_inventory/texture_1slot", "atlas_inventory/texture_1slot_iconic", "hub_atlas/ico_cafting_crafting"])


LOOPS = json.loads((ROOT / "data" / "ripperdoc" / "loops.json").read_text())["clips"]


class LoopTests(unittest.TestCase):
    def test_every_zone_clip_has_a_loop_point_inside_the_clip(self):
        for gender, g in LAYOUT["genders"].items():
            for key, z in g["zones"].items():
                e = LOOPS.get(f"{gender}/{z['clip']['name']}")
                self.assertIsNotNone(e, f"{gender}/{key}")
                self.assertTrue(0 <= e["loopStart"] < e["frames"] - 8)
                self.assertEqual(e["fps"], 30)

    def test_overview_anchors_split_into_left_and_right_columns(self):
        left = sorted(z["key"] for z in LAYOUT["zones"] if z["anchor"][0] <= 600)
        self.assertEqual(left, ["arms", "frontal_cortex", "integumentary", "nervous", "skeleton"])
