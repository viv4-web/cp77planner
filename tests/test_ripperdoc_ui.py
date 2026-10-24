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
