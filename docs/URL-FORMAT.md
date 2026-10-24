# Build link format

`?b=<version>.<base64url payload>` (plus `&tab=<tab>`; the tab is not part of the build).

**Append-only. Every link ever shared must keep working.** Never edit or remove an existing decoder in
`src/js/codec.js`; add a new version and keep the old one. `tests/codec.test.mjs` holds a golden link per version.

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
