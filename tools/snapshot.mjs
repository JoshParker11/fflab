// Bakes data/snapshot.json (all-season projections, stats, usage, market values) and appends
// to data/changes.json. The site overlays live data on top of this every time it loads.
//   node tools/snapshot.mjs          then commit data/ and push
// Set NTFY_TOPIC to push alerts for changes that matter.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { formFactor } from '../js/model.js';
import { LEAGUE, POS, url, getJSON, softJSON, scorer, buildTeams, parseGames, parseNews,
  parseTransactions, trendMap, compact, diffChanges } from '../js/sources.js';

const state = await getJSON(url.state());
const season = state.season, cur = state.week;
const [league, users, rosters, allPlayers] = await Promise.all([
  getJSON(url.league()), getJSON(url.users()), getJSON(url.rosters()), getJSON('https://api.sleeper.app/v1/players/nfl'),
]);
const score = scorer(league.scoring_settings);
const lastReg = league.settings.playoff_week_start - 1;
const weeks = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const [matchups, projs, stats, txs] = await Promise.all([
  Promise.all(weeks(1, lastReg).map((w) => getJSON(url.matchups(w)))),
  Promise.all(weeks(1, 17).map((w) => getJSON(url.proj(season, w)))),
  Promise.all(weeks(1, cur).map((w) => getJSON(url.stats(season, w)))),
  Promise.all(weeks(1, cur).map((w) => getJSON(url.transactions(w)))),
]);
const [add24, drop24, add6, board, feed, fcVals] = await Promise.all([
  softJSON(url.trending('add', 24)), softJSON(url.trending('drop', 24)), softJSON(url.trending('add', 6)),
  softJSON(url.scoreboard(season, cur)), softJSON(url.news()), softJSON(url.fantasycalc()),
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

// ---------- players ----------
const byWeek = (arr) => Object.fromEntries((arr || []).map((x) => [x.player_id, x]));
const P = projs.map(byWeek), A = stats.map(byWeek);
const t24 = trendMap(add24), d24 = trendMap(drop24), t6 = trendMap(add6);
const fc = {};
for (const v of fcVals || []) if (v.player?.sleeperId) fc[v.player.sleeperId] = { value: v.value, rank: v.overallRank, trend: v.trend30Day };

const keep = new Set([...Object.keys(owner), ...Object.keys(t24), ...Object.keys(d24), ...Object.keys(t6)]);
for (let w = cur; w <= 17; w++) for (const x of projs[w - 1]) if ((x.stats?.pts_ppr || 0) >= 3) keep.add(x.player_id);

// A team's bye = a week where none of its players has an opponent in the projections.
const teamBye = {};
for (let w = 1; w <= 17; w++) {
  const playing = new Set(projs[w - 1].filter((x) => x.opponent).map((x) => x.team));
  for (const x of projs[w - 1]) if (x.team && !playing.has(x.team)) teamBye[x.team] ??= w;
}

const players = {};
for (const id of keep) {
  const m = allPlayers[id]; if (!m || !POS.includes(m.position)) continue;
  const proj = [null], act = [null], use = [null], opp = [null];
  for (let w = 1; w <= 17; w++) {
    const pr = P[w - 1][id];
    proj.push(pr ? score(pr.stats) : 0); opp.push(pr?.opponent || null);
  }
  for (let w = 1; w < cur; w++) {
    const st = A[w - 1][id]?.stats;
    const played = st && (st.gp || st.off_snp || st.def_snp || st.fga || st.xpa);
    act.push(played ? score(st) : null);
    use.push(st ? {
      snp: st.tm_off_snp ? Math.round((100 * (st.off_snp || 0)) / st.tm_off_snp) : null,
      tgt: st.rec_tgt || 0, rec: st.rec || 0, ru: st.rush_att || 0, rz: (st.rec_rz_tgt || 0) + (st.rush_rz_att || 0),
      ay: st.rec_air_yd || 0, pa: st.pass_att || 0,
    } : null);
  }
  const p = {
    id, name: m.position === 'DEF' ? `${m.first_name} ${m.last_name}` : m.full_name || `${m.first_name} ${m.last_name}`,
    pos: m.position, team: m.team || null, age: m.age, inj: m.injury_status || null,
    injNote: [m.injury_body_part, m.injury_notes].filter(Boolean).join(' — ') || null,
    depth: m.depth_chart_order ?? null, own: owner[id] ?? null,
    proj, act, use, opp, bye: teamBye[m.team] ?? null,
    add24: t24[id] || 0, add6: t6[id] || 0, drop24: d24[id] || 0,
    fc: fc[id]?.value || 0, fcRank: fc[id]?.rank || null, fcTrend: fc[id]?.trend || 0,
  };
  p.form = Math.round(formFactor(p, cur) * 1000) / 1000;
  players[id] = p;
}

const transactions = parseTransactions(txs);
for (const t of teams) {
  t.moves = transactions.filter((x) => x.rids.includes(t.rid) && x.type !== 'commissioner').length;
  t.scores = weeks(1, cur - 1).map((w) => results[w]?.[t.rid] ?? 0);
}

const snap = {
  generated: new Date().toISOString(), season, week: cur,
  league: {
    id: LEAGUE, name: league.name.trim(), roster_positions: league.roster_positions, scoring: league.scoring_settings,
    playoff_week_start: league.settings.playoff_week_start, playoff_teams: league.settings.playoff_teams,
    trade_deadline: league.settings.trade_deadline, waiver_day: league.settings.waiver_day_of_week,
    budget: league.settings.waiver_budget, max_bid_seen: Math.max(0, ...transactions.map((t) => t.bid || 0)),
  },
  teams, schedule, results, players, games, news: parseNews(feed, players), transactions: transactions.slice(0, 80),
  live: { games: Object.fromEntries(Object.entries(games).map(([k, g]) => [k, { state: g.state }])), pts: livePts },
};

// ---------- what changed since the last snapshot ----------
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
const path = new URL('../data/snapshot.json', import.meta.url);
const logPath = new URL('../data/changes.json', import.meta.url);
let prev = null, log = [];
try { prev = compact(JSON.parse(await readFile(path, 'utf8'))); } catch {}
try { log = JSON.parse(await readFile(logPath, 'utf8')); } catch {}
const changes = diffChanges(prev, snap).map((c) => ({ ...c, at: snap.generated }));
log = [...changes, ...log].filter((c) => Date.parse(c.at) > Date.now() - 7 * 864e5).slice(0, 500);

await writeFile(path, JSON.stringify(snap));
await writeFile(logPath, JSON.stringify(log));
console.log(`week ${cur} · ${Object.keys(players).length} players · ${Object.keys(games).length / 2} games · ${snap.news.length} news · ${changes.length} changes`);

// ---------- push alerts ----------
const topic = process.env.NTFY_TOPIC;
const urgent = changes.filter((c) => (c.kind === 'injury' && c.rel >= 2) || (c.kind === 'trend' && c.rel >= 1) || (c.kind === 'move' && c.rel >= 1 && c.to));
if (topic && urgent.length) {
  const nm = (id) => players[id]?.name || id;
  const own = (rid) => teams.find((t) => t.rid === rid)?.owner || 'FA';
  const lines = urgent.slice(0, 8).map((c) => (c.kind === 'injury' ? `${nm(c.id)}: ${c.from || 'healthy'} → ${c.to || 'healthy'}`
    : c.kind === 'trend' ? `${nm(c.id)} trending: +${c.to.toLocaleString()} adds/6h` : `${nm(c.id)} → ${own(c.to)}`));
  await fetch(`https://ntfy.sh/${topic}`, { method: 'POST', body: lines.join('\n'),
    headers: { Title: 'FF Lab', Click: 'https://joshparker11.github.io/fflab/' } }).catch(() => {});
}
