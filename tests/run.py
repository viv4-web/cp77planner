#!/usr/bin/env python3
"""Run every test with one command: python3 tests/run.py"""
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    rc = 0
    if shutil.which("node"):
        rc |= subprocess.call(["node", "--test", *sorted(str(p) for p in (ROOT / "tests").glob("*.test.mjs"))], cwd=ROOT)
    else:
        print("node not found: JS tests skipped", file=sys.stderr)
        rc |= 1
    rc |= subprocess.call([sys.executable, "-m", "unittest", "discover", "-s", str(ROOT / "tests"), "-p", "test_*.py", "-v"], cwd=ROOT)
    if (ROOT / "node_modules" / "playwright").is_dir():
        rc |= subprocess.call(["node", str(ROOT / "tests" / "smoke.mjs")], cwd=ROOT)
    else:
        print("playwright not installed (npm install; npx playwright install chromium): browser smoke tests skipped")
    return rc


if __name__ == "__main__":
    sys.exit(main())
