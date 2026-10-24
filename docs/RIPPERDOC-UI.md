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
| `tools/art.py` | the ripperdoc atlas parts (WolvenKit per-part exports) -> WebP in `~/work/cyber-art/out/ui/{man_body,woman_body,cw_bars_assets,background}` |
| `tools/atlas_cut.py` | any other atlas, cut from the full PNG + `inkatlas.json` -> `out/ui/<atlas>/<part>.webp` + `atlas-index.json` (item icons, shapes, common icons) |
| `tools/paperdoll_video.py` | frame sequences -> `out/paperdoll/{man,woman}/<clip>.webm`, `_sm.webm`, `.webp` poster |
| `tools/build.py` | copies only the files the layout references into `dist/live/img/ui` and `dist/live/media`, and writes `ui-art.json`; `dist/offline` gets an empty `ui-art.json` and no game art |

Regenerate after a game patch: `python3 tools/paperdoll_video.py`, `python3 tools/art.py`, `python3 tools/atlas_cut.py`, `python3 tools/cyberware_icons.py`, `python3 tools/ripperdoc_layout.py`, `python3 tools/ripperdoc_widgets.py`, `python3 tools/ripperdoc_spec.py`.

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

## Idle body motion: what the game data says, and our float
The woman's idle body does not float in the source: `female_body_loop.bk2` is near-static in RAD's player too. Investigation (all from the export, `tools/` readers):
1. `ripperdoc_animations.inkanim` has no looping translation/scale/rotation on the paperdoll or its parents. The only endless motion is `BG_animation`: three rotations of a widget it plays on (0 -> 360 / 720 / 1080 degrees in 18 s, linear): rotating rings. No widget in this export uses it (the rings and cables are in `cw_paperdoll_assets.inkatlas`, parts `circle_1..3`, `dots_bg`, `man_cables` / `woman_cables`, but no exported widget references them: they belong to a background item that is not in the export). `Paperdoll_default_tab_intro` is a one-off zoom 2 -> 1 and slide 550 -> 0 over 0.9 s. The animation data has no loop flags at all (loops are set by the script that plays a sequence, which is not in the data).
2. `ripperdoc.inkwidget`: `paperdoll_woman_body_video` and `paperdoll_man_body_video` are identical: `loop = 1`, 1080 x 1920, `fitToContent`, no attached animation, no playback range or speed property.
3. The man's loop does **not** bob either: measured on `male_body_loop` (150 frames, 30 fps = one 5 s period) the alpha centroid moves 0.84 px peak to peak vertically (0.18 px horizontally) in the 1080 x 1920 source, the head top and feet stay on the same row; the woman's clip moves 0.01 px. So the "float" Vivek saw in the game is not in either body video; the likely sources are the rotating background rings and the hologram shimmer inside the video.
Our approximations (not in the game data). The float is the only endless motion on the stage (a test checks that, and that it stays within 2 px, moves in small steps and never touches the zone zoom transform), so it cannot combine with anything else into jitter:
- **Rotating rings** (`BG_animation`) — **currently OFF** (`bgRings: false` in `data/ripperdoc/flags.json`): they read as the body wobbling and the in-game overview shows none. With the flag off the layer is not created and the ring art is not built or deployed; set it to true (and run `tools/atlas_cut.py --atlas cw_paperdoll_assets`) to bring them back once the parent widget is exported. What the code does when on: `circle_1..3` turn 360 / 720 / 1080 degrees in 18 s, linear, endless, behind the paperdoll, with `dots_bg` and the gender's cables (`man_cables` / `woman_cables`) from `cw_paperdoll_assets` (cut by `tools/atlas_cut.py`). **Guessed:** which ring turns how fast (we map them in file order 1, 2, 3 = 360, 720, 1080, all clockwise); the placement (no anchor in the export): rings centred horizontally on the body and 36 % down it (the chest), `dots_bg` centred on the body, the cables hanging from the head; sizes are the parts' natural size / 2; opacities .7-.9 (the art is already faint). They fade out while a zone is open. Calm, Off and reduced motion: static.
- **Woman float:** the woman's paperdoll layer (body, hover sprites) floats 2 px up and back with a 1.002 scale over 5 s (the loop length), eased, only while no zone is open; the man gets none. It is a single flag, `idleFloat` in `data/ripperdoc/flags.json` (on), and the amplitude is `--rd-float-y` / `--rd-float-s` on `.rd`. Calm, Off and reduced motion: none.

## Overview (the game's Cyberware screen)
Each zone has a label in the game's red caps with its slot tiles under it, the same tile component as the zone panel. Positions come from the spec's slot panel anchors (`layout.zones[].anchor`): the five left-side zones (frontal cortex, arms, skeleton, nervous system, integumentary) are right-aligned with their tiles growing to the left (slot 1 nearest the body, a locked tile leftmost); the five right-side zones (operating system, face, hands, circulatory, legs) grow to the right (a locked tile rightmost). The right edge of a left group is the anchor + 250 (at most x 800), the left edge of a right group is the anchor + 45: this keeps the tiles clear of the body and of the capacity meter. Empty = the game's small square socket mark (`atlas_common/socket_empty`), equipped = icon, rarity strip and the yellow upgrade corner (`cw_bars_assets/upgrade_corner`, top right), locked = ghosted body-part silhouette (the zone's own hover sprite) with the lock icon and the word. A click on a tile or the label opens the zone with that slot selected; hovering a group lights its body zone and the other way round.

