# FF Lab

Fantasy football control center for the Sleeper league *Sleepless in Seattle* (2026).
Live at https://joshparker11.github.io/fflab/

## Tabs
- **Command**: what to do now, this week's matchup and win probability, week-by-week odds, standings with simulated playoff/bye/title odds
- **Pulse**: what changed since the last refresh (injuries, projections, trending adds, line moves), betting lines, injury watch, news
- **Waivers**: free agents ranked by how much they add to *your* lineup, with a suggested FAAB bid and who to drop; K/DEF stream planner
- **Trade Lab**: build any trade and see lineup change by week, bye/title odds before → after, and veto risk
- **Opponents**: power rankings, positional strength, team cards
- **Roster**: usage, form, next 3 matchups, byes, rest-of-season value, market value
- **Lab**: reports from our conversations, plus the season simulator

## Data
`.github/workflows/refresh.yml` runs `node tools/snapshot.mjs` hourly (every 15 min during games), on every
push, and on demand (the **pull ↗** link → *Run workflow*). It deploys the site with fresh data; `data/` isn't committed.
Optional phone alerts: install the ntfy app, subscribe to a private topic name, and add it as the repo secret `NTFY_TOPIC`.

Sources: Sleeper API (league, projections, stats, trending), ESPN (odds, game state, news), FantasyCalc (trade values).

## Model (`js/model.js`, shared by the site and the CLI)
- Weekly expected points = that week's matchup-aware Sleeper projection × a recency-weighted **form** factor
  (last week counts 1, then 0.6, 0.36 …, shrunk toward the projection), with form fading for weeks further out.
- Injury status zeroes or discounts the current week; byes are zero; the current week banks points already scored.
- Lineup value = expected best lineup each remaining week with random injury draws (so depth matters);
  QB/K/DEF are streamable after next week; near weeks count more (×0.9 per week out).
- Season sim = 5,000 runs through the real schedule and playoff bracket.

## Analysis CLI (writes Markdown for `reports/`)
```bash
node tools/snapshot.mjs
node tools/analyze.mjs trade ThisIsRachel "DeVonta Smith" "Zay Flowers"
node tools/analyze.mjs waivers 12
node tools/analyze.mjs outlook
```

Strategy and design notes: [docs/STRATEGY.md](docs/STRATEGY.md), [docs/DESIGN.md](docs/DESIGN.md).
