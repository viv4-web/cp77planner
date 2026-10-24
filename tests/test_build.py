import hashlib
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import build  # noqa: E402

ART_BYTES = {"SAMPLE.Perk.Body.T1.A.png": b"\x89PNG-fake-game-art-1", "secret_art_file.webp": b"RIFF-fake-game-art-2"}


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


class BuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        t = Path(cls.tmp.name)
        cls.art = t / "art"
        cls.art.mkdir()
        for name, data in ART_BYTES.items():
            (cls.art / name).write_bytes(data)
        cls.dist = t / "dist"
        cls.live, cls.offline = build.build(cls.dist, cls.art)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_both_outputs_exist(self):
        for d in (self.live, self.offline):
            self.assertTrue((d / "index.html").is_file())
            self.assertTrue((d / "js" / "art.js").is_file())
            self.assertTrue((d / "data" / "sample" / "tree.json").is_file())
            self.assertTrue((d / "fonts" / "chakra-petch-latin-700-normal.woff2").is_file())

    def test_same_code_in_both(self):
        def files(d):
            return {p.relative_to(d): sha(p) for p in d.rglob("*") if p.is_file()}
        live, off = files(self.live), files(self.offline)
        diff = {k for k in set(live) | set(off) if live.get(k) != off.get(k)}
        allowed = {Path("art-map.json")} | {k for k in live if k.parts[:2] == ("img", "game")}
        self.assertLessEqual(diff, allowed)

    def test_live_uses_art(self):
        m = json.loads((self.live / "art-map.json").read_text())
        self.assertEqual(m["SAMPLE.Perk.Body.T1.A"], "img/game/SAMPLE.Perk.Body.T1.A.png")
        self.assertTrue((self.live / m["SAMPLE.Perk.Body.T1.A"]).is_file())

    def test_offline_has_no_game_art(self):
        self.assertEqual(json.loads((self.offline / "art-map.json").read_text()), {})
        self.assertFalse((self.offline / "img" / "game").exists())
        art_hashes = {sha(p) for p in self.art.iterdir()}
        art_names = {p.name for p in self.art.iterdir()}
        for p in self.offline.rglob("*"):
            if p.is_file():
                self.assertNotIn(sha(p), art_hashes, p)
                self.assertNotIn(p.name, art_names, p)

    def test_offline_never_references_art_dir(self):
        pat = re.compile(rb"(^|[^A-Za-z0-9_])art/")
        for p in self.offline.rglob("*"):
            if p.is_file() and p.suffix in {".html", ".js", ".css", ".json", ".svg"}:
                self.assertIsNone(pat.search(p.read_bytes()), f"{p} references art/")

    def test_empty_art_dir_falls_back_to_placeholders(self):
        with tempfile.TemporaryDirectory() as t:
            empty = Path(t) / "art"
            empty.mkdir()
            live, _ = build.build(Path(t) / "dist", empty)
            self.assertEqual(json.loads((live / "art-map.json").read_text()), {})
        with tempfile.TemporaryDirectory() as t:  # art dir missing entirely
            live, _ = build.build(Path(t) / "dist", Path(t) / "nope")
            self.assertEqual(json.loads((live / "art-map.json").read_text()), {})

    def test_no_third_party_requests_in_source(self):
        pat = re.compile(rb"(https?:)?//(?!www\.w3\.org)[a-z0-9.-]+\.[a-z]{2,}", re.I)
        for p in (ROOT / "src").rglob("*"):
            if p.is_file() and p.suffix in {".html", ".js", ".css"}:
                for m in pat.finditer(p.read_bytes()):
                    self.fail(f"external URL in {p}: {m.group(0)!r}")


if __name__ == "__main__":
    unittest.main()
