// Signals: finds what's changing in the data and says it in plain words.
// Usage trends compare a player's last 2 games with his games before that. "Expected points"
// = opportunities × what an opportunity is worth at his position this season, so points far
// above or below it flag luck (touchdowns, big plays) rather than role.
import { weekDist } from './model.js?v=1792654421';

const avg = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
const SKILL = ['QB', 'RB', 'WR', 'TE'];

function usageRows(S, p) {
  const out = [];
  for (let w = 1; w < p.use.length; w++) {
    const u = p.use[w], a = p.act[w];
    if (!u || a == null) continue;
    const T = S.teamUse?.[u.team || p.team]?.[w];
    out.push({ w, a, proj: p.proj?.[w] || 0, snp: u.snp, opp: u.tgt + u.ru + (p.pos === 'QB' ? u.pa : 0), tgt: u.tgt, ru: u.ru, rz: u.rz,
      tshare: T?.tgt ? u.tgt / T.tgt : null, ayshare: T?.ay ? Math.max(0, u.ay) / T.ay : null });
  }
  return out;
}

export function computeSignals(S, { me, oppRid, changes = [] } = {}) {
  const P = S.players, out = [];
  const owner = (rid) => S.teams.find((t) => t.rid === rid)?.owner;
  const tag = (p) => (p.own === me ? 'mine' : p.own === oppRid ? 'opponent' : p.own ? 'league' : 'free agent');
  // value of one opportunity at each position this season (league-wide)
  const ppo = {};
  for (const pos of SKILL) {
    let pts = 0, opp = 0;
    for (const p of Object.values(P)) if (p.pos === pos) for (const r of usageRows(S, p)) { pts += r.a; opp += r.opp; }
    ppo[pos] = opp ? pts / opp : 0;
  }
  const ros = (p) => avg([0, 1, 2, 3].map((i) => weekDist(p, S.week + i, S.week, S.live).mean).filter((x) => x > 0)) || 0;
  const add = (o) => out.push({ ...o, owner: o.p.own ? owner(o.p.own) : null, tag: tag(o.p), ros: ros(o.p) });

  for (const p of Object.values(P)) {
    if (!SKILL.includes(p.pos)) continue;
    // Drop partial games (left hurt / eased back): under half his usual snap share.
    const all = usageRows(S, p), snaps = all.map((r) => r.snp).filter((x) => x != null).sort((a, b) => a - b);
    const med = snaps.length ? snaps[Math.floor(snaps.length / 2)] : null;
    const R = med ? all.filter((r) => r.snp == null || r.snp >= med * 0.5) : all;
    if (R.length < 3) continue;
    const recent = R.slice(-2), before = R.slice(0, -2);
    const m = (rows, k) => avg(rows.map((r) => r[k]).filter((x) => x != null));
    const d = { snp: m(recent, 'snp') - m(before, 'snp'), opp: m(recent, 'opp') - m(before, 'opp'),
      tshare: (m(recent, 'tshare') ?? 0) - (m(before, 'tshare') ?? 0), rz: m(recent, 'rz') - m(before, 'rz') };
    const spark = R.map((r) => r.opp);
    const sum = `snaps ${R.map((r) => (r.snp == null ? '–' : r.snp + '%')).slice(-4).join(' → ')} · touches+targets ${R.map((r) => r.opp).slice(-4).join(' → ')}`;
    // QBs: only a starting-job change counts (pass volume swings with game script)
    const rising = p.pos === 'QB' ? d.snp >= 40 : (d.snp >= 12 && m(recent, 'opp') >= 4) || d.opp >= 4 || (d.tshare >= 0.07 && m(recent, 'tgt') >= 5);
    const falling = p.pos === 'QB' ? d.snp <= -40 : (d.snp <= -15 && m(before, 'opp') >= 6) || d.opp <= -5 || (d.tshare <= -0.08 && m(before, 'tgt') >= 5);
    if (rising) add({ type: 'role-up', p, score: 1 + Math.max(d.snp / 20, d.opp / 5, d.tshare * 10), title: `${p.name}'s role is growing`,
      detail: `${d.snp >= 1 ? `+${Math.round(d.snp)}% snaps, ` : ''}${d.opp >= 0.5 ? `+${d.opp.toFixed(1)} touches/targets a game, ` : ''}${d.tshare >= 0.02 ? `target share ${Math.round(m(before, 'tshare') * 100)}% → ${Math.round(m(recent, 'tshare') * 100)}%` : ''}`.replace(/, $/, ''), evidence: sum, spark });
    if (falling) add({ type: 'role-down', p, score: 1 + Math.max(-d.snp / 20, -d.opp / 5, -d.tshare * 10), title: `${p.name}'s role is shrinking`,
      detail: `${d.snp <= -1 ? `${Math.round(d.snp)}% snaps, ` : ''}${d.opp <= -0.5 ? `${d.opp.toFixed(1)} touches/targets a game, ` : ''}${d.tshare <= -0.02 ? `target share ${Math.round(m(before, 'tshare') * 100)}% → ${Math.round(m(recent, 'tshare') * 100)}%` : ''}`.replace(/, $/, ''), evidence: sum, spark });
    // luck vs role, last 3 games
    // expected = opportunities × (half position average, half his own season rate), so elite
    // players aren't flagged just for being efficient
    const own = R.reduce((t, r) => t + r.a, 0) / Math.max(1, R.reduce((t, r) => t + r.opp, 0));
    const rate = 0.5 * ppo[p.pos] + 0.5 * own;
    const l3 = R.slice(-3), xp = avg(l3.map((r) => r.opp * rate)), act = avg(l3.map((r) => r.a)), gap = act - xp;
    const useOk = avg(l3.map((r) => r.opp)) >= (p.pos === 'QB' ? 30 : 6);
    if (useOk && gap <= -4) add({ type: 'buy-low', p, score: 1 + -gap / 4, title: `Buy low: ${p.name}`,
      detail: `Usage says ~${xp.toFixed(1)} a game, he's scored ${act.toFixed(1)} over his last 3. Role intact, results should catch up.`, evidence: sum, spark });
    if (gap >= 5 && !rising) add({ type: 'sell-high', p, score: 1 + gap / 5, title: `Sell high: ${p.name}`,
      detail: `Scoring ${act.toFixed(1)} a game on usage worth ~${xp.toFixed(1)} (TDs/big plays). ${d.opp < 0 ? 'Role is also slipping.' : 'Role is flat.'}`, evidence: sum, spark });
    // waiver gem: free agent with a real, growing role
    if (!p.own && (rising || (m(recent, 'snp') >= 55 && m(recent, 'opp') >= 6))) add({ type: 'gem', p, score: 1.5 + (rising ? 1 : 0) + Math.min(2, (p.add24 || 0) / 200000),
      title: `Waiver gem: ${p.name}`, detail: `${p.pos} ${p.team}: ${Math.round(m(recent, 'snp') ?? 0)}% snaps, ${m(recent, 'opp').toFixed(1)} touches+targets a game lately${p.add24 ? ` · ${Math.round(p.add24 / 1000)}k adds in 24h` : ''}.`, evidence: sum, spark });
  }
  // injuries on rostered starters and the most relevant players
  for (const t of S.teams) for (const id of t.starters || []) {
    const p = P[id]; if (!p?.inj) continue;
    add({ type: 'injury', p, score: (['Out', 'IR', 'Doubtful'].includes(p.inj) ? 3 : 1.5), title: `${p.name}: ${p.inj}`, detail: p.injNote || 'Check the final practice report.', evidence: `${owner(t.rid)} starts him` });
  }
  for (const c of changes.slice(0, 60)) {
    const p = P[c.id]; if (!p) continue;
    if (c.kind === 'proj' && Math.abs(c.to - c.from) >= 2.5) add({ type: 'proj', p, score: 1 + Math.abs(c.to - c.from) / 4,
      title: c.from < 0.5 ? `${p.name} is projected to play again` : c.to < 0.5 ? `${p.name} is no longer projected to play` : `${p.name}: projection ${c.from.toFixed(1)} → ${c.to.toFixed(1)}`,
      detail: c.from < 0.5 ? `Sleeper now has him at ${c.to.toFixed(1)} this week (return from injury or a new role).` : c.to < 0.5 ? 'Injury, benching or a change at the position. Check the news.' : 'Sleeper moved his number this week.', evidence: '' });
    if (c.kind === 'trend' && !p.own) add({ type: 'trend', p, score: 1 + Math.min(2, c.to / 300000), title: `${p.name} is being picked up fast`, detail: `${c.to.toLocaleString()} adds in 6 hours across Sleeper.`, evidence: '' });
  }
  for (const n of S.news || []) for (const id of n.ids.slice(0, 2)) {
    const p = P[id]; if (!p || !p.own) continue;
    add({ type: 'news', p, score: 0.8, title: n.headline, detail: n.desc || '', link: n.link, time: n.time, evidence: '' });
  }
  const boost = { mine: 1.6, opponent: 1.2, 'free agent': 1.25, league: 1 };
  for (const s of out) s.rank = s.score * boost[s.tag] * (0.6 + Math.min(1.4, s.ros / 12));
  return out.sort((a, b) => b.rank - a.rank);
}
