import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import ids  # noqa: E402

# Frozen forever: these mappings may never change. Add lines, never edit them.
FROZEN = {
    "SAMPLE.Attr.Body": 1,
    "SAMPLE.Attr.Cool": 5,
    "SAMPLE.Tree.Relic": 6,
    "SAMPLE.Perk.Body.T1.A": 101,
    "SAMPLE.Perk.Intelligence.T4.C": 433,
    "SAMPLE.Perk.Relic.T3.B": 622,
    "SAMPLE.Slot.FrontalCortex": 700,
    "SAMPLE.Implant.FrontalCortex.A": 710,
    "Slot.FrontalCortex": 1000,
    "Slot.Legs": 1009,
    "Items.AdvancedAdaptiveStemCellsCommon": 1010,
}


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)


class IdRegistryTests(unittest.TestCase):
    def setUp(self):
        self.reg = ids.load()

    def test_frozen_mappings(self):
        for name, n in FROZEN.items():
            self.assertEqual(self.reg["ids"].get(name), n, name)

    def test_n_unique_positive_and_below_next(self):
        ns = list(self.reg["ids"].values())
        self.assertEqual(len(ns), len(set(ns)), "duplicate n in registry")
        self.assertTrue(all(isinstance(n, int) and n > 0 for n in ns))
        real = [n for name, n in self.reg["ids"].items() if not name.startswith("SAMPLE.")]
        sample = [n for name, n in self.reg["ids"].items() if name.startswith("SAMPLE.")]
        self.assertGreater(self.reg["next"], max(real, default=0), "'next' must be above every real n")
        self.assertGreaterEqual(self.reg["next"], 1000, "1..999 is reserved for SAMPLE records")
        self.assertTrue(all(n < 1000 for n in sample), "SAMPLE records live below 1000")
        self.assertGreater(self.reg["nextSample"], max(sample), "'nextSample' must be above every sample n")

    def test_data_files_match_registry(self):
        self.assertEqual(ids.check(), 0)

    def test_record_without_registry_entry_fails(self):
        doc = {"trees": [{"id": "X.Tree", "perks": [{"id": "X.Perk"}]}]}
        with self.assertRaises(ids.MissingIds) as cm:
            ids.inject(doc, {"X.Tree": 1})
        self.assertIn("X.Perk", str(cm.exception))

    def test_inline_n_is_rejected(self):
        with self.assertRaises(ids.MissingIds):
            ids.inject({"trees": [{"id": "X.Tree", "n": 5, "perks": []}]}, {"X.Tree": 5})

    def test_build_fails_on_unregistered_record(self):
        import tempfile, shutil, build
        with tempfile.TemporaryDirectory() as t:
            fake = Path(t) / "root"
            shutil.copytree(ROOT / "data", fake / "data")
            shutil.copytree(ROOT / "src", fake / "src")
            doc = json.loads((fake / "data/sample/tree.json").read_text())
            doc["trees"][0]["perks"].append({"id": "SAMPLE.Perk.Unregistered", "tier": 0, "name": "SAMPLE x", "desc": "x"})
            (fake / "data/sample/tree.json").write_text(json.dumps(doc))
            old = build.ROOT
            build.ROOT = fake
            try:
                with self.assertRaises(ids.MissingIds):
                    build.build(Path(t) / "dist", Path(t) / "art")
            finally:
                build.ROOT = old

    def test_history_is_append_only(self):
        """Every earlier committed version of data/ids.json must be a subset of the current one."""
        if git("rev-parse", "--git-dir").returncode != 0:
            self.skipTest("not a git checkout")
        revs = git("log", "--format=%H", "--", "data/ids.json").stdout.split()
        for rev in revs:
            old = git("show", f"{rev}:data/ids.json")
            if old.returncode != 0:
                continue
            old = json.loads(old.stdout)
            for name, n in old["ids"].items():
                self.assertEqual(self.reg["ids"].get(name), n, f"{name} changed or was removed since {rev[:8]}")
            self.assertGreaterEqual(self.reg["next"], old["next"], f"'next' went backwards since {rev[:8]}")
            self.assertGreaterEqual(self.reg.get("nextSample", 0), old.get("nextSample", 0), f"'nextSample' went backwards since {rev[:8]}")


if __name__ == "__main__":
    unittest.main()
