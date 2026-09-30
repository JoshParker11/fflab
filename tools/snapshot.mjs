// Pulls everything FF Lab needs and bakes data/snapshot.json (plus data/changes.json).
//   node tools/snapshot.mjs
// Sources: Sleeper (league, projections, stats, trending), ESPN (odds, game state, news),
// FantasyCalc (consensus trade values). No keys needed. Set NTFY_TOPIC to push alerts.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { formFactor } from '../js/model.js';

const LEAGUE = '1400729034865774592';
const ME = 'bytesmith';
const SL = 'https://api.sleeper.app/v1';
const POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const posQ = POS.map((p) => `position%5B%5D=${p}`).join('&');

async function get(url, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await r.json();
    } catch (e) { if (i >= tries - 1) throw e; await new Promise((s) => setTimeout(s, 800 * (i + 1))); }
  }
}
const soft = (url) => get(url).catch((e) => { console.warn('skip', e.message); return null; });

const state = await get(`${SL}/state/nfl`);
const season = state.season, cur = state.week;
const [league, users, rosters, allPlayers] = await Promise.all([
  get(`${SL}/league/${LEAGUE}`), get(`${SL}/league/${LEAGUE}/users`),
  get(`${SL}/league/${LEAGUE}/rosters`), get(`${SL}/players/nfl`),
]);
const S = league.scoring_settings;
const score = (st = {}) => { let t = 0; for (const k in st) if (S[k]) t += st[k] * S[k]; return Math.round(t * 100) / 100; };

