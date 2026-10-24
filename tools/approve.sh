#!/usr/bin/env bash
# tools/approve.sh <commit>  -- the ONLY way .deploy/APPROVED is written. VIVEK RUNS THIS, never Claude.
# Run it only after you have reviewed the preview yourself. It checks, then writes APPROVED; it does not deploy.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(dirname "$HERE")"; STATE="$ROOT/.deploy"
want="${1:-}"; [ -n "$want" ] || { echo "usage: $0 <commit>" >&2; exit 2; }
full="$(git -C "$ROOT" rev-parse --verify --quiet "$want^{commit}")" || { echo "REFUSED: $want is not a commit here" >&2; exit 1; }
main="$(git -C "$ROOT" rev-parse refs/heads/main)"
[ "$full" = "$main" ] || { echo "REFUSED: $want is not HEAD of main ($main)" >&2; exit 1; }
[ "$(git -C "$ROOT" rev-parse HEAD)" = "$main" ] && [ -z "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ] \
  || { echo "REFUSED: check out a clean main first" >&2; exit 1; }
[ -f "$STATE/preview.sha256" ] || { echo "REFUSED: nothing has been deployed to preview" >&2; exit 1; }
"$HERE/deploy.sh" build >/dev/null                 # rebuild from that commit (deterministic)
hash="$(cat "$STATE/dist.sha256")"
[ "$hash" = "$(cat "$STATE/preview.sha256")" ] || { echo "REFUSED: dist from $full is $hash, the preview was $(cat "$STATE/preview.sha256"). Deploy preview from this commit and review it first." >&2; exit 1; }
printf '%s %s\n' "$full" "$hash" > "$STATE/APPROVED"
echo "APPROVED written: commit $full, dist $hash. Now: tools/deploy.sh live"
