// Source parsing shared by tools/snapshot.mjs (the baked snapshot) and js/live.js (the in-browser
// live overlay). Every source here is CORS-open, so the browser can call it directly.
export const LEAGUE = '1400729034865774592';
export const ME = 'bytesmith';
export const SL = 'https://api.sleeper.app/v1';
export const POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const posQ = POS.map((p) => `position%5B%5D=${p}`).join('&');
export const url = {
  state: () => `${SL}/state/nfl`,
  league: () => `${SL}/league/${LEAGUE}`,
  users: () => `${SL}/league/${LEAGUE}/users`,
  rosters: () => `${SL}/league/${LEAGUE}/rosters`,
  matchups: (w) => `${SL}/league/${LEAGUE}/matchups/${w}`,
  transactions: (w) => `${SL}/league/${LEAGUE}/transactions/${w}`,
  proj: (season, w) => `https://api.sleeper.com/projections/nfl/${season}/${w}?season_type=regular&${posQ}`,
  stats: (season, w) => `https://api.sleeper.com/stats/nfl/${season}/${w}?season_type=regular&${posQ}`,
  trending: (kind, hours) => `${SL}/players/nfl/trending/${kind}?lookback_hours=${hours}&limit=60`,
  scoreboard: (season, w) => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=2&week=${w}`,
  news: () => 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=100',
  fantasycalc: () => 'https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&numTeams=12&ppr=1',
};

export async function getJSON(u, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(u);
      if (!r.ok) throw new Error(`${r.status} ${u}`);
      return await r.json();
    } catch (e) { if (i >= tries - 1) throw e; await new Promise((s) => setTimeout(s, 800 * (i + 1))); }
  }
}
export const softJSON = (u) => getJSON(u, 2).catch((e) => { console.warn('skip', e.message); return null; });

export const scorer = (S) => (st = {}) => { let t = 0; for (const k in st) if (S[k]) t += st[k] * S[k]; return Math.round(t * 100) / 100; };

export function buildTeams(rosters, users, budget) {
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
      faab: budget - (s.waiver_budget_used || 0),
      players: r.players, starters: r.starters, reserve: r.reserve || [],
    };
  });
  return { teams, owner };
}

const abbr = (a) => ({ WSH: 'WAS' }[a] || a);
export function parseGames(board) {
  const games = {};
  for (const e of board?.events || []) {
    const c = e.competitions[0], o = c.odds?.[0];
    const [h, a] = ['home', 'away'].map((ha) => c.competitors.find((x) => x.homeAway === ha));
    const total = o?.overUnder ?? null;
    // homeSpread < 0 = home favored. ESPN "details" reads like "PIT -2.5" (favorite first).
    let homeSpread = null;
    if (o?.details && o.details !== 'EVEN') {
      const [fav, num] = o.details.split(' ');
      homeSpread = fav === h.team.abbreviation ? Number(num) : -Number(num);
    } else if (o) homeSpread = 0;
    for (const [side, op, spr] of [[h, a, homeSpread], [a, h, homeSpread == null ? null : -homeSpread]]) {
      games[abbr(side.team.abbreviation)] = {
        opp: abbr(op.team.abbreviation), home: side === h, kickoff: e.date, state: e.status.type.state,
        detail: e.status.type.shortDetail, score: Number(side.score || 0), oppScore: Number(op.score || 0),
        spread: spr, total, implied: total != null && spr != null ? Math.round((total / 2 - spr / 2) * 10) / 10 : null,
        venue: c.venue?.fullName, neutral: !!c.neutralSite,
      };
    }
  }
  return games;
}

export function parseNews(feed, players) {
  const idx = new Map(Object.values(players).filter((p) => p.pos !== 'DEF').map((p) => [p.name.toLowerCase(), p.id]));
  return (feed?.articles || []).map((a) => {
    const ids = (a.categories || []).map((c) => idx.get((c.description || '').toLowerCase())).filter(Boolean);
    return { headline: a.headline, desc: a.description, time: a.published, link: a.links?.web?.href, ids };
  }).filter((a) => a.ids.length);
}

export function parseTransactions(lists) {
  return lists.flat().filter((t) => t.status === 'complete')
    .map((t) => ({ id: t.transaction_id, week: t.leg, type: t.type, time: t.status_updated, rids: t.roster_ids,
      adds: t.adds || {}, drops: t.drops || {}, bid: t.settings?.waiver_bid ?? null }))
    .sort((a, b) => b.time - a.time);
}

export const trendMap = (lst) => Object.fromEntries((lst || []).map((x) => [x.player_id, x.count]));

// Compact state for change detection: {players: {id: [inj, projThisWeek, adds6h, owner]}, games: {team: [total, spread]}}
export function compact(S) {
  const players = {};
  for (const [id, p] of Object.entries(S.players)) players[id] = [p.inj || null, p.proj?.[S.week] || 0, p.add6 || 0, p.own ?? null];
  const games = {};
  for (const [t, g] of Object.entries(S.games || {})) if (g.home || g.neutral) games[t] = [g.total, g.spread];
  return { week: S.week, t: S.generated, players, games };
}

export function diffChanges(prev, S) {
  if (!prev) return [];
  const cur = S.week, out = [];
  const me = S.teams.find((t) => t.me);
  const g = (S.schedule[cur] || []).find((x) => x.includes(me.rid));
  const opp = g?.find((r) => r !== me.rid);
  const rel = (p) => (p.own === me.rid ? 3 : p.own === opp ? 2 : !p.own ? 1 : 0);
  for (const p of Object.values(S.players)) {
    const q = prev.players[p.id]; if (!q) continue;
    const [inj, proj, add6, own] = q, r = rel(p), pc = p.proj?.[cur] || 0;
    if ((inj || null) !== (p.inj || null) && (r || pc >= 8)) out.push({ kind: 'injury', id: p.id, from: inj, to: p.inj, rel: r });
    if (prev.week === cur && Math.abs(pc - proj) >= 2 && r >= 1) out.push({ kind: 'proj', id: p.id, from: proj, to: pc, rel: r });
    if ((p.add6 || 0) >= 50000 && !p.own && p.add6 > 2 * (add6 || 0)) out.push({ kind: 'trend', id: p.id, from: add6 || 0, to: p.add6, rel: r });
    if (own !== (p.own ?? null) && (p.own || own) && pc >= 5) out.push({ kind: 'move', id: p.id, from: own, to: p.own, rel: r });
  }
  for (const [team, h] of Object.entries(prev.games || {})) {
    const n = S.games?.[team]; if (!n) continue;
    if (h[0] != null && n.total != null && Math.abs(n.total - h[0]) >= 1.5) out.push({ kind: 'line', team, from: h[0], to: n.total, what: 'total' });
    if (h[1] != null && n.spread != null && Math.abs(n.spread - h[1]) >= 1.5) out.push({ kind: 'line', team, from: h[1], to: n.spread, what: 'spread' });
  }
  return out;
}
