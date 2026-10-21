# Research backtests over past seasons, in this league's scoring. Writes data/research.json for
# the site's Research tab.
#   ./tools/fetch_history.sh 2018 2019 2020 2021 2022 2023 2024 2025
#   curl -sL https://github.com/nflverse/nfldata/raw/master/data/games.csv -o data/hist/games.csv
#   python3 tools/research.py
# Every predictor uses only information available at the time ("as of" week k).
import csv, json, math, os, statistics as st
from collections import defaultdict

ROOT = os.path.join(os.path.dirname(__file__), '..')
H = os.path.join(ROOT, 'data', 'hist')
SC = json.load(open(os.path.join(ROOT, 'data', 'snapshot.json')))['league']['scoring']
SEASONS = [y for y in range(2018, 2026) if os.path.exists(os.path.join(H, f's{y}-1.json'))]
POS = ('QB', 'RB', 'WR', 'TE')
TEAM = {'LA': 'LAR', 'STL': 'LAR', 'SD': 'LAC', 'OAK': 'LV', 'WSH': 'WAS', 'JAC': 'JAX'}
team = lambda t: TEAM.get(t, t)


def pts(s):
    return sum(v * SC.get(k, 0) for k, v in s.items() if k in SC)


def corr(x, y):
    if len(x) < 3: return None
    mx, my = st.mean(x), st.mean(y)
    sx = math.sqrt(sum((a - mx) ** 2 for a in x)); sy = math.sqrt(sum((b - my) ** 2 for b in y))
    return None if not sx or not sy else sum((a - mx) * (b - my) for a, b in zip(x, y)) / (sx * sy)


def ols(X, y):  # least squares with intercept; returns coefficients [b0, b1, ...]
    k = len(X[0]) + 1
    A = [[0.0] * k for _ in range(k)]; b = [0.0] * k
    for xi, yi in zip(X, y):
        v = [1.0, *xi]
        for i in range(k):
            b[i] += v[i] * yi
            for j in range(k): A[i][j] += v[i] * v[j]
    for i in range(k):
        p = max(range(i, k), key=lambda r: abs(A[r][i])); A[i], A[p] = A[p], A[i]; b[i], b[p] = b[p], b[i]
        for r in range(k):
            if r != i:
                f = A[r][i] / A[i][i]
                for c in range(i, k): A[r][c] -= f * A[i][c]
                b[r] -= f * b[i]
    return [b[i] / A[i][i] for i in range(k)]


r3 = lambda v: None if v is None else round(v, 3)

# ---------- load ----------
rows = []
for y in SEASONS:
    for w in range(1, 18):
        S = json.load(open(os.path.join(H, f's{y}-{w}.json')))
        PJ = {r['player_id']: r for r in json.load(open(os.path.join(H, f'p{y}-{w}.json')))}
        for r in S:
            s = r['stats']; pos = r['player'].get('position')
            if pos not in POS or not r.get('opponent'): continue
            if not (s.get('off_snp', 0) > 0 or s.get('pass_att', 0) > 0 or s.get('rush_att', 0) > 0 or s.get('rec_tgt', 0) > 0): continue
            if pos == 'QB' and s.get('pass_att', 0) < 15: continue
            pj = PJ.get(r['player_id'])
            rows.append(dict(y=y, w=w, pid=r['player_id'], pos=pos, team=team(r.get('team') or ''), opp=team(r['opponent']),
                             a=pts(s), pj=pts(pj['stats']) if pj else None,
                             snp=(s.get('off_snp', 0) / s['tm_off_snp']) if s.get('tm_off_snp') else None,
                             opp_n=s.get('rec_tgt', 0) + s.get('rush_att', 0)))
print(f'{len(rows)} player-games, seasons {SEASONS}')

