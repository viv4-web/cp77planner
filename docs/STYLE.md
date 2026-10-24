# STYLE: Utopian 2077 neon with chrome accents (mockup v4)

Tokens live in `src/styles/tokens.css`. Do not hard-code colours elsewhere.

## Colour
| Token | Value | Use |
|---|---|---|
| `--bg` | `#070A1C` | page background |
| `--panel` | `rgba(16,20,58,.62)` | glass panel fill, with `backdrop-filter: blur(14px)` |
| `--panel-border` | `rgba(160,175,230,.24)` | glass panel border |
| `--text` / `--muted` / `--dim` / `--line` | `#EEF0FF` / `#B4B9E8` / `#8C90CC` / `#2A2E66` | text levels, dividers |
| `--yellow` | `#FFE14A` | signal: primary buttons, section labels `01 // NAME`, corner brackets, available-perk ring |
| `--cyan` / `--magenta` | `#4DF3FF` / `#FF4FD8` | accents, circuit pulses, NEW badge, glitch split |
| attribute colours | Body `#FF6B95`, Reflexes `#FF9F43`, Technical `#9DFF6A`, Intelligence `#4DF3FF`, Cool `#B596FF` | `--c-body` etc. The Relic tree uses signal yellow |
| `--chrome` | `linear-gradient(115deg,#5D6488,#F5F8FF,#7F88B0,#DDF6FF,#5D6488,#FFFFFF,#7F88B0)` | chrome text, chrome edges, socket hexagon |

## Shape
- Panels: cut corners (clip-path polygon, top-left and bottom-right), **20px**. Buttons: **12px**.
- Plain glass panels: border via a masked `::after` plus a hairline on each diagonal.
- Anything with a real outline (ghost buttons, perk nodes, the selected attribute card) uses the one shared `.cutline` utility: the element is clipped to the cut polygon and its background is the outline paint (solid or animated chrome); `::before` is the opaque fill, inset by the 1.5px stroke and clipped to the same polygon with each cut reduced by stroke × 0.586, so the outline is unbroken along the diagonals. Text sits above `::before`. Primary and ghost buttons share the same height and cut size.
- The selected attribute card gets **yellow HUD corner brackets** (`.brk`).
- Perk nodes are octagons; selected node has a cyan outline.

## Type
- **Chakra Petch** (500/600/700): headings, tabs, buttons. Uppercase, letter-spacing 0.06–0.1em.
- **IBM Plex Sans** (400/500/600): body text.
- **JetBrains Mono** (500): numbers, IDs, labels.
- Self-hosted woff2 in `src/fonts/` (SIL OFL, licences alongside). Never load Google Fonts.

## Background
Soft yellow-magenta radial "sun" at the top, a perspective neon grid floor at the bottom (masked fade), a few slow light motes.
**No scrolling tape stripes and no ticker anywhere.**

## Motion
CSS only. Animate `transform`, `opacity`, `background-position` (plus `stroke-dashoffset` on circuit traces, and a one-shot `filter: blur` clearing on the boot reveal). Easing `cubic-bezier(.2,.8,.2,1)`. Nothing may block input or delay content.

| Effect | Spec |
|---|---|
| boot | panels and cards rise 18px with blur clearing, 750ms, staggered 70ms |
| grid floor | 2.4s loop; sun breathe 9s; motes 12–20s |
| chrome text | gradient sweep 7s on big headings, perk tree attribute name, detail perk name |
| chrome edge | animated chrome border 5–8s on the selected attribute card, owned perks, ghost buttons |
| hover | cards lift 4px + chrome glint sweep; perk nodes lift 3px; buttons lift 2px; tabs: 320ms underline grow + short RGB-split glitch |
| available perk | yellow ping ring every 2s |
| install perk | silver-cyan plating sweep down the node (0.9s) + flash, then chrome-owned |
| circuit traces | light pulses (stroke-dashoffset) in the perk panel corner and into the detail panel's implant socket |
| implant socket | chrome hexagon, two counter-rotating rings (20s / 12s), scan line over the icon |

### Motion setting
`Full / Calm / Off` in the top bar, stored in `localStorage` (`cp77.motion`, always in try/catch), applied as `html[data-motion]`.
- **Calm**: no motes, no shine, pulses and grid at half speed (`--speed: 2`).
- **Off**: no animation or transitions.
- `prefers-reduced-motion: reduce` defaults to **Off** when the visitor has not chosen.

## Layout and responsive
- Top bar: logo text `buildplanner.net / CP77`, tabs (Character default, Cyberware, Inventory, Journal, Database), `GAME 2.5 · PL` chip, Player stats, yellow global "Copy build link".
- Open tab is kept in the URL (`?tab=`; Character is the default and omitted).
- Below **720px**: tabs become a bottom bar, the attribute rail scrolls horizontally with scroll-snap, perk tiers stack into one column, touch targets are at least 44px. No horizontal page scroll at 360px.
- Section labels: `01 // CHARACTER`, `02 // PERK TREE`, `03 // IMPLANT SOCKET`.

## Data and art
- All placeholder content is marked SAMPLE. Do not invent game facts in code or docs.
- Game art is resolved by record ID only (`src/js/art.js`); the offline build maps nothing and shows original placeholder glyphs from `src/img/placeholder/`.

## Cyberware screen
- Three panels: `02 // SLOTS` (sockets grouped by body area, count `x/y` per group, placeholder silhouette behind), `03 // IMPLANTS` (picker for the selected socket), `04 // LOADOUT` (capacity, armor, flags, granted effects).
- Sockets, implant rows and chips use `.cutline`. Socket states: empty (dim outline), filled (chrome), flagged (yellow outline). Selection is the same extra layer as perk nodes (`.nbox`: cyan glow + yellow brackets) and never replaces the state outline.
- Capacity bar: signal yellow, cyan when exactly full, striped yellow when over (overcap). No red anywhere.
- Requirements use the REQ chip: yellow + lock when unmet, cyan + check when met. Unmet implants can be picked; they are flagged in the summary.
- Disabled implant rows (over capacity) use the dashed `.cutline` variant and show the reason.
- Below 720px: slot groups stack, the picker becomes a full-width sheet (Close button), and a compact capacity/armor bar is pinned above the bottom tabs.
- Motion: the capacity bar rides a `transform` transition; a filled socket pops its icon in. Both stop under Off.
