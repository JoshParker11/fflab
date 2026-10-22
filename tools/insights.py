# Visual-insight data for the Insights tab (data/insights.json). League scoring, 2018–2025.
#   python3 tools/insights.py      (needs data/hist from fetch_history.sh and data/model from model_build.py)
#
# 1. Playoff-projection error by the week you make it, vs the typical one-week error.
# 2. Regular-season rank vs fantasy-playoff rank for each season's top players.
# 3. Did an "easy playoff schedule" (judged in October, or in hindsight) actually help?
import json, os, statistics as st
from collections import defaultdict

ROOT = os.path.join(os.path.dirname(__file__), '..'); H = os.path.join(ROOT, 'data', 'hist')
SC = json.load(open(os.path.join(ROOT, 'data', 'snapshot.json')))['league']['scoring']
POS = ('QB', 'RB', 'WR', 'TE'); PLAYOFF = (15, 16, 17); REG = range(1, 15)
SEASONS = [y for y in range(2018, 2026) if os.path.exists(os.path.join(H, f's{y}-1.json'))]
OOS = {2024, 2025}  # seasons the model never trained on in its explorer runs
TEAM = {'LA': 'LAR', 'STL': 'LAR', 'SD': 'LAC', 'OAK': 'LV', 'WSH': 'WAS', 'JAC': 'JAX'}
team = lambda t: TEAM.get(t, t) if t else t
pts = lambda s: sum(v * SC.get(k, 0) for k, v in s.items() if k in SC)
mean = lambda v: sum(v) / len(v) if v else None

# ---- per-season player weeks ----
A = {}  # (y, pid) -> {name,pos,a[w],opp[w]}
for y in SEASONS:
    for w in range(1, 18):
        for r in json.load(open(os.path.join(H, f's{y}-{w}.json'))):
            m = r.get('player') or {}; s = r['stats']
            if m.get('position') not in POS or not r.get('opponent'): continue
            if not (s.get('off_snp', 0) > 0 or s.get('snp', 0) > 0 or s.get('pass_att', 0) > 0 or s.get('rush_att', 0) > 0 or s.get('rec_tgt', 0) > 0): continue
            if m['position'] == 'QB' and s.get('pass_att', 0) < 10: continue
            g = A.setdefault((y, r['player_id']), {'name': f"{m.get('first_name','')} {m.get('last_name','')}".strip(), 'pos': m['position'], 'a': {}, 'opp': {}})
            g['a'][w] = pts(s); g['opp'][w] = team(r['opponent'])
        # opponents for weeks a player didn't play (schedule only) come from projections
        for r in json.load(open(os.path.join(H, f'p{y}-{w}.json'))):
            g = A.get((y, r['player_id']))
            if g is not None and w not in g['opp'] and r.get('opponent'): g['opp'][w] = team(r['opponent'])

def dvp(y, pos, upto):  # points allowed per game to a position through week `upto`, vs league avg
    tw = defaultdict(float)
    for (yy, _), g in A.items():
        if yy != y or g['pos'] != pos: continue
        for w, v in g['a'].items():
            if w <= upto: tw[(g['opp'][w], w)] += v
    per = defaultdict(list)
    for (o, w), v in tw.items(): per[o].append(v)
    lg = mean([v for vs in per.values() for v in vs]) or 0
    return {o: mean(v) - lg for o, v in per.items()}

out = {'seasons': SEASONS, 'playoff_weeks': PLAYOFF}

# ---- 1. playoff projection error by as-of week ----
conv = {'model': defaultdict(list), 'sleeper': defaultdict(list), 'ppg': defaultdict(list), 'week1': []}
for y in SEASONS:
    ex = json.load(open(os.path.join(ROOT, 'data', 'model', f'explorer-{y}.json')))
    for p in ex['players']:
        act = [p['a'][w] for w in PLAYOFF if p['a'][w] is not None]
        if len(act) < 2: continue
        truth = mean(act)
        for k in range(0, 15):
            # model (out-of-sample seasons only)
            if y in OOS:
                pv = [p['pred'][k].get(str(w)) for w in PLAYOFF if p['pred'][k].get(str(w)) is not None]
                if pv: conv['model'][k].append(abs(mean(pv) - truth))
            # Sleeper's newest projection carried forward to the playoffs
            mk = next((p['proj'][w] for w in range(k + 1, 0, -1) if p['proj'][w]), None)
            if mk: conv['sleeper'][k].append(abs(mk - truth))
            # season average so far
            so = [p['a'][w] for w in range(1, k + 1) if p['a'][w] is not None]
            if len(so) >= 2: conv['ppg'][k].append(abs(mean(so) - truth))
        # typical single-week miss: Sleeper's week-of projection vs that week's result
        for w in range(1, 18):
            if p['a'][w] is not None and p['proj'][w]: conv['week1'].append(abs(p['proj'][w] - p['a'][w]))