# Vegas: implied team points per (season, week, team)
implied = {}
gpath = os.path.join(H, 'games.csv')
if os.path.exists(gpath):
    for g in csv.DictReader(open(gpath)):
        try:
            y, w = int(g['season']), int(g['week'])
            if g.get('game_type') != 'REG' or y not in SEASONS or not g['total_line'] or not g['spread_line']: continue
            tot, spr = float(g['total_line']), float(g['spread_line'])  # spread_line > 0: home favored
            implied[(y, w, team(g['home_team']))] = tot / 2 + spr / 2
            implied[(y, w, team(g['away_team']))] = tot / 2 - spr / 2
        except (ValueError, KeyError):
            pass

by_season_pos = defaultdict(list)
for r in rows: by_season_pos[(r['y'], r['pos'])].append(r)

out = {'seasons': SEASONS, 'n': len(rows), 'scoring': 'league (full PPR, 4pt pass TD, INT -1)'}

# ---------- 1. week-of projection accuracy ----------
acc = {}
for pos in POS:
    R = [r for r in rows if r['pos'] == pos and r['pj'] and r['pj'] >= (12 if pos == 'QB' else 6)]
    c = corr([r['pj'] for r in R], [r['a'] for r in R])
    bins = defaultdict(list)
    for r in R: bins[int(r['pj'] // 3) * 3].append(r['a'])
    acc[pos] = {'n': len(R), 'corr': r3(c), 'r2': r3(c * c), 'mae': r3(st.mean(abs(r['a'] - r['pj']) for r in R)),
                'bias': r3(st.mean(r['a'] - r['pj'] for r in R)),
                'calibration': [[k, round(st.mean(v), 2), len(v)] for k, v in sorted(bins.items()) if len(v) >= 30]}
out['accuracy'] = acc


# ---------- helpers: as-of-week-k talent and defense-vs-position ----------
def asof(y, pos, k):
    R = by_season_pos[(y, pos)]
    ppg = defaultdict(list); tg = defaultdict(float)
    for r in R:
        if r['w'] <= k: ppg[r['pid']].append(r['a']); tg[(r['opp'], r['w'])] += r['a']
    dv = defaultdict(list)
    for (o, w), v in tg.items(): dv[o].append(v)
    lg = st.mean(v for vs in dv.values() for v in vs) if dv else 0
    return ({p: (st.mean(v), len(v)) for p, v in ppg.items()}, {o: st.mean(v) - lg for o, v in dv.items()})


# ---------- 2. horizon decay: talent vs matchup, h weeks ahead ----------
decay = {}
for pos in POS:
    series = []
    for h in range(1, 11):
        T, D, A = [], [], []
        for y in SEASONS:
            for k in range(4, 9):
                t = k + h
                if t > 17: continue
                ppg, dvp = asof(y, pos, k)
                for r in by_season_pos[(y, pos)]:
                    if r['w'] != t: continue
                    p = ppg.get(r['pid'])
                    if not p or p[1] < 3 or r['opp'] not in dvp: continue
                    T.append(p[0]); D.append(dvp[r['opp']]); A.append(r['a'])
        b = ols(list(zip(T, D)), A) if len(A) > 50 else [None] * 3
        series.append({'h': h, 'n': len(A), 'talent_corr': r3(corr(T, A)), 'matchup_corr': r3(corr(D, A)),
                       'pts_per_matchup_pt': r3(b[2]), 'pts_per_talent_pt': r3(b[1]),
                       'matchup_sd': r3(st.pstdev(D)) if D else None})
    decay[pos] = series
out['decay'] = decay

# ---------- 3. this week: Vegas implied total vs defense-vs-position ----------
# Raw implied totals mostly say "good offense", which the player's own average already knows.
# The matchup part is this week's implied total minus the team's average implied total so far.
vegas = {}
for pos in POS:
    res, imp, dv, raw, act = [], [], [], [], []
    for y in SEASONS:
        for k in range(3, 17):
            ppg, dvp = asof(y, pos, k)
            team_avg = defaultdict(list)
            for (yy, ww, t), v in implied.items():
                if yy == y and ww <= k: team_avg[t].append(v)
            for r in by_season_pos[(y, pos)]:
                if r['w'] != k + 1: continue
                p = ppg.get(r['pid']); it = implied.get((y, k + 1, r['team']))
                if not p or p[1] < 3 or it is None or r['opp'] not in dvp or not team_avg.get(r['team']): continue
                res.append(r['a'] - p[0]); imp.append(it - st.mean(team_avg[r['team']])); dv.append(dvp[r['opp']])
                raw.append(it); act.append(r['a'])
    b = ols(list(zip(imp, dv)), res) if len(res) > 50 else [None] * 3
    vegas[pos] = {'n': len(res), 'implied_raw_corr_with_points': r3(corr(raw, act)),
                  'implied_matchup_corr': r3(corr(imp, res)), 'dvp_corr': r3(corr(dv, res)),
                  'pts_per_implied_pt': r3(b[1]), 'pts_per_dvp_pt': r3(b[2]),
                  'implied_matchup_sd': r3(st.pstdev(imp)), 'dvp_sd': r3(st.pstdev(dv))}
out['vegas_vs_dvp'] = vegas if implied else None

# ---------- 4. which early stat predicts the fantasy playoffs ----------
stab = {}
for pos in POS:
    E = defaultdict(lambda: defaultdict(list)); L = defaultdict(list)
    for y in SEASONS:
        for r in by_season_pos[(y, pos)]:
            key = (y, r['pid'])
            if r['w'] <= 7:
                E[key]['ppg'].append(r['a']); E[key]['opp'].append(r['opp_n'])
                if r['snp'] is not None: E[key]['snp'].append(r['snp'])
            elif r['w'] >= 15:
                L[key].append(r['a'])
    keep = [k for k in E if len(E[k]['ppg']) >= 4 and len(L[k]) >= 2 and st.mean(E[k]['ppg']) >= (10 if pos == 'QB' else 5)]
    late = [st.mean(L[k]) for k in keep]
    m = {}
    for name in ('ppg', 'opp', 'snp'):
        ks = [k for k in keep if E[k][name]]
        m[name] = r3(corr([st.mean(E[k][name]) for k in ks], [st.mean(L[k]) for k in ks]))
    stab[pos] = {'n': len(keep), 'early_ppg': m['ppg'], 'early_opportunities': m['opp'], 'early_snap_share': m['snp']}
out['early_predicts_late'] = stab

# ---------- 5. does recent form add anything beyond the week-of projection? ----------
form = {}
for pos in POS:
    X, Y = [], []
    for y in SEASONS:
        hist = defaultdict(list)
        for r in sorted(by_season_pos[(y, pos)], key=lambda r: r['w']):
            h = hist[r['pid']]
            if r['pj'] and len(h) >= 3:
                X.append((r['pj'], st.mean(h[-3:]))); Y.append(r['a'])
            hist[r['pid']].append(r['a'])
    b = ols(X, Y) if len(Y) > 50 else [None] * 3
    form[pos] = {'n': len(Y), 'weight_projection': r3(b[1]), 'weight_last3': r3(b[2]),
                 'corr_projection': r3(corr([x[0] for x in X], Y)), 'corr_blend': r3(corr([b[0] + b[1] * x[0] + b[2] * x[1] for x in X], Y))}
out['form'] = form

json.dump(out, open(os.path.join(ROOT, 'data', 'research.json'), 'w'), indent=1)
print(json.dumps({k: out[k] for k in ('accuracy', 'vegas_vs_dvp', 'early_predicts_late', 'form')}, indent=1)[:4000])
print('decay QB', [(d['h'], d['talent_corr'], d['matchup_corr']) for d in decay['QB']])
print('decay WR', [(d['h'], d['talent_corr'], d['matchup_corr']) for d in decay['WR']])
