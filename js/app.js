import * as M from './model.js?v=1792654492';
import { bars, lines, spark, fromSpec, scatter } from './charts.js?v=1792654492';
import { overlay } from './live.js?v=1792654492';

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
  MOVES.rows = null; MOVES.sims = {};
  if (typeof SC !== 'undefined') { SC.base = null; SC.results = {}; }
  $('#stamp-t').textContent = `Week ${S.week} · ${live.ok ? 'live now' : 'live pull failed'} · model ${ago(S.generated)} old`;
}

const TABS = { command: renderCommand, pulse: renderPulse, waivers: renderWaivers, trade: renderTrade,
  opponents: renderOpponents, roster: renderRoster, playoffs: renderPlayoffs, scenarios: renderScenarios, research: renderResearch, model: renderModel, insights: renderInsights, lab: renderLab };
function route() {
  const [tab, arg] = (location.hash.slice(1) || 'command').split('/');
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  const el = $('main');
  if (route.last !== tab) el.innerHTML = '<div class="loading">crunching…</div>';
  const same = route.last === tab, y = window.scrollY; route.last = tab;
  if (same) { el.innerHTML = (TABS[tab] || renderCommand)(arg); afterRender(tab); window.scrollTo(0, y); return; }
  setTimeout(() => { el.innerHTML = (TABS[tab] || renderCommand)(arg); afterRender(tab); window.scrollTo(0, 0); }, 10);
}

