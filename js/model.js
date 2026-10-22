// FF Lab model: weekly player projections, lineups, season sims, trade and waiver math.
// Pure functions over data/snapshot.json, so the browser and tools/*.mjs share one model.

export const POS_CV = { QB: 0.32, RB: 0.48, WR: 0.52, TE: 0.58, K: 0.45, DEF: 0.6 };
const OUT = new Set(['Out', 'IR', 'PUP', 'Sus', 'NA', 'DNR', 'COV']);
const INJ_MULT = { Doubtful: 0.3, Questionable: 0.9 };

// How much a player's Week 1–N results move his projection. Recent weeks count most
// (1, .6, .36 …); K is how many weeks' worth of plain projection we blend in as a prior,
// so one game moves a player about 45% of the way and three games about 60%.
const RECENCY = 0.6;
const PRIOR_K = { QB: 1.2, RB: 1.2, WR: 1.2, TE: 1.2, K: 3, DEF: 3 };
const FORM_DECAY = 0.88; // form fades toward the projection the further out the week is
// Valuation weight per week: near weeks count more because they are more knowable.
export const TIME_DECAY = 0.9;

export function formFactor(p, cur) {
  let a = 0, pj = 0, wsum = 0;
  // Current-week games count once they're final, so a Sunday result moves Monday's view.
  let last = 0;
  for (let w = 1; w <= cur; w++) if (p.act?.[w] != null && p.proj?.[w]) last = w;
  for (let w = 1; w <= last; w++) {
    const act = p.act?.[w], proj = p.proj?.[w];
    if (act == null || !proj) continue; // didn't play or wasn't projected (bye, new role)
    const wt = RECENCY ** (last - w);
    a += wt * damp(p, w, act, proj); pj += wt * proj; wsum += wt;
  }
  if (!pj) return 1;
  const prior = (PRIOR_K[p.pos] ?? 1.2) * (pj / wsum);
  const f = (a + prior) / (pj + prior);
  return Math.min(1.5, Math.max(0.6, f));
}

// A blow-up game on ordinary volume is mostly touchdown luck: keep only 30% of the
// points above 1.5× projection unless his opportunities (targets + carries) also jumped.
function damp(p, w, act, proj) {
  const u = p.use?.[w];
  if (!u || act <= 2 * proj) return act;
  const others = p.use.filter((x, i) => x && i !== w).map((x) => x.tgt + x.ru);
  const avg = others.length ? others.reduce((a, b) => a + b, 0) / others.length : 0;
  if (!avg || u.tgt + u.ru > 1.75 * avg) return act; // real role change: trust it
  return 1.5 * proj + (act - 1.5 * proj) * 0.3;
}

// Expected league points and SD for player p in week w, seen from week cur.
// How much of a future week's matchup adjustment to keep. Backtest 2023–25 (tools/backtest.py):
// from Week 7, early-season "soft defense" signals barely predicted Weeks 15–17 for RB/WR/TE
// (corr ≈ 0) and only weakly for QBs (0.17), while player scoring carried over (0.35–0.56).
// So this week and next keep the full matchup; after that it fades toward the player's
// own average projection, leaving QBs ~30% and everyone else ~10% of the matchup effect.
const MATCHUP_FLOOR = { QB: 0.3, K: 0.2, DEF: 0.2 };
function matchupWeight(pos, ahead) {
  if (ahead <= 1) return 1;
  return Math.max(MATCHUP_FLOOR[pos] ?? 0.1, 0.55 ** (ahead - 1));
}
function avgProj(p, cur) {
  if (p._avg?.cur === cur) return p._avg.v;
  const v = (p.proj || []).slice(cur).filter((x) => x > 0);
  const a = v.length ? v.reduce((t, x) => t + x, 0) / v.length : 0;
  Object.defineProperty(p, '_avg', { value: { cur, v: a }, enumerable: false, configurable: true });
  return a;
}

