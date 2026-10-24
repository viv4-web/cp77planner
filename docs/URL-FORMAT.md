# Build link format

`?b=<version>.<base64url payload>` (plus `&tab=<tab>`; the tab is not part of the build).

**Append-only. Every link ever shared must keep working.** Never edit or remove an existing decoder in
`src/js/codec.js`; add a new version and keep the old one. `tests/codec.test.mjs` holds a golden link per version.

## v1 payload (bytes, then base64url without padding)
1. `level` (1 byte)
2. `attrs`: 5 bytes, in the attribute order of the data file (Body, Reflexes, Technical, Intelligence, Cool)
3. perk count (varint)
4. perk record IDs, sorted ascending, delta-coded varints. The decoder rejects trailing bytes.

Perk IDs are each record's permanent numeric alias `n` from the data files (the numeric form of its record ID).
`n` values are never reused or renumbered. Unknown IDs are dropped on load, and out-of-range values are clamped and
rule-breaking perks skipped (`sanitize` in `src/js/rules.js`), so old links degrade gracefully and never crash.
Unknown versions or malformed links start a fresh build and show a notice.

Note: `n` values in `data/sample/` are SAMPLE only. The real numbering must be settled before the first public link is shared.
