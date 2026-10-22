// FF Lab v2: three pages — Overview (power rankings by sector, trade fits, this week),
// Signals (what's changing, for you and around the league), Workshop (what-if scratchpad).
import * as M from './model.js?v=1792645747';
import { lines, spark } from './charts.js?v=1792645747';
import { overlay } from './live.js?v=1792645747';
import { computeSignals } from './signals.js?v=1792645747';
import { buildSnapshot } from './build.js?v=1792645747';
import { compact, diffChanges } from './sources.js?v=1792645747';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f1 = (v) => (v == null || Number.isNaN(v) ? '–' : v.toFixed(1));
const pct = (v) => `${Math.round(v * 100)}%`;
const sgn = (v, d = 1) => `${v > 0 ? '+' : ''}${v.toFixed(d)}`;
const ago = (t) => { const m = (Date.now() - Date.parse(t)) / 6e4; return m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } } };

let S, ME, OPP, SIM, SIGNALS = [], CHANGES = [];
const P = (id) => S.players[id];
const team = (rid) => S.teams.find((t) => t.rid === rid);

// ---------------------------------------------------------------- tooltips
const tipEl = () => $('#tip');
function tipFor(el) { return el.getAttribute('data-tip'); }
document.addEventListener('mouseover', (e) => { const el = e.target.closest('[data-tip]'); if (!el) return; const t = tipEl(); t.innerHTML = tipFor(el); t.style.display = 'block'; });
document.addEventListener('mousemove', (e) => { const t = tipEl(); if (t.style.display !== 'block') return; const x = Math.min(e.clientX + 14, innerWidth - t.offsetWidth - 8); const y = e.clientY + 16 + t.offsetHeight > innerHeight ? e.clientY - t.offsetHeight - 10 : e.clientY + 16; t.style.left = `${x}px`; t.style.top = `${y}px`; });
document.addEventListener('mouseout', (e) => { if (e.target.closest('[data-tip]')) tipEl().style.display = 'none'; });
document.addEventListener('click', (e) => { // tap to show on phones
  const el = e.target.closest('[data-tip]'); const t = tipEl();
  if (!el) { t.style.display = 'none'; return; }
  const r = el.getBoundingClientRect(); t.innerHTML = tipFor(el); t.style.display = 'block';
  t.style.left = `${Math.max(8, Math.min(r.left, innerWidth - t.offsetWidth - 8))}px`; t.style.top = `${r.bottom + 6}px`;
});
const tipAttr = (html) => `data-tip="${esc(html)}" tabindex="0"`;

// A projection with its ingredients on hover.
function proj(p, w = S.week, digits = 1) {
  if (!p) return '–';
  const r = M.projParts(p, w, S.week, S.live);
  const rows = r.parts.map(([k, v], i) => `<tr><td>${esc(k)}</td><td style="text-align:right">${i === 0 ? v.toFixed(1) : sgn(v)}</td></tr>`).join('');
  const html = `<b>${esc(p.name)} · week ${w}</b><table>${rows}<tr><td><b>projection</b></td><td style="text-align:right"><b>${r.mean.toFixed(1)}</b></td></tr></table><div class="faint">typical range ${Math.max(0, r.mean - r.sd).toFixed(0)}–${(r.mean + r.sd).toFixed(0)}</div>`;
  return `<span ${tipAttr(html)}>${r.mean.toFixed(digits)}</span>`;
}
function who(p, sub = true) {
  if (!p) return '<span class="faint">—</span>';
  const inj = p.inj ? ` <span class="pill ${['Out', 'IR', 'PUP', 'Doubtful', 'Sus'].includes(p.inj) ? 'bad' : 'act'}">${esc(p.inj)}</span>` : '';
  return `<div class="pl"><span class="n">${esc(p.name)}${inj}</span>${sub ? `<span class="m">${p.pos} · ${esc(p.team || 'FA')}${p.opp?.[S.week] ? ` · vs ${esc(p.opp[S.week])}` : ''}</span>` : ''}</div>`;
}