const lastReg = league.settings.playoff_week_start - 1;
const weeks = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const [matchups, projs, stats, txs] = await Promise.all([
  Promise.all(weeks(1, lastReg).map((w) => get(`${SL}/league/${LEAGUE}/matchups/${w}`))),
  Promise.all(weeks(1, 17).map((w) => get(`https://api.sleeper.com/projections/nfl/${season}/${w}?season_type=regular&${posQ}`))),
  Promise.all(weeks(1, cur).map((w) => get(`https://api.sleeper.com/stats/nfl/${season}/${w}?season_type=regular&${posQ}`))),
  Promise.all(weeks(1, cur).map((w) => get(`${SL}/league/${LEAGUE}/transactions/${w}`))),
]);
const [trendAdd24, trendDrop24, trendAdd6, espnGames, espnNews, fcVals] = await Promise.all([
  soft(`${SL}/players/nfl/trending/add?lookback_hours=24&limit=60`),
  soft(`${SL}/players/nfl/trending/drop?lookback_hours=24&limit=60`),
  soft(`${SL}/players/nfl/trending/add?lookback_hours=6&limit=60`),
  soft(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=2&week=${cur}`),
  soft('https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=100'),
  soft('https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&numTeams=12&ppr=1'),
]);

// ---------- teams ----------
const userBy = Object.fromEntries(users.map((u) => [u.user_id, u]));
const owner = {};
const teams = rosters.map((r) => {
  const u = userBy[r.owner_id] || {};
  r.players.forEach((p) => (owner[p] = r.roster_id));
  const s = r.settings;
  return {
    rid: r.roster_id, owner: u.display_name, team: u.metadata?.team_name || u.display_name,
    avatar: u.avatar, me: u.display_name === ME,
    wins: s.wins, losses: s.losses, ties: s.ties || 0,
    pf: s.fpts + (s.fpts_decimal || 0) / 100, pa: (s.fpts_against || 0) + (s.fpts_against_decimal || 0) / 100,
    faab: league.settings.waiver_budget - (s.waiver_budget_used || 0),
    players: r.players, starters: r.starters, reserve: r.reserve || [],
    scores: matchups.slice(0, cur - 1).map((ms) => ms.find((m) => m.roster_id === r.roster_id)?.points ?? 0),
  };
});
const schedule = {}, results = {};
matchups.forEach((ms, i) => {
  const w = i + 1, g = {};
  ms.forEach((m) => (g[m.matchup_id] ||= []).push(m.roster_id));
  schedule[w] = Object.values(g);
  if (w < cur) results[w] = Object.fromEntries(ms.map((m) => [m.roster_id, m.points]));
});
const curMs = matchups[cur - 1] || [];
const livePts = {};
curMs.forEach((m) => Object.assign(livePts, m.players_points || {}));

// ---------- games / odds ----------
const games = {};
for (const e of espnGames?.events || []) {
  const c = e.competitions[0], o = c.odds?.[0];
  const [h, a] = ['home', 'away'].map((ha) => c.competitors.find((x) => x.homeAway === ha));
  const total = o?.overUnder ?? null;
  // Positive spread = home is the underdog by that much (ESPN "details" names the favorite).
  let homeSpread = null;
  if (o?.details && o.details !== 'EVEN') {
    const [fav, num] = o.details.split(' ');
    homeSpread = fav === h.team.abbreviation ? Number(num) : -Number(num);
  } else if (o) homeSpread = 0;
  for (const [me, op, spr] of [[h, a, homeSpread], [a, h, homeSpread == null ? null : -homeSpread]]) {
    const ab = abbr(me.team.abbreviation);
    games[ab] = {
      opp: abbr(op.team.abbreviation), home: me === h, kickoff: e.date, state: e.status.type.state,
      detail: e.status.type.shortDetail, score: Number(me.score || 0), oppScore: Number(op.score || 0),
      spread: spr, total, implied: total != null && spr != null ? Math.round((total / 2 - spr / 2) * 10) / 10 : null,
      venue: c.venue?.fullName, neutral: !!c.neutralSite,
    };
  }
}
function abbr(a) { return { WSH: 'WAS', JAX: 'JAX', LAR: 'LAR' }[a] || a; }

// ---------- players ----------
const byWeek = (arr) => Object.fromEntries((arr || []).map((x) => [x.player_id, x]));
const P = projs.map(byWeek), A = stats.map(byWeek);
const trend = (lst) => Object.fromEntries((lst || []).map((x) => [x.player_id, x.count]));
const t24 = trend(trendAdd24), d24 = trend(trendDrop24), t6 = trend(trendAdd6);
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

// ---------- league activity / FAAB climate ----------
const transactions = txs.flat().filter((t) => t.status === 'complete')
  .map((t) => ({ week: t.leg, type: t.type, time: t.status_updated, rids: t.roster_ids,
    adds: t.adds || {}, drops: t.drops || {}, bid: t.settings?.waiver_bid ?? null }))
  .sort((a, b) => b.time - a.time);
const maxBid = Math.max(0, ...transactions.map((t) => t.bid || 0));
for (const t of teams) t.moves = transactions.filter((x) => x.rids.includes(t.rid) && x.type !== 'commissioner').length;

// ---------- news ----------
const nameIdx = new Map(Object.values(players).filter((p) => p.pos !== 'DEF').map((p) => [p.name.toLowerCase(), p.id]));
const news = (espnNews?.articles || []).map((a) => {
  const ids = (a.categories || []).map((c) => nameIdx.get((c.description || '').toLowerCase())).filter(Boolean);
  return { headline: a.headline, desc: a.description, time: a.published, link: a.links?.web?.href, ids };
}).filter((a) => a.ids.length);

const snap = {
  generated: new Date().toISOString(), season, week: cur,
  league: {
    id: LEAGUE, name: league.name.trim(), roster_positions: league.roster_positions, scoring: S,
    playoff_week_start: league.settings.playoff_week_start, playoff_teams: league.settings.playoff_teams,
    trade_deadline: league.settings.trade_deadline, waiver_day: league.settings.waiver_day_of_week,
    budget: league.settings.waiver_budget, max_bid_seen: maxBid,
  },
  teams, schedule, results, players, games, news, transactions: transactions.slice(0, 80),
  live: { games: Object.fromEntries(Object.entries(games).map(([k, g]) => [k, { state: g.state }])), pts: livePts },
};

// ---------- what changed since last snapshot ----------
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
const path = new URL('../data/snapshot.json', import.meta.url);
let prev = null;
try { prev = JSON.parse(await readFile(path, 'utf8')); } catch {}
const me = teams.find((t) => t.me);
const opp = teams.find((t) => t.rid === (schedule[cur] || []).find((g) => g.includes(me.rid))?.find((r) => r !== me.rid));
const relevance = (p) => (p.own === me.rid ? 3 : p.own === opp?.rid ? 2 : !p.own ? 1 : 0);
const changes = [];
if (prev) {
  for (const p of Object.values(players)) {
    const q = prev.players[p.id]; if (!q) continue;
    const rel = relevance(p);
    if ((q.inj || null) !== (p.inj || null) && (rel || p.proj[cur] >= 8))
      changes.push({ kind: 'injury', id: p.id, from: q.inj, to: p.inj, rel });
    const d = (p.proj[cur] || 0) - (q.proj?.[cur] || 0);
    if (prev.week === cur && Math.abs(d) >= 2 && rel >= 1)
      changes.push({ kind: 'proj', id: p.id, from: q.proj[cur], to: p.proj[cur], rel });
    if ((p.add6 || 0) >= 50000 && !p.own && (p.add6 || 0) > 2 * (q.add6 || 0))
      changes.push({ kind: 'trend', id: p.id, from: q.add6 || 0, to: p.add6, rel });
    if (q.own !== p.own && (p.own || q.own) && p.proj[cur] >= 5)
      changes.push({ kind: 'move', id: p.id, from: q.own, to: p.own, rel });
  }
  for (const [team, g] of Object.entries(games)) {
    const h = prev.games?.[team]; if (!h || g.home === false) continue;
    if (h.total != null && g.total != null && Math.abs(g.total - h.total) >= 1.5)
      changes.push({ kind: 'line', team, from: h.total, to: g.total, what: 'total' });
    if (h.spread != null && g.spread != null && Math.abs(g.spread - h.spread) >= 1.5)
      changes.push({ kind: 'line', team, from: h.spread, to: g.spread, what: 'spread' });
  }
}
snap.changes = changes.map((c) => ({ ...c, at: snap.generated }));
// keep a rolling 7-day log so the Pulse tab can show what moved over time
const logPath = new URL('../data/changes.json', import.meta.url);
let log = [];
try { log = JSON.parse(await readFile(logPath, 'utf8')); } catch {}
const cutoff = Date.now() - 7 * 864e5;
log = [...snap.changes, ...log].filter((c) => Date.parse(c.at) > cutoff).slice(0, 500);

await writeFile(path, JSON.stringify(snap));
await writeFile(logPath, JSON.stringify(log));
console.log(`week ${cur} · ${Object.keys(players).length} players · ${Object.keys(games).length / 2} games · ${news.length} news · ${changes.length} changes`);

// ---------- push alerts ----------
const topic = process.env.NTFY_TOPIC;
const urgent = changes.filter((c) => (c.kind === 'injury' && c.rel >= 2) || (c.kind === 'trend' && c.rel >= 1) || (c.kind === 'move' && c.rel >= 1 && c.to));
if (topic && urgent.length) {
  const nm = (id) => players[id]?.name || id;
  const own = (rid) => teams.find((t) => t.rid === rid)?.owner || 'FA';
  const lines = urgent.slice(0, 8).map((c) => c.kind === 'injury' ? `${nm(c.id)}: ${c.from || 'healthy'} → ${c.to || 'healthy'}`
    : c.kind === 'trend' ? `${nm(c.id)} trending: +${c.to.toLocaleString()} adds/6h`
    : `${nm(c.id)} → ${own(c.to)}`);
  await fetch(`https://ntfy.sh/${topic}`, { method: 'POST', body: lines.join('\n'),
    headers: { Title: 'FF Lab', Click: 'https://joshparker11.github.io/fflab/' } }).catch(() => {});
}