export function weekDist(p, w, cur, live) {
  if (w === cur && live) {
    const g = live.games?.[p.team];
    if (g?.state === 'post') return { mean: live.pts?.[p.id] ?? 0, sd: 0 };
  }
  let mean = p.proj?.[w] ?? 0;
  if (!mean) return { mean: 0, sd: 0 };
  const avg = avgProj(p, cur);
  if (avg) mean = avg + (mean - avg) * matchupWeight(p.pos, w - cur);
  const f = p.form ?? 1;
  mean *= 1 + (f - 1) * FORM_DECAY ** (w - cur);
  if (w === cur) {
    if (OUT.has(p.inj)) mean = 0;
    else mean *= INJ_MULT[p.inj] ?? 1;
  } else if (w === cur + 1 && OUT.has(p.inj) && p.inj !== 'Out') {
    mean *= 0.5; // IR/PUP next week: projection often assumes a return that may slip
  }
  let sd = mean * (POS_CV[p.pos] ?? 0.5) * (1 + 0.03 * (w - cur));
  if (w === cur && live?.games?.[p.team]?.state === 'in') {
    const got = live.pts?.[p.id] ?? 0; // halfway: blend banked points with the rest
    mean = got + mean * 0.5; sd *= 0.6;
  }
  return { mean, sd };
}

// Slot filling: dedicated slots first by best mean, then FLEX from what's left.
// Greedy is optimal here because FLEX accepts a superset of RB/WR/TE.
// opts.absent: ids unavailable this week; opts.floor(pos): streamable replacement level.
export function bestLineup(ids, players, w, cur, slots, live, opts = {}) {
  const pool = ids.filter((id) => !opts.absent?.has(id)).map((id) => players[id]).filter(Boolean)
    .map((p) => ({ p, ...weekDist(p, w, cur, live) }))
    .sort((a, b) => b.mean - a.mean);
  const used = new Set(), lineup = [];
  const order = [...slots.filter((s) => s !== 'FLEX'), ...slots.filter((s) => s === 'FLEX')];
  for (const s of order) {
    const ok = s === 'FLEX' ? ['RB', 'WR', 'TE'] : [s];
    const pick = pool.find((x) => !used.has(x.p.id) && ok.includes(x.p.pos));
    const fl = opts.floor?.(s) ?? 0;
    if (pick && pick.mean >= fl) { used.add(pick.p.id); lineup.push({ slot: s, ...pick }); }
    else if (fl) lineup.push({ slot: s, p: null, stream: true, mean: fl, sd: fl * (POS_CV[s] ?? 0.5) });
    else lineup.push({ slot: s, p: null, mean: 0, sd: 0 });
  }
  const mean = lineup.reduce((t, x) => t + x.mean, 0);
  const sd = Math.sqrt(lineup.reduce((t, x) => t + x.sd * x.sd, 0));
  return { lineup, mean, sd, bench: pool.filter((x) => !used.has(x.p.id)) };
}

// QB/K/DEF can be streamed off waivers, so from two weeks out no roster is worse than the
// 3rd-best free agent at those spots. Stops us "valuing" a defense we'd never hold.
const STREAM = ['QB', 'K', 'DEF'];
export function streamFloor(snap, pos, w) {
  const c = (snap._floor ||= {});
  const key = pos + w;
  if (!(key in c)) {
    const m = Object.values(snap.players).filter((p) => !p.own && p.pos === pos)
      .map((p) => weekDist(p, w, snap.week, snap.live).mean).sort((a, b) => b - a);
    c[key] = m[2] ?? 0;
  }
  return c[key];
}
export function floorsFor(snap, w) {
  return w >= snap.week + 2 ? (s) => (STREAM.includes(s) ? streamFloor(snap, s, w) : 0) : null;
}

// Weekly chance a healthy player misses the game (injury, illness). Drives depth value.
const MISS = { QB: 0.05, RB: 0.09, WR: 0.07, TE: 0.07, K: 0.01, DEF: 0 };
const DEPTH_SAMPLES = 16;
function hashU(str) { // stable uniform in [0,1) so every roster sees the same injuries
  let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1e6) / 1e6;
}
function expectedLineup(snap, ids, w, slots) {
  const floor = floorsFor(snap, w);
  if (w === snap.week) return bestLineup(ids, snap.players, w, snap.week, slots, snap.live, { floor }).mean;
  let t = 0;
  for (let k = 0; k < DEPTH_SAMPLES; k++) {
    const absent = new Set(ids.filter((id) => hashU(`${id}:${w}:${k}`) < (MISS[snap.players[id]?.pos] ?? 0)));
    t += bestLineup(ids, snap.players, w, snap.week, slots, snap.live, { floor, absent }).mean;
  }
  return t / DEPTH_SAMPLES;
}

