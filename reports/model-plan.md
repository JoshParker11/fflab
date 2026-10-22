# FF Lab model: the plan

*Living document. The Model tab shows the current version's accuracy and lets you browse every prediction it would have made.*

## The question the model answers

**"After week k, how many points will player P score in week t?"** We ask it for every k (0–16) and every later t, so the same model gives start/sit (t = k+1), trade value (t = k+1 … 17) and playoff value (t = 16–17). Each answer comes with an error range measured on past seasons, not guessed.

## Ground rules
1. **No peeking.** Every input must have been knowable after week k. (The backtest caught two leaks we had to design around: week-of projections are only published the week of, and the "defense vs position" table has to be rebuilt as of each week.)
2. **Train / validate / test by season.** Train 2018–2023, tune on 2024, report on 2025. Then refit through 2025 and run 2026 *your league* completely out of sample.
3. **Beat the baselines or don't ship.** Every version is scored against (a) Sleeper's newest projection carried forward, and (b) the player's season average. It must beat both on average error and on "picked the right player" rate.
4. **Score in your league's settings** (full PPR, 4-pt pass TD, −1 INT).

## Inputs, by family
| Family | Inputs (v1 ✓ = in now) | Why |
|---|---|---|
| Market | ✓ Sleeper's newest projection, ✓ projection for that week when available, ✓ last season's ppg | Strong summary of everything public |
| Production | ✓ season ppg, ✓ recency-weighted ppg, ✓ last-3 ppg, ✓ games played | What actually happened, shrunk by sample size |
| Usage | ✓ opportunities/game, ✓ snap share, ✓ target share, ✓ air-yard share, ✓ WOPR, ✓ red-zone share | Volume predicts points with less noise (Research tab) |
| Matchup | ✓ week-t opponent's points allowed to the position so far, ✓ weeks ahead | Small but real for QBs; fades with distance |
| Next (v2) | Vegas implied team total, team pass rate and pace, routes/TPRR (nflverse), age, injury history | Vegas beat defense-vs-position at QB; usage depth |
| Later (v3) | Player-level random effects, teammate injuries (vacated targets), QB change flags | Role shocks are what the market is slowest on |

## Model form
- **v1:** gradient-boosted trees, one per position (scikit-learn). They handle missing data natively (rookies, week 0) and interactions like "high target share × good QB."
- **v2:** add **quantile models** (10th/50th/90th percentile) so every prediction carries its own range. Those ranges replace the fixed variance guesses in the season simulator.
- **v3:** an ensemble with a simpler shrinkage model (empirical Bayes ppg), and a calibration check that predicted 80% ranges contain the outcome 80% of the time.

## How it plugs into the site
1. **Weekly projections** for every rostered player and top free agent → Command, Waivers, Roster.
2. **Season sim** draws from each player's predicted *range* instead of a guessed spread → better win/bye/title odds, and a real "variance strategy" against BooberEats.
3. **Trade and scenario value** = change in expected lineup points with the model's numbers, plus the probability the trade wins you more title-week points (not just the average).
4. **Monitoring:** every week the model's 2026 predictions are scored against what happened (Model tab → 2026), so we see drift quickly.

## Experiments queue
1. Does recent form add anything beyond the market? (Research says barely, so test the trees' use of last-3.)
2. Vegas implied totals for the coming week (QB/DEF first).
3. Usage-only model vs points-only model (which generalizes better to role changes?).
4. Horizon-specific models vs one model with "weeks ahead" as an input.
5. Rookie handling: prior from draft capital and preseason ADP.
