#!/usr/bin/env bash
# Runs on a server in Israel (the committee site refuses foreign servers), as an unprivileged user.
# Every minute: check the committee's "נכון ל-" time; on change fetch the results and push data.json/status.json to gh-pages.
# It never pulls or runs new code: update.mjs is a fixed copy in $ROOT/app. Stops by itself after Nov 5 2026.
set -u
ROOT="${ROOT:-/opt/elections26}"
cd "$ROOT/site" || exit 1
last=0
while :; do
  if node -e "process.exit(Date.now() > Date.parse('2026-11-05T00:00:00+02:00') ? 0 : 1)"; then echo "past STOP_AFTER"; exit 0; fi
  node "$ROOT/app/update.mjs" . || true
  git add data.json status.json
  if ! git diff --cached --quiet && [ $(( $(date +%s) - last )) -ge 120 ]; then
    last=$(date +%s)
    git -c user.name=elections26-bot -c user.email=elections26-bot@users.noreply.github.com commit -q -m "Update results $(date -u +%H:%M)"
    git push -q origin gh-pages || { git pull -q --rebase origin gh-pages && git push -q origin gh-pages; } || true
  fi
  sleep 60
done
