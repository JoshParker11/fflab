// Searches every team for trades that turn our spare parts into a better lineup.
//   node tools/tradefinder.mjs [maxGive=2] [fromWeek=current] [toWeek=17]
// e.g. `node tools/tradefinder.mjs 2 16 17` optimizes only the weeks a top-2 seed plays for the title.
// Ranks by our weighted ROS lineup gain, then keeps only deals the partner wouldn't hate
// (their lineup doesn't drop much) and that look fair on market value (veto league).
import { readFileSync } from 'node:fs';
import * as M from '../js/model.js';

const S = JSON.parse(readFileSync(new URL('../data/snapshot.json', import.meta.url)));
for (const id in S.players) S.players[id].id = id;
const P = S.players, ME = S.teams.find((t) => t.me);
const maxGive = Number(process.argv[2] || 2);
const from = Number(process.argv[3] || S.week), to = Number(process.argv[4] || 17);
const lv = (ids) => M.lineupValue(S, ids, { from, to }).value;
console.log(`Objective: weighted expected lineup, weeks ${from}–${to}`);
const ids0 = M.activeIds(ME), base = lv(ids0);

// Our tradeable pool: everyone except the core we'd only move for a clear upgrade.
const cost = Object.fromEntries(ids0.map((id) => [id, base - lv(ids0.filter((x) => x !== id))]));
const pool = ids0.filter((id) => P[id].pos !== 'K' && P[id].pos !== 'DEF').sort((a, b) => cost[a] - cost[b]);
const combos = [];
for (let i = 0; i < pool.length; i++) {
  combos.push([pool[i]]);
  if (maxGive > 1) for (let j = i + 1; j < pool.length; j++) combos.push([pool[i], pool[j]]);
}
const playoffPts = (id) => [15, 16, 17].reduce((t, w) => t + M.weekDist(P[id], w, S.week, S.live).mean, 0);
const out = [];
for (const t of S.teams.filter((x) => !x.me)) {
  const theirs = M.activeIds(t), tb = lv(theirs);
  const targets = theirs.filter((id) => ['QB', 'RB', 'WR', 'TE'].includes(P[id]?.pos) && M.playerValue(S, id) > 40);
  for (const get of targets) for (const give of combos) {
    const mine = M.trimRoster(S, [...ids0.filter((x) => !give.includes(x)), get]).ids;
    const gain = lv(mine) - base;
    if (gain < (to - from < 4 ? 1 : 4)) continue;
    const their = M.trimRoster(S, [...theirs.filter((x) => x !== get), ...give]).ids;
    const theirGain = lv(their) - tb;
    const gv = give.reduce((s, id) => s + (P[id].fc || 0), 0), gt = P[get].fc || 0;
    const gap = Math.abs(gv - gt) / Math.max(gv, gt, 1);
    out.push({ team: t.owner, rec: `${t.wins}-${t.losses}`, get, give, gain, theirGain, gap, gv, gt, po: playoffPts(get) - give.reduce((s, id) => s + playoffPts(id), 0) });
  }
}
const nm = (ids) => ids.map((id) => P[id].name).join(' + ');
const show = (rows, title) => {
  console.log(`\n## ${title}\n| Partner | Get | Give | Your gain | Their gain | Playoff-wk pts Δ | Market give/get |\n|---|---|---|---|---|---|---|`);
  for (const r of rows) console.log(`| ${r.team} (${r.rec}) | ${P[r.get].name} | ${nm(r.give)} | +${r.gain.toFixed(1)} | ${r.theirGain >= 0 ? '+' : ''}${r.theirGain.toFixed(1)} | ${r.po >= 0 ? '+' : ''}${r.po.toFixed(1)} | ${(r.gv / 1000).toFixed(1)}k / ${(r.gt / 1000).toFixed(1)}k |`);
};
console.log('Drop/trade cost of each of our players (weighted lineup pts):', pool.map((id) => `${P[id].name} ${cost[id].toFixed(1)}`).join(', '));
show(out.filter((r) => r.theirGain > -8 && r.gap < 0.3).sort((a, b) => b.gain - a.gain).slice(0, 25), 'Realistic: partner not hurt much, fair on market value');
show(out.sort((a, b) => b.gain - a.gain).slice(0, 12), 'Biggest gains regardless of fairness');
