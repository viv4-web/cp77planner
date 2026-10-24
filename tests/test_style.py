import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOKENS = (ROOT / "src/styles/tokens.css").read_text()


def token(name):
    return re.search(rf"--{name}:\s*(#[0-9A-Fa-f]{{6}})", TOKENS).group(1)


def lum(hex_):
    ch = [int(hex_[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    ch = [c / 12.92 if c <= .03928 else ((c + .055) / 1.055) ** 2.4 for c in ch]
    return .2126 * ch[0] + .7152 * ch[1] + .0722 * ch[2]


def ratio(a, b):
    hi, lo = sorted((lum(a), lum(b)), reverse=True)
    return (hi + .05) / (lo + .05)


def over(fg, alpha, bg):
    f = [int(fg[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(bg[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(x * alpha + y * (1 - alpha)):02x}" for x, y in zip(f, b))


class ContrastTests(unittest.TestCase):
    def test_disabled_text_contrast(self):
        text = token("dis-text")
        panel = over("#101438", .62, token("bg"))      # glass panel colour over the page background
        for bg in (token("dis-fill"), panel):
            self.assertGreaterEqual(ratio(text, bg), 4.5, f"{text} on {bg}")


class ChipContrastTests(unittest.TestCase):
    def test_req_chip_colours(self):
        css = (ROOT / "src/styles/components.css").read_text()
        fill = re.search(r"\.meta span\{[^}]*--fill:(#[0-9A-Fa-f]{6})", css).group(1)
        panel = over("#101438", .62, token("bg"))
        for name in ("yellow", "cyan"):          # REQ not met (yellow) / met (cyan)
            for bg in (fill, panel):
                self.assertGreaterEqual(ratio(token(name), bg), 4.5, f"{name} on {bg}")


if __name__ == "__main__":
    unittest.main()
