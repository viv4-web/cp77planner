# Windows helpers

## convert_paperdoll.bat: ripperdoc paperdoll clips

The game's ripperdoc body animations are Bink 2 (`.bk2`) files with an alpha plane. ffmpeg cannot decode Bink 2, so they are
converted to PNG frames on a Windows PC with **RAD Video Tools** (free from RAD / Epic) and then encoded to WebM on the server by
`tools/paperdoll_video.py`.

> **The RAD Video Tools command line is unverified.** The one line in the .bat that calls `radvideo64.exe` is a guess, marked
> `<<< CHECK THIS LINE`. Run `convert_paperdoll.bat /probe` to print the tool's own help, fix that line, and test on one file first.
> If the installed version has no usable command line, export with the GUI (Convert a file -> PNG sequence, 32-bit with alpha, no
> audio, original size) into `...\raw\paperdoll\{man,woman}\` and let the .bat only do the copy.

### After a game patch
1. Extract the new `.bk2` files (WolvenKit) into `C:\Work\cyber-extract\cp77-data\source\archive\base\movies\misc\paperdoll`
   (or pass another folder as the first argument).
2. `convert_paperdoll.bat /clean`  (`/clean` removes the old frames on the server first, so a clip that got shorter does not keep stale
   frames; it needs `ssh` to `w3dev@hetzner-w3`, same as `scp`).
3. On the server: `python3 tools/paperdoll_video.py --dry-run` (lists every clip with its frame count and size; check for odd counts),
   then `python3 tools/paperdoll_video.py`. Unchanged clips are skipped; changed ones are re-encoded.
4. Output is `~/work/cyber-art/out/paperdoll/{man,woman}/<clip>.webm`, `<clip>_sm.webm`, `<clip>.png` and `manifest.json`.

Raw frames and encoded clips are game content: they stay in `~/work/cyber-art/` and are never committed.