export const starterSlots = (snap) => snap.league.roster_positions.filter((s) => !['BN', 'IR'].includes(s));
export const activeIds = (t) => t.players.filter((id) => !(t.reserve || []).includes(id));
// Valuation pool = active roster + IR stashes. IR players project 0 while out and count again
// once their projections resume (a returning Charbonnet is part of the team's future), but they
// never count against roster size. `exclude` drops anyone traded away.
export const withIR = (t, ids, exclude = []) => [...ids, ...(t.reserve || []).filter((id) => !ids.includes(id) && !exclude.includes(id))];
export const lineupIds = (t) => withIR(t, activeIds(t));

export function timeWeight(w, cur) { return TIME_DECAY ** (w - cur); }

// Weighted rest-of-season lineup strength for a set of player ids: expected starting
// points each week (matchups, byes, injuries, depth), near weeks weighted most.
export function lineupValue(snap, ids, { from = snap.week, to = 17 } = {}) {
  const slots = starterSlots(snap); let v = 0; const weeks = [];
  for (let w = from; w <= to; w++) {
    const m = expectedLineup(snap, ids, w, slots);
    weeks.push(m); v += m * timeWeight(w, snap.week);
  }
  return { value: v, weeks };
}

// ---- deterministic RNG so before/after sims share random draws ----
export function rng(seed = 7) {
  let s = seed >>> 0;
  const u = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { u, n: () => { let a = 0; while (!a) a = u(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u()); } };
}

// Season Monte Carlo. rosters: {rid: [player ids]} (override to test trades).
// Every week uses that week's matchup-aware projections, byes included; the current week
// banks points already scored.
export function simulate(snap, { rosters, n = 4000, seed = 7 } = {}) {
  const cur = snap.week, lastReg = snap.league.playoff_week_start - 1;
  const slots = starterSlots(snap);
  const rids = snap.teams.map((t) => t.rid);
  const ids = rosters || Object.fromEntries(snap.teams.map((t) => [t.rid, lineupIds(t)]));
  const dist = {}; // dist[w][rid] = {mean, sd}
  for (let w = cur; w <= 17; w++) {
    dist[w] = {};
    for (const r of rids) dist[w][r] = bestLineup(ids[r], snap.players, w, cur, slots, snap.live, { floor: floorsFor(snap, w) });
  }
  const R = rng(seed);
  const out = Object.fromEntries(rids.map((r) => [r, { playoffs: 0, bye: 0, seed1: 0, title: 0, final: 0, semis: 0, wins: 0, weekWin: {},
    seeds: Array(rids.length).fill(0), quarterOpp: {}, semiOpp: {}, finalOpp: {} }]));
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
  const draw = (w, r) => dist[w][r].mean + dist[w][r].sd * R.n();
  for (let i = 0; i < n; i++) {
    const W = {}, PF = {};
    for (const t of snap.teams) { W[t.rid] = t.wins; PF[t.rid] = t.pf; }
    for (let w = cur; w <= lastReg; w++) {
      for (const [a, b] of snap.schedule[w] || []) {
        const sa = draw(w, a), sb = draw(w, b);
        PF[a] += sa; PF[b] += sb; const win = sa > sb ? a : b; W[win]++;
        out[win].weekWin[w] = (out[win].weekWin[w] || 0) + 1;
      }
    }
    const order = [...rids].sort((x, y) => W[y] - W[x] || PF[y] - PF[x]);
    order.slice(0, snap.league.playoff_teams).forEach((r) => out[r].playoffs++);
    order.slice(0, 2).forEach((r) => out[r].bye++);
    out[order[0]].seed1++;
    order.forEach((r, i) => out[r].seeds[i]++);
    for (const r of rids) out[r].wins += W[r];
    // Bracket: wk15 3v6 & 4v5; wk16 1 v lowest seed left, 2 v other; wk17 final.
    const s = order; const pw = snap.league.playoff_week_start;
    const game = (w, a, b) => (draw(Math.min(w, 17), a) > draw(Math.min(w, 17), b) ? a : b);
    const q1 = game(pw, s[2], s[5]), q2 = game(pw, s[3], s[4]);
    bump(out[s[2]].quarterOpp, s[5]); bump(out[s[5]].quarterOpp, s[2]);
    bump(out[s[3]].quarterOpp, s[4]); bump(out[s[4]].quarterOpp, s[3]);
    const [lo, hi] = s.indexOf(q1) > s.indexOf(q2) ? [q1, q2] : [q2, q1];
    for (const [a, b] of [[s[0], lo], [s[1], hi]]) { out[a].semis++; out[b].semis++; bump(out[a].semiOpp, b); bump(out[b].semiOpp, a); }
    const f1 = game(pw + 1, s[0], lo), f2 = game(pw + 1, s[1], hi);
    out[f1].final++; out[f2].final++;
    bump(out[f1].finalOpp, f2); bump(out[f2].finalOpp, f1);
    out[game(pw + 2, f1, f2)].title++;
  }
  for (const r of rids) {
    const o = out[r];
    for (const k of ['playoffs', 'bye', 'seed1', 'title', 'final', 'semis', 'wins']) o[k] /= n;
    for (const w in o.weekWin) o.weekWin[w] /= n;
    o.seeds = o.seeds.map((c) => c / n);
    o.avgSeed = o.seeds.reduce((t, p, i) => t + p * (i + 1), 0);
    for (const k of ['quarterOpp', 'semiOpp', 'finalOpp']) for (const r in o[k]) o[k][r] /= n;
  }
  return { odds: out, dist };
}

