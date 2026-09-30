# FF Lab — Control Center Design

A second screen next to the Sleeper app. Sleeper is where we *act*. FF Lab is where we *decide*.
One principle drives every screen: **show what changed and what to do about it; hide everything else.**

## Architecture (all free, no server)

```
             ┌──────────── GitHub Actions (cron) ────────────┐
             │ hourly:   Sleeper trending adds/drops, injuries│
             │ hourly:   odds (The Odds API, key in Secrets)  │
             │ 3×/day:   news RSS (Rotoworld/NBC, ESPN, team) │
             │ daily:    projections, usage (nflverse), sims  │
             │ → writes data/*.json, commits → Pages deploys  │
             │ → diff vs last run → push alert (ntfy.sh)      │
             └────────────────────────────────────────────────┘
                              │
 Browser (iPhone/desktop) ────┤  static site on GitHub Pages
   • live Sleeper calls (rosters, matchups: CORS-open, no key)
   • baked JSON from Actions (odds, news, sentiment deltas, sims)
   • reports/*.md written by Claude sessions in this repo
```

- **Static site** at `joshparker11.github.io/fflab/`. Plain HTML/JS modules and no build
  step, so it matches our other Pages projects.
- **Secrets stay server-side.** The odds API key lives in GitHub Actions secrets. Only the
  resulting JSON is published. (League data is already public through Sleeper.)
- **Alerts to your phone** through [ntfy.sh](https://ntfy.sh) (free app, private topic name).
  Actions push when a rule fires (see Alerts).

## Screens

### 1. Command (home) — "What do I need to do right now?"
- **Action queue** (top, ranked): e.g. *"Bid on Ollie Gordon — waivers run in 7h"*,
  *"Shrader still limited Fri — swap kicker before 9:30 AM ET London kickoff"*.
  Each card shows the evidence and a one-tap deep link into Sleeper.
- **This week's matchup:** our projection vs theirs, **win probability**, each lineup slot
  side by side, and a *lineup optimizer* diff (the "start X over Y" suggestion with its
  projected gain).
- **Lock clock:** the next kickoff with players in our lineup. Players still in play vs locked.
- **Standings strip:** record, PF, all-play, playoff %, bye %.

### 2. Pulse — "What changed since I last looked?"
A single feed sorted by *impact on our team*, combining:
- **Market moves:** player prop lines (rush/receiving yards, anytime TD) and team implied
  totals, with movement since open. Prop moves are the sharpest real-time injury/role signal.
- **Sentiment:** Sleeper trending adds/drops per hour (velocity, not totals), plus a
  news-mention spike score.
- **Injury status** transitions (Q→O, DNP→LP→FP in practice reports) and inactives.
- Filters: *My team · My opponent · Waiver targets · Everyone*.

### 3. Waivers — "Who should I add, and for how much?"
- Free agents ranked by an **Edge score** = rest-of-season value above our worst starter +
  opportunity trend (snap/route/target growth) + trending velocity.
- **Suggested FAAB bid** that accounts for this league's history (max bid, who has money,
  who needs the position).
- K/DEF **stream planner:** the next 3 weeks of matchups for every available unit.

### 4. Opponents — "Who is dangerous, and where are they weak?"
- Power rankings: projected lineup strength, all-play record, points-for luck.
- A card for each team: positional strength heatmap vs the league, injuries/byes,
  FAAB left, activity level (moves per week), and *needs* (auto-detected holes).
- **Schedule strength**: our remaining opponents' projected strength each week.

### 5. Trade Lab — "Is this trade good for *us*?"
- Build a trade (any partner). See the change in our **weekly projected lineup**, **playoff/bye
  odds**, and **weeks 15–17 strength**, for *both* teams.
- **Veto risk meter:** fairness measured against consensus trade values.
- **Partner finder:** pairs our surpluses with other teams' holes and suggests packages.

### 6. Lab (reports & simulations) — "Show me the analysis we discussed"
- Every analysis Claude produces lands here as a dated report with charts: trade
  breakdowns, sit/start calls, season sims, player deep dives.
- **Season simulator:** Monte Carlo of the rest of the season → playoff, bye, and title odds.
  Runs in the browser, so a hypothetical roster can be edited and re-run.

### 7. My Roster — "How is my team trending?"
- Every player as a row: weekly points sparkline, snaps %, target/opportunity share,
  xFP vs actual (luck flag), next 3 matchups, playoff-week matchups (weeks 15–17), bye.
- Colors only mark *changes* (a role rising or falling), not raw numbers.

## Alerts (push to phone)

Pushes are rare on purpose. Each one must be something we might act on:

| Trigger | Example |
|---|---|
| Injury status change for a player on our team, our opponent, or our waiver watchlist | "Waddle downgraded to Out — Boober WR thin" |
| Player prop / implied total moves ≥ threshold | "Chase Brown rush yds 62.5 → 71.5 (+9)" |
| Trending-add velocity spike for an unrostered player (≥3× hourly baseline) | "Kenyon Sadiq +400k adds/hr" |
| League activity from a rival | "sim1flowers added Braelon Allen ($24)" |
| Deadlines | "Waivers run in 2h", "Our first starter locks in 60m" |

## Working with Claude

The site is the shared whiteboard. The conversation happens in Claude Code sessions opened
in this repo:

1. Ask a question in chat: *"Should I trade Fannin + Godwin for tbwelch's McConkey?"*
2. Claude runs the repo's tools (`tools/pull.py`, `tools/sim.py`, `tools/trade.py`) against
   live data and writes `reports/2026-10-01-fannin-godwin-trade.md` plus JSON chart data.
3. Commit + push. The report appears in **Lab** on the phone within about a minute.
4. Decisions and outcomes are logged (`reports/decisions.json`), so we can score our own
   process over the season.

## Data sources

| Need | Source | Cost |
|---|---|---|
| League, rosters, matchups, transactions, trending adds/drops, projections, stats | Sleeper API (public) | free |
| Play-by-play, snaps, routes, target share, xFP-style usage | nflverse (nflreadr data releases) | free |
| Spreads, totals, player props, line movement | The Odds API (free tier ≈500 req/mo; props need a paid tier) | free / ~$30 |
| News | RSS from NBC/Rotoworld, ESPN, team beat feeds; r/fantasyfootball JSON | free |
| Consensus rankings / trade values | FantasyCalc public trade-value API | free |

## Build order

1. **v0.1 Command + Opponents** using live Sleeper data only (no Actions yet).
2. **v0.2 Waivers + Roster** with baked projections/usage (Action: daily).
3. **v0.3 Pulse + Alerts** (Action: hourly trending/odds/news, ntfy push).
4. **v0.4 Trade Lab + Season sim.**
5. **v0.5 Lab reports pipeline** (Claude writes reports; the site renders them).

Mobile-first. Dark theme default. One accent color for "act now", one for "good", one for
"bad". Nothing else gets a color.