avg_pts = mean([mean([p for p in [g['a'].get(w) for w in PLAYOFF] if p is not None]) or 0 for g in A.values()
                if sum(1 for w in PLAYOFF if w in g['a']) >= 2])
out['convergence'] = {
    'as_of': list(range(0, 15)),
    'model': [round(mean(conv['model'][k]), 2) if conv['model'][k] else None for k in range(15)],
    'sleeper': [round(mean(conv['sleeper'][k]), 2) if conv['sleeper'][k] else None for k in range(15)],
    'ppg': [round(mean(conv['ppg'][k]), 2) if conv['ppg'][k] else None for k in range(15)],
    'one_week_miss': round(mean(conv['week1']), 2),
    # with ~6 pts of game-to-game noise, a 3-game playoff average carries ~noise/sqrt(3) on its own
    'noise_floor': round(st.pstdev([v - mean(list(g['a'].values())) for g in A.values() if len(g['a']) >= 8 for v in g['a'].values()]) / 3 ** 0.5 * 0.8, 2),
    'avg_playoff_ppg': round(avg_pts, 2) if avg_pts else None,
}

# ---- 2. regular-season rank vs playoff rank ----
ranks = []; stay = defaultdict(lambda: [0, 0])
for y in SEASONS:
    for pos in POS:
        pl = []
        for (yy, pid), g in A.items():
            if yy != y or g['pos'] != pos: continue
            reg = [g['a'][w] for w in REG if w in g['a']]; po = [g['a'][w] for w in PLAYOFF if w in g['a']]
            if len(reg) >= 8 and len(po) >= 2: pl.append((g['name'], mean(reg), mean(po)))
        top = sorted(pl, key=lambda x: -x[1])[: {'QB': 24, 'RB': 36, 'WR': 48, 'TE': 18}[pos]]
        by_po = sorted(top, key=lambda x: -x[2])
        cut = {'QB': 12, 'RB': 24, 'WR': 24, 'TE': 12}[pos]
        for i, (n, r, p) in enumerate(top):
            pr = by_po.index((n, r, p)) + 1
            ranks.append({'y': y, 'pos': pos, 'name': n, 'reg_rank': i + 1, 'po_rank': pr, 'reg_ppg': round(r, 1), 'po_ppg': round(p, 1)})
            if i < cut: stay[pos][1] += 1; stay[pos][0] += pr <= cut
out['ranks'] = ranks
out['stay_top'] = {p: {'stayed': v[0], 'of': v[1], 'cut': {'QB': 12, 'RB': 24, 'WR': 24, 'TE': 12}[p]} for p, v in stay.items()}

# ---- 3. playoff schedule: judged in October (wk 1–7 data) and in hindsight (full season) ----
sched = {}
for pos in POS:
    rows = []
    for y in SEASONS:
        early, full = dvp(y, pos, 7), dvp(y, pos, 17)
        for (yy, pid), g in A.items():
            if yy != y or g['pos'] != pos: continue
            reg = [g['a'][w] for w in REG if w in g['a']]; po = [g['a'][w] for w in PLAYOFF if w in g['a']]
            opps = [g['opp'].get(w) for w in PLAYOFF if g['opp'].get(w)]
            if len(reg) < 8 or len(po) < 2 or len(opps) < 2 or mean(reg) < (12 if pos == 'QB' else 7): continue
            rows.append((mean([early.get(o, 0) for o in opps]), mean([full.get(o, 0) for o in opps]), mean(po) - mean(reg)))
    res = {}
    for name, idx in (('october', 0), ('hindsight', 1)):
        srt = sorted(rows, key=lambda r: r[idx]); n = len(srt) // 3
        groups = {'hardest third': srt[:n], 'middle third': srt[n:2 * n], 'easiest third': srt[2 * n:]}
        res[name] = {k: {'n': len(v), 'playoff_minus_season_ppg': round(mean([r[2] for r in v]), 2), 'schedule_softness': round(mean([r[idx] for r in v]), 2)} for k, v in groups.items()}
    sched[pos] = res
out['schedule'] = sched
json.dump(out, open(os.path.join(ROOT, 'data', 'insights.json'), 'w'))
print(json.dumps({k: out[k] for k in ('convergence', 'stay_top', 'schedule')}, indent=1))
