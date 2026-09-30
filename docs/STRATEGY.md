# FF Lab Playbook — Sleepless in Seattle (2026)

Written 2026-09-29 (Tuesday before Week 4). Numbers come from the public Sleeper API plus
Sleeper/Rotowire projections, scored with **this league's** settings.

## 1. The league: rules that change strategy

| Setting | Value | Why it matters |
|---|---|---|
| Teams / format | 12-team redraft, full PPR | Receptions count as much as 10 yards, so targets beat carries |
| Passing | 4 pt pass TD, 0.04/yd, **INT only −1** | QBs are flat; streaming a QB is viable and a gunslinger's INTs barely hurt |
| Lineup | QB, 2 RB, 2 WR, TE, **2 FLEX**, K, DEF | Two flex spots make the 3rd/4th RB/WR matter a lot; depth is starting value |
| Bench / IR | 5 BN + 2 IR (Out/Doubtful eligible) | IR slots are free bench; stash injured upside there |
| Waivers | FAAB $100, $0 bids allowed, 2-day clear | Most managers barely bid: 8 of 12 teams still have $100 |
| Trades | **League veto (6 votes)**, 2-day review | Lopsided deals get vetoed, so offers must *look* fair |
| Trade deadline | Week 11 | 7 weeks of trade window left |
| Playoffs | 6 teams, weeks 15–17, **top-2 seeds get a bye** | Reaching the playoffs is nearly certain for us; the bye and a strong week 15–17 lineup win titles |

## 2. Where we stand

**Riders of Rohan (bytesmith): 3-0, 457.2 PF (2nd), all-play 27-6 (2nd).** The record is
earned, not lucky: we would have beaten 82% of lineups each week.

Our Monte Carlo (20k seasons, blending points scored with projected lineup strength) gives:

| Team | Playoffs | Top-2 bye | #1 seed |
|---|---|---|---|
| BooberEats (3-0) | ~100% | 75% | 48% |
| **bytesmith (3-0)** | **99%** | **58%** | **28%** |
| sim1flowers (2-1) | 98% | 44% | 18% |
| jaythe1st (2-1) | 94% | 19% | 6% |
| everyone else | ≤60% | ≤2% | 0% |

The model is overconfident this early, since it treats team strength as known, but the
shape is right: a **four-team upper class** (Boober, us, sim1flowers, jaythe1st) and eight
chasers. Our real race is for the bye against those three.

## 3. Risk: fast or slow at 3-0?

**Neither extreme. Make positive-expected-value moves aggressively, but avoid moves that
only add variance.** Playoff odds near 99% mean:

- We **don't need** coin-flip gambles to reach the playoffs. Avoid trades that swap a
  reliable starter for a boom/bust lottery ticket.
- We **should** spend assets (FAAB, bench depth, surplus positions) on anything that raises
  our weekly *median*, **most of all our weeks 15–17 lineup**.
- Around week 9–11, shift bench spots from "upside stashes" to protection: handcuffs for
  our own starters and players with good playoff-week matchups.
- Late in the year, **playing for ceiling** in a playoff game we're projected to lose is
  correct. As favorites, play for floor.

## 4. The stats that actually predict fantasy points (track weekly)

Opportunity predicts future points; efficiency and touchdowns mostly don't.

**Receivers (WR/TE)**
1. **Target share / targets per route run (TPRR).** The single stickiest receiving stat.
2. **Route participation %.** Is he on the field when they throw? Rising route % comes before breakouts.
3. **Air yards share / aDOT.** Deep targets are volatile but high value.
4. **Red-zone and end-zone targets.** Touchdown equity.
5. **Expected fantasy points (xFP) vs actual.** Big positive gap = sell candidate. Big negative gap = buy.

**Running backs**
1. **Snap % and "opportunity share"** (carries + targets ÷ team RB opportunities).
2. **Targets.** In full PPR a target is worth about 2.5× a carry.
3. **Carries inside the 10 / inside the 5.** Goal-line role is where RB touchdowns come from.
4. **Two-minute and third-down role.** Hidden PPR gold.

**QBs**: rushing attempts plus designed runs, dropbacks, and team pass rate over expectation.

**Game environment (all positions)**: **Vegas implied team total** (spread + over/under) is
the best one-number predictor of a team's fantasy output that week.

