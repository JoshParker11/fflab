// Builds the full league snapshot from public sources. Runs in Node (tools/snapshot.mjs) and in the
// browser ("Refresh all" on the site), so nothing depends on GitHub Actions.
import { LEAGUE, POS, url, getJSON, softJSON, scorer, buildTeams, parseGames, parseNews,
  parseTransactions, trendMap } from './sources.js?v=1792645849';
import { formFactor } from './model.js?v=1792645849';

const NFLV = { LA: 'LAR', STL: 'LAR', SD: 'LAC', OAK: 'LV', WSH: 'WAS', JAC: 'JAX' };
const team = (t) => NFLV[t] || t;
const posQ = POS.map((p) => `position%5B%5D=${p}`).join('&');

// nflverse schedule with closing spreads/totals -> implied team points per week
function parseVegas(csv, season) {
  const lines = csv.trim().split('\n'), head = lines[0].split(',');
  const ix = (k) => head.indexOf(k);
  const [iS, iT, iW, iA, iH, iSp, iTo] = ['season', 'game_type', 'week', 'away_team', 'home_team', 'spread_line', 'total_line'].map(ix);
  const out = {};
  for (const l of lines.slice(1)) {
    const c = l.split(',');
    if (c[iS] !== String(season) || c[iT] !== 'REG' || !c[iSp] || !c[iTo]) continue;
    const w = +c[iW], tot = +c[iTo], spr = +c[iSp]; // spread_line > 0: home favored
    (out[team(c[iH])] ||= {})[w] = tot / 2 + spr / 2;
    (out[team(c[iA])] ||= {})[w] = tot / 2 - spr / 2;
  }
  return out;
}

