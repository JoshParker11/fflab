// Analysis CLI that prints Markdown (with ```chart blocks the Lab tab renders).
//   node tools/analyze.mjs trade "<partner owner>" "Give A, Give B" "Get C"
//   node tools/analyze.mjs waivers [limit]
//   node tools/analyze.mjs outlook
// Player names are matched case-insensitively against the snapshot.
import { readFileSync } from 'node:fs';
import * as M from '../js/model.js';

const S = JSON.parse(readFileSync(new URL('../data/snapshot.json', import.meta.url)));
for (const id in S.players) S.players[id].id = id;
const ME = S.teams.find((t) => t.me);
const P = (id) => S.players[id];
const byName = (n) => {
  const q = n.trim().toLowerCase();
  const hit = Object.values(S.players).find((p) => p.name.toLowerCase() === q)
    || Object.values(S.players).find((p) => p.name.toLowerCase().includes(q));
  if (!hit) throw new Error(`no player "${n}"`);
  return hit.id;
};
const pct = (v) => `${Math.round(v * 100)}%`;
const sgn = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
const chart = (o) => '```chart\n' + JSON.stringify(o) + '\n```';
const weeksFrom = (n) => Array.from({ length: n }, (_, i) => `W${S.week + i}`);

const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'trade') {
  const partner = S.teams.find((t) => t.owner.toLowerCase() === args[0].toLowerCase());
  const give = args[1].split(',').map(byName), get = args[2].split(',').map(byName);
  const r = M.evalTrade(S, ME.rid, partner.rid, give, get, { n: 5000 });
  const nm = (ids) => ids.map((id) => P(id).name).join(' + ');
  const row = (id) => { const p = P(id); const nx = [0, 1, 2].map((i) => M.weekDist(p, S.week + i, S.week, S.live).mean);
    return `| ${p.name} | ${p.pos} ${p.team} | ${p.act.slice(1).map((x) => (x == null ? '–' : x.toFixed(1))).join(' / ')} | ${p.form.toFixed(2)} | ${nx.map((x) => x.toFixed(1)).join(' / ')} | ${p.bye} | ${M.playerValue(S, id).toFixed(0)} | ${(p.fc / 1000).toFixed(1)}k |`; };
  console.log(`## ${nm(give)} → ${partner.owner} for ${nm(get)}

| | You | ${partner.owner} |
|---|---|---|
| Weighted ROS lineup pts | **${sgn(r.me.value)}** | ${sgn(r.them.value)} |
| Next 3 weeks | ${sgn(r.me.next3)} | |
| Playoff weeks 15–17 | ${sgn(r.me.playoffWeeks)} | |
| Playoff odds | ${pct(r.me.odds0.playoffs)} → ${pct(r.me.odds1.playoffs)} | ${pct(r.them.odds0.playoffs)} → ${pct(r.them.odds1.playoffs)} |
| Top-2 bye odds | ${pct(r.me.odds0.bye)} → **${pct(r.me.odds1.bye)}** | ${pct(r.them.odds0.bye)} → ${pct(r.them.odds1.bye)} |
| Title odds | ${pct(r.me.odds0.title)} → **${pct(r.me.odds1.title)}** | ${pct(r.them.odds0.title)} → ${pct(r.them.odds1.title)} |
| Market value (FantasyCalc) | give ${(r.market.give / 1000).toFixed(1)}k | get ${(r.market.get / 1000).toFixed(1)}k |
| Veto risk | ${r.market.vetoRisk} | |
${r.me.dropped.length ? `\nYou'd need to drop: ${nm(r.me.dropped)}.\n` : ''}
| Player | Pos | Wk 1–${S.week - 1} actual | Form | Next 3 proj | Bye | ROS value | Market |
|---|---|---|---|---|---|---|---|
${[...give, ...get].map(row).join('\n')}

Your expected starting points, change by week:

${chart({ type: 'bars', labels: weeksFrom(r.me.weekly.length), values: r.me.weekly.map((x) => +x.toFixed(2)) })}
`);
} else if (cmd === 'waivers') {
  const b = M.waiverBoard(S, ME.rid, { limit: Number(args[0]) || 12 });
  console.log(`| Add | Pos | Gain | Next 3 wks | Bid | Drop | Adds 24h |\n|---|---|---|---|---|---|---|\n` +
    b.map((r) => { const p = P(r.id); return `| ${p.name}${p.inj ? ` (${p.inj})` : ''} | ${p.pos} ${p.team} | ${sgn(r.gain)} | ${r.weeks.slice(0, 3).map(sgn).join(' / ')} | $${r.bid} | ${P(r.drop).name} | ${p.add24 ? `${Math.round(p.add24 / 1000)}k` : ''} |`; }).join('\n'));
} else if (cmd === 'outlook') {
  const sim = M.simulate(S, { n: 5000 });
  const wk = M.lineupValue(S, M.activeIds(ME)).weeks;
  const rem = Object.keys(S.schedule).map(Number).filter((w) => w >= S.week && w < S.league.playoff_week_start);
  const owner = (rid) => S.teams.find((t) => t.rid === rid).owner;
  console.log(`| Team | W-L | Playoffs | Bye | #1 | Title |\n|---|---|---|---|---|---|\n` +
    [...S.teams].sort((a, b) => sim.odds[b.rid].title - sim.odds[a.rid].title).map((t) => { const o = sim.odds[t.rid];
      return `| ${t.me ? '**' + t.owner + '**' : t.owner} | ${t.wins}-${t.losses} | ${pct(o.playoffs)} | ${pct(o.bye)} | ${pct(o.seed1)} | ${pct(o.title)} |`; }).join('\n'));
  console.log('\n' + chart({ type: 'bars', labels: rem.map((w) => `W${w}`), sub: rem.map((w) => owner(S.schedule[w].find((g) => g.includes(ME.rid)).find((r) => r !== ME.rid))),
    values: rem.map((w) => { const g = S.schedule[w].find((x) => x.includes(ME.rid)); const o = g.find((r) => r !== ME.rid); return +M.winProb(sim.dist[w][ME.rid], sim.dist[w][o]).toFixed(3); }) }));
  console.log('\n' + chart({ type: 'lines', labels: weeksFrom(wk.length), series: [{ name: 'Expected starting points', values: wk.map((x) => +x.toFixed(1)), color: 'var(--act)' }] }));
} else {
  console.log('usage: analyze.mjs trade|waivers|outlook …');
}
