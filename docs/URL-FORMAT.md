# Build link format

`?b=<version>.<base64url payload>` (plus `&tab=<tab>`; the tab is not part of the build).

**Append-only. Every link ever shared must keep working.** Never edit or remove an existing decoder in
`src/js/codec.js`; add a new version and keep the old one. `tests/codec.test.mjs` holds a golden link per version.

## Versions
- **v1** (frozen): level, attributes, perks. Still decodes forever.
- **v2** (current, emitted by the app): the v1 payload followed by cyberware. v1 was strict about trailing bytes, so it could not be extended in place; v2 is the extension and v1 decoding is untouched.

## v1 payload (bytes, then base64url without padding)
1. `level` (1 byte)
2. `attrs`: 5 bytes, in the attribute order of the data file (Body, Reflexes, Technical, Intelligence, Cool)
3. perk count (varint)
4. perk record IDs, sorted ascending, delta-coded varints. The decoder rejects trailing bytes.

Perk IDs are each record's permanent numeric alias `n`. `n` lives ONLY in the append-only registry `data/ids.json`
(record name -> n); data files carry no `n`. `tools/build.py` injects it at build time and fails the build if any record has
no registry entry. New records get the registry's `next` value (`python3 tools/ids.py add NAME`). Never change, reuse or
renumber an `n`, even if the record disappears; `tests/test_ids.py` enforces this against git history. 1..999 is reserved for SAMPLE data.
Unknown IDs are dropped on load, and out-of-range values are clamped and rule-breaking perks skipped (`sanitize` in
`src/js/rules.js`), so old links degrade gracefully and never crash. Unknown versions or malformed links start a fresh build and show a notice.

## v2 payload
The v1 payload, then:
5. cyberware count (varint, at most 256)
6. per filled slot: group `n`, slot position (0-based), implant `n` (varints), sorted by (group n, position)

Group and implant ids come from the registry like every other record. Slot positions are per group; a group's slot count may only grow.
The decoder rejects trailing bytes. Entries that don't match the data (unknown group or implant, wrong group, bad position, duplicate slot)
are dropped on load; capacity and requirement conflicts are kept and flagged, never silently removed.

## Cyberware record numbers
The SAMPLE implants and slots (n 700-739) are retired: their numbers are never reused. Links made against them still decode; on load
those entries are dropped like any unknown id. Real slots and implants have n >= 1000 (`data/ids.json`). Each quality variant of an
item is its own record with its own n.
