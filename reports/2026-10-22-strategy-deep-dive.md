# Strategy deep dive: talent vs schedule, the QB call, beating BooberEats

*Thursday 10/22. Includes a backtest of 2023–2025 in this league's scoring (17,953 player-games) and a model update based on it.*

> **Bottom line**
> 1. **Bet on players, not playoff schedules.** From Week 7, a player's own scoring predicted Weeks 15–17 far better than how soft his opponents looked early. For RB/WR/TE the schedule signal was essentially zero.
> 2. **QB: close Maye for Dak + Keenan Allen.** It's the cheapest route to the same title odds as Lawrence or Josh Allen (≈39% vs 34% today), and it keeps Bucky, Strange and Flowers.
> 3. **BooberEats beats you at RB, not anywhere else.** The QB upgrade plus one RB upgrade (Hubbard is the best fit) takes you from 34% to **41%** and pulls Boober from 39% down to 36%.
> 4. **Keep LaPorta.** Selling him for Likely is a wash. Give Chase Brown his one more week.

## 1 · Does schedule matter? The backtest

| From Week 7, predicting Weeks 15–17 | QB | RB | WR | TE |
|---|---|---|---|---|
| Player's Weeks 1–7 scoring (correlation) | **0.35** | **0.54** | **0.56** | **0.54** |
| Opponent "softness" measured in Weeks 1–7 | 0.17 | 0.00 | 0.02 | −0.01 |
| Defense softness early vs late (stability) | 0.18 | −0.04 | 0.12 | 0.06 |
| Player scoring early vs late (stability) | 0.46 | 0.51 | 0.53 | **0.27** |
| *Week-of projection explains this share of one week* | 10% | 22% | 19% | 12% |

**What it means**
- Months out, playoff schedules are mostly noise. Defenses that look soft in October usually aren't in December. The only partial exception is QB: a clearly softer opponent is worth about +1.4 points.
- Talent and role persist. TE scoring is the least stable, so don't pay a premium for TE "upside."
- Any single week is mostly luck. Even same-week projections miss by 5–6 points on average. Beating Boober once tells you little.
- **Model change:** the projections behind every tab now keep the full matchup only for this week and next. After that, the matchup effect fades toward the player's own average (QBs keep ~30%, everyone else ~10%). Reproduce with `./tools/fetch_history.sh 2023 2024 2025 && python3 tools/backtest.py data/hist/`.

So the videos are half right: playoff schedule is a fine **tiebreaker between similar players**, especially at QB, but it shouldn't drive trades in October.

## 2 · The QB decision (re-run with the corrected model)

| Move | Your title odds | BooberEats title | What it costs you |
|---|---|---|---|
| Stand pat | 34.3% | 39.4% | – |
| **Dak + Keenan Allen → Maye** (tbwelch) | **39.0%** | 37.3% | Nothing you start |
| Bucky + Dak → Josh Allen (sim1flowers) | 39.3% | 36.6% | Bucky |
| Bucky → Lawrence (Jjenness) | 38.3% | 37.8% | Bucky |
| Bucky + LaPorta → Lawrence + Golden | 39.6% | 37.0% | Bucky + LaPorta |
| Maye *and* Lawrence | 38.4% | 38.1% | Overkill: one QB is enough |

- Experts agree with your lean. Footballguys has Maye at **QB2** for the rest of the season and Lawrence at QB11. Rotowire has Maye at QB1 this week. Maye's rushing (30+ yards a game) gives him the highest weekly floor of the three.
- The three QBs land within a point of each other, inside simulation noise. **Cost decides it**, and Dak + Keenan Allen is the cheapest. tbwelch asked for Flowers; counter with Dak + Keenan Allen, and add Strange or Cooper only if needed.
- **Josh Allen** is the best player and the backup plan. Getting him also keeps him away from Boober.

## 3 · The Jjenness deal: would you be creating a monster?

No. Jjenness is 2-4 with a ~46% playoff chance and a 2.3% title chance. Even after receiving Bucky (and LaPorta in the bigger version), their title odds *fall* (to 1.4–1.6%), because they'd be giving up their QB. Their WR room is strong, but fixing their RB spot doesn't make them a contender. If you go that route, the Golden piece adds Packers exposure: Watson and Golden share a Week 11 bye, and that week you play katiek626, a bye-race rival.

## 4 · How to beat BooberEats

Projected title-week lineups (Weeks 16 / 17): **you 148 / 149, Boober 154 / 155**, a ~44% win chance for you.

| Slot | You | Boober | Edge |
|---|---|---|---|
| QB | Dak 17 | Caleb Williams 19 | −2 |
| **RB / RB** | **Javonte 18, Brown 15** | **Gibbs 27, Walker 23** | **−17** |
| WR / WR | Flowers 19, St. Brown 18–19 | Tate 14, Waddle 12 | **+11** |
| TE | LaPorta 14 | McBride 16 | −2 |
| FLEX ×2 | Watson 17, Irving 14 | Warren 16, Jacobs 13 | +2 |
| K / DEF | Shrader 9, Vikings 8 | Zvada 7, stream 7 | +3 |

