"""Checks on the shipped data/cyberware.json: real records only, registered, consistent."""
import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import ids  # noqa: E402

DATA = json.loads((ROOT / "data" / "cyberware.json").read_text(encoding="utf-8"))
REG = ids.load()["ids"]
MAP = json.loads((ROOT / "tools" / "cyberware-map.json").read_text(encoding="utf-8"))


class CyberwareDataTests(unittest.TestCase):
    def test_no_sample_values(self):
        text = (ROOT / "data" / "cyberware.json").read_text(encoding="utf-8")
        self.assertNotIn("SAMPLE", text.upper())
        self.assertNotIn("_sample", DATA)
        self.assertFalse((ROOT / "data" / "sample" / "cyberware.json").exists(), "SAMPLE cyberware must be gone")

    def test_records_are_registered_real_numbers_and_carry_no_n(self):
        for r in [*DATA["groups"], *DATA["implants"]]:
            self.assertNotIn("n", r, r["id"])
            self.assertGreaterEqual(REG[r["id"]], 1000, r["id"])
        self.assertEqual(len({REG[r["id"]] for r in [*DATA["groups"], *DATA["implants"]]}), len(DATA["groups"]) + len(DATA["implants"]))

    def test_sample_range_is_retired(self):
        for name, n in REG.items():
            if 700 <= n <= 739:
                self.assertTrue(name.startswith("SAMPLE."), f"{name} reuses a retired SAMPLE number")

    def test_shape(self):
        groups = {g["id"] for g in DATA["groups"]}
        self.assertEqual(len(groups), len(MAP["slots"]))
        qualities = {q["label"] for q in MAP["qualities"]}
        pats = [re.compile(p) for p in MAP["flagStatPatterns"]]
        for i in DATA["implants"]:
            self.assertIn(i["group"], groups)
            self.assertIn(i["quality"], qualities)
            self.assertIsInstance(i["cost"], int)
            self.assertGreater(i["cost"], 0)
            self.assertTrue(i["family"].startswith(i["group"].removeprefix("Slot.") + "/"), i["id"])
            for s in i["stats"]:
                self.assertIsInstance(s["value"], (int, float), i["id"])
                self.assertFalse(any(p.search(s["stat"]) for p in pats), f"{i['id']}: flag stat {s['stat']} left in stats")
            self.assertTrue(all(any(p.search(f) for p in pats) for f in i["flags"]), i["id"])

    def test_cost_is_not_a_function_of_quality(self):
        by_q = {}
        for i in DATA["implants"]:
            by_q.setdefault(i["quality"], set()).add(i["cost"])
        self.assertTrue(any(len(v) > 1 for v in by_q.values()), "costs vary within a quality")

    def test_each_variant_is_unique_in_its_family(self):
        seen = set()
        for i in DATA["implants"]:
            k = (i["family"], i["tier"], i["variant"])
            self.assertNotIn(k, seen, k)
            seen.add(k)


if __name__ == "__main__":
    unittest.main()
