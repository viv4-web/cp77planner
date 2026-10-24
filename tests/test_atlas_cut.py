"""atlas_cut.py with a synthetic atlas (no game data): UV -> pixel rectangles, part discovery, WebP output, re-run skips, determinism."""
import hashlib
import json
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import atlas_cut as ac  # noqa: E402


def png(path: Path, w, h):
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
    rows = b"".join(b"\x00" + b"".join(bytes((x * 4 % 256, y * 8 % 256, 90, 255)) for x in range(w)) for y in range(h))
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


def part(name, l, t, r, b):
    return {"partName": {"$value": name}, "clippingRectInUVCoords": {"Left": l, "Top": t, "Right": r, "Bottom": b}}


def atlas_json(parts):
    return {"Data": {"RootChunk": {"slots": {"Elements": [{"parts": parts}]}, "parts": []}}}


class AtlasCutTests(unittest.TestCase):
    def test_pixel_rect_rounds_uv_and_clamps(self):
        self.assertEqual(ac.pixel_rect((0.25, 0.5, 0.5, 1.0), 64, 32), (16, 16, 16, 16))
        self.assertEqual(ac.pixel_rect((-0.1, 0, 1.2, 0.5), 64, 32), (0, 0, 64, 16))

    def test_parts_of_reads_slots_and_single_mode_parts(self):
        d = atlas_json([part("a", 0, 0, .5, .5)])
        d["Data"]["RootChunk"]["parts"] = [part("b", .5, .5, 1, 1)]
        self.assertEqual([p[0] for p in ac.parts_of(d)], ["a", "b"])

    def test_cut_writes_webp_per_part_index_and_is_rerunnable(self):
        if not shutil.which("ffmpeg") and not (Path.home() / "bin" / "ffmpeg").exists():
            self.skipTest("ffmpeg not installed")
        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            gui = t / "raw" / ac.GUI / "common" / "icons"
            gui.mkdir(parents=True)
            png(gui / "toy.png", 64, 32)
            (gui / "toy.inkatlas.json").write_text(json.dumps(atlas_json([part("left", 0, 0, .5, 1), part("right", .5, 0, 1, 1), part("left", 0, 0, .1, .1)])))
            out = t / "out"
            self.assertEqual(ac.main(["--raw", str(t / "raw"), "--out", str(out), "--atlas", "toy"]), 0)
            idx = json.loads((out / "atlas-index.json").read_text())["atlases"]["toy"]
            self.assertEqual(sorted(idx["parts"]), ["left", "right"], "duplicate part names: first wins")
            self.assertEqual((idx["parts"]["left"]["w"], idx["parts"]["left"]["h"]), (32, 32))
            head = (out / "toy" / "left.webp").read_bytes()[:12]
            self.assertEqual((head[:4], head[8:12]), (b"RIFF", b"WEBP"))
            first = hashlib.sha256((out / "toy" / "right.webp").read_bytes()).hexdigest()
            (out / "toy" / "right.webp").unlink()                       # a missing file is re-cut, byte-identical
            ac.main(["--raw", str(t / "raw"), "--out", str(out), "--atlas", "toy"])
            self.assertEqual(hashlib.sha256((out / "toy" / "right.webp").read_bytes()).hexdigest(), first)
            probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", str(out / "toy" / "left.webp")],
                                   capture_output=True, text=True, env={"PATH": f"{Path.home() / 'bin'}:/usr/bin:/bin"})
            self.assertEqual(probe.stdout.strip(), "32,32")

    def test_low_disk_stops(self):
        from unittest import mock
        with tempfile.TemporaryDirectory() as t:
            gui = Path(t) / "raw" / ac.GUI
            gui.mkdir(parents=True)
            with mock.patch.object(shutil, "disk_usage", return_value=shutil._ntuple_diskusage(100, 99, 3 * 2**30)):
                with self.assertRaises(SystemExit) as cm:
                    ac.main(["--raw", str(Path(t) / "raw"), "--out", str(Path(t) / "out")])
                self.assertIn("20 GB", str(cm.exception))


if __name__ == "__main__":
    unittest.main()