export async function buildSnapshot({ allPlayers = null, progress = () => {} } = {}) {
  const step = (m) => progress(m);
  step('league');
  const state = await getJSON(url.state());
  const season = state.season, cur = state.week;
  const [league, users, rosters] = await Promise.all([getJSON(url.league()), getJSON(url.users()), getJSON(url.rosters())]);
  const score = scorer(league.scoring_settings);
  const lastReg = league.settings.playoff_week_start - 1;
  const weeks = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
  step('projections and stats');
  const [matchups, projs, stats, txs] = await Promise.all([
    Promise.all(weeks(1, lastReg).map((w) => getJSON(url.matchups(w)))),
    Promise.all(weeks(1, 17).map((w) => getJSON(url.proj(season, w)))),
    Promise.all(weeks(1, cur).map((w) => getJSON(url.stats(season, w)))),
    Promise.all(weeks(1, cur).map((w) => getJSON(url.transactions(w)))),
  ]);
  step('markets, trends, news');
  const [add24, drop24, add6, board, feed, fcVals, lastYear, vegasCsv] = await Promise.all([
    softJSON(url.trending('add', 24)), softJSON(url.trending('drop', 24)), softJSON(url.trending('add', 6)),
    softJSON(url.scoreboard(season, cur)), softJSON(url.news()), softJSON(url.fantasycalc()),
    softJSON(`https://api.sleeper.com/stats/nfl/${+season - 1}?season_type=regular&${posQ}`),
    fetch('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv').then((r) => (r.ok ? r.text() : null)).catch(() => null),
  ]);

  const { teams, owner } = buildTeams(rosters, users, league.settings.waiver_budget);
  const schedule = {}, results = {};
  matchups.forEach((ms, i) => {
    const w = i + 1, g = {};
    ms.forEach((m) => (g[m.matchup_id] ||= []).push(m.roster_id));
    schedule[w] = Object.values(g);
    if (w < cur) results[w] = Object.fromEntries(ms.map((m) => [m.roster_id, m.points]));
  });
  const livePts = {};
  (matchups[cur - 1] || []).forEach((m) => Object.assign(livePts, m.players_points || {}));
  const games = parseGames(board);

  // Vegas implied team totals: nflverse for every week with a line, ESPN for the live week
  const vegas = vegasCsv ? parseVegas(vegasCsv, season) : {};
  for (const [t, g] of Object.entries(games)) if (g.implied != null) (vegas[t] ||= {})[cur] = g.implied;

  const byWeek = (arr) => Object.fromEntries((arr || []).map((x) => [x.player_id, x]));
  const P = projs.map(byWeek), A = stats.map(byWeek);
  const t24 = trendMap(add24), d24 = trendMap(drop24), t6 = trendMap(add6);
  const fc = {};
  for (const v of fcVals || []) if (v.player?.sleeperId) fc[v.player.sleeperId] = { value: v.value, rank: v.overallRank, trend: v.trend30Day };
  const ly = {};
  for (const r of lastYear || []) if (r.stats?.gp >= 4) ly[r.player_id] = Math.round((score(r.stats) / r.stats.gp) * 10) / 10;

  // team usage totals per week (all players, not just the ones we keep) -> shares
  const teamUse = {};
  stats.forEach((rows, i) => {
    for (const r of rows || []) {
      const s = r.stats || {}; if (!r.team) continue;
      const t = (teamUse[r.team] ||= {}), u = (t[i + 1] ||= { tgt: 0, ay: 0, ru: 0 });
      u.tgt += s.rec_tgt || 0; u.ay += Math.max(0, s.rec_air_yd || 0); u.ru += s.rush_att || 0;
    }
  });

  const keep = new Set([...Object.keys(owner), ...Object.keys(t24), ...Object.keys(d24), ...Object.keys(t6)]);
  for (let w = cur; w <= 17; w++) for (const x of projs[w - 1] || []) if ((x.stats?.pts_ppr || 0) >= 3) keep.add(x.player_id);
  for (let w = Math.max(1, cur - 3); w < cur; w++) for (const x of stats[w - 1] || []) if ((x.stats?.rec_tgt || 0) + (x.stats?.rush_att || 0) >= 5) keep.add(x.player_id);

  const teamBye = {};
  for (let w = 1; w <= 17; w++) {
    const playing = new Set((projs[w - 1] || []).filter((x) => x.opponent).map((x) => x.team));
    for (const x of projs[w - 1] || []) if (x.team && !playing.has(x.team)) teamBye[x.team] ??= w;
  }
  // player metadata: the full players DB when we have it (Node), otherwise the newest row that names them
  const metaFrom = (id) => {
    if (allPlayers?.[id]) return allPlayers[id];
    for (let w = 17; w >= 1; w--) { const r = P[w - 1]?.[id] || A[w - 1]?.[id]; if (r?.player) return { ...r.player, team: r.player.team ?? r.team }; }
    return null;
  };

  step('players');
  const players = {};
  for (const id of keep) {
    const m = metaFrom(id); if (!m || !POS.includes(m.position)) continue;
    const proj = [null], act = [null], use = [null], opp = [null];
    for (let w = 1; w <= 17; w++) { const pr = P[w - 1][id]; proj.push(pr ? score(pr.stats) : 0); opp.push(pr?.opponent || null); }
    const done = games[m.team]?.state === 'post';
    for (let w = 1; w < cur || (w === cur && done); w++) {
      const st = A[w - 1]?.[id]?.stats;
      const played = st && (st.gp || st.off_snp || st.def_snp || st.fga || st.xpa);
      act.push(played ? score(st) : null);
      use.push(st ? {
        snp: st.tm_off_snp ? Math.round((100 * (st.off_snp || 0)) / st.tm_off_snp) : null,
        tgt: st.rec_tgt || 0, rec: st.rec || 0, ru: st.rush_att || 0, rz: (st.rec_rz_tgt || 0) + (st.rush_rz_att || 0),
        ay: st.rec_air_yd || 0, pa: st.pass_att || 0, team: A[w - 1][id].team || null,
      } : null);
    }
    players[id] = {
      id, name: m.position === 'DEF' ? `${m.first_name} ${m.last_name}` : m.full_name || `${m.first_name} ${m.last_name}`,
      pos: m.position, team: m.team || null, age: m.age ?? null, inj: m.injury_status || null,
      injNote: [m.injury_body_part, m.injury_notes].filter(Boolean).join(' — ') || null,
      own: owner[id] ?? null, proj, act, use, opp, bye: teamBye[m.team] ?? null, ly: ly[id] ?? null,
      add24: t24[id] || 0, add6: t6[id] || 0, drop24: d24[id] || 0,
      fc: fc[id]?.value || 0, fcRank: fc[id]?.rank || null, fcTrend: fc[id]?.trend || 0,
    };
    players[id].form = Math.round(formFactor(players[id], cur) * 1000) / 1000; // classic view only
  }

  const transactions = parseTransactions(txs);
  for (const t of teams) {
    t.moves = transactions.filter((x) => x.rids.includes(t.rid) && x.type !== 'commissioner').length;
    t.scores = weeks(1, cur - 1).map((w) => results[w]?.[t.rid] ?? 0);
  }
  step('done');
  return {
    generated: new Date().toISOString(), season, week: cur,
    league: {
      id: LEAGUE, name: league.name.trim(), roster_positions: league.roster_positions, scoring: league.scoring_settings,
      playoff_week_start: league.settings.playoff_week_start, playoff_teams: league.settings.playoff_teams,
      trade_deadline: league.settings.trade_deadline, waiver_day: league.settings.waiver_day_of_week,
      budget: league.settings.waiver_budget, max_bid_seen: Math.max(0, ...transactions.map((t) => t.bid || 0)),
    },
    teams, schedule, results, players, games, vegas, teamUse, news: parseNews(feed, players), transactions: transactions.slice(0, 80),
    live: { games: Object.fromEntries(Object.entries(games).map(([k, g]) => [k, { state: g.state }])), pts: livePts },
  };
}
