#!/bin/sh
# Cache-bust: stamp a new version onto every JS/CSS reference so phones load the new code
# right away instead of after GitHub Pages' 10-minute cache. Run before committing code changes.
cd "$(dirname "$0")/.."
V=$(date +%s)
for f in js/*.js; do sed -i '' -E "s#(\./[a-z0-9]+\.js)(\?v=[0-9]+)?'#\1?v=$V'#g" "$f"; done
for f in index.html classic.html; do sed -i '' -E "s#((js|css)/[a-z0-9]+\.(js|css))(\?v=[0-9]+)?\"#\1?v=$V\"#g" "$f"; done
echo "stamped v=$V"
