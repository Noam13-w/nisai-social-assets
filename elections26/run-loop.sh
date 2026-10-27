#!/usr/bin/env bash
# Runs on a server in Israel (the committee site refuses foreign servers).
# Every minute: refresh the code, check the committee's "נכון ל-" time, fetch and publish to gh-pages only on change.
# Layout: $ROOT/src = branch claude/project-thread-qg4lbt, $ROOT/site = branch gh-pages. Stops by itself after Nov 5 2026.
set -u
ROOT="${ROOT:-/opt/elections26}"
cd "$ROOT/site" || exit 1
git config user.name "elections26-bot"; git config user.email "elections26-bot@users.noreply.github.com"
last=0; i=0
while :; do
  if node -e "process.exit(Date.now() > Date.parse('2026-11-05T00:00:00+02:00') ? 0 : 1)"; then echo "past STOP_AFTER"; exit 0; fi
  if [ $(( i % 10 )) -eq 0 ]; then git -C "$ROOT/src" pull -q --ff-only || true; fi
  i=$(( i + 1 ))
  node "$ROOT/src/elections26/update.mjs" . || true
  cp "$ROOT/src/elections26/index.html" index.html; touch .nojekyll
  git add -A
  if ! git diff --cached --quiet && [ $(( $(date +%s) - last )) -ge 120 ]; then
    last=$(date +%s)
    git commit -q -m "Update results $(date -u +%H:%M)"
    git push -q origin gh-pages || { git pull -q --rebase origin gh-pages && git push -q origin gh-pages; } || true
  fi
  sleep 60
done
