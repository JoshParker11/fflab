#!/bin/sh
# Download Sleeper weekly stats + week-of projections for past seasons (QB/RB/WR/TE) into data/hist/.
#   ./tools/fetch_history.sh 2023 2024 2025     then: python3 tools/backtest.py data/hist/
set -e
cd "$(dirname "$0")/.."; mkdir -p data/hist
Q="season_type=regular&position%5B%5D=QB&position%5B%5D=RB&position%5B%5D=WR&position%5B%5D=TE"
for y in "$@"; do for w in $(seq 1 17); do
  [ -s data/hist/s$y-$w.json ] || curl -s "https://api.sleeper.com/stats/nfl/$y/$w?$Q" -o data/hist/s$y-$w.json
  [ -s data/hist/p$y-$w.json ] || curl -s "https://api.sleeper.com/projections/nfl/$y/$w?$Q" -o data/hist/p$y-$w.json
done; done
