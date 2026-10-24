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

UI_FILES = {   # fake ripperdoc art: one sprite, the background, one body loop with all three files
    "ui/woman_body/wo_arms.webp": b"RIFF-fake-sprite", "ui/background/background.webp": b"RIFF-fake-bg",
    "paperdoll/woman/female_body_loop.webm": b"fake-webm", "paperdoll/woman/female_body_loop_sm.webm": b"fake-webm-sm",
    "paperdoll/woman/female_body_loop.webp": b"RIFF-fake-poster", "ui/woman_body/not_referenced.webp": b"RIFF-unused",
}
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
        cls.ui = t / "ui-out"
        for rel, data in UI_FILES.items():
            f = cls.ui / rel
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_bytes(data)
        cls.live, cls.offline = build.build(cls.dist, cls.art, cls.ui)

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
        allowed = {Path("art-map.json"), Path("ui-art.json")} | {k for k in live if k.parts[:2] in (("img", "game"), ("img", "ui")) or k.parts[0] == "media"}
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

    def test_live_gets_only_referenced_ui_art(self):
        ui = json.loads((self.live / "ui-art.json").read_text())
        self.assertEqual(ui["parts"]["woman_body/wo_arms"], "img/ui/woman_body/wo_arms.webp")
        self.assertIn("background/background", ui["parts"])
        self.assertEqual(sorted(ui["clips"]), ["woman/female_body_loop"])
        self.assertEqual(sorted(ui["clips"]["woman/female_body_loop"]), ["poster", "sm", "webm"])
        for rel in [*ui["parts"].values(), *ui["clips"]["woman/female_body_loop"].values()]:
            self.assertTrue((self.live / rel).is_file(), rel)
        self.assertFalse((self.live / "img" / "ui" / "woman_body" / "not_referenced.webp").exists())

    def test_icons_are_copied_only_when_our_data_references_them(self):
        icons = json.loads((ROOT / "data" / "ripperdoc" / "icons.json").read_text())["map"]
        used = {i.get("icon") or i.get("iconName") for i in json.loads((ROOT / "data" / "cyberware.json").read_text())["implants"]}
        key = sorted(used & set(icons))[0]
        with tempfile.TemporaryDirectory() as t:
            ui = Path(t) / "ui"
            for part in (icons[key], "item_icons9/not_in_our_data"):
                f = ui / "ui" / f"{part}.webp"
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_bytes(b"RIFF....WEBP")
            live, _ = build.build(Path(t) / "dist", Path(t) / "no-art", ui)
            doc = json.loads((live / "ui-art.json").read_text())
            self.assertEqual(doc["icons"][key], icons[key])
            self.assertTrue((live / doc["parts"][icons[key]]).is_file())
            self.assertFalse((live / "img" / "ui" / "item_icons9" / "not_in_our_data.webp").exists())

    def test_offline_has_no_ripperdoc_game_art(self):
        self.assertEqual(json.loads((self.offline / "ui-art.json").read_text()), {"clips": {}, "icons": {}, "parts": {}})
        self.assertFalse((self.offline / "img" / "ui").exists())
        self.assertFalse((self.offline / "media").exists())

    def test_missing_ui_art_folder_gives_placeholders(self):
        with tempfile.TemporaryDirectory() as t:
            live, _ = build.build(Path(t) / "dist", Path(t) / "nope", Path(t) / "nope-ui")
            self.assertEqual(json.loads((live / "ui-art.json").read_text()), {"clips": {}, "icons": {}, "parts": {}})

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



class DeployHeaderTests(unittest.TestCase):
    def test_htaccess_serves_webm_and_webp_with_the_right_types(self):
        text = (ROOT / "tools" / "deploy.sh").read_text()
        self.assertIn("AddType video/webm .webm", text)
        self.assertIn("AddType image/webp .webp", text)
        self.assertRegex(text, r'FilesMatch "\\\.\(woff2\|svg\|png\|webp\|jpg\|webm\)\$"')


if __name__ == "__main__":
    unittest.main()
