"""Importer golden test, on a small HAND-MADE dump fixture (tests/fixtures/dump), not game data."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import import_cyberware as imp  # noqa: E402

FX = ROOT / "tests" / "fixtures" / "dump"
load = lambda name: json.loads((FX / name).read_text(encoding="utf-8"))  # noqa: E731


class ImportGoldenTests(unittest.TestCase):
    def setUp(self):
        self.doc, self.rep = imp.build(load("cyberware_v1.json"), load("costs_v1.json"), load("map.json"))

    def test_matches_golden_output(self):
        self.assertEqual(self.doc, load("expected.json"))

    def test_deterministic_and_input_order_independent(self):
        recs = load("cyberware_v1.json")
        again, _ = imp.build(list(reversed(recs)), load("costs_v1.json"), load("map.json"))
        self.assertEqual(json.dumps(again), json.dumps(self.doc))

    def test_cost_is_per_item_not_per_quality(self):
        by = {i["id"]: i for i in self.doc["implants"]}
        self.assertEqual((by["T.WidgetRare"]["cost"], by["T.WidgetRare2"]["cost"]), (4, 6))   # same name, slot and quality
        self.assertEqual(by["T.WidgetCommon"]["cost"], by["T.WidgetRare"]["cost"])

    def test_no_cost_items_are_reported_and_left_out(self):
        self.assertEqual([x["id"] for x in self.rep["noCost"]], ["T.Free"])
        self.assertNotIn("T.Free", [i["id"] for i in self.doc["implants"]])

    def test_unmapped_area_and_excluded_patterns_are_reported(self):
        self.assertEqual(dict(self.rep["unmapped"]), {"TailCW": ["T.Orphan"]})
        self.assertEqual(self.rep["excluded"], ["T.Debug_Widget", "TEST.Thing"])

    def test_flags_split_from_stats_and_noise_rounded(self):
        w = next(i for i in self.doc["implants"] if i["id"] == "T.WidgetCommon")
        self.assertEqual(w["flags"], ["AttunementHelper", "HasWidget"])
        self.assertEqual([s["stat"] for s in w["stats"]], ["Armor", "Speed"])
        self.assertEqual(w["stats"][1]["value"], 0.1)
        self.assertIs(type(w["stats"][0]["value"]), int)
        self.assertEqual(self.rep["nullStats"], 1)

    def test_variants_share_a_family_and_same_quality_gets_a_variant_number(self):
        fam = [i for i in self.doc["implants"] if i["family"] == "Head/Widget"]
        self.assertEqual([(i["tier"], i["variant"]) for i in fam], [(1, 1), (2, 1), (2, 2)])
        self.assertEqual(self.rep["sameQuality"], ["Head/Widget"])

    def test_groups_come_from_the_map_table_including_empty_slots(self):
        self.assertEqual([(g["id"], g["slots"], g["locked"]) for g in self.doc["groups"]],
                         [("Slot.Head", 2, 1), ("Slot.Leg", 1, 0), ("Slot.Arm", 1, 0)])

    def test_legacy_area_dropped_and_pending_data_carried(self):
        self.assertEqual(self.rep["legacy"], ["T.OldThing"])
        self.assertNotIn("T.OldThing", [i["id"] for i in self.doc["implants"]])
        self.assertEqual([g.get("pendingData") for g in self.doc["groups"]], [None, None, "invented gap"])

    def test_input_files_come_from_source_txt_not_from_the_newest_version(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            for f in ("cyberware_v1.json", "costs_v1.json", "SOURCE.txt"):
                (t / f).write_bytes((FX / f).read_bytes())
            (t / "cyberware_v9.json").write_text("[]")     # newer decoys must be ignored
            (t / "costs_v9.json").write_text("{}")
            out = t / "out.json"
            subprocess.run([sys.executable, str(ROOT / "tools" / "import_cyberware.py"), "--extract", str(t), "--map", str(FX / "map.json"),
                            "--out", str(out)], capture_output=True, text=True)
            self.assertEqual(json.loads(out.read_text()), load("expected.json"))

    def test_missing_source_txt_or_entry_stops(self):
        with tempfile.TemporaryDirectory() as t:
            self.assertRaises(SystemExit, imp.source_file, Path(t), "Cyberware file")
            (Path(t) / "SOURCE.txt").write_text("Costs file: costs_v1.json\n")
            self.assertRaises(SystemExit, imp.source_file, Path(t), "Cyberware file")
            self.assertRaises(SystemExit, imp.source_file, Path(t), "Costs file")   # named but absent

    def test_unknown_quality_fails_loudly(self):
        recs = load("cyberware_v1.json")
        recs[0]["quality"] = "Mythic"
        with self.assertRaises(ValueError):
            imp.build(recs, load("costs_v1.json"), load("map.json"))

    def test_icon_key_is_icon_part_and_report_lists_them(self):
        self.assertEqual([i["icon"] for i in self.doc["implants"]], ["ico_a", "ico_a", "ico_a", None])
        self.assertEqual(self.rep["icons"], {"ico_a", "ico_old"})   # whole dump, imported or not
        self.assertIn("ico_a", imp.render_report(self.doc, self.rep))

    def test_command_line_end_to_end_is_byte_identical(self):
        with tempfile.TemporaryDirectory() as t:
            outs = []
            for n in (1, 2):
                out = Path(t) / f"out{n}.json"
                subprocess.run([sys.executable, str(ROOT / "tools" / "import_cyberware.py"), "--extract", str(FX), "--map", str(FX / "map.json"),
                                "--out", str(out)], capture_output=True, text=True)   # rc 1: fixture ids are not in the registry
                outs.append(out.read_bytes())
            self.assertEqual(outs[0], outs[1])
            self.assertEqual(json.loads(outs[0]), load("expected.json"))


if __name__ == "__main__":
    unittest.main()
