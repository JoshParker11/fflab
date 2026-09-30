#!/bin/sh
# Cache-bust: stamp a new version onto every JS/CSS reference so phones load the new code
# right away instead of after GitHub Pages' 10-minute cache. Run before committing code changes.
cd "$(dirname "$0")/.."
V=$(date +%s)
sed -i '' -E "s#(\./[a-z]+\.js)(\?v=[0-9]+)?'#\1?v=$V'#g" js/app.js js/live.js
sed -i '' -E "s#(js/app\.js|css/app\.css)(\?v=[0-9]+)?\"#\1?v=$V\"#g" index.html
echo "stamped v=$V"
