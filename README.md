# cp77planner

A build planner for Cyberpunk 2077 (game 2.5 + Phantom Liberty), live at
<https://buildplanner.net/cyberpunk-2077/>.

Static site: plain HTML, CSS and JS (ES modules). No framework, no backend, no analytics,
no third-party requests. Your whole build is encoded in the URL, so a link is the save file.

> **Status: v0.1 – site shell.** All perk/attribute data in `data/sample/` is clearly marked
> SAMPLE and exists only to exercise the layout. Real data will come from game-file exports.

## Develop

```sh
python3 tools/build.py          # writes dist/live and dist/offline
python3 -m http.server -d dist/offline 8000
python3 tests/run.py            # all tests (needs python3 and node >= 18)
```

- `dist/live` uses game art from `art/` when present, falling back to placeholders.
- `dist/offline` uses original placeholder glyphs only and contains no game art.

Both are built from the same source; only the art resolver map differs.
See `docs/STYLE.md` for the design spec and `docs/URL-FORMAT.md` for the build-link format
(which is append-only: every link ever shared must keep working).

## Paperdoll clips

The ripperdoc body animations (Bink 2) are converted on Windows (`tools/windows/`, see its README) and encoded to VP9+alpha WebM by
`tools/paperdoll_video.py` (needs ffmpeg with libvpx-vp9). Output stays in `~/work/cyber-art/out/paperdoll/`, never in the repo.

## Licence and credits

- Code: MIT, see `LICENSE`.
- Fonts (Chakra Petch, IBM Plex Sans, JetBrains Mono): SIL Open Font License 1.1, licences in `src/fonts/`.
- Cyberpunk 2077 game data and art are © CD PROJEKT RED. This is an unofficial fan project and is
  not affiliated with or endorsed by CD PROJEKT RED. Game art is never committed to this repository.
