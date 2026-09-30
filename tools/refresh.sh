#!/bin/sh
# Re-bake the season model and publish it: ./tools/refresh.sh
set -e
cd "$(dirname "$0")/.."
node tools/snapshot.mjs
git add data
git diff --cached --quiet || git commit -qm "Refresh snapshot"
git push -q