// ---------------------------------------------------------------- data
async function load({ rebuild = false } = {}) {
  const stamp = $('#stamp-t');
  let snap = null;
  const local = store.get('fflab-snap');
  if (rebuild) {
    stamp.textContent = 'rebuilding…';
    snap = await buildSnapshot({ progress: (m) => (stamp.textContent = `refreshing: ${m}…`) });
    const prev = local || await fetch(`data/snapshot.json?t=${Date.now()}`).then((r) => r.json()).catch(() => null);
    const ch = prev ? diffChanges(compact(prev), snap).map((c) => ({ ...c, at: snap.generated })) : [];
    store.set('fflab-changes', [...ch, ...(store.get('fflab-changes') || [])].slice(0, 300));
    if (!store.set('fflab-snap', snap)) console.warn('snapshot too big for local storage');
  } else {
    const file = await fetch(`data/snapshot.json?t=${Date.now()}`).then((r) => r.json());
    snap = local && Date.parse(local.generated) > Date.parse(file.generated) && local.week === file.week ? local : file;
  }
  S = snap;
  for (const id in S.players) S.players[id].id = id;
  M.bindSnapshot(S);
  stamp.textContent = 'live update…';
  const baked = await fetch(`data/changes.json?t=${Date.now()}`).then((r) => r.json()).catch(() => []);
  const live = await Promise.race([overlay(S).catch(() => ({ ok: false, changes: [] })), new Promise((r) => setTimeout(() => r({ ok: false, changes: [] }), 12000))]);
  CHANGES = [...live.changes, ...(store.get('fflab-changes') || []), ...baked].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  M.bindSnapshot(S, true); // refresh Vegas averages after the overlay
  WS.base = null;
  ME = S.teams.find((t) => t.me);
  const g = (S.schedule[S.week] || []).find((x) => x.includes(ME.rid));
  OPP = g && team(g.find((r) => r !== ME.rid));
  SIM = M.simulate(S, { n: 4000, seed: 11 });
  SIGNALS = computeSignals(S, { me: ME.rid, oppRid: OPP?.rid, changes: CHANGES });
  SECT = null;
  stamp.textContent = `Week ${S.week} · data ${ago(S.generated)} old${live.ok ? ' · live' : ''}`;
}

// ---------------------------------------------------------------- sectors / power rankings
const SECTORS = [['QB', ['QB']], ['RB', ['RB']], ['WR', ['WR']], ['TE', ['TE']], ['FLEX', ['FLEX']], ['K/DEF', ['K', 'DEF']], ['Bench', null]];
let SECT = null;
function sectors() {
  if (SECT) return SECT;
  const slots = M.starterSlots(S), weeks = [0, 1, 2, 3].map((i) => S.week + i).filter((w) => w <= 17);
  const data = {};
  for (const t of S.teams) {
    const acc = Object.fromEntries(SECTORS.map(([k]) => [k, { v: 0, players: {} }]));
    for (const w of weeks) {
      const lu = M.bestLineup(M.lineupIds(t), S.players, w, S.week, slots, S.live, { floor: M.floorsFor(S, w) });
      for (const x of lu.lineup) {
        const sec = SECTORS.find(([, s]) => s && s.includes(x.slot))?.[0]; if (!sec) continue;
        acc[sec].v += x.mean / weeks.length;
        const nm = x.p?.name || 'streamer'; acc[sec].players[nm] = (acc[sec].players[nm] || 0) + x.mean / weeks.length;
      }
      const bench = lu.bench.filter((x) => ['RB', 'WR', 'TE'].includes(x.p.pos)).slice(0, 3);
      for (const x of bench) { acc.Bench.v += x.mean / weeks.length; acc.Bench.players[x.p.name] = (acc.Bench.players[x.p.name] || 0) + x.mean / weeks.length; }
    }
    const power = Object.entries(acc).filter(([k]) => k !== 'Bench').reduce((s, [, x]) => s + x.v, 0);
    data[t.rid] = { ...acc, power };
  }
  const rank = (k) => { const order = [...S.teams].sort((a, b) => data[b.rid][k].v - data[a.rid][k].v); order.forEach((t, i) => (data[t.rid][k].rank = i + 1)); };
  SECTORS.forEach(([k]) => rank(k));
  [...S.teams].sort((a, b) => data[b.rid].power - data[a.rid].power).forEach((t, i) => (data[t.rid].powerRank = i + 1));
  return (SECT = data);
}
const rankColor = (r, n = 12) => { const x = (r - 1) / (n - 1); return `background:color-mix(in srgb, ${x < 0.5 ? 'var(--good)' : 'var(--bad)'} ${Math.round(Math.abs(x - 0.5) * 2 * 55)}%, transparent)`; };

