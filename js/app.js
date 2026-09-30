import * as M from './model.js';
import { bars, lines, spark, fromSpec } from './charts.js';
import { overlay } from './live.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f1 = (v) => (v == null ? '–' : v.toFixed(1));
const pct = (v) => `${Math.round(v * 100)}%`;
const sgn = (v, d = 1) => `${v > 0 ? '+' : ''}${v.toFixed(d)}`;
const cls = (v, eps = 0.05) => (v > eps ? 'good' : v < -eps ? 'bad' : 'muted');
const ago = (t) => { const m = (Date.now() - Date.parse(t)) / 6e4; return m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
const kick = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

let S, ME, OPP, SIM, CHANGES = [], REPORTS = [];
const cache = {};
const P = (id) => S.players[id];
const team = (rid) => S.teams.find((t) => t.rid === rid);
const owner = (rid) => team(rid)?.owner ?? 'FA';

function injPill(p) {
  if (!p?.inj) return '';
  const bad = ['Out', 'IR', 'PUP', 'Sus', 'NA', 'Doubtful'].includes(p.inj);
  return ` <span class="pill ${bad ? 'bad' : 'act'}" title="${esc(p.injNote || '')}">${esc(p.inj)}</span>`;
}
function gameLine(p, w = S.week) {
  if (!p?.team) return '';
  if (w !== S.week) { const o = p.opp?.[w]; return o ? `vs ${o}` : 'BYE'; }
  const g = S.games[p.team];
  if (!g) return p.opp?.[w] ? `vs ${p.opp[w]}` : 'BYE';
  const at = g.home || g.neutral ? 'vs' : '@';
  if (g.state === 'post') return `${at} ${g.opp} · final ${g.score}-${g.oppScore}`;
  if (g.state === 'in') return `${at} ${g.opp} · ${g.detail}`;
  return `${at} ${g.opp} · ${kick(g.kickoff)}${g.implied != null ? ` · ${g.implied} pts implied` : ''}`;
}
function who(p, { game = true, w } = {}) {
  if (!p) return '<span class="faint">—</span>';
  return `<div class="pl"><span class="n">${esc(p.name)}${injPill(p)}</span><span class="m">${p.pos} · ${p.team || 'FA'}${game ? ` · ${esc(gameLine(p, w))}` : ''}</span></div>`;
}

// ------------------------------------------------------------ boot
async function load() {
  const bust = `?t=${Date.now()}`;
  S = await fetch(`data/snapshot.json${bust}`).then((r) => r.json());
  const baked = await fetch(`data/changes.json${bust}`).then((r) => r.json()).catch(() => []);
  REPORTS = await fetch(`reports/index.json${bust}`).then((r) => r.json()).catch(() => []);
  for (const id in S.players) S.players[id].id = id;
  $('#stamp-t').textContent = 'pulling live data…';
  const live = await Promise.race([overlay(S).catch((e) => (console.warn(e), { ok: false, changes: [] })),
    new Promise((r) => setTimeout(() => r({ ok: false, changes: [] }), 12000))]);
  CHANGES = [...live.changes, ...baked].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  ME = S.teams.find((t) => t.me);
  const g = (S.schedule[S.week] || []).find((x) => x.includes(ME.rid));
  OPP = g && team(g.find((r) => r !== ME.rid));
  SIM = M.simulate(S, { n: 5000 });
  for (const k in cache) delete cache[k];
  $('#stamp-t').textContent = `Week ${S.week} · ${live.ok ? 'live now' : 'live pull failed'} · model ${ago(S.generated)} old`;
}

const TABS = { command: renderCommand, pulse: renderPulse, waivers: renderWaivers, trade: renderTrade,
  opponents: renderOpponents, roster: renderRoster, lab: renderLab };
function route() {
  const [tab, arg] = (location.hash.slice(1) || 'command').split('/');
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  const el = $('main');
  el.innerHTML = '<div class="loading">crunching…</div>';
  setTimeout(() => { el.innerHTML = (TABS[tab] || renderCommand)(arg); afterRender(tab); window.scrollTo(0, 0); }, 10);
}

// ------------------------------------------------------------ command
function myLineup(rid = ME.rid, w = S.week) {
  return M.bestLineup(M.activeIds(team(rid)), S.players, w, S.week, M.starterSlots(S), S.live);
}
function setLineup(t) { // what Sleeper actually has set
  const slots = M.starterSlots(S);
  return t.starters.map((id, i) => ({ slot: slots[i], p: P(id), ...(P(id) ? M.weekDist(P(id), S.week, S.week, S.live) : { mean: 0, sd: 0 }) }));
}

function actions() {
  const out = [];
  const best = myLineup(), set = setLineup(ME);
  const setIds = new Set(set.map((x) => x.p?.id)), bestIds = new Set(best.lineup.map((x) => x.p?.id));
  const benchIn = best.lineup.filter((x) => x.p && !setIds.has(x.p.id));
  const benchOut = set.filter((x) => x.p && !bestIds.has(x.p.id)).sort((a, b) => a.mean - b.mean);
  benchIn.forEach((x, i) => {
    const o = benchOut[i];
    const gain = x.mean - (o?.mean ?? 0);
    if (gain >= 0.5) out.push({ lvl: gain > 3 ? 'hi' : '', t: `Start ${x.p.name} over ${o?.p?.name ?? 'empty slot'}`,
      d: `+${gain.toFixed(1)} projected. ${x.p.name}: ${f1(x.mean)} (${gameLine(x.p)}). ${o?.p ? `${o.p.name}: ${f1(o.mean)}${o.p.inj ? `, ${o.p.inj}` : ''}.` : ''}` });
  });
  for (const x of set) if (x.p && ['Out', 'IR', 'PUP', 'Sus', 'Doubtful'].includes(x.p.inj))
    out.push({ lvl: 'warn', t: `${x.p.name} is ${x.p.inj} and in your lineup`, d: x.p.injNote || 'Swap him out before kickoff.' });
  for (const x of set) if (x.p?.inj === 'Questionable') {
    const g = S.games[x.p.team];
    out.push({ lvl: '', t: `${x.p.name} is questionable`, d: `Kickoff ${g ? kick(g.kickoff) : '?'}${g?.neutral ? ' (international — early lock)' : ''}. ${x.p.injNote ? `${x.p.injNote}. ` : ''}Check the final practice report; have a backup ready.` });
  }
  if (!cache.plan) {
    out.push({ lvl: '', t: 'Working out your waiver claims…', d: 'Testing every free agent against every week of your lineup.' });
    if (!cache.planning) cache.planning = setTimeout(() => { cache.plan = M.waiverPlan(S, ME.rid); if (!location.hash || location.hash === '#command') route(); }, 50);
  }
  (cache.plan || []).forEach((r, i) => out.push({ lvl: r.gain > 8 ? 'hi' : '', t: `Claim ${i + 1}: add ${P(r.id).name}${r.bid ? ` ($${r.bid})` : ''}, drop ${P(r.drop).name}`,
    d: `+${r.gain.toFixed(1)} weighted lineup points ROS; next 3 wks ${r.weeks.slice(0, 3).map((x) => sgn(x)).join(' / ')}.${P(r.id).add24 > 500000 ? ' Heavily added right now; expect competition.' : ''}` }));
  const wk = M.lineupValue(S, M.activeIds(ME)).weeks, avg = wk.reduce((a, b) => a + b, 0) / wk.length;
  wk.slice(1, 6).forEach((v, i) => { if (v < avg * 0.92) out.push({ lvl: '', t: `Week ${S.week + 1 + i} looks thin (${v.toFixed(0)} vs ${avg.toFixed(0)} avg)`,
    d: `Byes: ${M.activeIds(ME).map(P).filter((p) => p?.bye === S.week + 1 + i).map((p) => p.name).join(', ') || 'none — matchups/injuries'}. Plan an add or trade before then.` }); });
  if (OPP) for (const x of setLineup(OPP)) if (x.p?.inj) out.push({ lvl: 'ok', t: `Opponent's ${x.p.name} is ${x.p.inj}`, d: `${OPP.owner} may lose ~${f1(x.mean)} if he sits.` });
  return out;
}

function renderCommand() {
  const o = SIM.odds[ME.rid];
  const rank = [...S.teams].sort((a, b) => b.pf - a.pf).findIndex((t) => t.rid === ME.rid) + 1;
  const mine = SIM.dist[S.week][ME.rid], theirs = OPP && SIM.dist[S.week][OPP.rid];
  const wp = OPP ? M.winProb(mine, theirs) : null;
  const acts = actions();
  const remaining = Object.keys(S.schedule).map(Number).filter((w) => w >= S.week && w < S.league.playoff_week_start);
  const stale = S.staleWeek ? `<div class="card" style="margin-bottom:14px;border-color:var(--act)"><b class="act">Week ${S.staleWeek} has started.</b> <span class="muted">The season model is still on Week ${S.week}. Ask Claude to run a fresh snapshot.</span></div>` : '';
  const liveM = S.live.matchups && OPP && (S.live.matchups[ME.rid] || S.live.matchups[OPP.rid]) ? `<div class="row" style="justify-content:center;gap:18px;margin-top:6px"><span class="act">live ${f1(S.live.matchups[ME.rid])}</span><span class="faint">–</span><span class="act">${f1(S.live.matchups[OPP.rid])}</span></div>` : '';
  return `${stale}
  <div class="kpis">
    ${kpi(`${ME.wins}-${ME.losses}`, 'record', `PF #${rank}`)}
    ${kpi(pct(o.playoffs), 'playoffs')}
    ${kpi(pct(o.bye), 'top-2 bye')}
    ${kpi(pct(o.seed1), '#1 seed')}
    ${kpi(pct(o.title), 'title')}
    ${kpi(`$${ME.faab}`, 'FAAB left')}
  </div>
  <div class="grid two" style="margin-top:14px">
    <div class="card">
      <h2>Do this <small>${acts.length} items</small></h2>
      ${acts.length ? acts.map((a) => `<div class="action ${a.lvl}"><i></i><div><b>${esc(a.t)}</b><p>${esc(a.d)}</p></div></div>`).join('') : '<div class="empty">Nothing urgent. Lineup is optimal.</div>'}
    </div>
    <div class="card">
      <h2>Week ${S.week} matchup <small>${OPP ? `${esc(OPP.team)}` : ''}</small></h2>
      ${OPP ? `
      <div class="vs">
        <div><div class="big">${f1(mine.mean)}</div><div class="who">${esc(ME.owner)}</div></div>
        <div class="who">proj</div>
        <div><div class="big">${f1(theirs.mean)}</div><div class="who">${esc(OPP.owner)}</div></div>
      </div>
      ${liveM}
      <div class="bar"><span style="width:${wp * 100}%;background:var(--good)"></span><span style="flex:1;background:var(--bad);opacity:.7"></span></div>
      <div class="row"><b class="${wp >= 0.5 ? 'good' : 'bad'}">${pct(wp)} win</b><span class="sp"></span><span class="faint">±${f1(Math.hypot(mine.sd, theirs.sd))} pts swing</span></div>
      <div class="scroll" style="margin-top:8px">${slotTable(myLineup(), myLineup(OPP.rid))}</div>` : '<div class="empty">No matchup</div>'}
    </div>
  </div>
  <div class="card" style="margin-top:14px">
    <h2>Win probability by week <small>matchup-aware projections, byes included</small></h2>
    ${bars({ labels: remaining.map((w) => `W${w}`), sub: remaining.map((w) => owner(S.schedule[w].find((g) => g.includes(ME.rid))?.find((r) => r !== ME.rid))),
      values: remaining.map((w) => { const g = S.schedule[w].find((x) => x.includes(ME.rid)); const opp = g.find((r) => r !== ME.rid); return M.winProb(SIM.dist[w][ME.rid], SIM.dist[w][opp]); }),
      color: (v) => (v >= 0.6 ? 'var(--good)' : v >= 0.45 ? 'var(--act)' : 'var(--bad)'), fmt: (v) => pct(v), height: 170 })}
  </div>
  <div class="card" style="margin-top:14px">
    <h2>Standings & odds <small>${(5000).toLocaleString()} simulated seasons</small></h2>
    <div class="scroll">${standingsTable()}</div>
  </div>`;
}
const kpi = (v, k, d = '') => `<div class="kpi"><div class="v">${v}</div><div class="k">${k}${d ? ` · <span class="faint">${d}</span>` : ''}</div></div>`;

function slotTable(a, b) {
  return `<table class="slots"><tr><th class="l">${esc(ME.owner)}</th><th>proj</th><th></th><th>proj</th><th class="l">${esc(OPP.owner)}</th></tr>
  ${a.lineup.map((x, i) => { const y = b.lineup[i]; const live = (p) => (p && S.live.pts[p.id] != null && S.games[p.team]?.state !== 'pre' ? ` <span class="act">${f1(S.live.pts[p.id])}</span>` : '');
    return `<tr><td class="l">${who(x.p)}</td><td class="${x.mean > y.mean ? 'good' : ''}">${f1(x.mean)}${live(x.p)}</td><td>${x.slot}</td><td class="${y.mean > x.mean ? 'good' : ''}">${f1(y.mean)}${live(y.p)}</td><td class="l">${who(y.p)}</td></tr>`; }).join('')}
  </table>`;
}

function allPlay() {
  const ap = Object.fromEntries(S.teams.map((t) => [t.rid, 0])); let games = 0;
  for (const w in S.results) {
    const r = S.results[w]; games += S.teams.length - 1;
    for (const t of S.teams) ap[t.rid] += S.teams.filter((u) => r[u.rid] < r[t.rid]).length;
  }
  return { ap, games };
}
function standingsTable() {
  const { ap, games } = allPlay();
  const rows = [...S.teams].sort((a, b) => b.wins - a.wins || b.pf - a.pf);
  return `<table><tr><th class="l">#</th><th class="l">Team</th><th>W-L</th><th>PF</th><th>All-play</th><th>Luck</th><th>Playoffs</th><th>Bye</th><th>Title</th><th>Proj W</th></tr>
  ${rows.map((t, i) => { const o = SIM.odds[t.rid]; const exp = games ? (ap[t.rid] / games) * (t.wins + t.losses) : 0; const luck = t.wins - exp;
    return `<tr class="${t.me ? 'me' : ''}"><td class="l">${i + 1}</td><td class="l"><a href="#opponents/${t.rid}">${esc(t.owner)}</a><span class="sub">${esc(t.team)}</span></td>
    <td>${t.wins}-${t.losses}</td><td>${f1(t.pf)}</td><td>${ap[t.rid]}-${games - ap[t.rid]}</td><td class="${cls(luck, 0.3)}">${sgn(luck)}</td>
    <td>${pct(o.playoffs)}</td><td>${pct(o.bye)}</td><td>${pct(o.title)}</td><td>${o.wins.toFixed(1)}</td></tr>`; }).join('')}</table>`;
}

// ------------------------------------------------------------ pulse
function renderPulse() {
  const rel = (p) => (p.own === ME.rid ? 'mine' : p.own === OPP?.rid ? 'opp' : !p.own ? 'fa' : 'other');
  const tag = { mine: '<span class="pill act">mine</span>', opp: '<span class="pill bad">opp</span>', fa: '<span class="pill good">FA</span>', other: `` };
  const ch = CHANGES.slice(0, 60).map((c) => {
    const p = c.id && P(c.id);
    let t = '';
    if (c.kind === 'injury') t = `<b>${esc(p?.name)}</b> ${esc(c.from || 'healthy')} → <b class="${c.to ? 'bad' : 'good'}">${esc(c.to || 'healthy')}</b>`;
    else if (c.kind === 'proj') t = `<b>${esc(p?.name)}</b> projection ${f1(c.from)} → <b class="${c.to > c.from ? 'good' : 'bad'}">${f1(c.to)}</b>`;
    else if (c.kind === 'trend') t = `<b>${esc(p?.name)}</b> adds surging: ${c.to.toLocaleString()} in 6h`;
    else if (c.kind === 'move') t = `<b>${esc(p?.name)}</b> ${c.to ? `→ ${esc(owner(c.to))}` : `dropped by ${esc(owner(c.from))}`}`;
    else if (c.kind === 'line') t = `<b>${esc(c.team)}</b> game ${c.what} ${c.from} → <b>${c.to}</b>`;
    return `<div class="feed-item"><time>${ago(c.at)} ago</time><div>${t} ${p ? tag[rel(p)] : ''}</div></div>`;
  }).join('');
  const trending = Object.values(S.players).filter((p) => p.add24 > 0).sort((a, b) => b.add24 - a.add24).slice(0, 20);
  const dropping = Object.values(S.players).filter((p) => p.drop24 > 0).sort((a, b) => b.drop24 - a.drop24).slice(0, 12);
  const mineIds = new Set([...ME.players, ...(OPP?.players || [])]);
  const hurt = Object.values(S.players).filter((p) => p.inj && (mineIds.has(p.id) || (p.proj[S.week] || 0) >= 10)).sort((a, b) => (mineIds.has(b.id) - mineIds.has(a.id)) || b.proj[S.week] - a.proj[S.week]).slice(0, 30);
  const myTeams = new Set([...ME.starters, ...(OPP?.starters || [])].map((id) => P(id)?.team));
  return `
  <div class="grid two">
    <div class="card"><h2>What changed <small>since you last looked · last 7 days</small></h2>
      ${ch || '<div class="empty">No changes logged yet. Each refresh compares with the previous snapshot.</div>'}</div>
    <div class="card"><h2>Trending adds <small>Sleeper, 24h (6h)</small></h2>
      <table>${trending.map((p) => `<tr><td class="l">${who(p, { game: false })}</td><td>${tag[rel(p)] || esc(owner(p.own))}</td><td>${(p.add24 / 1000).toFixed(0)}k<span class="sub">${p.add6 ? `${(p.add6 / 1000).toFixed(0)}k/6h` : ''}</span></td></tr>`).join('')}</table></div>
  </div>
  <div class="grid half" style="margin-top:14px">
    <div class="card"><h2>Betting lines <small>ESPN / DraftKings · implied team points</small></h2><div class="scroll">
      <table><tr><th class="l">Game</th><th>Kick</th><th>Spread</th><th>Total</th><th>Implied</th></tr>
      ${Object.entries(S.games).filter(([t, g]) => g.home || (g.neutral && t < g.opp && !S.games[g.opp]?.home)).sort((a, b) => Date.parse(a[1].kickoff) - Date.parse(b[1].kickoff)).map(([t, g]) => {
        const o = S.games[g.opp]; const star = myTeams.has(t) || myTeams.has(g.opp);
        return `<tr><td class="l">${star ? '<span class="act">●</span> ' : ''}${g.opp} @ ${t}</td><td>${kick(g.kickoff)}</td><td>${t} ${g.spread > 0 ? '+' : ''}${g.spread ?? '–'}</td><td>${g.total ?? '–'}</td><td>${o?.implied ?? '–'} / ${g.implied ?? '–'}</td></tr>`; }).join('')}</table></div>
      <p class="faint" style="font-size:12px">● = a starter in your matchup plays in this game. High implied totals mean more points for everyone in that game.</p></div>
    <div class="card"><h2>Injury watch <small>your matchup + key players</small></h2>
      <table>${hurt.map((p) => `<tr><td class="l">${who(p, { game: false })}</td><td>${tag[rel(p)] || esc(owner(p.own))}</td><td class="l faint" style="white-space:normal;font-size:12px">${esc(p.injNote || '')}</td></tr>`).join('')}</table></div>
  </div>
  <div class="grid half" style="margin-top:14px">
    <div class="card"><h2>News <small>ESPN · tagged players</small></h2>
      ${S.news.slice(0, 25).map((n) => `<div class="feed-item"><time>${ago(n.time)}</time><div><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.headline)}</a><div class="faint" style="font-size:12px">${n.ids.map((id) => P(id)).filter(Boolean).map((p) => `${esc(p.name)}${p.own ? ` (${esc(owner(p.own))})` : ' (FA)'}`).join(', ')}</div></div></div>`).join('') || '<div class="empty">No tagged news</div>'}</div>
    <div class="card"><h2>Being dropped <small>24h</small></h2>
      <table>${dropping.map((p) => `<tr><td class="l">${who(p, { game: false })}</td><td>${tag[rel(p)] || esc(owner(p.own))}</td><td>${(p.drop24 / 1000).toFixed(0)}k</td></tr>`).join('')}</table>
      <p class="faint" style="font-size:12px">Mass drops of a player whose snaps and targets held up are a cheap buy.</p></div>
  </div>`;
}

// ------------------------------------------------------------ waivers
function waiverBoardCached() { return (cache.board ||= M.waiverBoard(S, ME.rid, { limit: 60 })); }
let wpos = 'ALL';
function renderWaivers() {
  const board = waiverBoardCached().filter((r) => wpos === 'ALL' || P(r.id).pos === wpos);
  const stream = (pos) => Object.values(S.players).filter((p) => !p.own && p.pos === pos)
    .map((p) => ({ p, w: [S.week, S.week + 1, S.week + 2].map((w) => M.weekDist(p, w, S.week, S.live).mean) }))
    .sort((a, b) => b.w[0] - a.w[0]).slice(0, 8);
  const streamTbl = (pos) => `<table><tr><th class="l">${pos}</th>${[S.week, S.week + 1, S.week + 2].map((w) => `<th>W${w}</th>`).join('')}</tr>
    ${stream(pos).map(({ p, w }) => `<tr><td class="l">${who(p, { game: false })}</td>${w.map((v, i) => `<td>${f1(v)}<span class="sub">${esc(p.opp?.[S.week + i] || 'bye')}</span></td>`).join('')}</tr>`).join('')}</table>`;
  return `
  <div class="card">
    <h2>Waiver board <small>gain = added weighted lineup points ROS for your team, dropping the player shown</small></h2>
    <div class="row" style="margin-bottom:8px"><div class="seg">${['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map((p) => `<button data-wpos="${p}" class="${p === wpos ? 'on' : ''}">${p}</button>`).join('')}</div>
      <span class="sp"></span><span class="faint">$${ME.faab} left · league high bid $${S.league.max_bid_seen}</span></div>
    <div class="scroll"><table>
      <tr><th class="l">Player</th><th>Gain</th><th>Next 3 wks</th><th>Bid</th><th class="l">Drop</th><th>W${S.week}</th><th>Usage (snap/tgt/ru)</th><th>Adds 24h</th></tr>
      ${board.map((r) => { const p = P(r.id); const u = p.use.slice(-3).filter(Boolean);
        return `<tr><td class="l">${who(p)}</td><td class="${cls(r.gain, 1)}"><b>${sgn(r.gain)}</b></td><td>${r.weeks.slice(0, 3).map((x) => `<span class="${cls(x, 0.3)}">${sgn(x)}</span>`).join(' ')}</td>
        <td><b>${r.bid ? `$${r.bid}` : '$0'}</b></td><td class="l">${esc(P(r.drop)?.name)}</td><td>${f1(p.proj[S.week] * (p.form || 1))}</td>
        <td class="faint">${u.map((x) => `${x.snp ?? '–'}/${x.tgt}/${x.ru}`).join(' · ')}</td><td>${p.add24 ? `${(p.add24 / 1000).toFixed(0)}k` : ''}</td></tr>`; }).join('')}
    </table></div>
    <p class="faint" style="font-size:12px">How it works: every week from now to 17 we build your best lineup with and without the player, using that week's matchup projection, byes, injuries and random injury draws (so depth counts). Near weeks count more (×0.9 per week out). QB/K/DEF are valued as streamable after next week. Suggested bid ≈ $1 per weighted point, scaled to this league's bidding, capped at 60% of your budget.</p>
  </div>
  <div class="grid half" style="margin-top:14px">
    <div class="card"><h2>Kicker streams</h2>${streamTbl('K')}</div>
    <div class="card"><h2>Defense streams</h2>${streamTbl('DEF')}</div>
  </div>`;
}

// ------------------------------------------------------------ trade lab
const T = { partner: null, give: [], get: [], result: null };
function renderTrade(arg) {
  if (arg && !T.partner) T.partner = Number(arg);
  const partners = S.teams.filter((t) => !t.me);
  const pt = T.partner && team(T.partner);
  const opt = (ids, sel) => ids.map(P).filter(Boolean).sort((a, b) => b.fc - a.fc).map((p) => `<option value="${p.id}" ${sel.includes(p.id) ? 'disabled' : ''}>${esc(p.name)} · ${p.pos} ${p.team || ''}${p.inj ? ` (${p.inj})` : ''}</option>`).join('');
  const chips = (arr, side) => arr.map((id) => `<span class="chip">${esc(P(id).name)} <button data-rm="${side}:${id}">×</button></span>`).join('') || '<span class="faint">add players…</span>';
  const r = T.result;
  return `
  <div class="grid half">
    <div class="card"><h2>You give</h2>
      <select id="give-sel"><option value="">+ add from your roster</option>${opt(ME.players, T.give)}</select>
      <div class="chips">${chips(T.give, 'give')}</div></div>
    <div class="card"><h2>You get</h2>
      <select id="partner-sel"><option value="">choose a partner…</option>${partners.map((t) => `<option value="${t.rid}" ${t.rid === T.partner ? 'selected' : ''}>${esc(t.owner)} (${t.wins}-${t.losses})</option>`).join('')}</select>
      ${pt ? `<select id="get-sel" style="margin-top:8px"><option value="">+ add from ${esc(pt.owner)}</option>${opt(pt.players, T.get)}</select>` : ''}
      <div class="chips">${chips(T.get, 'get')}</div></div>
  </div>
  <div class="row" style="margin:12px 0"><button class="btn" id="run-trade" ${T.partner && T.give.length && T.get.length ? '' : 'disabled'}>Analyze trade</button>
    <button class="btn ghost" id="clear-trade">Clear</button><span class="sp"></span><span class="faint" style="font-size:12px">Runs 3,000 season sims before and after</span></div>
  ${r ? tradeResult(r) : ''}
  ${partnerFinder()}`;
}
function tradeResult(r) {
  const d = (a, b, f = pct) => `${f(a)} → <b class="${cls(b - a, 0.005)}">${f(b)}</b>`;
  const verdict = r.me.value > 5 && r.me.playoffWeeks > -3 ? ['good', 'Accept-worthy for you'] : r.me.value > 0 ? ['act', 'Slight edge — check fit'] : ['bad', 'Hurts your team'];
  const labels = r.me.weekly.map((_, i) => `W${S.week + i}`);
  return `<div class="card">
    <h2>Result <small>${esc(r.names.me)} ⇄ ${esc(r.names.them)}</small></h2>
    <div class="row" style="margin-bottom:10px"><b class="${verdict[0]}" style="font-size:17px">${verdict[1]}</b><span class="sp"></span>
      <span class="pill ${r.market.vetoRisk === 'low' ? 'good' : r.market.vetoRisk === 'medium' ? 'act' : 'bad'}">veto risk: ${r.market.vetoRisk}</span></div>
    <div class="kpis">
      ${kpi(sgn(r.me.value), 'your weighted ROS pts')}
      ${kpi(sgn(r.me.next3), 'next 3 weeks')}
      ${kpi(sgn(r.me.playoffWeeks), 'playoff weeks 15–17')}
      ${kpi(d(r.me.odds0.bye, r.me.odds1.bye), 'bye odds')}
      ${kpi(d(r.me.odds0.title, r.me.odds1.title), 'title odds')}
      ${kpi(sgn(r.them.value), `${esc(r.names.them)} weighted`)}
      ${kpi(d(r.them.odds0.playoffs, r.them.odds1.playoffs), `${esc(r.names.them)} playoffs`)}
      ${kpi(`${(r.market.give / 1000).toFixed(1)}k / ${(r.market.get / 1000).toFixed(1)}k`, 'market value give/get')}
    </div>
    <h2 style="margin-top:16px">Your expected starting points, change by week</h2>
    ${bars({ labels, values: r.me.weekly, height: 150 })}
    ${r.me.dropped.length ? `<p class="muted">Roster limit: you'd have to drop ${r.me.dropped.map((id) => esc(P(id).name)).join(', ')}.</p>` : ''}
    ${r.them.dropped.length ? `<p class="muted">They'd have to drop ${r.them.dropped.map((id) => esc(P(id).name)).join(', ')}.</p>` : ''}
    <p class="faint" style="font-size:12px">Market value = FantasyCalc consensus redraft values. The gap between the two sides drives veto risk in a league-vote league. A deal that is fair on market value but better for your lineup is the target.</p>
  </div>`;
}
function partnerFinder() {
  const { prof, avg } = cache.prof ||= M.positionProfile(S);
  const groups = ['QB', 'RB', 'WR', 'TE', 'FLEX'];
  const mine = prof[ME.rid];
  return `<div class="card" style="margin-top:14px"><h2>Partner finder <small>this week's starting strength by slot vs league average</small></h2><div class="scroll">
    <table class="heat"><tr><th class="l">Team</th>${groups.map((g) => `<th>${g}</th>`).join('')}<th class="l">Needs</th><th class="l">Fits your surplus?</th></tr>
    ${S.teams.map((t) => { const pr = prof[t.rid];
      const needs = groups.filter((g) => (pr[g] || 0) < avg[g] * 0.9);
      const surplus = groups.filter((g) => (mine[g] || 0) > avg[g] * 1.05);
      const fit = needs.filter((n) => surplus.includes(n) || n === 'FLEX');
      return `<tr class="${t.me ? 'me' : ''}"><td class="l">${t.me ? esc(t.owner) : `<a href="#trade/${t.rid}" data-partner="${t.rid}">${esc(t.owner)}</a>`}</td>${groups.map((g) => { const v = (pr[g] || 0) - avg[g];
        return `<td class="h" style="background:color-mix(in srgb, ${v >= 0 ? 'var(--good)' : 'var(--bad)'} ${Math.min(45, Math.abs(v) * 6)}%, transparent)">${sgn(v)}</td>`; }).join('')}
        <td class="l">${t.me ? '' : needs.join(', ') || '—'}</td><td class="l">${t.me ? '' : fit.length ? `<span class="good">${fit.join(', ')}</span>` : ''}</td></tr>`; }).join('')}
    </table></div></div>`;
}

// ------------------------------------------------------------ opponents
function renderOpponents(arg) {
  const { ap, games } = allPlay();
  const strength = Object.fromEntries(S.teams.map((t) => [t.rid, M.lineupValue(S, M.activeIds(t), { to: Math.min(S.week + 3, 17) })]));
  const rows = [...S.teams].sort((a, b) => strength[b.rid].value - strength[a.rid].value);
  const sel = arg ? team(Number(arg)) : OPP;
  return `
  <div class="card"><h2>Power ranking <small>expected lineup next 4 weeks (weighted) · not record</small></h2><div class="scroll">
    <table><tr><th class="l">#</th><th class="l">Team</th><th>Next 4 wks</th><th>This wk</th><th>W-L</th><th>All-play</th><th>FAAB</th><th>Moves</th><th>Playoffs</th></tr>
    ${rows.map((t, i) => `<tr class="${t.me ? 'me' : ''}"><td class="l">${i + 1}</td><td class="l"><a href="#opponents/${t.rid}">${esc(t.owner)}</a><span class="sub">${esc(t.team)}</span></td>
      <td>${strength[t.rid].weeks.map((x) => x.toFixed(0)).join(' · ')}</td><td><b>${f1(strength[t.rid].weeks[0])}</b></td><td>${t.wins}-${t.losses}</td><td>${ap[t.rid]}-${games - ap[t.rid]}</td>
      <td>$${t.faab}</td><td>${t.moves}</td><td>${pct(SIM.odds[t.rid].playoffs)}</td></tr>`).join('')}</table></div></div>
  ${sel ? teamCard(sel) : ''}`;
}
function teamCard(t) {
  const lu = myLineup(t.rid);
  const { prof, avg } = cache.prof ||= M.positionProfile(S);
  const wk = M.lineupValue(S, M.activeIds(t)).weeks;
  const labels = wk.map((_, i) => `W${S.week + i}`);
  const hurt = t.players.map(P).filter((p) => p?.inj);
  const myWk = M.lineupValue(S, M.activeIds(ME)).weeks;
  return `<div class="card" style="margin-top:14px">
    <h2>${esc(t.owner)} · ${esc(t.team)} <small>${t.wins}-${t.losses} · $${t.faab} FAAB · ${t.moves} moves</small></h2>
    <div class="grid half">
      <div><table><tr><th class="l">Slot</th><th class="l">Best lineup W${S.week}</th><th>Proj</th></tr>
        ${lu.lineup.map((x) => `<tr><td class="l faint">${x.slot}</td><td class="l">${who(x.p)}</td><td>${f1(x.mean)}</td></tr>`).join('')}
        <tr><td></td><td class="l faint">Bench: ${lu.bench.map((x) => esc(x.p.name)).join(', ')}</td><td></td></tr></table></div>
      <div>
        <div class="kpis">${['QB', 'RB', 'WR', 'TE', 'FLEX'].map((g) => { const v = (prof[t.rid][g] || 0) - avg[g]; return kpi(`<span class="${cls(v, 1)}">${sgn(v)}</span>`, `${g} vs avg`); }).join('')}</div>
        <h2 style="margin-top:14px">Weekly outlook vs yours</h2>
        ${lines({ labels, series: [{ name: t.owner, values: wk, color: 'var(--bad)' }, { name: `${ME.owner}`, values: myWk, color: 'var(--act)' }] })}
        ${hurt.length ? `<p class="muted" style="font-size:13px">Injuries: ${hurt.map((p) => `${esc(p.name)} (${p.inj})`).join(', ')}</p>` : ''}
        ${t.me ? '' : `<a class="btn ghost" href="#trade/${t.rid}" data-partner="${t.rid}" style="display:inline-block;margin-top:6px">Build a trade with ${esc(t.owner)} →</a>`}
      </div>
    </div></div>`;
}

// ------------------------------------------------------------ roster
function renderRoster() {
  const ids = [...ME.players];
  const vals = Object.fromEntries(ids.map((id) => [id, M.playerValue(S, id)]));
  const order = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DEF: 5 };
  ids.sort((a, b) => order[P(a)?.pos] - order[P(b)?.pos] || vals[b] - vals[a]);
  const W = [S.week, S.week + 1, S.week + 2].filter((w) => w <= 17);
  const wk = M.lineupValue(S, M.activeIds(ME)).weeks;
  return `<div class="card"><h2>My roster <small>form = how recent results move the projection (1.00 = on track)</small></h2><div class="scroll">
    <table><tr><th class="l">Player</th><th>Wk 1–${S.week - 1}</th><th>Snap% · tgt · ru (last 3)</th><th>Form</th>${W.map((w) => `<th>W${w}</th>`).join('')}<th>Bye</th><th>ROS val</th><th>Market</th></tr>
    ${ids.map((id) => { const p = P(id); if (!p) return ''; const u = p.use.slice(-3).filter(Boolean);
      return `<tr><td class="l">${who(p, { game: false })}${ME.reserve.includes(id) ? ' <span class="pill">IR slot</span>' : ''}</td>
      <td>${spark(p.act.slice(1))} <span class="faint">${p.act.slice(1).map((x) => (x == null ? '–' : x.toFixed(0))).join('/')}</span></td>
      <td class="faint">${u.map((x) => `${x.snp ?? '–'}·${x.tgt}·${x.ru}`).join('  ')}</td>
      <td class="${cls(p.form - 1, 0.05)}">${p.form.toFixed(2)}</td>
      ${W.map((w) => `<td>${f1(M.weekDist(p, w, S.week, S.live).mean)}<span class="sub">${esc(p.opp?.[w] || 'BYE')}</span></td>`).join('')}
      <td>${p.bye ?? ''}</td><td>${vals[id].toFixed(0)}</td><td>${p.fc ? `${(p.fc / 1000).toFixed(1)}k` : '–'}<span class="sub ${cls(p.fcTrend, 20)}">${p.fcTrend ? sgn(p.fcTrend, 0) : ''}</span></td></tr>`; }).join('')}
    </table></div></div>
  <div class="card" style="margin-top:14px"><h2>Expected starting lineup by week <small>byes, matchups, injury depth</small></h2>
    ${bars({ labels: wk.map((_, i) => `W${S.week + i}`), values: wk, color: (v) => (v < (wk.reduce((a, b) => a + b, 0) / wk.length) * 0.93 ? 'var(--bad)' : 'var(--info)'), fmt: (v) => v.toFixed(0), height: 160 })}
  </div>`;
}

// ------------------------------------------------------------ lab
let marked;
function renderLab(arg) {
  if (arg) return `<div class="card report" id="report"><div class="loading">loading report…</div></div>`;
  const o = SIM.odds;
  return `<div class="grid two">
    <div class="card"><h2>Reports <small>analysis from our conversations</small></h2>
      ${REPORTS.length ? REPORTS.map((r) => `<div class="list-item" onclick="location.hash='lab/${encodeURIComponent(r.file)}'"><b>${esc(r.title)}</b><div class="faint" style="font-size:12px">${esc(r.date)} · ${esc(r.summary || '')}</div></div>`).join('') : '<div class="empty">No reports yet.</div>'}</div>
    <div class="card"><h2>Season simulator <small>5,000 runs · live</small></h2>
      ${bars({ labels: S.teams.map((t) => t.owner.slice(0, 7)), values: S.teams.map((t) => o[t.rid].title), fmt: (v) => pct(v), color: (v, i) => (S.teams[i].me ? 'var(--act)' : 'var(--info)'), height: 170 })}
      <p class="faint" style="font-size:12px">Title odds. Every remaining week uses that week's matchup-aware projections with each team's best lineup, byes and known injuries, plus the playoff bracket (weeks ${S.league.playoff_week_start}–17, top 2 get byes).</p></div>
  </div>`;
}
async function loadReport(file) {
  marked ||= (await import('https://cdn.jsdelivr.net/npm/marked@12/lib/marked.esm.js')).marked;
  const md = await fetch(`reports/${file}?t=${Date.now()}`).then((r) => r.text());
  const html = marked.parse(md).replace(/<pre><code class="language-chart">([\s\S]*?)<\/code><\/pre>/g, (_, j) => {
    try { return fromSpec(JSON.parse(j.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'))); } catch (e) { return `<pre>${j}</pre>`; }
  });
  $('#report').innerHTML = `<p><a href="#lab">← all reports</a></p>${html}`;
}

// ------------------------------------------------------------ events
function afterRender(tab) {
  const arg = location.hash.split('/')[1];
  if (tab === 'lab' && arg) loadReport(decodeURIComponent(arg));
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-wpos]'); if (b) { wpos = b.dataset.wpos; route(); return; }
  const rm = e.target.closest('[data-rm]');
  if (rm) { const [side, id] = rm.dataset.rm.split(':'); T[side] = T[side].filter((x) => x !== id); T.result = null; route(); return; }
  const pa = e.target.closest('[data-partner]');
  if (pa) { const r = Number(pa.dataset.partner); if (r !== T.partner) { T.partner = r; T.get = []; T.result = null; } return; }
  if (e.target.id === 'run-trade') { e.target.textContent = 'Simulating…'; setTimeout(() => { T.result = M.evalTrade(S, ME.rid, T.partner, T.give, T.get); route(); }, 20); }
  if (e.target.id === 'clear-trade') { Object.assign(T, { give: [], get: [], result: null }); route(); }
  const tb = e.target.closest('nav button'); if (tb) location.hash = tb.dataset.tab;
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'give-sel' && e.target.value) { T.give.push(e.target.value); T.result = null; route(); }
  if (e.target.id === 'get-sel' && e.target.value) { T.get.push(e.target.value); T.result = null; route(); }
  if (e.target.id === 'partner-sel') { T.partner = Number(e.target.value) || null; T.get = []; T.result = null; route(); }
});
window.addEventListener('hashchange', route);
$('#refresh').addEventListener('click', async () => { $('#refresh').textContent = '…'; await load(); $('#refresh').textContent = 'refresh'; route(); });
$('#theme').addEventListener('click', () => {
  const r = document.documentElement; const next = r.dataset.theme === 'light' ? 'dark' : 'light'; r.dataset.theme = next;
  try { localStorage.setItem('fflab-theme', next); } catch {}
});
try { const th = localStorage.getItem('fflab-theme'); if (th) document.documentElement.dataset.theme = th; } catch {}

await load();
route();
