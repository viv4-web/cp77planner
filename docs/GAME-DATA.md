# Game data

Target: Cyberpunk 2077 **2.5 + Phantom Liberty**, English strings. Raw game data never enters this repo; only normalized
planner data (names, numbers, rules, record numbers) is committed, in `data/`.

## Source route (cyberware)
WolvenKit cannot read item records in 2.5, so cyberware comes from a **CET dump mod**: `tools/cet/cp77dump/init.lua`
(it is our code, not game data). Run it in the CET console:

- `GetMod("cp77dump").dump()` writes the cyberware records (names, area, quality, icon, stats, onEquip).
- `GetMod("cp77dump").realcost()` writes the capacity cost of every cyberware item.

The outputs live outside the repo in `~/work/cyber-extract/2.5/` (see `SOURCE.txt` there: game 2.5, CET 1.38.0, dump mod v9,
24 Oct 2026, costs read on a level 2 prologue save with no perks). Then:

    python3 tools/import_cyberware.py --report incoming/import-report.txt     # writes data/cyberware.json
    python3 tools/import_cyberware.py --register                              # same, and registers new record numbers

The importer is deterministic. All mapping tables (EquipArea -> slot, quality order, flag stats, excluded debug records, slot
counts, capacity rules) are in `tools/cyberware-map.json`, not in code. Record numbers come only from `data/ids.json`
(`tools/ids.py`), keyed by TweakDB id (slots: `Slot.<Key>`); real records start at 1000, the SAMPLE range 700-739 is retired.

## Slots (character level 2)
| Slot | Usable | Locked | Source EquipArea |
|---|---|---|---|
| Frontal Cortex | 3 | 0 | FrontalCortexCW |
| Arms | 1 | 0 | none in the dump (no items yet) |
| Skeleton | 2 | 1 | MusculoskeletalSystemCW |
| Nervous System | 3 | 0 | NervousSystemCW |
| Integumentary | 3 | 0 | IntegumentarySystemCW |
| Operating System | 1 | 0 | SystemReplacementCW |
| Face | 1 | 0 | EyesCW |
| Hands | 1 | 1 | HandsCW |
| Circulatory | 3 | 0 | CardiovascularSystemCW |
| Legs | 1 | 0 | LegsCW |

Capacity at level 2: **27**.

## Capacity cost
- Cost is the stat **HumanityAllocated**, **per item instance**. It is not in the TweakDB record; it is read from the item data in
  game (`realcost()`), so it needs the CET dump.
- It is **not derived from quality**: the same quality spans costs 1-50. Each record carries its own `cost`.
- Items with no cost entry (legacy decks, tattoos, scrapped items) are left out of `data/cyberware.json` for now and listed in the
  import report; Vivek decides what happens to them.

## Data shape (`data/cyberware.json`)
- `groups`: slot groups (`id`, `name`, `slots`, `locked`).
- `implants`: one record per game item, i.e. per quality variant. `family` (`<slot>/<name>`, from the data) groups the variants of
  one item so the picker shows it once with a quality picker; `quality`, `tier` (order from the map table), `variant` (1, 2, ... when
  several records share name, slot and quality), `cost`, `stats` (`stat`, `op`, `value`), `flags` (flag-only stats: `Has*`,
  `IsItem*`, `AttunementHelper*`, not displayed), `icon` (the `iconPart` art key), `req` (null: no requirement data in the dump).
- Repeated stats (for example several Armor values) are listed as the dump has them, never summed: what each value means (for example
  attunement tiers) is not decoded yet.

## Still unknown (pending - needs CET probe)
- Capacity growth by level, attributes and perks: pending - needs CET probe. `rules.capacityBase` is the level-2 value and the UI marks
  capacity as provisional.
- Slot unlocks (the locked Skeleton and Hands slots): pending - needs CET probe.
- Overcap rule: pending - needs CET probe. The engine reads it from the data rule `rules.overcapFlag` (a perk flag), not from a
  perk id; no perk carries the flag until the perk data is real.
- Item requirements (attribute or perk gates): not in the dump yet.