**Our Week 1–3 usage read:**
- Amon-Ra: 14→13→8 targets; still elite.
- Christian Watson: 8→11→10 targets, 80–90% snaps. A real WR1-type role, not a fluke.
- DeVonta Smith: 6→13→8.
- Chase Brown: 70%+ snaps, but targets fell 6→5→2. Watch this.
- Bucky Irving: snaps 61→78→52% and he was pulled in the 4th quarter of Week 3. Monitor, but the Mayfield injury may push more volume to him.
- Javonte Williams: 19 carries in Week 3; locked in as the Dallas lead back.
- Harold Fannin: targets rising 3→6→9 on 86% snaps.
- Sam LaPorta: targets falling 8→7→4, although he still plays 90%+ of snaps.
- Marvin Harrison Jr: 3→1→5 targets. The talent isn't turning into volume.

## 5. How the best managers run a roster

1. **Process over results.** They judge decisions by the information available at the time, not by what one Sunday scored.
2. **Bench = options, not insurance.** Early season, fill the bench with players who could become weekly starters if one thing breaks their way (backup RBs behind injury-prone starters, WR3s on high-volume offenses). Cut "safe" 6-point players freely. Handcuffs mostly wait until late season.
3. **Churn the bottom of the roster.** The 14th and 15th roster spots should turn over almost weekly.
4. **Stream K and DEF every week** based on matchup (DEF vs bad or backup QBs, high implied opponent turnovers; K in domes/high team totals). Never spend real FAAB on them.
5. **Act before the news, not after.** Injuries create the season's biggest value swings. The edge is being first: Sunday-night news, Wednesday–Friday practice reports, and inactives 90 minutes before kickoff.
6. **Trade for the playoffs, not the next week.** Check playoff-week matchups (NFL weeks 15–17) before any trade after Week 8.

## 6. Where edge exists in *this* league

- **Passive FAAB economy.** The biggest bid so far is $20; 8 teams haven't spent a dollar. We have $69. Overbidding slightly on true league-changers (like Ollie Gordon this week) is cheap dominance.
- **Inactive managers.** ThisIsRachel (0-3, 250 PF) and a few others barely use the waiver wire. Starters there go unreplaced.
- **Desperate 0-3 teams** (tbwelch, Jjenness, ThisIsRachel) are motivated trade partners and value "win now" players. tbwelch is the best partner: an unlucky, strong WR corps (Lamb, McConkey, Higgins, Jefferson OUT), weak RBs, and two QBs (Stafford + Maye) plus a spare TE (Ferguson).
- **Veto league.** Offer trades that are fair by consensus trade values but win for us on *our* needs (fit, byes, playoff schedule). That's how you win trades that don't get vetoed.
- **Sleeper's trending counts** are a real-time public-sentiment feed: 6.3M adds on Ollie Gordon in 24h. When a player trends hard *before* our waiver run, bid up. When a player is being mass-dropped but his usage is fine, he's a cheap buy.

## 7. Trading effectively

1. **Trade from surplus to need.** Our surplus: TE (LaPorta + Fannin, both startable) and
   WR depth (Godwin, Harrison Jr, Wicks). Our need: RB certainty (Brown/Irving are volatile; Coleman is on IR; Charbonnet is on PUP).
2. **2-for-1 consolidation** is our lever. With 2 FLEX spots and a 5-man bench, turning two
   good players into one great one raises our starting lineup, then waivers refill the bench.
3. **Sell high on touchdown luck.** Sell players whose actual points far exceed their xFP.
   Buy players whose usage is strong but whose results have been bad (Chase Brown-type profiles on other rosters).
4. **Know the partner.** Before offering, check their positional holes, bye-week crunch, record, and FAAB. A team with no healthy QB or RB will overpay.
5. **Anchor with a fair-looking first offer.** Lead with the player they need most. Don't open with an insult (vetoes, and a partner who stops negotiating).

## 8. Waivers: how to pick

Ask, in order:
1. **What changed structurally?** (injury ahead of him, depth-chart move, snap/route jump). Not "what did he score."
2. **How long does the change last?** Multi-week or season-long gets real FAAB. One week gets $0–3.
3. **Would he start for *us*?** Our weakest starter sets the bar (Week 4: FLEX ≈ 13–15 projected).
4. **Denial value.** Is our upcoming opponent, or a bye rival, short at that position?

**FAAB guide ($69 left):** league-winner = 50%+ of what's left; multi-week starter =
25–40%; bench upside = $1–8; K/DEF = $0.

