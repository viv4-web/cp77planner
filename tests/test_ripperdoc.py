"""Pure-function tests for the ripperdoc tools; hand-made nodes, no game data."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import ripperdoc_data as rd  # noqa: E402
import ripperdoc_render as rr  # noqa: E402
import ripperdoc_spec as sp  # noqa: E402


def node(**kw):
    n = {"anchor": "TopLeft", "anchorPoint": [0, 0], "margin": [0, 0, 0, 0], "size": [100, 50], "fitToContent": False,
         "scale": [1, 1], "translation": [0, 0], "pivot": [.5, .5]}
    n.update(kw)
    return n


class RipperdocToolTests(unittest.TestCase):
    def test_anchor_and_margin_rules(self):
        parent = (0, 0, 3840, 2160)
        self.assertEqual(rr.place(node(margin=[10, 20, 0, 0]), parent, None), (10, 20, 100, 50))
        self.assertEqual(rr.place(node(anchor="TopRight", anchorPoint=[1, 0], margin=[0, 0, 40, 0]), parent, None), (3700, 0, 100, 50))        # inset from the right
        self.assertEqual(rr.place(node(anchor="BottomCenter", anchorPoint=[.5, 1], margin=[0, 0, 0, 50]), parent, None), (1870, 2060, 100, 50))
        self.assertEqual(rr.place(node(anchor="Centered", anchorPoint=[.5, .5], margin=[10, -20, 0, 0]), parent, None), (1880, 1055, 100, 50))
        self.assertEqual(rr.place(node(anchor="Fill", margin=[5, 6, 7, 8]), parent, None), (5, 6, 3828, 2146))

    def test_fit_to_content_uses_natural_size(self):
        self.assertEqual(rr.place(node(fitToContent=True), (0, 0, 500, 500), (32, 16))[2:], (32, 16))

    def test_render_transform_about_pivot(self):
        aff = rr.Aff().then_local(node(scale=[2, 2]), (0, 0, 100, 50))
        self.assertEqual(aff.rect((0, 0, 100, 50)), (-50, -25, 200, 100))

    def test_hex_color_clamps_hdr(self):
        self.assertEqual(rd.hexcolor((1.2, 0.5, 0, 1)), "#FF8000")
        self.assertEqual(rd.hexcolor((0, 0, 1, 0.5)), "#0000FF80")

    def test_every_easing_in_the_data_has_a_css_curve(self):
        for t in ("Quadratic", "Qubic", "Quartic", "Quintic", "Exponential", "Sinusoidal"):
            for m in ("EasyIn", "EasyOut", "EasyInOut"):
                self.assertIn((t, m), sp.BEZIER)
        self.assertEqual(sp.css_ease({"type": "Linear", "mode": "EasyIn"}), "linear")
        self.assertIn("approx", sp.css_ease({"type": "Linear", "mode": "EasyOutIn"}))

    def test_handle_references_resolve(self):
        ch = rd.Chunk({"a": {"HandleId": "1", "Data": {"$type": "inkCanvasWidget", "name": {"$type": "CName", "$value": "x"}}}, "b": {"HandleRefId": "1"}})
        self.assertEqual(ch.get({"HandleRefId": "1"})["$type"], "inkCanvasWidget")
        self.assertIsNone(ch.get({"HandleRefId": "9"}))

    def test_number_formatting_drops_float_noise(self):
        self.assertEqual(sp.num(3.4969e-07), "0")
        self.assertEqual(sp.num(5.4000001), "5.4")
        self.assertEqual(sp.num(7), "7")


if __name__ == "__main__":
    unittest.main()
