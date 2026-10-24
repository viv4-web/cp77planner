#!/usr/bin/env bash
# tools/deploy.sh build | preview | live    (cp77planner only; never touches ~/work/deploy)
#   build    runs tools/build.py and records the git commit, time and content hash of dist/live in .deploy/
#   preview  publishes dist/live to PREVIEW (noindex). Shows an rsync dry run first.   flags: --dry-run (list only), --yes
#   live     publishes dist/live to buildplanner.net/cyberpunk-2077/. Refuses unless tools/approve.sh <commit> was run by
#            Vivek for this exact commit and dist. Always asks on the terminal; --yes is ignored.
# The remote paths are hard-coded on purpose. rsync --delete only ever runs inside those two exact folders.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(dirname "$HERE")"; STATE="$ROOT/.deploy"; DIST="$ROOT/dist/live"
SSH_HOST="hostinger"
REMOTE_ROOT="domains/buildplanner.net/public_html"      # relative to the account's home
LIVE_DIR="cyberpunk-2077"                               # https://buildplanner.net/cyberpunk-2077/
PREVIEW_DIR="preview-cyberpunk-2077"                    # https://buildplanner.net/preview-cyberpunk-2077/  (NOT under /preview/: W3's preview deploy deletes everything in there)
RSH=(ssh -o BatchMode=yes)

usage() { echo "usage: $0 build|preview|live [--dry-run] [--yes]" >&2; exit 2; }
mode="${1:-}"; shift || true
DRY=0; YES=0
for a in "$@"; do case "$a" in --dry-run) DRY=1;; --yes) YES=1;; *) usage;; esac; done
[ "$mode" = build ] || [ "$mode" = preview ] || [ "$mode" = live ] || usage

dist_hash() { (cd "$DIST" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1); }
head_commit() { git -C "$ROOT" rev-parse HEAD; }
tree_clean() { [ -z "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ]; }

if [ "$mode" = build ]; then
  python3 "$ROOT/tools/build.py"
  mkdir -p "$STATE"; head_commit > "$STATE/dist.commit"; date +%s > "$STATE/dist.built"; dist_hash > "$STATE/dist.sha256"
  tree_clean || echo "warning: uncommitted changes to tracked files; preview/live will refuse until you commit"
  echo "build recorded: commit $(cat "$STATE/dist.commit") dist $(cat "$STATE/dist.sha256")"
  exit 0
fi

# ---- checks common to preview and live ----
[ -f "$DIST/index.html" ] || { echo "dist/live is missing: run tools/deploy.sh build first" >&2; exit 1; }
HASH="$(dist_hash)"
[ "$HASH" = "$(cat "$STATE/dist.sha256" 2>/dev/null)" ] || { echo "REFUSED: dist/live changed since build (hash mismatch): run build again" >&2; exit 1; }
HEAD="$(head_commit)"
[ "$(cat "$STATE/dist.commit" 2>/dev/null)" = "$HEAD" ] || { echo "REFUSED: dist was built from $(cat "$STATE/dist.commit" 2>/dev/null || echo unknown), HEAD is $HEAD: run build again" >&2; exit 1; }
tree_clean || { echo "REFUSED: tracked files have uncommitted changes" >&2; exit 1; }

confirm() {
  if [ "$mode" = preview ] && [ "$YES" = 1 ]; then return 0; fi
  local a; read -r -p "$1 [y/N] " a < /dev/tty; [ "$a" = y ] || [ "$a" = Y ] || { echo "aborted, nothing changed"; exit 1; }
}

STAGE="$STATE/stage"; rm -rf "$STAGE"; mkdir -p "$STAGE"; cp -a "$DIST/." "$STAGE/"
# Headers: no third-party anything; everything is same-origin.
{
  cat <<'HT'
<IfModule mod_headers.c>
  Header always set X-Content-Type-Options "nosniff"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
  Header always set X-Frame-Options "DENY"
  Header always set Permissions-Policy "camera=(), microphone=(), geolocation=(), interest-cohort=()"
  Header always set Content-Security-Policy "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'"
  <FilesMatch "\.(html|js|css|json)$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
  <FilesMatch "\.(woff2|svg|png|webp|jpg)$">
    Header set Cache-Control "public, max-age=604800"
  </FilesMatch>
</IfModule>
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css text/javascript application/javascript application/json image/svg+xml
</IfModule>
HT
  if [ "$mode" = preview ]; then
    printf '\n# preview: never index\n<IfModule mod_headers.c>\n  Header set X-Robots-Tag "noindex, nofollow"\n</IfModule>\n'
  fi
} > "$STAGE/.htaccess"
[ "$mode" = preview ] && printf 'User-agent: *\nDisallow: /\n' > "$STAGE/robots.txt"

if [ "$mode" = preview ]; then
  SUB="$PREVIEW_DIR"
else
  APP="$STATE/APPROVED"
  [ -f "$APP" ] || { echo "REFUSED: .deploy/APPROVED does not exist. Live needs Vivek to run tools/approve.sh <commit>." >&2; exit 1; }
  read -r A_COMMIT A_HASH < "$APP" || true
  [ "$A_COMMIT" = "$HEAD" ] || { echo "REFUSED: APPROVED is for commit ${A_COMMIT:-?}, HEAD is $HEAD." >&2; exit 1; }
  [ "$A_HASH" = "$HASH" ] || { echo "REFUSED: APPROVED is for dist ${A_HASH:-?}, current dist is $HASH." >&2; exit 1; }
  [ "$(cat "$STATE/preview.sha256" 2>/dev/null)" = "$HASH" ] || { echo "REFUSED: this dist was not the one deployed to preview (run preview first)." >&2; exit 1; }
  SUB="$LIVE_DIR"
fi
# Only these two folders may ever be a rsync --delete target.
case "$SUB" in cyberpunk-2077|preview-cyberpunk-2077) ;; *) echo "internal error: bad target $SUB" >&2; exit 1;; esac
DEST="$SSH_HOST:$REMOTE_ROOT/$SUB/"
OPTS=(-rlt --delete --chmod=D755,F644)

echo "== $mode: commit $HEAD dist $HASH"
echo "== target: $DEST"
echo "== dry run (rsync -n), nothing is changed yet:"
rsync "${OPTS[@]}" -n -i --stats -e "${RSH[*]}" "$STAGE/" "$DEST" </dev/null | grep -v '^\.d\|^$' | sed -n '1,400p'
[ "$DRY" = 1 ] && { echo "dry run only"; exit 0; }
confirm "Run the real $mode deploy to $SUB/?"
rsync "${OPTS[@]}" -e "${RSH[*]}" "$STAGE/" "$DEST" </dev/null
if [ "$mode" = preview ]; then
  echo "$HASH" > "$STATE/preview.sha256"; echo "$HEAD" > "$STATE/preview.commit"
  echo "preview deployed: https://buildplanner.net/$PREVIEW_DIR/"
else
  rm -f "$STATE/APPROVED"; echo "live deployed: https://buildplanner.net/$LIVE_DIR/ (APPROVED used up)"
fi