**The plan against them**
1. **Stay the #1 seed (80% now).** Boober is most likely #2, so as #1 you meet them only in the final, not the semifinal. Don't make trades that put the bye at risk. Every move here keeps it at 97–99%.
2. **Attack the RB gap.** That's where they beat you. QB + RB together: Dak + K. Allen → Maye **and** Chase Brown → Hubbard gets you **41.0%**, with Boober down to 36.4%. Hubbard is averaging 19.6 a game on 20–28 carries, so the "buy high" chatter is justified by volume. Decide on Brown after this week, as you planned.
3. **Deny their upgrades.** Their weak spots are QB (Caleb/Kyler) and WR. Don't trade them QB or WR help. Acquiring Maye or Josh Allen also takes those QBs off their list.
4. **In the actual game, play for ceiling.** As a slight underdog, prefer high-ceiling options: a QB with rushing, WRs with big air yards, and a QB/WR stack if you have one. Pick K/DEF from Vegas lines that week, when it's real information (worth 2–4 points).

## 5 · The other ideas

| Idea | Verdict | Why |
|---|---|---|
| Sell LaPorta → Likely | **Hold** | 34.3% → 34.4%. Likely is hot (11–13 targets), but TE scoring is the least stable position. No gain. |
| Malik Nabers | Maybe later | +1.6 to +2 points of title odds for Bucky/Brown packages. Good, but behind QB and RB. |
| Chuba Hubbard | **Yes, as the RB upgrade** | See above. Easiest from tbwelch, who is already talking to you. |
| Luther Burden | Pass | 0.0 change. ~13–14 a week and not better than your WRs. |
| Jeremiyah Love (commissioner) | Pass | ~8 a week, ankle issue, and the most experienced manager. |
| Higbee | Pass | Agree with you. |
| Vikings DEF | Keep | Fine, but don't trust "best playoff schedule" from October. Swap in the week if Vegas says so. |
| Jaguars playoff matchups | Tiebreaker only | Matchups this far out are mostly noise (section 1). |
| Chase Brown | One more week | If the split continues, he's your best trade chip for the RB upgrade. |

## 6 · How to stop feeling lost

**Things you can't predict** (one game, a December matchup, a single week's luck): don't optimize for them.
**Things that persist** (talent, volume, health, role): buy those.

A simple routine:
- **Every week:** set the lineup, check injuries and role changes, and stream K/DEF from Vegas.
- **Every two weeks until the Week 11 deadline:** open the Playoffs tab, run the title-move finder, and act only on moves that clearly improve Weeks 16–17 *and* keep the bye above 90%.
- **After the deadline:** depth. Hold a backup at RB and QB for December injuries.

You're 97–99% for the bye in every scenario above. You can afford to trade regular-season points for title odds. What you can't afford is losing depth.

## 7 · The 10-year study: plan

**Data**
| Source | What | Years |
|---|---|---|
| Sleeper API (`tools/fetch_history.sh`) | Weekly stats (all), week-of projections | stats 2015+, projections **2018+** |
| nflverse (`nflreadr` releases, CSV) | Play-by-play, weekly player stats, snap counts, rosters, **historical spreads and totals** | 1999+ (snaps 2012+) |
| Next Gen Stats / FTN charting (via nflverse) | Routes, separation, air yards, target quality | 2016+ / 2022+ |
| FantasyPros ECR archives (optional) | Expert consensus to compare against | varies |

**Questions and metrics** (each evaluated "as of week k," using only information available then)
1. **Matchup half-life:** how fast does matchup signal decay with weeks ahead, per position? Compare DvP against Vegas implied team totals.
2. **Projection calibration:** bias by position, projection tier and season phase. Does Sleeper systematically miss breakouts and fade-outs?
3. **Which usage stats stabilize fastest** (snap %, route %, target share, carry share, red-zone share), and which best predict future points?
4. **TD-luck regression:** do points above expected (xFP) predict a decline, and how fast?
5. **Late-season effects:** rookie second-half growth, age curves, weather and December games, teams resting starters in Week 17.
6. **Injury risk:** chance a starter misses a given playoff week by position, age and injury history. This sets how much depth is worth.
7. **Ceiling and correlation:** how correlated are QB/WR stacks? How much does a "variance strategy" help an underdog?
8. **DEF/K:** Vegas spread and total versus defense and kicker scoring, including points-allowed buckets in this league's scoring.

**Method:** rolling-origin backtests (train on weeks before k, predict k+h). Report correlation, average error and calibration, plus a **decision metric**: when the predictor says "A over B," how often is A actually better? That last number is what you care about for start/sit and trades.
