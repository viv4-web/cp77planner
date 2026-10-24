# Ripperdoc-style Cyberware screen

The Cyberware tab is a replica of the game's ripperdoc screen, built from `docs/RIPPERDOC-SPEC.md` and `docs/RIPPERDOC-ANIMATIONS.md`.
It is a UI layer only: the engine (`src/js/cyber.js`), the data, the URL format and their tests are unchanged.

## Files
| File | Role |
|---|---|
| `src/js/ripperdoc.js` | the screen (stage, doll, zones, slot panel, picker, capacity meter, tooltip) |
| `src/styles/ripperdoc.css` | its styles; fonts Rajdhani (OFL) and Share Tech Mono (OFL), self-hosted in `src/fonts/` |
| `src/styles/ripperdoc-tokens.css` | generated: the game's style tokens as `--t-*` custom properties (HDR colors clamped, excess as `--t-*-glow`) |
| `data/ripperdoc/layout.json` | generated: positions on the 1920x1080 stage, zone zoom/fade timings, hover sprite and clip rects |
| `tools/ripperdoc_layout.py` | generates the two files above from the UI export (`~/work/cyber-art/raw/ui`, read only) |
| `tools/art.py` | atlas parts -> WebP in `~/work/cyber-art/out/ui/` (the only writer of that folder) |
| `tools/paperdoll_video.py` | frame sequences -> `out/paperdoll/{man,woman}/<clip>.webm`, `_sm.webm`, `.webp` poster |
| `tools/build.py` | copies only the files the layout references into `dist/live/img/ui` and `dist/live/media`, and writes `ui-art.json`; `dist/offline` gets an empty `ui-art.json` and no game art |

Regenerate after a game patch: `python3 tools/paperdoll_video.py`, `python3 tools/art.py`, `python3 tools/ripperdoc_layout.py`, `python3 tools/ripperdoc_spec.py`.

## Behaviour (ours; the controller scripts are not in the data)
- **Stage.** 1920x1080, scaled to fit the window (letterbox). Below 900 px wide the older stacked layout is shown instead (`.cw-legacy`).
- **Idle.** The body loop (woman default, Man/Woman switch, remembered) plays; zone tags sit at the spec's slot-panel anchors.
- **Hover.** Moving over a body zone (hit test on the hover sprite's alpha) or its tag fades the sprite in (0.233 s linear).
- **Select.** The zone sequence: the body zooms toward the zone while fading out, the zone clip window scales in and plays once from 0 and holds its last frame; timings, easing and numbers come from the sequences. The zone's slot panel opens at its anchor. Back / Esc runs the outro (0.533 s) and stops the clip.
- **Slots.** Counts from our data at level 2, locked slots drawn locked, Arms marked pending data. Clicking a slot opens the implant picker (the spec's inventory grid: 4 columns of 112x101 cells, filter bar with arrows, ten zone dots, divider) on the side of the panel that is free. One cell per item, quality pips under it, click equips; Remove clears the slot.
- **Capacity.** Left meter, 13.5 px segments from the bottom, NewMeter tokens: lit = used, green/red preview of the hovered pick, red over max. Values from the engine; max 27 is provisional (labelled). Armor stays hidden until armor stats are decoded.
- **Tooltip.** Name, quality color (Rarity tokens), capacity row, stats, the #1/#2 difference, over-capacity warning.

## Motion and media
- **Full:** game durations, delays and easing (ink curves mapped to cubic-beziers); body loop loops.
- **Calm:** durations and delays x0.5, the body loop plays once.
- **Off** (also `prefers-reduced-motion`): no transitions, WebP posters instead of video, the final state of a zone is applied at once.
- Safari gets posters only (it ignores WebM alpha); widths up to 1100 px or Save-Data get the `_sm.webm` clips.
- Without art (offline build or no `out/` folder) the screen uses a silhouette placeholder and the glyph icons; everything still works.

## What is approximated
- Capacity meter: CSS bars instead of the atlas bar images (`bar_long2`), no animated counter, no lock/glow box of the overcharge state, no hover areas.
- Slot cell and picker cell are simplified `itemDisplay` / `inventoryItem` (rarity strip, cost badge, name, placeholder icon: item icons are not exported yet).
- Tooltip is placed beside the hovered cell, not at the spec's Left/Right anchors, and has no equipped-item comparison.
- Video interpolators are replaced by "play once from 0, hold"; the LinearWipe sequences belong to list rows and popups and are not used here.
- The legacy Immune zone is left out (no slot group in our data).
- Hover sprites use `mix-blend-mode: screen`; the exact blend of the game is not in the data.