// ------------------------------------------------------------ command
function myLineup(rid = ME.rid, w = S.week) {
  return M.bestLineup(M.lineupIds(team(rid)), S.players, w, S.week, M.starterSlots(S), S.live);
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
  const wk = M.lineupValue(S, M.lineupIds(ME)).weeks, avg = wk.reduce((a, b) => a + b, 0) / wk.length;
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
const rosPerGame = (p) => { const v = p.proj.slice(S.week).filter((x) => x > 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
function dropCosts() {
  if (cache.dropCosts) return cache.dropCosts;
  const ids = M.activeIds(ME), base = M.lineupValue(S, M.withIR(ME, ids));
  return (cache.dropCosts = ids.map((id) => {
    const v = M.lineupValue(S, M.withIR(ME, ids.filter((x) => x !== id)));
    return { id, cost: base.value - v.value, weeks: v.weeks.map((x, i) => x - base.weeks[i]) };
  }).sort((a, b) => a.cost - b.cost));
}
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
      <tr><th class="l">Player</th><th>Gain</th><th>Next 3 wks</th><th>Bid</th><th class="l">Drop</th><th>W${S.week}</th><th>Sleeper ROS/g</th><th>Market</th><th>Usage (snap/tgt/ru)</th><th>Adds 24h</th></tr>
      ${board.map((r) => { const p = P(r.id); const u = p.use.slice(-3).filter(Boolean);
        return `<tr><td class="l">${who(p)}</td><td class="${cls(r.gain, 1)}"><b>${sgn(r.gain)}</b></td><td>${r.weeks.slice(0, 3).map((x) => `<span class="${cls(x, 0.3)}">${sgn(x)}</span>`).join(' ')}</td>
        <td><b>${r.bid ? `$${r.bid}` : '$0'}</b></td><td class="l">${P(r.drop)?.pos === p.pos ? '<span class="pill">swap</span> ' : ''}${esc(P(r.drop)?.name)}</td>
        <td>${f1(M.weekDist(p, S.week, S.week, S.live).mean)}${p.form >= 1.35 ? '<span class="sub act" title="Most of this comes from one big recent game">spike?</span>' : ''}</td>
        <td>${f1(rosPerGame(p))}</td><td>${p.fc ? `${(p.fc / 1000).toFixed(1)}k` : '–'}</td>
        <td class="faint">${u.map((x) => `${x.snp ?? '–'}/${x.tgt}/${x.ru}`).join(' · ')}</td><td>${p.add24 ? `${(p.add24 / 1000).toFixed(0)}k` : ''}</td></tr>`; }).join('')}
    </table></div>
    <p class="faint" style="font-size:12px">How it works: every week from now to 17 we build your best lineup with and without the player, using that week's matchup projection, byes, injuries and random injury draws (so depth counts). Near weeks count more (×0.9 per week out). QB/K/DEF are valued as streamable after next week. Suggested bid ≈ $1 per weighted point, scaled to this league's bidding, capped at 60% of your budget.</p>
  </div>
  <div class="card" style="margin-top:14px">
    <h2>Who is expendable on your roster <small>points your lineup loses (weighted, rest of season) if he's gone</small></h2>
    <div class="scroll"><table><tr><th class="l">Player</th><th>Drop cost</th><th>Worst week without him</th><th>Bye</th><th>Usage (snap/tgt/ru)</th><th>Market</th></tr>
    ${dropCosts().slice(0, 9).map((d) => { const p = P(d.id); const u = p.use.slice(-3).filter(Boolean); const worst = d.weeks.reduce((m, x, i) => (x < m.x ? { x, i } : m), { x: 0, i: -1 });
      return `<tr><td class="l">${who(p, { game: false })}</td><td class="${d.cost < 4 ? 'good' : d.cost < 10 ? 'act' : 'bad'}"><b>${d.cost.toFixed(1)}</b></td>
      <td>${worst.i >= 0 ? `W${S.week + worst.i} ${worst.x.toFixed(1)}` : '—'}</td><td>${p.bye ?? ''}</td>
      <td class="faint">${u.map((x) => `${x.snp ?? '–'}/${x.tgt}/${x.ru}`).join(' · ')}</td><td>${p.fc ? `${(p.fc / 1000).toFixed(1)}k` : '–'}</td></tr>`; }).join('')}
    </table></div>
    <p class="faint" style="font-size:12px">Green = safe to cut. Differences under ~3 points are noise, so break ties on role (snaps, targets), your bye crunch weeks, and whether he'd be a trade chip. Defenses and kickers are swapped like-for-like, never paid for with a bench spot.</p>
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
      ${kpi(sgn(r.me.titleWeeks), 'title weeks 16–17')}
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
  const strength = Object.fromEntries(S.teams.map((t) => [t.rid, M.lineupValue(S, M.lineupIds(t), { to: Math.min(S.week + 3, 17) })]));
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
  const wk = M.lineupValue(S, M.lineupIds(t)).weeks;
  const labels = wk.map((_, i) => `W${S.week + i}`);
  const hurt = t.players.map(P).filter((p) => p?.inj);
  const myWk = M.lineupValue(S, M.lineupIds(ME)).weeks;
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
  const wk = M.lineupValue(S, M.lineupIds(ME)).weeks;
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


// ------------------------------------------------------------ playoffs
// A top-2 seed skips the first playoff week, so the title is the last two weeks.
const PW = () => S.league.playoff_week_start;
const heat = (v, scale = 6) => `background:color-mix(in srgb, ${v >= 0 ? 'var(--good)' : 'var(--bad)'} ${Math.min(45, Math.abs(v) * scale)}%, transparent)`;
const MOVES = { running: false, rows: null, progress: 0, realistic: true, sims: {} };

function projectedBracket() {
  const seeds = [...S.teams].sort((a, b) => SIM.odds[a.rid].avgSeed - SIM.odds[b.rid].avgSeed).slice(0, S.league.playoff_teams);
  const d = (w, r) => SIM.dist[Math.min(w, 17)][r];
  const pick = (w, a, b) => (M.winProb(d(w, a.rid), d(w, b.rid)) >= 0.5 ? a : b);
  const pw = PW();
  const q = [[seeds[2], seeds[5]], [seeds[3], seeds[4]]];
  const qw = q.map(([a, b]) => pick(pw, a, b));
  const [lo, hi] = seeds.indexOf(qw[0]) > seeds.indexOf(qw[1]) ? [qw[0], qw[1]] : [qw[1], qw[0]];
  const sf = [[seeds[0], lo], [seeds[1], hi]];
  const sw = sf.map(([a, b]) => pick(pw + 1, a, b));
  return { seeds, rounds: [{ w: pw, label: 'Quarterfinals', games: q }, { w: pw + 1, label: 'Semifinals', games: sf }, { w: pw + 2, label: 'Final', games: [sw] }] };
}
function gameCard(w, a, b) {
  const da = SIM.dist[w][a.rid], db = SIM.dist[w][b.rid], p = M.winProb(da, db);
  const line = (t, dd, pp) => `<div class="row" style="padding:3px 0"><span class="${t.me ? 'act' : ''}" style="flex:1">${esc(t.owner)}</span><span class="faint">${f1(dd.mean)}</span><b class="${pp >= 0.5 ? 'good' : 'muted'}" style="width:44px;text-align:right">${pct(pp)}</b></div>`;
  return `<div class="kpi" style="margin-bottom:8px">${line(a, da, p)}${line(b, db, 1 - p)}</div>`;
}
function renderPlayoffs() {
  const o = SIM.odds[ME.rid], pw = PW();
  const weeks = []; for (let w = S.week; w <= 17; w++) weeks.push(w);
  const nm = (rid) => team(rid).owner;
  const br = projectedBracket();
  const oppTable = (map, w) => Object.entries(map).sort((a, b) => b[1] - a[1]).filter(([, p]) => p >= 0.01).map(([r, p]) => {
    const wp = M.winProb(SIM.dist[w][ME.rid], SIM.dist[w][+r]);
    return `<tr><td class="l">${esc(nm(+r))}</td><td>${pct(p / Math.max(o[w === pw + 1 ? 'semis' : 'final'], 1e-9))}</td><td>${f1(SIM.dist[w][+r].mean)}</td><td class="${wp >= 0.5 ? 'good' : 'bad'}"><b>${pct(wp)}</b></td></tr>`; }).join('');
  // strength grid
  const avgW = Object.fromEntries(weeks.map((w) => [w, S.teams.reduce((t, x) => t + SIM.dist[w][x.rid].mean, 0) / S.teams.length]));
  const titleAvg = (rid) => (SIM.dist[pw + 1][rid].mean + SIM.dist[pw + 2][rid].mean) / 2;
  const grid = [...S.teams].sort((a, b) => titleAvg(b.rid) - titleAvg(a.rid));
  // my players in playoff weeks
  const pWeeks = [pw, pw + 1, pw + 2];
  const lus = Object.fromEntries(pWeeks.map((w) => [w, myLineup(ME.rid, w)]));
  const starts = (id, w) => lus[w].lineup.some((x) => x.p?.id === id);
  const myIds = M.lineupIds(ME).filter((id) => P(id)).sort((a, b) => pWeeks.reduce((t, w) => t + M.weekDist(P(b), w, S.week, S.live).mean - M.weekDist(P(a), w, S.week, S.live).mean, 0));
  // slot comparison vs the other likely playoff teams in the title weeks
  const rivals = [...S.teams].filter((t) => !t.me).sort((a, b) => SIM.odds[b.rid].playoffs - SIM.odds[a.rid].playoffs).slice(0, S.league.playoff_teams - 1);
  const slotCmp = [pw + 1, pw + 2].map((w) => {
    const mine = myLineup(ME.rid, w).lineup;
    const theirs = rivals.map((t) => myLineup(t.rid, w).lineup);
    return { w, rows: mine.map((x, i) => ({ slot: x.slot, p: x.p, mean: x.mean, avg: theirs.reduce((t, l) => t + l[i].mean, 0) / theirs.length })) };
  });
  return `
  <div class="kpis">
    ${kpi(pct(o.playoffs), 'playoffs')}${kpi(pct(o.bye), 'top-2 bye')}${kpi(pct(o.seed1), '#1 seed')}
    ${kpi(o.avgSeed.toFixed(2), 'avg seed')}${kpi(pct(o.final), 'reach final')}${kpi(pct(o.title), 'title')}
  </div>
  <div class="card" style="margin-top:14px">
    <h2>Projected bracket <small>most likely seeds · each game uses that week's projected lineups</small></h2>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
      ${br.rounds.map((r) => `<div><div class="muted" style="font-size:12px;margin-bottom:6px">Week ${r.w} · ${r.label}${r.w === pw ? ' <span class="faint">(seeds 1–2 on bye)</span>' : ''}</div>${r.games.map(([a, b]) => gameCard(r.w, a, b)).join('')}</div>`).join('')}
    </div>
  </div>
  <div class="grid two" style="margin-top:14px">
    <div class="card"><h2>Projected seeding <small>${(5000).toLocaleString()} simulated seasons</small></h2><div class="scroll">
      <table><tr><th class="l">Team</th><th>Avg seed</th><th>1</th><th>2</th><th>3–6</th><th>Out</th><th>Bye</th><th>Title</th><th>Wk ${pw + 1}–17</th></tr>
      ${[...S.teams].sort((a, b) => SIM.odds[a.rid].avgSeed - SIM.odds[b.rid].avgSeed).map((t) => { const x = SIM.odds[t.rid]; const mid = x.seeds.slice(2, 6).reduce((a, b) => a + b, 0);
        return `<tr class="${t.me ? 'me' : ''}"><td class="l">${esc(t.owner)}<span class="sub">${t.wins}-${t.losses}</span></td><td>${x.avgSeed.toFixed(1)}</td><td>${pct(x.seeds[0])}</td><td>${pct(x.seeds[1])}</td><td>${pct(mid)}</td><td class="faint">${pct(1 - x.playoffs)}</td><td>${pct(x.bye)}</td><td><b>${pct(x.title)}</b></td><td>${f1(titleAvg(t.rid))}</td></tr>`; }).join('')}</table></div></div>
    <div class="card"><h2>Your path <small>who you'd face, and your chances in that game</small></h2>
      <div class="muted" style="font-size:12.5px;margin-bottom:4px">Week ${pw + 1} semifinal (reached ${pct(o.semis)})</div>
      <table><tr><th class="l">Opponent</th><th>Likelihood</th><th>Their proj</th><th>You win</th></tr>${oppTable(o.semiOpp, pw + 1)}</table>
      <div class="muted" style="font-size:12.5px;margin:12px 0 4px">Week ${pw + 2} final (reached ${pct(o.final)})</div>
      <table><tr><th class="l">Opponent</th><th>Likelihood</th><th>Their proj</th><th>You win</th></tr>${oppTable(o.finalOpp, pw + 2)}</table>
      <p class="faint" style="font-size:12px">Your projection: Week ${pw + 1} ${f1(SIM.dist[pw + 1][ME.rid].mean)}, Week ${pw + 2} ${f1(SIM.dist[pw + 2][ME.rid].mean)}. Likelihood = share of the times you reach that round.</p></div>
  </div>
  <div class="card" style="margin-top:14px"><h2>Team strength by week <small>expected best lineup · color vs that week's league average · sorted by title weeks</small></h2><div class="scroll">
    <table><tr><th class="l">Team</th>${weeks.map((w) => `<th class="${w >= pw ? 'act' : ''}">W${w}</th>`).join('')}<th>Title avg</th></tr>
    ${grid.map((t) => `<tr class="${t.me ? 'me' : ''}"><td class="l">${esc(t.owner)}</td>${weeks.map((w) => { const m = SIM.dist[w][t.rid].mean; return `<td style="${heat((m - avgW[w]) / 3, 6)}">${m.toFixed(0)}</td>`; }).join('')}<td><b>${f1(titleAvg(t.rid))}</b></td></tr>`).join('')}
    </table></div></div>
  <div class="grid two" style="margin-top:14px">
    <div class="card"><h2>Your players in the playoffs <small>★ = in your best lineup that week</small></h2><div class="scroll">
      <table><tr><th class="l">Player</th>${pWeeks.map((w) => `<th>W${w}${w === pw ? '<span class="sub">bye if top 2</span>' : ''}</th>`).join('')}</tr>
      ${myIds.map((id) => { const p = P(id); return `<tr><td class="l">${who(p, { game: false })}</td>${pWeeks.map((w) => { const m = M.weekDist(p, w, S.week, S.live).mean; return `<td>${starts(id, w) ? '<span class="act">★</span> ' : ''}${f1(m)}<span class="sub">${esc(p.opp?.[w] || 'BYE')}</span></td>`; }).join('')}</tr>`; }).join('')}
      </table></div></div>
    <div class="card"><h2>Where you're thin in the title games <small>your starter vs the average of the other likely playoff teams</small></h2>
      ${slotCmp.map(({ w, rows }) => `<div class="muted" style="font-size:12.5px;margin:6px 0 4px">Week ${w}</div><table>
        ${rows.map((r) => { const dlt = r.mean - r.avg; return `<tr><td class="l faint">${r.slot}</td><td class="l">${esc(r.p?.name || 'stream')}</td><td>${f1(r.mean)}</td><td class="faint">${f1(r.avg)}</td><td style="${heat(dlt, 6)}"><b>${sgn(dlt)}</b></td></tr>`; }).join('')}</table>`).join('')}
      <p class="faint" style="font-size:12px">Red slots are where an upgrade moves your title odds most.</p></div>
  </div>
  ${titleMovesCard()}`;
}

function titleMovesCard() {
  const pw = PW();
  let body;
  if (MOVES.running) body = `<div class="empty">Searching every trade and free agent… ${Math.round(MOVES.progress * 100)}%</div>`;
  else if (!MOVES.rows) body = `<div class="empty"><button class="btn" id="find-moves">Find title moves</button><div class="faint" style="margin-top:8px;font-size:12px">Tests every 1-for-1 and 2-for-1 trade with every team plus free-agent swaps, scored on your Week ${pw + 1}–17 lineup. Takes a few seconds.</div></div>`;
  else {
    // Realistic = their title-week lineup doesn't drop much, and we're not taking far more market
    // value than we give (overpaying is fine: it makes a yes easier).
    const ok = (r) => r.kind === 'FA' || (r.theirGain > -3 && (r.gt - r.gv) / Math.max(r.gt, r.gv, 1) < 0.4);
    const seen = new Set(), rows = [];
    for (const r of MOVES.rows) {
      if (MOVES.realistic && !ok(r)) continue;
      const key = (r.partner ?? 'FA') + ':' + r.get.join(',');
      if (seen.has(key)) continue; seen.add(key); rows.push(r);
      if (rows.length >= 20) break;
    }
    for (const r of rows) if (r.regDelta == null) r.regDelta = regularSeasonDelta(r);
    body = `<div class="row" style="margin-bottom:8px"><label class="muted" style="font-size:13px"><input type="checkbox" id="moves-realistic" ${MOVES.realistic ? 'checked' : ''}> Realistic only (their title-week lineup drops under 3 pts, and you're not taking 40%+ more trade value than you give)</label><span class="sp"></span><button class="btn ghost" id="find-moves">Re-run</button></div>
    <div class="scroll"><table><tr><th class="l">Move</th><th class="l">Give</th><th class="l">Get</th><th>Title games</th><th>Reg. season<span class="sub">weighted pts</span></th><th>Their title games</th><th>Market</th><th></th></tr>
    ${rows.map((r) => { const key = MOVES.rows.indexOf(r); const sim = MOVES.sims[key];
      return `<tr><td class="l">${r.kind === 'FA' ? '<span class="pill good">waiver</span>' : esc(team(r.partner).owner)}</td>
      <td class="l">${r.give.map((id) => esc(P(id).name)).join(' + ')}</td><td class="l"><b>${r.get.map((id) => esc(P(id).name)).join(' + ')}</b></td>
      <td class="good"><b>${sgn(r.gain)}</b><span class="sub">pts/game</span></td><td class="${cls(r.regDelta ?? 0, 1)}">${r.regDelta != null ? sgn(r.regDelta) : '–'}</td>
      <td class="${cls(r.theirGain ?? 0, 0.5)}">${r.theirGain != null ? sgn(r.theirGain) : '–'}</td>
      <td class="faint">${r.kind === 'FA' ? '' : `${(r.gv / 1000).toFixed(1)}k/${(r.gt / 1000).toFixed(1)}k`}</td>
      <td>${sim ? `<span class="${cls(sim.d, 0.005)}"><b>${pct(sim.before)}→${pct(sim.after)}</b></span>` : `<button class="btn ghost" data-simmove="${key}" style="padding:3px 8px;font-size:12px">title odds</button>`}
      ${r.kind === 'trade' ? `<button class="btn ghost" data-openmove="${key}" style="padding:3px 8px;font-size:12px">Trade Lab</button>` : ''}</td></tr>`; }).join('') || '<tr><td class="empty" colspan="8">Nothing clears the bar. Untick "realistic" to see everything.</td></tr>'}
    </table></div>`;
  }
  return `<div class="card" style="margin-top:14px" id="moves-card"><h2>Title-move finder <small>what improves Weeks ${pw + 1}–17 most</small></h2>${body}</div>`;
}
function regularSeasonDelta(r) {
  const mine = M.activeIds(ME), to = PW() - 1;
  const ids = M.trimRoster(S, [...mine.filter((x) => !r.give.includes(x)), ...r.get]).ids;
  return M.lineupValue(S, M.withIR(ME, ids, r.give), { from: S.week, to }).value - M.lineupValue(S, M.lineupIds(ME), { from: S.week, to }).value;
}
function runMoveSearch() {
  MOVES.running = true; MOVES.progress = 0; MOVES.sims = {};
  const gen = M.titleMoveSearch(S, ME.rid);
  const step = () => {
    const t0 = performance.now(); let r;
    while (performance.now() - t0 < 40) { r = gen.next(); if (r.done) break; MOVES.progress = r.value.done / r.value.total; }
    const card = $('#moves-card');
    if (r.done) { MOVES.running = false; MOVES.rows = r.value; }
    if (card) card.outerHTML = titleMovesCard();
    if (!r.done) setTimeout(step, 0);
  };
  step();
}
function simMove(key) {
  const r = MOVES.rows[key];
  const base = M.simulate(S, { n: 4000 });
  const rosters = Object.fromEntries(S.teams.map((t) => [t.rid, M.activeIds(t)]));
  rosters[ME.rid] = M.trimRoster(S, [...rosters[ME.rid].filter((x) => !r.give.includes(x)), ...r.get]).ids;
  if (r.partner) rosters[r.partner] = M.trimRoster(S, [...rosters[r.partner].filter((x) => !r.get.includes(x)), ...r.give]).ids;
  for (const t of S.teams) rosters[t.rid] = M.withIR(t, rosters[t.rid], [...r.give, ...r.get]);
  const owned = r.get.map((id) => [id, P(id).own]);
  if (!r.partner) { r.get.forEach((id) => (P(id).own = ME.rid)); delete S._floor; } // keep the free agent out of stream floors
  const after = M.simulate(S, { rosters, n: 4000 });
  owned.forEach(([id, o]) => (P(id).own = o)); delete S._floor;
  const b = base.odds[ME.rid].title, a = after.odds[ME.rid].title;
  MOVES.sims[key] = { before: b, after: a, d: a - b };
  const card = $('#moves-card'); if (card) card.outerHTML = titleMovesCard();
}


// ------------------------------------------------------------ scenarios
// Presets live in reports/scenarios.json (by player/owner name, so they survive refreshes);
// your own chains are saved in this browser.
const SC = { presets: null, results: {}, base: null, draft: [], step: { partner: '', give: [], get: [] }, running: false };
const SC_KEY = 'fflab-scenarios';
const savedScenarios = () => { try { return JSON.parse(localStorage.getItem(SC_KEY)) || []; } catch { return []; } };
const saveScenarios = (v) => { try { localStorage.setItem(SC_KEY, JSON.stringify(v)); } catch {} };
const pidByName = (n) => Object.values(S.players).find((p) => p.name === n)?.id;
const ridByOwner = (o) => S.teams.find((t) => t.owner === o)?.rid;
function resolve(sc) { // names -> ids; flags anything that moved
  const problems = [];
  const steps = sc.steps.map((st) => {
    const partner = st.partner === 'FA' || st.partner == null ? null : ridByOwner(st.partner);
    const give = st.give.map(pidByName), get = st.get.map(pidByName);
    give.forEach((id, i) => { if (!id || !ME.players.includes(id)) problems.push(`${st.give[i]} isn't on your roster`); });
    get.forEach((id, i) => { if (!id) problems.push(`${st.get[i]} not found`); else if (partner != null && !team(partner).players.includes(id)) problems.push(`${st.get[i]} isn't on ${st.partner}`); else if (partner == null && P(id).own) problems.push(`${st.get[i]} is rostered`); });
    return { partner, give, get };
  });
  return { steps, problems };
}
function scenarioBase() { return (SC.base ||= M.simulate(S, { n: 4000, seed: 11 })); }
function rival() { const b = scenarioBase(); return S.teams.filter((t) => !t.me).sort((a, c) => b.odds[c.rid].title - b.odds[a.rid].title)[0]; }
function runOne(key, sc) {
  const { steps, problems } = resolve(sc);
  if (problems.length) { SC.results[key] = { problems }; return; }
  const r = M.runScenario(S, steps, { n: 4000, seed: 11, base: scenarioBase() });
  const rv = rival();
  SC.results[key] = { r, rival: [r.base.odds[rv.rid].title, r.after.odds[rv.rid].title], rivalName: rv.owner };
}
function scenarioRow(key, sc, mine) {
  const res = SC.results[key];
  const stepsTxt = sc.steps.map((st) => `<div><span class="faint">${esc(st.partner === 'FA' || st.partner == null ? 'waivers' : st.partner)}:</span> ${st.give.map(esc).join(' + ')} → <b>${st.get.map(esc).join(' + ')}</b></div>`).join('');
  let cells;
  if (!res) cells = `<td colspan="6"><button class="btn ghost" data-runsc="${key}" style="padding:3px 10px;font-size:12px">run</button></td>`;
  else if (res.problems) cells = `<td colspan="6" class="bad" style="white-space:normal;font-size:12px">${res.problems.map(esc).join('; ')}</td>`;
  else { const m = res.r.me; const d = m.title[1] - m.title[0];
    cells = `<td><b>${pct(m.title[0])}→${pct(m.title[1])}</b></td><td class="${cls(d, 0.004)}"><b>${sgn(d * 100)}</b></td><td>${pct(m.bye[1])}</td>
      <td class="${cls(m.w16 + m.w17, 0.5)}">${sgn(m.w16)} / ${sgn(m.w17)}</td><td>${pct(res.rival[0])}→${pct(res.rival[1])}</td>
      <td class="l" style="white-space:normal;font-size:12px">${res.r.steps.map((st) => st.partner == null ? 'waivers' : `${esc(team(st.partner).owner)} ${pct(st.partnerOdds.playoffs[0])}→${pct(st.partnerOdds.playoffs[1])} PO · ${(st.give$ / 1000).toFixed(1)}k/${(st.get$ / 1000).toFixed(1)}k`).join('<br>')}</td>`; }
  return `<tr><td class="l" style="white-space:normal"><b>${esc(sc.name)}</b>${sc.note ? `<span class="sub">${esc(sc.note)}</span>` : ''}${mine ? ` <button class="chip" data-delsc="${mine}" style="padding:0 6px">delete</button>` : ''}</td><td class="l" style="white-space:normal;font-size:12.5px">${stepsTxt}</td>${cells}</tr>`;
}
function renderScenarios() {
  if (!SC.presets) { fetch(`reports/scenarios.json?t=${Date.now()}`).then((r) => r.json()).then((p) => { SC.presets = p; route(); }).catch(() => { SC.presets = []; route(); }); return '<div class="loading">loading scenarios…</div>'; }
  const b = scenarioBase(), rv = rival();
  const mine = savedScenarios();
  const head = `<tr><th class="l">Scenario</th><th class="l">Steps</th><th>Your title</th><th>Δ pts</th><th>Bye</th><th>Wk ${PW() + 1} / ${PW() + 2}</th><th>${esc(rv.owner)} title</th><th class="l">Partners (playoff odds · value give/get)</th></tr>`;
  const st = SC.step, partners = S.teams.filter((t) => !t.me);
  const pool = st.partner === 'FA' ? Object.values(S.players).filter((p) => !p.own && p.pos).sort((a, c) => M.playerValue(S, c.id) - M.playerValue(S, a.id)).slice(0, 80).map((p) => p.id)
    : st.partner ? team(+st.partner).players : [];
  const opt = (ids, sel) => ids.map(P).filter(Boolean).map((p) => `<option value="${p.id}" ${sel.includes(p.id) ? 'disabled' : ''}>${esc(p.name)} · ${p.pos} ${p.team || ''}</option>`).join('');
  return `
  <div class="kpis">${kpi(pct(b.odds[ME.rid].title), 'your title odds now')}${kpi(pct(b.odds[ME.rid].bye), 'bye odds now')}${kpi(`${esc(rv.owner)} ${pct(b.odds[rv.rid].title)}`, 'top rival')}</div>
  <div class="card" style="margin-top:14px"><h2>Saved scenarios <small>4,000 seasons each · same random draws as the baseline, so differences are real</small></h2>
    <div class="row" style="margin-bottom:8px"><button class="btn" id="run-all-sc" ${SC.running ? 'disabled' : ''}>${SC.running ? 'Running…' : 'Run all'}</button><span class="sp"></span><span class="faint" style="font-size:12px">Edit presets in reports/scenarios.json (ask Claude) or build your own below.</span></div>
    <div class="scroll"><table>${head}
      ${SC.presets.map((sc, i) => scenarioRow('p' + i, sc)).join('')}
      ${mine.map((sc, i) => scenarioRow('m' + i, sc, String(i + 1))).join('')}
    </table></div></div>
  <div class="card" style="margin-top:14px"><h2>Build a scenario <small>chain several trades or waiver adds, then simulate them together</small></h2>
    ${SC.draft.length ? `<div class="chips">${SC.draft.map((d, i) => `<span class="chip">${esc(d.partner)}: ${d.give.map(esc).join(' + ')} → ${d.get.map(esc).join(' + ')} <button data-dropstep="${i}">×</button></span>`).join('')}</div>` : '<p class="faint">No steps yet.</p>'}
    <div class="grid half">
      <div><select id="sc-partner"><option value="">step partner…</option><option value="FA" ${st.partner === 'FA' ? 'selected' : ''}>Waivers / free agent</option>${partners.map((t) => `<option value="${t.rid}" ${String(t.rid) === st.partner ? 'selected' : ''}>${esc(t.owner)}</option>`).join('')}</select>
        <select id="sc-give" style="margin-top:6px"><option value="">+ you give / drop</option>${opt(ME.players, st.give)}</select>
        <div class="chips">${st.give.map((id) => `<span class="chip">${esc(P(id).name)} <button data-scrm="give:${id}">×</button></span>`).join('')}</div></div>
      <div>${st.partner ? `<select id="sc-get"><option value="">+ you get</option>${opt(pool, st.get)}</select>` : ''}
        <div class="chips">${st.get.map((id) => `<span class="chip">${esc(P(id).name)} <button data-scrm="get:${id}">×</button></span>`).join('')}</div></div>
    </div>
    <div class="row" style="margin-top:8px"><button class="btn ghost" id="sc-addstep" ${st.partner && st.give.length && st.get.length ? '' : 'disabled'}>Add step</button>
      <input type="text" id="sc-name" placeholder="scenario name" style="flex:1"><button class="btn" id="sc-save" ${SC.draft.length ? '' : 'disabled'}>Save & run</button></div>
  </div>`;
}
function runAllScenarios() {
  const all = [...SC.presets.map((sc, i) => ['p' + i, sc]), ...savedScenarios().map((sc, i) => ['m' + i, sc])];
  SC.running = true; route();
  let i = 0;
  const step = () => { if (i >= all.length) { SC.running = false; route(); return; } const [k, sc] = all[i++]; runOne(k, sc); route(); setTimeout(step, 10); };
  setTimeout(step, 20);
}


// ------------------------------------------------------------ research
let RESEARCH = null;
function renderResearch() {
  if (!RESEARCH) { fetch(`data/research.json?t=${Date.now()}`).then((r) => r.json()).then((d) => { RESEARCH = d; route(); }).catch(() => { RESEARCH = { error: true }; route(); }); return '<div class="loading">loading research…</div>'; }
  if (RESEARCH.error) return '<div class="card"><div class="empty">No research data yet. Run tools/research.py.</div></div>';
  const R = RESEARCH, POSS = ['QB', 'RB', 'WR', 'TE'], c2 = (v) => (v == null ? '–' : v.toFixed(2));
  const decayChart = (pos) => lines({ labels: R.decay[pos].map((d) => `+${d.h}`), height: 150, fmt: (v) => v.toFixed(2),
    series: [{ name: 'player scoring so far', values: R.decay[pos].map((d) => d.talent_corr), color: 'var(--good)' },
             { name: 'opponent softness so far', values: R.decay[pos].map((d) => d.matchup_corr), color: 'var(--bad)' }] });
  const acc = R.accuracy, v = R.vegas_vs_dvp, e = R.early_predicts_late, fm = R.form;
  return `
  <div class="card"><h2>What the history says <small>${R.seasons[0]}–${R.seasons.at(-1)} · ${R.n.toLocaleString()} player-games · your league's scoring</small></h2>
    <div class="grid half">
      <div><b>1. Bet on players over schedules.</b><p class="muted">Looking ahead 1–10 weeks, a player's own scoring so far predicts future weeks far better than how soft his opponent has looked (WR ${c2(R.decay.WR[4].talent_corr)} vs ${c2(R.decay.WR[4].matchup_corr)} five weeks out; QB ${c2(R.decay.QB[4].talent_corr)} vs ${c2(R.decay.QB[4].matchup_corr)}).</p></div>
      <div><b>2. Matchups matter mostly this week, mostly for QBs.</b><p class="muted">Vegas's view of this week's matchup is worth about ${c2(v?.QB?.pts_per_implied_pt)} QB points per point of implied total. For RB/WR/TE, both Vegas and defense-vs-position move scoring by under ~0.12 per point.</p></div>
      <div><b>3. Any one week is mostly luck.</b><p class="muted">Even Sleeper's projection made that week explains ${Math.round(acc.QB.r2 * 100)}% (QB) to ${Math.round(acc.RB.r2 * 100)}% (RB) of a single game. Average miss: ${acc.WR.mae.toFixed(1)} points.</p></div>
      <div><b>4. Volume ≈ points for spotting who'll be good later.</b><p class="muted">Early-season opportunities (targets + carries) predict playoff-week scoring about as well as early points (WR ${c2(e.WR.early_opportunities)} vs ${c2(e.WR.early_ppg)}); snap share alone is weak (${c2(e.WR.early_snap_share)}).</p></div>
    </div></div>
  <div class="card" style="margin-top:14px"><h2>How fast matchup value fades <small>correlation with points h weeks after the "as of" week (weeks 4–8)</small></h2>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">${POSS.map((p) => `<div><div class="muted" style="font-size:12.5px">${p}</div>${decayChart(p)}</div>`).join('')}</div></div>
  <div class="grid half" style="margin-top:14px">
    <div class="card"><h2>Week-of projection accuracy</h2><table>
      <tr><th class="l">Pos</th><th>Games</th><th>Corr</th><th>Explains</th><th>Avg miss</th><th>Bias</th></tr>
      ${POSS.map((p) => `<tr><td class="l">${p}</td><td>${acc[p].n.toLocaleString()}</td><td>${c2(acc[p].corr)}</td><td>${Math.round(acc[p].r2 * 100)}%</td><td>${acc[p].mae.toFixed(1)}</td><td class="${cls(acc[p].bias, 0.3)}">${sgn(acc[p].bias)}</td></tr>`).join('')}</table>
      <p class="faint" style="font-size:12px">Bias = actual minus projected on average. Negative means Sleeper projects a bit high.</p></div>
    <div class="card"><h2>This week's matchup: Vegas vs defense-vs-position <small>beyond the player's own average</small></h2><table>
      <tr><th class="l">Pos</th><th>Vegas corr</th><th>pts / implied pt</th><th>DvP corr</th><th>pts / DvP pt</th></tr>
      ${v ? POSS.map((p) => `<tr><td class="l">${p}</td><td>${c2(v[p].implied_matchup_corr)}</td><td>${c2(v[p].pts_per_implied_pt)}</td><td>${c2(v[p].dvp_corr)}</td><td>${c2(v[p].pts_per_dvp_pt)}</td></tr>`).join('') : '<tr><td>no Vegas data</td></tr>'}</table>
      <p class="faint" style="font-size:12px">Vegas matchup = this week's implied team total minus the team's average so far.</p></div>
  </div>
  <div class="grid half" style="margin-top:14px">
    <div class="card"><h2>Which early stat predicts the fantasy playoffs <small>weeks 1–7 vs weeks 15–17</small></h2><table>
      <tr><th class="l">Pos</th><th>Players</th><th>Points</th><th>Opportunities</th><th>Snap share</th></tr>
      ${POSS.map((p) => `<tr><td class="l">${p}</td><td>${e[p].n}</td><td>${c2(e[p].early_ppg)}</td><td>${c2(e[p].early_opportunities)}</td><td>${c2(e[p].early_snap_share)}</td></tr>`).join('')}</table></div>
    <div class="card"><h2>Does recent form beat the projection? <small>best blend of week-of projection and last-3 average</small></h2><table>
      <tr><th class="l">Pos</th><th>Weight on projection</th><th>Weight on last 3</th><th>Corr: projection</th><th>Corr: blend</th></tr>
      ${POSS.map((p) => `<tr><td class="l">${p}</td><td>${c2(fm[p].weight_projection)}</td><td>${c2(fm[p].weight_last3)}</td><td>${c2(fm[p].corr_projection)}</td><td>${c2(fm[p].corr_blend)}</td></tr>`).join('')}</table>
      <p class="faint" style="font-size:12px">Recent form adds little on top of Sleeper's projection, which already updates weekly. The model's form factor leans harder than this. See decision #1 below.</p></div>
  </div>
  <div class="card" style="margin-top:14px"><h2>Model roadmap <small>decisions and next studies</small></h2>
    <table>
      <tr><th class="l">#</th><th class="l">Item</th><th class="l">Evidence</th><th class="l">Status</th></tr>
      <tr><td class="l">1</td><td class="l" style="white-space:normal"><b>Tone down the recent-form factor</b> (currently moves a projection ±40–50%).</td><td class="l" style="white-space:normal">Last-3 average earns only ~${c2(fm.WR.weight_last3)}–${c2(fm.TE.weight_last3)} weight beyond the projection for RB/WR/TE, ${c2(fm.QB.weight_last3)} for QB.</td><td class="l"><span class="pill act">your call</span></td></tr>
      <tr><td class="l">2</td><td class="l" style="white-space:normal">Fade far-off matchups toward the player's average.</td><td class="l" style="white-space:normal">Matchup signal ≈ 0 beyond next week except a little at QB.</td><td class="l"><span class="pill good">done</span></td></tr>
      <tr><td class="l">3</td><td class="l" style="white-space:normal">Use Vegas (implied totals) for this week's QB and DEF decisions.</td><td class="l" style="white-space:normal">Vegas matchup beats DvP at QB.</td><td class="l"><span class="pill">next</span></td></tr>
      <tr><td class="l">4</td><td class="l" style="white-space:normal">Add usage (target and carry share, routes) from nflverse as a talent signal.</td><td class="l" style="white-space:normal">Opportunities predict playoffs as well as points with less noise.</td><td class="l"><span class="pill">next</span></td></tr>
      <tr><td class="l">5</td><td class="l" style="white-space:normal">Calibrate weekly variance (SD) by position from history instead of fixed guesses.</td><td class="l" style="white-space:normal">Avg miss 5–6 pts. Matters for win probabilities and the variance strategy against BooberEats.</td><td class="l"><span class="pill">next</span></td></tr>
      <tr><td class="l">6</td><td class="l" style="white-space:normal">Injury rates by position and age → value of depth.</td><td class="l" style="white-space:normal">Needs games-missed history (nflverse injuries).</td><td class="l"><span class="pill">later</span></td></tr>
      <tr><td class="l">7</td><td class="l" style="white-space:normal">Touchdown-luck regression and QB/WR stack correlation.</td><td class="l" style="white-space:normal">For trade timing and playoff ceiling.</td><td class="l"><span class="pill">later</span></td></tr>
    </table>
    <p class="faint" style="font-size:12px">Reproduce: <code>./tools/fetch_history.sh 2018 … 2025</code>, then <code>python3 tools/research.py</code>.</p></div>`;
}


// ------------------------------------------------------------ model explorer
// Built offline by tools/model_build.py: for every season and every "as of" week k, the model's
// prediction for each later week, so you can watch projections converge and see the misses.
const MX = { metrics: null, season: null, data: {}, k: 6, pos: 'ALL', league: true, q: '', sel: null, tgt: null, mpos: 'WR' };
const loadJSON = (u) => fetch(`${u}?t=${Date.now()}`).then((r) => r.json());
function renderModel() {
  if (!MX.metrics) { Promise.all([loadJSON('data/model/metrics.json'), loadJSON('data/model/league2026_sitemodel.json').catch(() => null)])
    .then(([m, lg]) => { MX.metrics = m; MX.league26 = lg; MX.season ||= String(Math.max(...m.seasons)); route(); }).catch(() => { MX.metrics = { error: 1 }; route(); }); return '<div class="loading">loading model…</div>'; }
  if (MX.metrics.error) return '<div class="card"><div class="empty">No model output yet. Run tools/model_build.py.</div></div>';
  const m = MX.metrics, d = MX.data[MX.season];
  if (!d) { loadJSON(`data/model/explorer-${MX.season}.json`).then((x) => { MX.data[MX.season] = x; route(); }); }
  const BUCKETS = ['1', '2-3', '4-6', '7-10', '11+'];
  const accTable = (res, title) => `<div><div class="muted" style="font-size:12.5px;margin-bottom:4px">${title}</div><table>
    <tr><th class="l">Pos</th><th>Model</th><th>Sleeper latest</th><th>Season ppg</th><th>Model bias</th><th>Avg pts</th><th>n</th></tr>
    ${Object.entries(res).map(([p, v]) => { const a = v.all; if (!a) return ''; const best = Math.min(a.model, a.sleeper_latest, a.ppg_so_far);
      const c = (x) => `<td class="${x === best ? 'good' : ''}">${x.toFixed(2)}</td>`;
      return `<tr><td class="l">${p}</td>${c(a.model)}${c(a.sleeper_latest)}${c(a.ppg_so_far)}<td>${sgn(a.bias_model)}</td><td>${a.avg_pts.toFixed(1)}</td><td class="faint">${a.n.toLocaleString()}</td></tr>`; }).join('')}</table></div>`;
  const hz = m.test[MX.mpos] || {};
  const hChart = lines({ labels: BUCKETS.map((b) => `+${b}`), height: 150, fmt: (v) => v.toFixed(1),
    series: [{ name: 'model', values: BUCKETS.map((b) => hz[b]?.model ?? null), color: 'var(--good)' },
             { name: 'Sleeper latest', values: BUCKETS.map((b) => hz[b]?.sleeper_latest ?? null), color: 'var(--info)' },
             { name: 'season ppg', values: BUCKETS.map((b) => hz[b]?.ppg_so_far ?? null), color: 'var(--faint)' }] });
  const imp = m.importance?.[MX.mpos] || {};
  const impRows = Object.entries(imp).sort((a, b) => b[1] - a[1]);
  return `
  <div class="card"><h2>How accurate is the model? <small>average points missed per player-week · lower is better · green = best</small></h2>
    <div class="grid half">${accTable(m.test, 'Test season 2025 (never trained on)')}${accTable(m.live2026, 'Your league, 2026 weeks played (never trained on)')}</div>
    <p class="faint" style="font-size:12px">"Sleeper latest" carries Sleeper's newest projection forward to every future week. "Season ppg" uses the player's average so far. The model blends market, production, usage and matchup (trained ${m.train[0]}–${m.train.at(-1)}).</p></div>
  <div class="grid half" style="margin-top:14px">
    <div class="card"><h2>Error by weeks ahead <small>${MX.mpos} · 2025 test</small></h2>
      <div class="seg" style="margin-bottom:6px">${['QB', 'RB', 'WR', 'TE'].map((p) => `<button data-mpos="${p}" class="${p === MX.mpos ? 'on' : ''}">${p}</button>`).join('')}</div>${hChart}</div>
    <div class="card"><h2>What the model leans on <small>${MX.mpos} · how much worse it gets if a stat is scrambled</small></h2>
      <table>${impRows.slice(0, 10).map(([f, v]) => `<tr><td class="l">${esc(FEAT_NAMES[f] || f)}</td><td style="width:55%"><div style="height:8px;border-radius:4px;background:var(--info);width:${Math.max(2, Math.min(100, (v / (impRows[0][1] || 1)) * 100))}%"></div></td><td>${v.toFixed(2)}</td></tr>`).join('')}</table></div>
  </div>
  ${leagueCheckCard()}
  ${explorerCard(d)}`;
}
function leagueCheckCard() {
  const lg = MX.league26; if (!lg) return '';
  const W = lg.weeks, avg = (k) => W.reduce((t, w) => t + w[k], 0) / W.length, sum = (k) => W.reduce((t, w) => t + w[k], 0);
  return `<div class="card" style="margin-top:14px"><h2>The site's old math vs Sleeper on your league <small>every starter, weeks ${W[0].w}–${W.at(-1).w} · what the site used before the new model</small></h2><div class="scroll"><table>
    <tr><th class="l">Week</th><th>Player miss: site</th><th>Player miss: Sleeper</th><th>Team miss: site</th><th>Team miss: Sleeper</th><th>Winners picked: site / Sleeper</th></tr>
    ${W.map((w) => `<tr><td class="l">${w.w}</td><td class="${w.playerMaeModel <= w.playerMaeSleeper ? 'good' : 'bad'}">${w.playerMaeModel.toFixed(2)}</td><td>${w.playerMaeSleeper.toFixed(2)}</td><td class="${w.teamMaeModel <= w.teamMaeSleeper ? 'good' : 'bad'}">${w.teamMaeModel.toFixed(1)}</td><td>${w.teamMaeSleeper.toFixed(1)}</td><td>${w.winnersModel} / ${w.winnersSleeper} of ${w.games}</td></tr>`).join('')}
    <tr><td class="l"><b>All</b></td><td><b>${avg('playerMaeModel').toFixed(2)}</b></td><td><b>${avg('playerMaeSleeper').toFixed(2)}</b></td><td><b>${avg('teamMaeModel').toFixed(1)}</b></td><td><b>${avg('teamMaeSleeper').toFixed(1)}</b></td><td><b>${sum('winnersModel')} / ${sum('winnersSleeper')} of ${sum('games')}</b></td></tr>
  </table></div><p class="faint" style="font-size:12px">The recent-form factor made player projections worse every week, matching the Research tab. Matchup winners are close to a coin flip at this sample size for any method.</p></div>`;
}
const FEAT_NAMES = { h: 'weeks ahead', k: 'as-of week', mkt: "Sleeper's latest projection", mkt_t: "Sleeper's projection for that week", prev: 'last season ppg', ppg: 'season ppg so far',
  ewm: 'recency-weighted ppg', last3: 'last-3 ppg', gp: 'games played', opp_pg: 'opportunities / game', snap: 'snap share', tshare: 'target share', ayshare: 'air-yard share',
  wopr: 'WOPR', rzshare: 'red-zone share', dvp: 'opponent pts allowed (DvP)' };
function explorerCard(d) {
  const m = MX.metrics;
  const head = `<div class="row" style="flex-wrap:wrap;gap:8px;margin-bottom:8px">
    <select id="mx-season">${m.seasons.map((y) => `<option ${String(y) === MX.season ? 'selected' : ''}>${y}</option>`).join('')}</select>
    <div class="seg">${['ALL', 'QB', 'RB', 'WR', 'TE'].map((p) => `<button data-mxpos="${p}" class="${p === MX.pos ? 'on' : ''}">${p}</button>`).join('')}</div>
    <label class="muted" style="font-size:13px">as of week <b>${MX.k}</b> <input type="range" id="mx-k" min="0" max="16" value="${MX.k}" style="vertical-align:middle"></label>
    ${MX.season === '2026' ? `<label class="muted" style="font-size:13px"><input type="checkbox" id="mx-league" ${MX.league ? 'checked' : ''}> league rosters only</label>` : ''}
    <input type="search" id="mx-q" placeholder="find player" value="${esc(MX.q)}" style="width:150px"></div>`;
  if (!d) return `<div class="card" style="margin-top:14px"><h2>Projection explorer</h2>${head}<div class="loading">loading ${MX.season}…</div></div>`;
  const k = MX.k, weeks = Array.from({ length: 17 }, (_, i) => i + 1);
  let rows = d.players.filter((p) => (MX.pos === 'ALL' || p.pos === MX.pos) && (!MX.q || p.name.toLowerCase().includes(MX.q.toLowerCase())) && (MX.season !== '2026' || !MX.league || p.league));
  const tot = (p) => p.a.reduce((t, x) => t + (x || 0), 0);
  rows = rows.sort((a, b) => tot(b) - tot(a)).slice(0, 60);
  // overall error by as-of week (all players in file, predicted weeks with actuals)
  const conv = Array.from({ length: 17 }, (_, kk) => { let s = 0, n = 0; for (const p of d.players) for (const [t, v] of Object.entries(p.pred[kk] || {})) { const a = p.a[+t]; if (a != null) { s += Math.abs(v - a); n++; } } return n ? s / n : null; });
  const cell = (p, t) => {
    const a = p.a[t];
    if (t <= k) return `<td class="faint">${a == null ? '–' : a.toFixed(0)}</td>`;
    const v = p.pred[k]?.[t];
    if (v == null) return `<td class="faint">bye</td>`;
    if (a == null) return `<td>${v.toFixed(0)}</td>`;
    const e = v - a;
    return `<td style="${heat(-Math.abs(e) / 3 + 1.2, 10)}" title="pred ${v} · actual ${a} · miss ${e.toFixed(1)}">${v.toFixed(0)}<span class="sub">${a.toFixed(0)}</span></td>`;
  };
  const grid = `<div class="scroll"><table><tr><th class="l">Player</th>${weeks.map((w) => `<th class="${w === k + 1 ? 'act' : ''}">${w}</th>`).join('')}<th>Avg miss</th></tr>
    ${rows.map((p) => { const errs = weeks.filter((t) => t > k && p.pred[k]?.[t] != null && p.a[t] != null).map((t) => Math.abs(p.pred[k][t] - p.a[t]));
      return `<tr data-mxsel="${p.id}" style="cursor:pointer" class="${MX.sel === p.id ? 'me' : ''}"><td class="l"><span class="n">${esc(p.name)}</span><span class="sub">${p.pos} ${esc(p.team || '')}</span></td>${weeks.map((t) => cell(p, t)).join('')}<td><b>${errs.length ? (errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(1) : '–'}</b></td></tr>`; }).join('')}
    </table></div><p class="faint" style="font-size:12px">Grey = already played (actual). After week ${k}: big number = prediction made after week ${k}, small = what happened. Green = close, red = big miss. Click a player for the convergence chart.</p>`;
  return `<div class="card" style="margin-top:14px"><h2>Projection explorer <small>${d.out_of_sample ? 'out-of-sample: this season was never trained on' : 'in-sample: this season was used for training'}</small></h2>${head}${grid}</div>
  <div class="grid half" style="margin-top:14px">
    <div class="card"><h2>Convergence: whole season <small>average miss of all predictions made after each week</small></h2>
      ${bars({ labels: conv.map((_, i) => `${i}`), values: conv.map((v) => v ?? 0), fmt: (v) => v.toFixed(1), color: () => 'var(--info)', height: 150 })}
      <p class="faint" style="font-size:12px">x = as-of week. Errors shrink as real data replaces guesses, then flatten: the rest is week-to-week noise.</p></div>
    ${playerConvergence(d)}
  </div>`;
}
function playerConvergence(d) {
  const p = d.players.find((x) => x.id === MX.sel);
  if (!p) return '<div class="card"><h2>Player convergence</h2><div class="empty">Click a player in the explorer.</div></div>';
  // predicted vs actual average of the remaining season, as of each week
  const ks = Array.from({ length: 17 }, (_, k) => k);
  const predRos = ks.map((k) => { const v = Object.entries(p.pred[k] || {}).map(([, x]) => x); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; });
  const actRos = ks.map((k) => { const v = p.a.slice(k + 1).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; });
  const t = MX.tgt || Math.min(17, MX.k + 4);
  const predT = ks.map((k) => (k < t ? p.pred[k]?.[t] ?? null : null));
  return `<div class="card"><h2>${esc(p.name)} <small>${p.pos} · predictions converging</small></h2>
    ${lines({ labels: ks.map((k) => `${k}`), height: 160, fmt: (v) => v.toFixed(0), series: [
      { name: 'predicted rest-of-season ppg', values: predRos, color: 'var(--good)' }, { name: 'actual rest-of-season ppg', values: actRos, color: 'var(--act)' }] })}
    <div class="row" style="margin-top:8px"><span class="muted" style="font-size:13px">Week</span><select id="mx-tgt">${Array.from({ length: 17 }, (_, i) => i + 1).map((w) => `<option ${w === t ? 'selected' : ''}>${w}</option>`).join('')}</select><span class="muted" style="font-size:13px">prediction as of each earlier week (actual: <b>${p.a[t] == null ? '–' : p.a[t].toFixed(1)}</b>)</span></div>
    ${lines({ labels: ks.slice(0, t).map((k) => `${k}`), height: 140, fmt: (v) => v.toFixed(0), series: [
      { name: `predicted week ${t}`, values: predT.slice(0, t), color: 'var(--info)' }, { name: 'actual', values: ks.slice(0, t).map(() => p.a[t] ?? null), color: 'var(--bad)', dash: true }] })}
  </div>`;
}


// ------------------------------------------------------------ insights
let INS = null; const INSV = { pos: 'WR', season: 'all' };
function renderInsights() {
  if (!INS) { loadJSON('data/insights.json').then((d) => { INS = d; route(); }).catch(() => { INS = { error: 1 }; route(); }); return '<div class="loading">loading insights…</div>'; }
  if (INS.error) return '<div class="card"><div class="empty">Run tools/insights.py.</div></div>';
  const c = INS.convergence, ks = c.as_of;
  const conv = lines({ labels: ks.map((k) => `${k}`), height: 210, fmt: (v) => v.toFixed(1), series: [
    { name: "Sleeper's newest projection", values: c.sleeper, color: 'var(--info)' },
    { name: 'our model (2024–25)', values: c.model, color: 'var(--good)' },
    { name: 'season average so far', values: c.ppg, color: 'var(--faint)' },
    { name: `one ordinary week's miss (${c.one_week_miss})`, values: ks.map(() => c.one_week_miss), color: 'var(--bad)', dash: true },
    { name: `pure luck floor (${c.noise_floor})`, values: ks.map(() => c.noise_floor), color: 'var(--act)', dash: true }] });
  const first = c.sleeper[0], last = c.sleeper.at(-1);
  // ranks scatter
  const R = INS.ranks.filter((r) => r.pos === INSV.pos && (INSV.season === 'all' || String(r.y) === INSV.season));
  const cut = INS.stay_top[INSV.pos].cut, maxRank = Math.max(...R.map((r) => Math.max(r.reg_rank, r.po_rank)));
  const pts = R.map((r) => ({ x: r.reg_rank, y: r.po_rank, label: `${r.y} ${r.name}: #${r.reg_rank} season → #${r.po_rank} playoffs (${r.reg_ppg} → ${r.po_ppg} ppg)`,
    color: r.reg_rank <= cut ? (r.po_rank <= cut ? 'var(--good)' : 'var(--bad)') : 'var(--faint)' }));
  const movers = INSV.season === 'all' ? [] : [...R].sort((a, b) => (a.po_rank - a.reg_rank) - (b.po_rank - b.reg_rank));
  // schedule bars: easiest third minus hardest third, per position
  const POSS = ['QB', 'RB', 'WR', 'TE'];
  const gap = (p, w) => { const s = INS.schedule[p][w]; return s['easiest third'].playoff_minus_season_ppg - s['hardest third'].playoff_minus_season_ppg; };
  const gmax = Math.max(...POSS.flatMap((p) => [gap(p, 'october'), gap(p, 'hindsight')]), 1);
  const hbar = (v, color) => `<div class="row" style="gap:8px"><div style="flex:1;background:var(--panel2);border-radius:4px;height:12px"><div style="height:12px;border-radius:4px;background:${color};width:${Math.max(1, (Math.max(0, v) / gmax) * 100)}%"></div></div><b style="width:44px;text-align:right">${sgn(v)}</b></div>`;
  const sched = POSS.map((p) => `<div style="margin-bottom:10px"><div class="muted" style="font-size:12.5px">${p}</div>${hbar(gap(p, 'october'), 'var(--act)')}${hbar(gap(p, 'hindsight'), 'var(--faint)')}</div>`).join('');
  return `
  <div class="card"><h2>1 · How much should you trust a playoff projection? <small>${INS.seasons[0]}–${INS.seasons.at(-1)} · avg miss on a player's Weeks 15–17 points per game, by the week the projection was made</small></h2>
    ${conv}
    <div class="grid half" style="margin-top:8px">
      <p class="muted" style="margin:0">Projecting the playoffs in <b>Week 0</b>, Sleeper misses a player's playoff average by <b>${first.toFixed(1)}</b> pts/game. By <b>Week 14</b> it's still <b>${last.toFixed(1)}</b>, only ${Math.round((1 - last / first) * 100)}% better. Projections <i>barely converge</i>: most of what happens in December isn't knowable in October.</p>
      <p class="muted" style="margin:0">The gold dashed line is the <b>luck floor</b>: even knowing a player's true talent exactly, a 3-game playoff average still misses by about ${c.noise_floor}. The red dashed line is the typical miss on <b>one ordinary week</b> (${c.one_week_miss}). Playoff projections sit between the two. Useful, but treat a 2-point projected edge as a coin flip.</p>
    </div></div>
  <div class="card" style="margin-top:14px"><h2>2 · Do the season's best players stay the best in the playoffs? <small>regular-season rank (Weeks 1–14 ppg) vs playoff rank (Weeks 15–17 ppg) among each year's top players</small></h2>
    <div class="row" style="flex-wrap:wrap;gap:8px;margin-bottom:6px"><div class="seg">${POSS.map((p) => `<button data-inspos="${p}" class="${p === INSV.pos ? 'on' : ''}">${p}</button>`).join('')}</div>
      <select id="ins-season"><option value="all">all seasons</option>${INS.seasons.map((y) => `<option ${String(y) === INSV.season ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
    <div class="grid two">
      <div>${scatter({ points: pts, invert: true, diagonal: true, max: maxRank, xLabel: 'regular-season rank', yLabel: 'playoff rank' })}
        <p class="faint" style="font-size:12px">Green = top-${cut} in the season and still top-${cut} in the playoffs. Red = top-${cut} who fell out. Points on the dashed line kept their rank. Hover a dot for the player.</p></div>
      <div><table><tr><th class="l">Pos</th><th>Stayed in top tier</th><th class="l"></th></tr>
        ${POSS.map((p) => { const t = INS.stay_top[p]; const r = t.stayed / t.of; return `<tr><td class="l">${p} top-${t.cut}</td><td><b>${pct(r)}</b><span class="sub">${t.stayed} of ${t.of}</span></td><td style="width:45%"><div style="height:8px;border-radius:4px;background:var(--good);width:${r * 100}%"></div></td></tr>`; }).join('')}</table>
        <p class="muted" style="font-size:13px">About two-thirds to three-quarters of a season's top tier stays top tier in the playoffs. Elite players are the safest bet, and WRs churn the most.</p>
        ${movers.length ? `<div class="muted" style="font-size:12.5px;margin-top:8px">${INSV.season} biggest risers: ${movers.slice(0, 3).map((r) => `${esc(r.name)} (#${r.reg_rank}→#${r.po_rank})`).join(', ')}<br>Biggest fallers: ${movers.slice(-3).reverse().map((r) => `${esc(r.name)} (#${r.reg_rank}→#${r.po_rank})`).join(', ')}</div>` : ''}</div>
    </div></div>
  <div class="card" style="margin-top:14px"><h2>3 · How much does a soft playoff schedule matter? <small>playoff-minus-season ppg: easiest third of schedules minus hardest third</small></h2>
    <div class="grid two"><div>${sched}<div class="legend"><span style="--c:var(--act)">judged in October (what you can know)</span><span style="--c:var(--faint)">in hindsight (what actually happened)</span></div></div>
    <div><table><tr><th class="l">Pos</th><th>Schedule edge you can see in Oct</th><th>Edge in hindsight</th></tr>
      ${POSS.map((p) => `<tr><td class="l">${p}</td><td><b>${sgn(gap(p, 'october'))}</b> ppg</td><td class="faint">${sgn(gap(p, 'hindsight'))} ppg</td></tr>`).join('')}</table>
      <p class="muted" style="font-size:13px">Schedules <i>do</i> matter: in hindsight the softest third of playoff slates beat the hardest by 1–4 points a game. But almost none of that is visible in October. Picking "schedule-friendly" players was worth about <b>+1 ppg at QB and RB</b> and roughly <b>nothing at WR and TE</b>. Use schedule as a tiebreaker between similar players, never as a reason to trade down in talent.</p></div></div></div>
  <div class="card" style="margin-top:14px"><h2>What this means for you</h2>
    <ul class="muted" style="margin:0;padding-left:18px;line-height:1.7">
      <li><b>Projections are a starting point, not a verdict.</b> A 2–3 point projected difference in the playoffs is mostly noise. Bigger gaps (5+) are real.</li>
      <li><b>Pay for talent and role, not for schedules.</b> Elite players stay elite about 70–80% of the time; schedule picked in October adds about 1 point at QB/RB.</li>
      <li><b>Your information edge lives in the news</b> (practice reports, coach comments, role changes like Bernard's). The numbers can't see that, so it's where your judgment should go.</li>
      <li><b>In December, matchups get real.</b> Week-of Vegas lines and injury news carry the schedule signal that October rankings can't. Decide K, DEF and close start/sits then.</li>
    </ul></div>`;
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
  if (e.target.id === 'find-moves') { runMoveSearch(); return; }
  if (e.target.id === 'run-all-sc') { runAllScenarios(); return; }
  const ip = e.target.closest('[data-inspos]'); if (ip) { INSV.pos = ip.dataset.inspos; route(); return; }
  const mp = e.target.closest('[data-mpos]'); if (mp) { MX.mpos = mp.dataset.mpos; route(); return; }
  const mxp = e.target.closest('[data-mxpos]'); if (mxp) { MX.pos = mxp.dataset.mxpos; route(); return; }
  const mxs = e.target.closest('[data-mxsel]'); if (mxs) { MX.sel = mxs.dataset.mxsel; route(); return; }
  const rs = e.target.closest('[data-runsc]'); if (rs) { const k = rs.dataset.runsc; const sc = k[0] === 'p' ? SC.presets[+k.slice(1)] : savedScenarios()[+k.slice(1)]; rs.textContent = '…'; setTimeout(() => { runOne(k, sc); route(); }, 20); return; }
  const ds = e.target.closest('[data-delsc]'); if (ds) { const v = savedScenarios(); v.splice(+ds.dataset.delsc - 1, 1); saveScenarios(v); Object.keys(SC.results).filter((k) => k[0] === 'm').forEach((k) => delete SC.results[k]); route(); return; }
  const dst = e.target.closest('[data-dropstep]'); if (dst) { SC.draft.splice(+dst.dataset.dropstep, 1); route(); return; }
  const sr = e.target.closest('[data-scrm]'); if (sr) { const [side, id] = sr.dataset.scrm.split(':'); SC.step[side] = SC.step[side].filter((x) => x !== id); route(); return; }
  if (e.target.id === 'sc-addstep') { const st = SC.step; SC.draft.push({ partner: st.partner === 'FA' ? 'FA' : team(+st.partner).owner, give: st.give.map((id) => P(id).name), get: st.get.map((id) => P(id).name) }); SC.step = { partner: '', give: [], get: [] }; route(); return; }
  if (e.target.id === 'sc-save') { const name = $('#sc-name')?.value?.trim() || `My scenario ${savedScenarios().length + 1}`; const v = savedScenarios(); v.push({ name, steps: SC.draft }); saveScenarios(v); SC.draft = []; const k = 'm' + (v.length - 1); setTimeout(() => { runOne(k, v[v.length - 1]); route(); }, 20); route(); return; }
  const sm = e.target.closest('[data-simmove]'); if (sm) { sm.textContent = '…'; setTimeout(() => simMove(+sm.dataset.simmove), 20); return; }
  const om = e.target.closest('[data-openmove]');
  if (om) { const r = MOVES.rows[+om.dataset.openmove]; Object.assign(T, { partner: r.partner, give: [...r.give], get: [...r.get], result: null }); location.hash = 'trade'; return; }
  const tb = e.target.closest('nav button'); if (tb) location.hash = tb.dataset.tab;
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'give-sel' && e.target.value) { T.give.push(e.target.value); T.result = null; route(); }
  if (e.target.id === 'get-sel' && e.target.value) { T.get.push(e.target.value); T.result = null; route(); }
  if (e.target.id === 'ins-season') { INSV.season = e.target.value; route(); return; }
  if (e.target.id === 'mx-season') { MX.season = e.target.value; MX.sel = null; route(); return; }
  if (e.target.id === 'mx-league') { MX.league = e.target.checked; route(); return; }
  if (e.target.id === 'mx-tgt') { MX.tgt = +e.target.value; route(); return; }
  if (e.target.id === 'sc-partner') { SC.step = { partner: e.target.value, give: SC.step.give, get: [] }; route(); return; }
  if (e.target.id === 'sc-give' && e.target.value) { SC.step.give.push(e.target.value); route(); return; }
  if (e.target.id === 'sc-get' && e.target.value) { SC.step.get.push(e.target.value); route(); return; }
  if (e.target.id === 'moves-realistic') { MOVES.realistic = e.target.checked; const c = $('#moves-card'); if (c) c.outerHTML = titleMovesCard(); return; }
  if (e.target.id === 'partner-sel') { T.partner = Number(e.target.value) || null; T.get = []; T.result = null; route(); }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'mx-k') { MX.k = +e.target.value; clearTimeout(MX._t); MX._t = setTimeout(route, 120); }
  if (e.target.id === 'mx-q') { MX.q = e.target.value; clearTimeout(MX._t); MX._t = setTimeout(() => { route(); setTimeout(() => { const q = $('#mx-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 30); }, 300); }
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