// P(A beats B) for one week, normal approximation.
export function winProb(a, b) {
  const sd = Math.hypot(a.sd, b.sd) || 1;
  const z = (a.mean - b.mean) / sd;
  return 0.5 * (1 + erf(z / Math.SQRT2));
}
function erf(x) { // Abramowitz–Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

const benchSize = (snap) => snap.league.roster_positions.length;

// Keeps roster size legal after a trade/add by dropping the lowest-value extras.
export function trimRoster(snap, ids) {
  const max = benchSize(snap);
  if (ids.length <= max) return { ids, dropped: [] };
  const scored = ids.map((id) => ({ id, v: playerValue(snap, id) })).sort((a, b) => a.v - b.v);
  const dropped = scored.slice(0, ids.length - max).map((x) => x.id);
  return { ids: ids.filter((id) => !dropped.includes(id)), dropped };
}

// A player's own weighted ROS points (used for drop order and fairness, not for lineup value).
export function playerValue(snap, id) {
  const p = snap.players[id]; if (!p) return 0; let v = 0;
  for (let w = snap.week; w <= 17; w++) v += weekDist(p, w, snap.week, snap.live).mean * timeWeight(w, snap.week);
  return v;
}

// Trade: my side gives `give`, receives `get` from team `partner`.
export function evalTrade(snap, myRid, partnerRid, give, get, { n = 3000 } = {}) {
  const team = (r) => snap.teams.find((t) => t.rid === r);
  const me = team(myRid), them = team(partnerRid);
  const before = Object.fromEntries(snap.teams.map((t) => [t.rid, activeIds(t)]));
  const mine = trimRoster(snap, [...before[myRid].filter((id) => !give.includes(id)), ...get]);
  const theirs = trimRoster(snap, [...before[partnerRid].filter((id) => !get.includes(id)), ...give]);
  const moved = [...give, ...get];
  const full = Object.fromEntries(snap.teams.map((t) => [t.rid, lineupIds(t)]));
  const after = { ...full, [myRid]: withIR(me, mine.ids, moved), [partnerRid]: withIR(them, theirs.ids, moved) };
  const lv = (ids) => lineupValue(snap, ids);
  const [mb, ma, tb, ta] = [lv(full[myRid]), lv(after[myRid]), lv(full[partnerRid]), lv(after[partnerRid])];
  const s0 = simulate(snap, { n }), s1 = simulate(snap, { rosters: after, n });
  const fc = (ids) => ids.reduce((t, id) => t + (snap.players[id]?.fc || 0), 0);
  const giveFc = fc(give), getFc = fc(get);
  const gap = Math.abs(giveFc - getFc) / Math.max(giveFc, getFc, 1);
  return {
    me: { rid: myRid, weekly: ma.weeks.map((x, i) => x - mb.weeks[i]), value: ma.value - mb.value,
      next3: ma.weeks.slice(0, 3).reduce((a, b) => a + b, 0) - mb.weeks.slice(0, 3).reduce((a, b) => a + b, 0),
      playoffWeeks: ma.weeks.slice(-3).reduce((a, b) => a + b, 0) - mb.weeks.slice(-3).reduce((a, b) => a + b, 0),
      // A top-2 seed skips week 15, so the title is weeks 16–17.
      titleWeeks: ma.weeks.slice(-2).reduce((a, b) => a + b, 0) - mb.weeks.slice(-2).reduce((a, b) => a + b, 0),
      odds0: s0.odds[myRid], odds1: s1.odds[myRid], dropped: mine.dropped },
    them: { rid: partnerRid, weekly: ta.weeks.map((x, i) => x - tb.weeks[i]), value: ta.value - tb.value,
      odds0: s0.odds[partnerRid], odds1: s1.odds[partnerRid], dropped: theirs.dropped },
    market: { give: giveFc, get: getFc, gap, vetoRisk: gap < 0.15 ? 'low' : gap < 0.35 ? 'medium' : 'high' },
    names: { me: me.owner, them: them.owner },
  };
}

// Waiver board for one team: gain of adding each free agent, dropping our least useful player.
export function waiverBoard(snap, rid, { limit = 40 } = {}) {
  const t = snap.teams.find((x) => x.rid === rid);
  const ids = activeIds(t);
  const L = (x) => lineupValue(snap, withIR(t, x));
  const base = L(ids);
  const drops = ids.map((id) => ({ id, v: L(ids.filter((x) => x !== id)).value }))
    .sort((a, b) => b.v - a.v); // highest remaining value = least costly drop
  const free = Object.values(snap.players).filter((p) => !p.own && p.pos)
    .map((p) => ({ p, pv: playerValue(snap, p.id) }))
    .sort((a, b) => b.pv - a.pv).slice(0, 120);
  const rows = [];
  for (const { p, pv } of free) {
    let best = null;
    // Try our 4 least useful players, plus anyone at the same position (a like-for-like swap,
    // e.g. one defense for another).
    const cands = [...drops.slice(0, 4), ...drops.filter((d) => snap.players[d.id]?.pos === p.pos)];
    const tried = [...new Map(cands.map((c) => [c.id, c])).values()].map((d) => {
      const v = L([...ids.filter((x) => x !== d.id), p.id]);
      return { gain: v.value - base.value, drop: d.id, weeks: v.weeks.map((x, i) => x - base.weeks[i]) };
    });
    // Drops within 2 points are a coin flip for the model, so cut the one whose role is shrinking.
    const top = Math.max(...tried.map((x) => x.gain));
    best = tried.filter((x) => x.gain >= top - 2)
      .sort((a, b) => snapTrend(snap.players[a.drop]) - snapTrend(snap.players[b.drop]) || b.gain - a.gain)[0];
    rows.push({ id: p.id, pv, ...best, bid: suggestBid(snap, t, best.gain, p.pos, p.add24) });
  }
  return rows.sort((a, b) => b.gain - a.gain).slice(0, limit);
}

// Last game's snap share minus the average of the games before it (negative = role shrinking).
export function snapTrend(p) {
  const s = (p?.use || []).filter((u) => u && u.snp != null).map((u) => u.snp);
  if (s.length < 2) return 0;
  const prior = s.slice(0, -1);
  return s[s.length - 1] - prior.reduce((a, b) => a + b, 0) / prior.length;
}

// FAAB: K/DEF $0–1. Otherwise roughly $1 per weighted point of lineup gain, scaled by this league's bidding
// climate (top bid so far) and by demand (Sleeper adds in 24h), capped at 60% of our remaining budget.
export function suggestBid(snap, team, gain, pos, adds24 = 0) {
  if (gain <= 0.5) return 0;
  if (pos === 'K' || pos === 'DEF') return Math.min(1, team.faab); // streamers: never pay up
  const climate = Math.max(10, snap.league.max_bid_seen || 0);
  // Demand: nobody chasing him → bid low; millions of adds → expect a fight.
  const demand = adds24 < 20000 ? 0.4 : adds24 < 200000 ? 0.8 : adds24 < 1000000 ? 1 : 1.2;
  const raw = gain * (climate / 20) * demand;
  return Math.max(1, Math.min(Math.round(raw), Math.floor(team.faab * 0.6)));
}

// Positional strength per team for the given week: points by slot group vs league average.
export function positionProfile(snap, w = snap.week) {
  const slots = starterSlots(snap);
  const prof = {};
  for (const t of snap.teams) {
    const { lineup } = bestLineup(lineupIds(t), snap.players, w, snap.week, slots, snap.live);
    const g = {};
    for (const x of lineup) { const k = x.slot; g[k] = (g[k] || 0) + x.mean; }
    prof[t.rid] = g;
  }
  const avg = {};
  for (const k of new Set(slots)) avg[k] = snap.teams.reduce((s, t) => s + (prof[t.rid][k] || 0), 0) / snap.teams.length;
  return { prof, avg };
}

// A coherent claim plan: take the best add, apply it, then find the next best with what's left
// (each claim needs its own drop).
export function waiverPlan(snap, rid, { steps = 3, minGain = 2 } = {}) {
  const t = snap.teams.find((x) => x.rid === rid);
  const saved = t.players, plan = [];
  try {
    for (let i = 0; i < steps; i++) {
      const best = waiverBoard(snap, rid, { limit: 1 })[0];
      if (!best || best.gain < minGain) break;
      plan.push(best);
      t.players = [...t.players.filter((id) => id !== best.drop), best.id];
      snap.players[best.id].own = rid; // so the next pass doesn't pick him again
    }
  } finally {
    for (const s of plan) snap.players[s.id].own = null;
    t.players = saved;
  }
  return plan;
}

// ---- title-move search ----
// Every 1-for-1 and 2-for-1 trade with every team, plus free-agent swaps, scored on the
// weeks that decide the title (default 16–17 for a bye team). A generator, so the page can
// run it in slices without freezing.
export function* titleMoveSearch(snap, rid, { from = snap.league.playoff_week_start + 1, to = 17, maxGive = 2 } = {}) {
  const P = snap.players, me = snap.teams.find((t) => t.rid === rid);
  const lv = (ids, t = me, a = from, b = to) => lineupValue(snap, withIR(t, ids), { from: a, to: b });
  const per = (v) => v.weeks.reduce((x, y) => x + y, 0) / v.weeks.length; // pts per title game
  const mine = activeIds(me), base = lv(mine), baseReg = lineupValue(snap, withIR(me, mine), { from: snap.week, to: snap.league.playoff_week_start - 1 }).value;
  const pool = mine.filter((id) => !['K', 'DEF'].includes(P[id]?.pos));
  const gives = [];
  for (let i = 0; i < pool.length; i++) {
    gives.push([pool[i]]);
    if (maxGive > 1) for (let j = i + 1; j < pool.length; j++) gives.push([pool[i], pool[j]]);
  }
  const titlePts = (p) => { let t = 0; for (let w = from; w <= to; w++) t += weekDist(p, w, snap.week, snap.live).mean; return t / (to - from + 1); };
  const jobs = [];
  for (const t of snap.teams.filter((x) => x.rid !== rid)) {
    const theirs = activeIds(t);
    for (const id of theirs) if (['QB', 'RB', 'WR', 'TE'].includes(P[id]?.pos) && titlePts(P[id]) >= 9) jobs.push({ t, get: id, theirs });
  }
  const fas = Object.values(P).filter((p) => !p.own && ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(p.pos))
    .sort((a, b) => titlePts(b) - titlePts(a)).slice(0, 30);
  const total = jobs.length + fas.length; let done = 0;
  const rows = [];
  for (const p of fas) {
    let best = null;
    for (const d of mine) {
      const v = lv([...mine.filter((x) => x !== d), p.id]);
      const g = per(v) - per(base);
      if (!best || g > best.gain) best = { kind: 'FA', partner: null, give: [d], get: [p.id], gain: g };
    }
    if (best.gain > 0.3) rows.push(best);
    done++; if (done % 5 === 0) yield { done, total };
  }
  for (const { t, get, theirs } of jobs) {
    const tb = lv(theirs, t);
    for (const give of gives) {
      const ids = trimRoster(snap, [...mine.filter((x) => !give.includes(x)), get]).ids;
      const g = per(lv(ids)) - per(base);
      if (g < 0.5) continue;
      const their = trimRoster(snap, [...theirs.filter((x) => x !== get), ...give]).ids;
      const gv = give.reduce((s2, id) => s2 + (P[id].fc || 0), 0), gt = P[get].fc || 0;
      rows.push({ kind: 'trade', partner: t.rid, give, get: [get], gain: g, theirGain: per(lv(their, t)) - per(tb),
        gap: Math.abs(gv - gt) / Math.max(gv, gt, 1), gv, gt });
    }
    done++; yield { done, total };
  }
  rows.sort((a, b) => b.gain - a.gain);
  // Regular-season cost for the leaders, so a playoff boost that sinks the bye is visible.
  for (const r of rows.slice(0, 40)) {
    const ids = r.kind === 'FA' ? [...mine.filter((x) => !r.give.includes(x)), ...r.get]
      : trimRoster(snap, [...mine.filter((x) => !r.give.includes(x)), ...r.get]).ids;
    r.regDelta = lineupValue(snap, withIR(me, ids), { from: snap.week, to: snap.league.playoff_week_start - 1 }).value - baseReg;
  }
  return rows;
}

// ---- scenarios: chains of trades / adds, simulated together ----
// steps: [{ partner: rid | null (free agent), give: [ids], get: [ids] }]
export function runScenario(snap, steps, { n = 4000, seed = 11, base } = {}) {
  const me = snap.teams.find((t) => t.me);
  const rosters = Object.fromEntries(snap.teams.map((t) => [t.rid, activeIds(t)]));
  const touched = [];
  for (const st of steps) {
    rosters[me.rid] = trimRoster(snap, [...rosters[me.rid].filter((x) => !st.give.includes(x)), ...st.get]).ids;
    if (st.partner != null) rosters[st.partner] = trimRoster(snap, [...rosters[st.partner].filter((x) => !st.get.includes(x)), ...st.give]).ids;
    else for (const id of st.get) { touched.push([id, snap.players[id].own]); snap.players[id].own = me.rid; }
  }
  const moved = steps.flatMap((st) => [...st.give, ...st.get]);
  for (const t of snap.teams) rosters[t.rid] = withIR(t, rosters[t.rid], moved);
  delete snap._floor;
  const b = base || simulate(snap, { n, seed });
  const a = simulate(snap, { rosters, n, seed });
  for (const [id, o] of touched) snap.players[id].own = o;
  delete snap._floor;
  const pw = snap.league.playoff_week_start;
  const fc = (ids) => ids.reduce((t, id) => t + (snap.players[id]?.fc || 0), 0);
  return {
    base: b, after: a,
    me: { rid: me.rid, title: [b.odds[me.rid].title, a.odds[me.rid].title], bye: [b.odds[me.rid].bye, a.odds[me.rid].bye],
      w16: a.dist[pw + 1][me.rid].mean - b.dist[pw + 1][me.rid].mean, w17: a.dist[pw + 2][me.rid].mean - b.dist[pw + 2][me.rid].mean },
    steps: steps.map((st) => ({ ...st, give$: fc(st.give), get$: fc(st.get),
      partnerOdds: st.partner == null ? null : { title: [b.odds[st.partner].title, a.odds[st.partner].title], playoffs: [b.odds[st.partner].playoffs, a.odds[st.partner].playoffs] } })),
  };
}
