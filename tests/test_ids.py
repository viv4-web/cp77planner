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
        self.assertGreater(self.reg["next"], max(ns), "'next' must be above every assigned n")

    def test_data_files_match_registry(self):
        self.assertEqual(ids.check(), 0)

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


if __name__ == "__main__":
    unittest.main()
