// Live overlay: every page load refreshes the fast-moving parts of the baked snapshot straight
// from the sources (rosters, records, live scores, this week's projections and injury tags,
// trending adds, odds, news, transactions). Season-long projections and stats stay baked.
import { url, softJSON, scorer, buildTeams, parseGames, parseNews, parseTransactions, trendMap,
  compact, diffChanges } from './sources.js?v=1790745336';
import { formFactor } from './model.js?v=1790745336';

const KEY = 'fflab-last-seen';
const LOG = 'fflab-change-log';
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

export async function overlay(S) {
  const state = await softJSON(url.state());
  if (!state) return { ok: false, changes: [] };
  const cur = S.week; // stay on the snapshot's week so the season projections line up
  const [users, rosters, ms, tx, add24, drop24, add6, board, feed, proj] = await Promise.all([
    softJSON(url.users()), softJSON(url.rosters()), softJSON(url.matchups(cur)), softJSON(url.transactions(cur)),
    softJSON(url.trending('add', 24)), softJSON(url.trending('drop', 24)), softJSON(url.trending('add', 6)),
    softJSON(url.scoreboard(S.season, cur)), softJSON(url.news()), softJSON(url.proj(S.season, cur)),
  ]);
  const score = scorer(S.league.scoring);

  if (users && rosters) {
    const { teams, owner } = buildTeams(rosters, users, S.league.budget);
    for (const t of teams) {
      const old = S.teams.find((x) => x.rid === t.rid);
      Object.assign(old, { ...t, scores: old.scores, moves: old.moves });
    }
    for (const p of Object.values(S.players)) p.own = owner[p.id] ?? null;
    for (const id of Object.keys(owner)) if (!S.players[id]) addStub(S, id, proj, owner[id]);
  }
  if (proj) {
    for (const row of proj) {
      const p = S.players[row.player_id] || (score(row.stats) >= 3 && addStub(S, row.player_id, proj, null));
      if (!p) continue;
      p.proj[cur] = score(row.stats);
      const m = row.player || {};
      p.inj = m.injury_status || null;
      p.injNote = [m.injury_body_part, m.injury_notes].filter(Boolean).join(' — ') || null;
      if (m.team !== undefined) p.team = m.team || null;
    }
  }
  if (add24 || add6 || drop24) {
    const a = trendMap(add24), d = trendMap(drop24), s6 = trendMap(add6);
    for (const p of Object.values(S.players)) { p.add24 = a[p.id] || 0; p.drop24 = d[p.id] || 0; p.add6 = s6[p.id] || 0; }
  }
  if (ms) {
    const pts = {};
    ms.forEach((m) => Object.assign(pts, m.players_points || {}));
    S.live.pts = pts;
    S.live.matchups = Object.fromEntries(ms.map((m) => [m.roster_id, m.points]));
  }
  if (board) {
    S.games = parseGames(board);
    S.live.games = Object.fromEntries(Object.entries(S.games).map(([k, g]) => [k, { state: g.state }]));
  }
  if (feed) S.news = parseNews(feed, S.players);
  if (tx) {
    const seen = new Set(S.transactions.map((t) => t.id ?? t.time));
    const fresh = parseTransactions([tx]).filter((t) => !seen.has(t.id) && !seen.has(t.time));
    S.transactions = [...fresh, ...S.transactions];
    S.league.max_bid_seen = Math.max(S.league.max_bid_seen, ...fresh.map((t) => t.bid || 0));
  }
  S.liveAt = new Date().toISOString();
  S.staleWeek = state.week !== cur ? state.week : null;

  // "since you last looked" — compared per device
  const now = compact({ ...S, generated: S.liveAt });
  const changes = diffChanges(store.get(KEY), S).map((c) => ({ ...c, at: S.liveAt, local: true }));
  store.set(KEY, now);
  const log = [...changes, ...(store.get(LOG) || [])].filter((c) => Date.parse(c.at) > Date.now() - 7 * 864e5).slice(0, 300);
  store.set(LOG, log);
  return { ok: true, changes: log };
}

// A player the snapshot didn't bake (fresh add, surging free agent): this week's projection only.
function addStub(S, id, proj, own) {
  const row = proj?.find((r) => r.player_id === id);
  const m = row?.player; if (!m || !['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(m.position)) return null;
  const blank = Array(18).fill(0); blank[0] = null;
  const p = S.players[id] = {
    id, name: m.position === 'DEF' ? `${m.first_name} ${m.last_name}` : `${m.first_name} ${m.last_name}`,
    pos: m.position, team: m.team || null, inj: m.injury_status || null, injNote: null, own,
    proj: blank, act: [null], use: [null], opp: [null], bye: null, add24: 0, add6: 0, drop24: 0, fc: 0, stub: true,
  };
  p.form = formFactor(p, S.week);
  return p;
}