function tradeFits() {
  const D = sectors(), mine = D[ME.rid], out = [];
  const posOf = { QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'] };
  const myWeak = ['QB', 'RB', 'WR', 'TE'].filter((k) => mine[k].rank >= 7);
  const myStrong = ['QB', 'RB', 'WR', 'TE'].filter((k) => mine[k].rank <= 4);
  for (const t of S.teams.filter((x) => !x.me)) {
    const d = D[t.rid];
    const strong = ['QB', 'RB', 'WR', 'TE'].filter((k) => d[k].rank <= 3), weak = ['QB', 'RB', 'WR', 'TE'].filter((k) => d[k].rank >= 9);
    const theyHave = strong, theyNeed = weak;
    if (!theyNeed.length || !theyHave.length) continue;
    // their spare: best player at a strong position who isn't one of their two best there
    const spare = (rid, pos) => team(rid).players.map(P).filter((p) => p && posOf[pos].includes(p.pos))
      .map((p) => ({ p, v: M.playerValue(S, p.id) })).sort((a, b) => b.v - a.v);
    const giveOpts = theyNeed.flatMap((k) => spare(ME.rid, k).slice(k === 'RB' || k === 'WR' ? 2 : 1, 4)).filter((x) => x.v > 20).slice(0, 3);
    const getOpts = theyHave.flatMap((k) => spare(t.rid, k).slice(0, 3)).filter((x) => x.v > 30).slice(0, 3);
    if (!giveOpts.length || !getOpts.length) continue;
    const score = theyNeed.reduce((s, k) => s + d[k].rank, 0) + theyHave.reduce((s, k) => s + (13 - d[k].rank), 0) + (myWeak.some((k) => theyHave.includes(k)) ? 6 : 0);
    out.push({ t, strong: theyHave, weak: theyNeed, give: giveOpts, get: getOpts, score, fitsMe: theyHave.filter((k) => myWeak.includes(k)) });
  }
  return { list: out.sort((a, b) => b.score - a.score), myWeak, myStrong };
}

// ---------------------------------------------------------------- overview
function renderOverview() {
  const o = SIM.odds[ME.rid], D = sectors();
  const mine = SIM.dist[S.week][ME.rid], theirs = OPP && SIM.dist[S.week][OPP.rid], wp = OPP ? M.winProb(mine, theirs) : null;
  const rows = [...S.teams].sort((a, b) => D[a.rid].powerRank - D[b.rid].powerRank);
  const pmax = Math.max(...rows.map((t) => D[t.rid].power));
  const cellTip = (t, k) => { const x = D[t.rid][k]; const list = Object.entries(x.players).sort((a, b) => b[1] - a[1]).map(([n, v]) => `<tr><td>${esc(n)}</td><td style="text-align:right">${v.toFixed(1)}</td></tr>`).join('');
    return `<b>${esc(t.owner)} · ${k}</b> <span class="faint">#${x.rank} of 12</span><table>${list}<tr><td><b>${k === 'Bench' ? 'top-3 depth' : 'per week'}</b></td><td style="text-align:right"><b>${x.v.toFixed(1)}</b></td></tr></table><div class="faint">avg of the next 4 weeks' best lineups</div>`; };
  const fits = tradeFits();
  const mySig = SIGNALS.filter((s) => s.tag === 'mine').slice(0, 4);
  const set = (t) => t.starters.map((id, i) => ({ slot: M.starterSlots(S)[i], p: P(id) }));
  return `
  <div class="kpis">
    <div class="kpi"><div class="v">${ME.wins}-${ME.losses}</div><div class="k">record · power #${D[ME.rid].powerRank}</div></div>
    ${OPP ? `<div class="kpi"><div class="v">${pct(wp)} <small>win</small></div><div class="k">vs ${esc(OPP.owner)} · ${f1(mine.mean)}–${f1(theirs.mean)}</div></div>` : ''}
    <div class="kpi"><div class="v">${pct(o.playoffs)}</div><div class="k">playoffs</div></div>
    <div class="kpi"><div class="v">${pct(o.bye)}</div><div class="k">top-2 bye</div></div>
    <div class="kpi"><div class="v">${pct(o.title)}</div><div class="k">title</div></div>
  </div>
  <div class="card" style="margin-top:14px"><h2>Power rankings <small>projected starters, next 4 weeks · hover any cell for the players</small></h2><div class="scroll">
    <table><tr><th class="l">#</th><th class="l">Team</th><th class="l">Power</th>${SECTORS.map(([k]) => `<th>${k}</th>`).join('')}<th>Playoffs</th><th>Title</th></tr>
    ${rows.map((t) => { const d = D[t.rid]; return `<tr class="${t.me ? 'me' : ''}"><td class="l">${d.powerRank}</td><td class="l">${esc(t.owner)}<span class="sub">${t.wins}-${t.losses}</span></td>
      <td class="l" style="min-width:110px"><div class="row" style="gap:6px"><div style="flex:1;height:8px;background:var(--panel2);border-radius:4px"><div style="height:8px;border-radius:4px;background:var(--info);width:${(d.power / pmax) * 100}%"></div></div><span>${d.power.toFixed(0)}</span></div></td>
      ${SECTORS.map(([k]) => `<td><span class="rankcell" style="${rankColor(d[k].rank)}" ${tipAttr(cellTip(t, k))}>${d[k].rank}</span></td>`).join('')}
      <td>${pct(SIM.odds[t.rid].playoffs)}</td><td><b>${pct(SIM.odds[t.rid].title)}</b></td></tr>`; }).join('')}
    </table></div><p class="faint" style="font-size:12px">Numbers are ranks (1 = best of 12). Bench = your 3 best non-starting RB/WR/TE, i.e. injury and bye cover.</p></div>
  <div class="grid two" style="margin-top:14px">
    <div class="card"><h2>Trade fits <small>teams strong where you're thin, or thin where you're deep</small></h2>
      <p class="muted" style="font-size:13px;margin-top:0">You: strongest at <b>${fits.myStrong.join(', ') || '—'}</b>, thinnest at <b>${fits.myWeak.join(', ') || '—'}</b>.</p>
      ${fits.list.slice(0, 5).map((f) => `<div class="fit"><div class="row"><b>${esc(f.t.owner)}</b><span class="faint" style="font-size:12px">${f.t.wins}-${f.t.losses}</span><span class="sp"></span>
        <button class="btn ghost" style="padding:3px 9px;font-size:12px" data-fit="${f.t.rid}">try in Workshop</button></div>
        <div class="muted" style="font-size:13px">Strong at <b class="good">${f.strong.map((k) => `${k} (#${D[f.t.rid][k].rank})`).join(', ')}</b>, thin at <b class="bad">${f.weak.map((k) => `${k} (#${D[f.t.rid][k].rank})`).join(', ')}</b>.${f.fitsMe.length ? ` Their strength is your need (${f.fitsMe.join(', ')}).` : ''}</div>
        <div style="font-size:12.5px;margin-top:3px"><span class="faint">They could use:</span> ${f.give.map((x) => `${esc(x.p.name)} (${proj(x.p)})`).join(', ')}<br><span class="faint">Ask about:</span> ${f.get.map((x) => `${esc(x.p.name)} (${proj(x.p)})`).join(', ')}</div></div>`).join('') || '<div class="empty">No clear mismatches right now.</div>'}
    </div>
    <div class="card"><h2>Week ${S.week} ${OPP ? `vs ${esc(OPP.owner)}` : ''} <small>hover a number for how it's built</small></h2>
      ${OPP ? `<div class="scroll"><table><tr><th class="l">${esc(ME.owner)}</th><th>Proj</th><th></th><th>Proj</th><th class="l">${esc(OPP.owner)}</th></tr>
      ${set(ME).map((x, i) => { const y = set(OPP)[i]; return `<tr><td class="l">${who(x.p)}</td><td>${proj(x.p)}</td><td class="faint" style="font-size:11px;text-align:center">${x.slot}</td><td>${proj(y?.p)}</td><td class="l">${who(y?.p)}</td></tr>`; }).join('')}
      <tr><td class="l"><b>Total</b></td><td><b>${f1(mine.mean)}</b></td><td></td><td><b>${f1(theirs.mean)}</b></td><td class="l faint">${pct(wp)} for you</td></tr></table></div>` : '<div class="empty">Bye week</div>'}
    </div>
  </div>
  <div class="card" style="margin-top:14px"><h2>Your signals <small><a href="#signals">all signals →</a></small></h2>${mySig.map(sigRow).join('') || '<div class="empty">Nothing notable on your roster right now.</div>'}</div>`;
}

// ---------------------------------------------------------------- signals
const SIG_TYPES = { 'role-up': ['Role ↑', 'var(--good)'], 'role-down': ['Role ↓', 'var(--bad)'], 'buy-low': ['Buy low', 'var(--info)'], 'sell-high': ['Sell high', 'var(--act)'],
  gem: ['Waiver gem', 'var(--good)'], injury: ['Injury', 'var(--bad)'], proj: ['Projection', 'var(--info)'], trend: ['Trending', 'var(--act)'], news: ['News', 'var(--faint)'] };
const SV = { who: 'all', type: 'all' };
function sigRow(s) {
  const [label, color] = SIG_TYPES[s.type];
  const owner = s.tag === 'mine' ? '<span class="pill act">your team</span>' : s.tag === 'opponent' ? '<span class="pill bad">this week\'s opponent</span>' : s.tag === 'free agent' ? '<span class="pill good">free agent</span>' : `<span class="pill">${esc(s.owner)}</span>`;
  return `<div class="sig"><i style="background:${color}"></i><div><div class="t">${s.link ? `<a href="${esc(s.link)}" target="_blank" rel="noopener">${esc(s.title)}</a>` : esc(s.title)}</div>
    <div class="d">${esc(s.detail)}</div>${s.evidence ? `<div class="e">${esc(s.evidence)}</div>` : ''}<div style="margin-top:4px">${owner} <span class="pill">${label}</span></div></div>
    <div class="side">${s.spark ? spark(s.spark, { w: 70, h: 20, color }) : ''}<div>next 4 wks ${s.ros ? `<b>${s.ros.toFixed(1)}</b>/wk` : '–'}</div>${s.time ? `<div class="faint">${ago(s.time)} ago</div>` : ''}</div></div>`;
}
function renderSignals() {
  const W = { all: 'Everything', mine: 'Your team', opponent: 'Opponent', 'free agent': 'Free agents', league: 'Other teams' };
  const list = SIGNALS.filter((s) => (SV.who === 'all' || s.tag === SV.who) && (SV.type === 'all' || s.type === SV.type));
  const count = (k) => SIGNALS.filter((s) => (SV.who === 'all' || s.tag === SV.who) && s.type === k).length;
  return `<div class="card"><h2>Signals <small>what's changing, ranked by how much it matters to you · ${SIGNALS.length} total</small></h2>
    <div class="chips2">${Object.entries(W).map(([k, v]) => `<button data-sw="${k}" class="${SV.who === k ? 'on' : ''}">${v}</button>`).join('')}</div>
    <div class="chips2"><button data-st="all" class="${SV.type === 'all' ? 'on' : ''}">All types</button>${Object.entries(SIG_TYPES).map(([k, [v]]) => `<button data-st="${k}" class="${SV.type === k ? 'on' : ''}">${v} <span class="faint">${count(k)}</span></button>`).join('')}</div>
    ${list.slice(0, 60).map(sigRow).join('') || '<div class="empty">Nothing here right now.</div>'}
    <p class="faint" style="font-size:12px">Role = last 2 games vs earlier (snaps, touches + targets, target share), ignoring games a player left early. Buy low / sell high = last 3 games' points vs what that usage usually produces. Gems = free agents with a real, growing role.</p></div>`;
}

// ---------------------------------------------------------------- workshop
const WS_KEY = 'fflab-workspaces';
const WS = { list: store.get(WS_KEY) || [{ name: 'Workspace 1', moves: [] }], active: 0, draft: { kind: 'trade', partner: '', give: [], get: [], pid: '', out: '', scale: 100 }, result: null, running: false, compare: null };
const saveWS = () => store.set(WS_KEY, WS.list);
const cur = () => WS.list[WS.active];
function movesToScenario(moves) {
  const steps = [], overrides = {};
  for (const m of moves) {
    const g = m.give.map(pidOf).filter(Boolean), r = m.get.map(pidOf).filter(Boolean);
    if (m.kind === 'trade') steps.push({ partner: S.teams.find((t) => t.owner === m.partner)?.rid, give: g, get: r });
    if (m.kind === 'add') steps.push({ partner: null, give: g, get: r });
    if (m.kind === 'whatif') { const id = pidOf(m.player); if (id) overrides[id] = m.out ? { out: m.out } : { scale: m.scale / 100 }; }
  }
  return { steps, overrides };
}
const pidOf = (name) => Object.values(S.players).find((p) => p.name === name)?.id;
function runWS(ws = cur()) {
  const { steps, overrides } = movesToScenario(ws.moves);
  const base = (WS.base ||= M.simulate(S, { n: 3000, seed: 11 }));
  return M.runScenario(S, steps, { n: 3000, seed: 11, base, overrides });
}
function moveText(m) {
  if (m.kind === 'trade') return `<b>Trade</b> with ${esc(m.partner)}: ${m.give.map(esc).join(' + ')} → <b>${m.get.map(esc).join(' + ')}</b>`;
  if (m.kind === 'add') return `<b>Waiver</b>: add <b>${m.get.map(esc).join(', ')}</b>${m.give.length ? `, drop ${m.give.map(esc).join(', ')}` : ''}`;
  return `<b>What-if</b>: ${esc(m.player)} ${m.out ? `out weeks ${m.out[0]}–${m.out[1]}` : `at ${m.scale}% of projection`}`;
}
function resultPanel(r) {
  if (!r) return '<div class="empty">Add a move. Results update automatically.</div>';
  const m = r.me, rv = S.teams.filter((t) => !t.me).sort((a, b) => r.base.odds[b.rid].title - r.base.odds[a.rid].title)[0];
  const d = (a, b, f = pct) => `${f(a)} → <b class="${b - a > 0.004 ? 'delta-up' : b - a < -0.004 ? 'delta-down' : ''}">${f(b)}</b>`;
  const wk = r.weeks.base.map((_, i) => `W${S.week + i}`);
  const pw = S.league.playoff_week_start;
  return `<div class="kpis">
      <div class="kpi"><div class="v" style="font-size:17px">${d(m.title[0], m.title[1])}</div><div class="k">your title odds</div></div>
      <div class="kpi"><div class="v" style="font-size:17px">${d(m.bye[0], m.bye[1])}</div><div class="k">top-2 bye</div></div>
      <div class="kpi"><div class="v" style="font-size:17px">${d(r.base.odds[ME.rid].playoffs, r.after.odds[ME.rid].playoffs)}</div><div class="k">playoffs</div></div>
      <div class="kpi"><div class="v" style="font-size:17px">${d(r.base.odds[rv.rid].title, r.after.odds[rv.rid].title)}</div><div class="k">${esc(rv.owner)} title</div></div>
    </div>
    <h2 style="margin-top:14px">Your expected starting lineup by week</h2>
    ${lines({ labels: wk, height: 170, fmt: (v) => v.toFixed(0), series: [{ name: 'now', values: r.weeks.base, color: 'var(--faint)' }, { name: 'with these moves', values: r.weeks.after, color: 'var(--act)' }] })}
    <p class="muted" style="font-size:13px">Title weeks ${pw + 1}–17: <b class="${m.w16 + m.w17 >= 0 ? 'delta-up' : 'delta-down'}">${sgn(m.w16)} / ${sgn(m.w17)}</b> pts. ${r.steps.filter((s) => s.partner != null).map((s) => `${esc(team(s.partner).owner)}: playoffs ${pct(s.partnerOdds.playoffs[0])}→${pct(s.partnerOdds.playoffs[1])}, value ${(s.give$ / 1000).toFixed(1)}k for ${(s.get$ / 1000).toFixed(1)}k`).join(' · ')}</p>`;
}
function renderWorkshop() {
  const ws = cur(), dr = WS.draft, partners = S.teams.filter((t) => !t.me);
  const pt = dr.partner && S.teams.find((t) => t.owner === dr.partner);
  const fas = Object.values(S.players).filter((p) => !p.own && p.pos).sort((a, b) => M.playerValue(S, b.id) - M.playerValue(S, a.id)).slice(0, 80);
  const opt = (ps, sel) => ps.filter(Boolean).map((p) => `<option value="${esc(p.name)}" ${sel.includes(p.name) ? 'disabled' : ''}>${esc(p.name)} · ${p.pos} ${esc(p.team || '')}</option>`).join('');
  const chipList = (arr, side) => arr.map((n) => `<span class="chip">${esc(n)} <button data-wsrm="${side}:${esc(n)}">×</button></span>`).join('');
  const everyone = Object.values(S.players).filter((p) => p.own).sort((a, b) => a.name.localeCompare(b.name));
  const builder = dr.kind === 'trade' ? `
      <select id="ws-partner"><option value="">trade partner…</option>${partners.map((t) => `<option ${t.owner === dr.partner ? 'selected' : ''}>${esc(t.owner)}</option>`).join('')}</select>
      <div class="grid half" style="margin-top:6px"><div><select id="ws-give"><option value="">+ you give</option>${opt(ME.players.map(P), dr.give)}</select><div class="chips">${chipList(dr.give, 'give')}</div></div>
      <div>${pt ? `<select id="ws-get"><option value="">+ you get</option>${opt(pt.players.map(P), dr.get)}</select>` : ''}<div class="chips">${chipList(dr.get, 'get')}</div></div></div>`
    : dr.kind === 'add' ? `
      <div class="grid half"><div><select id="ws-get"><option value="">+ add free agent</option>${opt(fas, dr.get)}</select><div class="chips">${chipList(dr.get, 'get')}</div></div>
      <div><select id="ws-give"><option value="">− drop (optional)</option>${opt(ME.players.map(P), dr.give)}</select><div class="chips">${chipList(dr.give, 'give')}</div></div></div>`
    : `
      <select id="ws-player"><option value="">any rostered player…</option>${opt(everyone, [])}</select>
      ${dr.pid ? `<div class="muted" style="margin:6px 0">Selected: <b>${esc(dr.pid)}</b></div>` : ''}
      <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:6px"><label class="muted" style="font-size:13px">out weeks <input type="text" id="ws-out" placeholder="e.g. 8-10" value="${esc(dr.out)}" style="width:80px"></label>
      <span class="faint">or</span><label class="muted" style="font-size:13px">projection at <input type="text" id="ws-scale" value="${dr.scale}" style="width:56px">%</label></div>`;
  const canAdd = dr.kind === 'trade' ? dr.partner && dr.give.length && dr.get.length : dr.kind === 'add' ? dr.get.length : dr.pid && (dr.out || dr.scale != 100);
  return `<div class="ws-tabs">${WS.list.map((w, i) => `<button data-ws="${i}" class="${i === WS.active ? 'on' : ''}">${esc(w.name)}</button>`).join('')}<button data-wsnew="1">+ new</button><button data-wsdup="1">duplicate</button>${WS.list.length > 1 ? '<button data-wsdel="1">delete</button>' : ''}<button data-wscmp="1">compare all</button></div>
  <div class="grid two">
    <div class="card"><h2>${esc(ws.name)} <small><button class="chip" data-wsrename="1" style="padding:1px 8px">rename</button></small></h2>
      ${ws.moves.length ? ws.moves.map((m, i) => `<div class="move">${moveText(m)}<button data-wsdelmove="${i}" title="remove">×</button></div>`).join('') : '<p class="faint">No moves yet. Start from today\'s league and add trades, waiver adds, or what-ifs (an injury, a role change).</p>'}
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
        <div class="seg" style="margin-bottom:8px">${[['trade', 'Trade'], ['add', 'Waiver add'], ['whatif', 'What-if']].map(([k, v]) => `<button data-wskind="${k}" class="${dr.kind === k ? 'on' : ''}">${v}</button>`).join('')}</div>
        ${builder}
        <div class="row" style="margin-top:8px"><button class="btn" id="ws-add" ${canAdd ? '' : 'disabled'}>Add to workspace</button><span class="sp"></span><button class="btn ghost" id="ws-copy" ${ws.moves.length ? '' : 'disabled'}>Copy summary</button></div>
      </div></div>
    <div class="card" id="ws-result"><h2>Projected result <small>3,000 simulated seasons vs today</small></h2>${WS.running ? '<div class="loading">simulating…</div>' : resultPanel(WS.result)}</div>
  </div>
  ${WS.compare ? `<div class="card" style="margin-top:14px"><h2>All workspaces</h2><div class="scroll"><table><tr><th class="l">Workspace</th><th>Moves</th><th>Title</th><th>Bye</th><th>Weeks 16/17</th></tr>
    ${WS.compare.map(({ ws, r }) => `<tr><td class="l">${esc(ws.name)}</td><td>${ws.moves.length}</td><td><b>${pct(r.me.title[1])}</b> <span class="faint">(${sgn((r.me.title[1] - r.me.title[0]) * 100)})</span></td><td>${pct(r.me.bye[1])}</td><td>${sgn(r.me.w16)} / ${sgn(r.me.w17)}</td></tr>`).join('')}</table></div></div>` : ''}`;
}
function rerunWS() { WS.running = true; route(); setTimeout(() => { WS.result = cur().moves.length ? runWS() : null; WS.running = false; route(); }, 20); }
function summaryText() {
  const r = WS.result, ws = cur();
  return [`FF Lab workspace "${ws.name}" (week ${S.week})`, ...ws.moves.map((m) => '- ' + moveText(m).replace(/<[^>]+>/g, '')),
    r ? `Title ${pct(r.me.title[0])} → ${pct(r.me.title[1])}, bye ${pct(r.me.bye[0])} → ${pct(r.me.bye[1])}, title weeks ${sgn(r.me.w16)}/${sgn(r.me.w17)} pts` : ''].join('\n');
}

// ---------------------------------------------------------------- routing + events
const TABS = { overview: renderOverview, signals: renderSignals, workshop: renderWorkshop };
function route() {
  const tab = location.hash.slice(1) || 'overview';
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  const y = window.scrollY, same = route.last === tab; route.last = tab;
  $('main').innerHTML = (TABS[tab] || renderOverview)();
  window.scrollTo(0, same ? y : 0);
}
document.addEventListener('click', async (e) => {
  const q = (sel) => e.target.closest(sel);
  let x;
  if ((x = q('nav button'))) { location.hash = x.dataset.tab; return; }
  if ((x = q('[data-sw]'))) { SV.who = x.dataset.sw; route(); return; }
  if ((x = q('[data-st]'))) { SV.type = x.dataset.st; route(); return; }
  if ((x = q('[data-fit]'))) { const t = team(+x.dataset.fit); WS.draft = { ...WS.draft, kind: 'trade', partner: t.owner, give: [], get: [] }; location.hash = 'workshop'; return; }
  if ((x = q('[data-wskind]'))) { WS.draft.kind = x.dataset.wskind; WS.draft.give = []; WS.draft.get = []; route(); return; }
  if ((x = q('[data-wsrm]'))) { const [side, n] = x.dataset.wsrm.split(':'); WS.draft[side] = WS.draft[side].filter((v) => v !== n); route(); return; }
  if ((x = q('[data-ws]'))) { WS.active = +x.dataset.ws; WS.compare = null; rerunWS(); return; }
  if (q('[data-wsnew]')) { WS.list.push({ name: `Workspace ${WS.list.length + 1}`, moves: [] }); WS.active = WS.list.length - 1; saveWS(); WS.result = null; route(); return; }
  if (q('[data-wsdup]')) { const c = cur(); WS.list.push({ name: `${c.name} (copy)`, moves: JSON.parse(JSON.stringify(c.moves)) }); WS.active = WS.list.length - 1; saveWS(); rerunWS(); return; }
  if (q('[data-wsdel]')) { WS.list.splice(WS.active, 1); WS.active = 0; saveWS(); rerunWS(); return; }
  if (q('[data-wsrename]')) { const n = prompt('Workspace name', cur().name); if (n) { cur().name = n; saveWS(); route(); } return; }
  if (q('[data-wscmp]')) { WS.compare = WS.list.map((ws) => ({ ws, r: ws.moves.length ? runWS(ws) : { me: { title: [SIM.odds[ME.rid].title, SIM.odds[ME.rid].title], bye: [SIM.odds[ME.rid].bye, SIM.odds[ME.rid].bye], w16: 0, w17: 0 } } })); route(); return; }
  if ((x = q('[data-wsdelmove]'))) { cur().moves.splice(+x.dataset.wsdelmove, 1); saveWS(); rerunWS(); return; }
  if (e.target.id === 'ws-add') {
    const d = WS.draft; let m;
    if (d.kind === 'trade') m = { kind: 'trade', partner: d.partner, give: d.give, get: d.get };
    else if (d.kind === 'add') m = { kind: 'add', give: d.give, get: d.get };
    else { const r = d.out.match(/(\d+)\s*-\s*(\d+)/) || d.out.match(/(\d+)/); m = { kind: 'whatif', player: d.pid, give: [], get: [], ...(r ? { out: [+r[1], +(r[2] || r[1])] } : { scale: +d.scale || 100 }) }; }
    cur().moves.push(m); saveWS(); WS.draft = { ...WS.draft, give: [], get: [], pid: '', out: '', scale: 100 }; rerunWS(); return;
  }
  if (e.target.id === 'ws-copy') { try { await navigator.clipboard.writeText(summaryText()); e.target.textContent = 'copied ✓'; } catch { prompt('Copy this:', summaryText()); } return; }
  if (e.target.id === 'refresh-all') { e.target.textContent = '…'; try { await load({ rebuild: true }); WS.base = null; } catch (err) { console.error(err); $('#stamp-t').textContent = 'refresh failed, showing saved data'; } e.target.textContent = 'refresh all'; route(); return; }
  if (e.target.id === 'theme') { const r = document.documentElement; r.dataset.theme = r.dataset.theme === 'light' ? 'dark' : 'light'; store.set('fflab-theme', r.dataset.theme); }
});
document.addEventListener('change', (e) => {
  const id = e.target.id, v = e.target.value;
  if (id === 'ws-partner') { WS.draft.partner = v; WS.draft.get = []; route(); }
  if (id === 'ws-give' && v) { WS.draft.give.push(v); route(); }
  if (id === 'ws-get' && v) { WS.draft.get.push(v); route(); }
  if (id === 'ws-player' && v) { WS.draft.pid = v; route(); }
  if (id === 'ws-out') { WS.draft.out = v; route(); }
  if (id === 'ws-scale') { WS.draft.scale = +v || 100; route(); }
});
window.addEventListener('hashchange', () => { if (location.hash === '#workshop' && !WS.result && cur().moves.length) rerunWS(); else route(); });
try { const th = store.get('fflab-theme'); if (th) document.documentElement.dataset.theme = th; } catch {}

await load();
if (location.hash === '#workshop' && cur().moves.length) rerunWS(); else route();