## 9. Evaluating opponents

For each league mate we track: projected lineup strength, all-play record (luck-adjusted),
positional strengths/holes, injuries/byes, FAAB left, and activity level. Current tiers:

| Team | Strength / notes |
|---|---|
| **BooberEats (3-0)** | Best RB duo (Gibbs, Walker) + McBride at TE. Weak at WR (Waddle Q, Worthy, Diggs). QB Kyler Murray; Caleb Williams and Mayfield are both Out. Our Week 4 opponent. |
| **sim1flowers (2-1)** | Deepest lineup (190.9 in Week 2). QB Shough/Josh Allen (Q). Hasn't spent FAAB. |
| **jaythe1st (2-1)** | Bijan, Jeanty, Kittle, Mahomes. Loaded RBs, busy on the waiver wire. |
| katiek626, mgcoluccio, ExWill, lenworth | Middle class; each has a hole (mgcoluccio: Jayden Daniels on IR, starting Mariota; ExWill: Breece Hall Out, Nico Collins Out). |
| tbwelch (0-3) | Unlucky; 2nd-most points allowed. Strong WR group. **Best trade partner.** |
| Jjenness, coluccio33, ThisIsRachel | Chasing. Rachel has McCaffrey and is 0-3. Buy-low calls are worth a message. |

## 10. Week 4 action list (vs BooberEats: our 136.6 projected vs their 144.5)

Roughly a **40% win chance** as it stands. It's a big game for the #1 seed tiebreak.

1. **Waivers (process overnight Tue→Wed):** bid on **Ollie Gordon (RB, MIA)**. Achane tore
   his ACL (out for the year), and Gordon played 84% of snaps with 17 carries in Week 3.
   Bid **~$28–35**: the league's high bid so far is $20, and 8 teams have $100. Drop
   **Emmett Johnson** (18–36% snaps, trending drop).
2. **DEF stream:** GB DEF vs TB (Mayfield out, backup QB, 39.5 O/U) projects 8.4 vs SF's 6.8.
   Swap SF → GB.
3. **Kicker:** Shrader (groin, Q) kicks in the **London game (Sunday 9:30 AM ET)**, which
   locks early. If he isn't a full practice participant by Friday, swap to Will Reichard
   (MIN −10 vs MIA) or Matt Gay.
4. **TE:** LaPorta (DET–CAR, 50.5 O/U, 90%+ snaps) vs Fannin (PIT–CLE, 38.5 O/U, rising
   targets). Projections slightly favor Fannin. Game environment favors LaPorta. **Start
   LaPorta** and re-check Saturday's news.
5. **Chase Brown gets the week's best spot:** CIN–JAX has the highest total on the slate (51.5).
6. **Watch their Waddle (Q, walking boot).** If he sits, Boober's WR room is thin.

## Sources
- Sleeper public API (league, rosters, matchups, transactions, trending, projections)
- [NBC Sports — Week 4 waiver wire](https://www.nbcsports.com/fantasy/football/news/fantasy-football-waiver-wire-week-4-braelon-allen-and-ollie-gordon-are-next-in-line)
- [DraftKings Network — Ollie Gordon after Achane injury](https://dknetwork.draftkings.com/2026/09/29/is-ollie-gordon-ii-a-must-add-waiver-wire-pickup-for-week-4-after-devon-achanes-injury/)
- [Yahoo — Chase Brown, Bucky Irving Week 3 bad beats](https://sports.yahoo.com/articles/chase-brown-bucky-irving-other-140907894.html)
- [RotoBaller — Waddle "fine" for Week 4](https://www.rotoballer.com/player-news/jaylen-waddle-is-fine-going-into-week-4/1954086)
- [Covers — Week 4 lines](https://www.covers.com/nfl/week-4-odds-opening-lines-2026)
- [Sharp Football — Expected Fantasy Points tool](https://www.sharpfootballanalysis.com/fantasy/expected-fantasy-points-tool/)
- [Dynasty Nerds — advanced stats to know 2026](https://www.dynastynerds.com/analytics/advanced-stats-to-know-full-slate-2026/)
- [Waiver Wizard — FAAB spend by situation](https://fantasywaiverwizard.com/blog/how-much-faab-to-spend)
- [FTN — handcuff strategy 2026](https://ftnfantasy.com/nfl/fantasy-football-handcuff-strategy-for-2026)