Zone clips loop while the zone is open (Full). `tools/loop_points.py` finds the loop point per clip into `data/ripperdoc/loops.json`: all 20 zone clips loop whole (start frame 0, seam as smooth as the neighbouring frames except `man_integumentary`, `woman_arm` and `woman_hand`, which show a small step). Calm: once and hold. Off / Safari: poster.

## Zone panel (matches the in-game Cyberware screen)
One left column at the inventory origin (stage x 400, y 150; `layout.panel`), no box: header "< ZONE >" with arrows (cut-corner outline), one dash per body zone (current = cyan; arrows and dashes switch zones), the zone's slot tiles in a row (filled = icon, empty = socket plus, locked = lock + word, selected = cyan frames), a thin red divider, then a 4-column grid of compatible implants (the full 4 x 5 area is always drawn; "+" marks on empty cells; scrolls when there are more). Tiles are icon only: rarity = strip and frame colour plus a small letter, over capacity = hatch and a cross; the name, rarity, capacity cost, stats, #1/#2 diff and the quality / variant buttons are in the tooltip, which opens on hover or focus and pins on click or tap (Esc or a click elsewhere unpins; hovering another item replaces it). The body on the right is never covered by the panel.
Meters: capacity (left) and armor (right, cyan) use the same two-column bar construction; capacity has the body icon on top, the red max box at the limit line, the yellow used box and the "OVER BY n" text and marker; armor shows "\u2014" and "pending data" until the armor rules are decoded.

## Game widgets (second pass)
Slot tiles, picker tiles, capacity segments and the item tooltip are built from the game's own widgets and atlas parts (spec section 10):
- `tools/atlas_cut.py` cuts atlas parts from the full PNGs (`inkatlas.json` UVs x PNG size) into `~/work/cyber-art/out/ui/<atlas>/<part>.webp` plus `atlas-index.json`.
- `tools/cyberware_icons.py` maps each record's `iconPart` (or `iconName`) to a cut item icon: `data/ripperdoc/icons.json`. 1065 of 1065 records are covered; the 15 Operating System decks use the generic cyberdeck icon.
- `tools/ripperdoc_widgets.py` writes `data/ripperdoc/widgets.json` (tile, tooltip and segment numbers, and the part names they use). `tools/build.py` copies only those parts and the icons our data references.
- `src/styles/ripperdoc-widgets.css` draws the layers as masks of the game parts (`--p-<atlas>-<part>` custom properties set by `js/ripperdoc.js`); the offline build draws the same layers as plain cut-corner shapes.
- Not color alone: empty = plus shape, filled = marker shape + written name, locked = lock icon + the word, selected = frames, over capacity = hatch + marker + "OVER BY n" text + warning icon.

## What is approximated
- Capacity meter: no animated counter, no lock/glow box of the overcharge state, no hover areas. Segments are the `bar_long2` part; the highlight is `perk_highlight_nottransparent` at a size of our choosing.
- Tiles lack the game's `atlas_inventory` parts (not in the export): the hatch texture is a CSS gradient, the equipped corner marks and iconic texture are left out. Nine-slice margins are not in the data, so tile parts are stretched like the game's Fill setting.
- Tooltip colors are the widgets' default tints (`tooltip_style.inkstyle` is not exported); it is placed beside the hovered tile, not at the spec's Left/Right anchors, and has no equipped-item comparison.
- The capacity chip and the written item name are ours (the planner has to show names and costs on every tile).
- Video interpolators are replaced by "play once from 0, hold"; the LinearWipe sequences belong to list rows and popups and are not used here.
- The legacy Immune zone is left out (no slot group in our data).
- Hover sprites use `mix-blend-mode: screen`; the exact blend of the game is not in the data.

## Export wishlist (what is missing from the UI export)
Each item is approximated today (see "What is approximated"); exporting it would let us use the game's own art.
1. `fullscreen_elements.inkatlas` (+ PNG): the part `socket`, the empty cyberware socket mark. Now: `atlas_common/socket_empty` (a small rounded square).
2. `atlas_inventory.inkatlas` (+ PNG): `texture_1slot` (the slot's line texture), `texture_1slot_iconic`, `corners_equipped`, and `BLUEPRINT_*` / `illegal_tooltip_bottom` / `texture_iconic_tooltip2` if cheap. Now: a CSS hatch at the game's opacity; no corner marks.
3. **Locked-slot silhouettes** (skeleton, hand, the other parts): atlas unknown. Candidates to look for: a cyberware / ripperdoc atlas in `base/gameplay/gui/fullscreen/ripperdoc/` or `common/` that holds small per-zone icons (the locked slots on the overview show a body-part silhouette with a lock). Now: the zone's own hover sprite, ghosted.
4. **The parent widget of `BG_animation`**: the library item that holds the rotating rings (`circle_1..3`) with their real anchors, sizes and opacity. Likely in another `.inkwidget` of the ripperdoc / hub menu that is not in the export. Now: our guessed placement.
5. `tooltip_style.inkstyle` (`base/gameplay/gui/common/tooltip/`): the tooltip colors (`Tooltip.*`, `TooltipReq.*`, `TooltipStat.*`). Now: the widgets' default tints.
6. `hub_atlas.inkatlas`: `ico_cafting_crafting` (blueprint icon); low priority, only referenced by hidden widgets.
7. The icon atlas that holds the Operating System deck icon `militech_paraline` (the `iconName` of the 15 deck records; it is in no exported atlas). Now: the generic cyberdeck icon from `item_icons`.
