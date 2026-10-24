"""paperdoll_video.py without ffmpeg: discovery, problems, command lines, fingerprint. Frames are tiny hand-made PNGs."""
import struct
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import paperdoll_video as pv  # noqa: E402


def png(path: Path, w=4, h=2, ctype=6, fill=b"\x10\x20\x30\x40"):
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
    raw = b"".join(b"\x00" + fill * w for _ in range(h))
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, ctype, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


class PaperdollTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.raw = Path(self.tmp.name)
        for side, clip, n in (("man", "man_hand", 3), ("woman", "woman_hand", 2)):
            (self.raw / side).mkdir()
            for i in range(n):
                png(self.raw / side / f"{clip}{i:03d}.png")
        (self.raw / "man" / "keep.txt").write_text("x")

    def tearDown(self):
        self.tmp.cleanup()

    def test_discovers_clips_and_ignores_other_files(self):
        c = pv.discover(self.raw)
        self.assertEqual(sorted(c), ["man/man_hand", "woman/woman_hand"])
        self.assertEqual([len(c[k]["files"]) for k in sorted(c)], [3, 2])
        self.assertEqual(c["man/man_hand"]["problems"], [])

    def test_gap_in_frame_numbers_is_a_problem(self):
        (self.raw / "man" / "man_hand001.png").unlink()
        self.assertTrue(pv.discover(self.raw)["man/man_hand"]["problems"])

    def test_png_size_and_color_type(self):
        png(self.raw / "rgb.png", w=7, h=5, ctype=2, fill=b"\x01\x02\x03")
        self.assertEqual(pv.png_size(self.raw / "rgb.png"), (7, 5, 2))
        self.assertEqual(pv.png_size(self.raw / "man" / "man_hand000.png"), (4, 2, 6))
        with self.assertRaises(ValueError):
            pv.png_size(self.raw / "man" / "keep.txt")

    def test_encode_command_matches_the_brief(self):
        d = Path("/in")
        full = pv.encode_cmd(d, "woman_hand", Path("/out/woman_hand.webm"), 34)
        s = " ".join(full)
        for part in ("-framerate 30", "-i /in/woman_hand%03d.png", "-c:v libvpx-vp9", "-pix_fmt yuva420p", "-b:v 0", "-crf 34", "-row-mt 1",
                     "-auto-alt-ref 0", "+bitexact", "-map_metadata -1"):
            self.assertIn(part, s)
        self.assertNotIn("scale", s)
        small = " ".join(pv.encode_cmd(d, "woman_hand", Path("/out/x_sm.webm"), 36, width=253))
        self.assertIn("scale=253:-2", small)
        self.assertIn("-crf 36", small)

    def test_poster_is_webp_with_alpha_kept(self):
        s = " ".join(pv.poster_cmd(Path("/in/x050.png"), Path("/out/x.webp")))
        self.assertIn("-c:v libwebp", s)
        self.assertIn("-quality 90", s)
        self.assertTrue(s.endswith("/out/x.webp"))

    def test_fingerprint_changes_with_content_and_is_stable(self):
        files = pv.discover(self.raw)["man/man_hand"]["files"]
        a = pv.fingerprint(files)
        self.assertEqual(a, pv.fingerprint(files))
        png(files[0], fill=b"\x99\x99\x99\x99")
        self.assertNotEqual(a, pv.fingerprint(files))

    def test_dry_run_needs_no_ffmpeg_and_writes_nothing(self):
        out = Path(self.tmp.name) / "out"
        self.assertEqual(pv.main(["--raw", str(self.raw), "--out", str(out), "--dry-run"]), 0)
        self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
