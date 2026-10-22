# FF Lab model v1: "as of week k, how many points will each player score in week t?"
#
# Every feature uses only information available after week k's games:
#   market     Sleeper's projection for week k+1 (published after week k), last season's ppg
#   production season ppg, recency-weighted ppg, last-3 ppg, games played
#   usage      opportunities/game, snap share, target share, air-yard share, WOPR, red-zone share
#   matchup    week-t opponent's points allowed to the position so far (vs league average), horizon h
# Trained on 2018–2023, validated on 2024, tested on 2025. Then refit on 2018–2025 and applied to
# 2026 — your league's season stays out of training so it's an honest test.
#   ./tools/fetch_history.sh 2018 … 2026 && python3 tools/model_build.py
import json, math, os, statistics as st
from collections import defaultdict
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import Ridge

ROOT = os.path.join(os.path.dirname(__file__), '..')
H = os.path.join(ROOT, 'data', 'hist'); OUT = os.path.join(ROOT, 'data', 'model')
os.makedirs(OUT, exist_ok=True)
SNAP = json.load(open(os.path.join(ROOT, 'data', 'snapshot.json')))
SC = SNAP['league']['scoring']
POS = ('QB', 'RB', 'WR', 'TE')
SEASONS = [y for y in range(2018, 2027) if os.path.exists(os.path.join(H, f's{y}-1.json'))]
TRAIN, VALID, TEST, LIVE = [y for y in SEASONS if y <= 2023], [2024], [2025], [2026]
TEAM = {'LA': 'LAR', 'STL': 'LAR', 'SD': 'LAC', 'OAK': 'LV', 'WSH': 'WAS', 'JAC': 'JAX'}
team = lambda t: TEAM.get(t, t) if t else t
pts = lambda s: sum(v * SC.get(k, 0) for k, v in s.items() if k in SC)

# ---------------- load player-weeks ----------------
G = {}          # (y, pid) -> player record with per-week arrays (index 1..17)
TEAMW = defaultdict(lambda: defaultdict(float))  # (y, w, team) -> team totals for shares
def rec(y, pid, meta):
    k = (y, pid)
    if k not in G:
        G[k] = dict(y=y, pid=pid, name=f"{meta.get('first_name','')} {meta.get('last_name','')}".strip(), pos=meta.get('position'),
                    a=[None] * 18, proj=[None] * 18, opp=[None] * 18, team=[None] * 18,
                    tgt=[0.0] * 18, ru=[0.0] * 18, pa=[0.0] * 18, ay=[0.0] * 18, rz=[0.0] * 18, snp=[None] * 18)
    return G[k]

for y in SEASONS:
    for w in range(1, 18):
        for r in json.load(open(os.path.join(H, f'p{y}-{w}.json'))):
            m = r.get('player') or {}
            if m.get('position') not in POS: continue
            g = rec(y, r['player_id'], m)
            g['proj'][w] = pts(r['stats']); g['opp'][w] = team(r.get('opponent')); g['team'][w] = team(r.get('team'))
        for r in json.load(open(os.path.join(H, f's{y}-{w}.json'))):
            m = r.get('player') or {}; s = r['stats']
            if m.get('position') not in POS or not r.get('opponent'): continue
            played = s.get('off_snp', 0) > 0 or s.get('snp', 0) > 0 or s.get('pass_att', 0) > 0 or s.get('rush_att', 0) > 0 or s.get('rec_tgt', 0) > 0
            if not played: continue
            if m['position'] == 'QB' and s.get('pass_att', 0) < 10: continue
            g = rec(y, r['player_id'], m); tm = team(r.get('team'))
            g['a'][w] = pts(s); g['opp'][w] = team(r['opponent']); g['team'][w] = tm
            g['tgt'][w] = s.get('rec_tgt', 0); g['ru'][w] = s.get('rush_att', 0); g['pa'][w] = s.get('pass_att', 0)
            g['ay'][w] = s.get('rec_air_yd', 0); g['rz'][w] = s.get('rec_rz_tgt', 0) + s.get('rush_rz_att', 0)
            snp = s.get('off_snp', s.get('snp', 0)); tsn = s.get('tm_off_snp', 0)
            g['snp'][w] = snp / tsn if tsn else None
            T = TEAMW[(y, w, tm)]
            T['tgt'] += g['tgt'][w]; T['ay'] += max(0, g['ay'][w]); T['rz'] += g['rz'][w]; T['ru'] += g['ru'][w]
print(f'{len(G)} player-seasons, seasons {SEASONS}')

# defense vs position, cumulative by week: DVP[(y,pos,opp)][w] = mean points allowed per game in weeks <= w
DVP = {}
for y in SEASONS:
    for pos in POS:
        tw = defaultdict(float)
        for g in G.values():
            if g['y'] != y or g['pos'] != pos: continue
            for w in range(1, 18):
                if g['a'][w] is not None: tw[(g['opp'][w], w)] += g['a'][w]
        for k in range(0, 18):
            per = defaultdict(list)
            for (o, w), v in tw.items():
                if w <= k: per[o].append(v)
            lg = st.mean(v for vs in per.values() for v in vs) if per else 0
            for o, vs in per.items(): DVP.setdefault((y, pos, o), [None] * 18)[k] = st.mean(vs) - lg

prev_ppg = {}
for (y, pid), g in G.items():
    v = [x for x in g['a'][1:] if x is not None]
    if len(v) >= 4: prev_ppg[(y + 1, pid)] = st.mean(v)

def ewm(vals, half=3.0):
    if not vals: return None
    wts = [0.5 ** ((len(vals) - 1 - i) / half) for i in range(len(vals))]
    return sum(w * v for w, v in zip(wts, vals)) / sum(wts)

def share(g, key, w):
    T = TEAMW.get((g['y'], w, g['team'][w]))
    return (g[key][w] / T[key]) if T and T.get(key) else None

FEATS = ['h', 'k', 'mkt', 'mkt_t', 'prev', 'ppg', 'ewm', 'last3', 'gp', 'opp_pg', 'snap', 'tshare', 'ayshare', 'wopr', 'rzshare', 'dvp']

def features(g, k, t):
    played = [w for w in range(1, k + 1) if g['a'][w] is not None]
    A = [g['a'][w] for w in played]
    # market view after week k: projection for week k+1, else the most recent available
    mkt = next((g['proj'][w] for w in range(k + 1, 0, -1) if w <= 17 and g['proj'][w]), None)
    # week-t projection only exists ahead of time for the live season (Sleeper's current ROS);
    # historically it's published the week of, so only usable when t == k+1
    mkt_t = g['proj'][t] if (t == k + 1 or g['y'] in LIVE) else None
    sh = lambda key: ewm([x for x in (share(g, key, w) for w in played[-6:]) if x is not None])
    ts, ays = sh('tgt'), sh('ay')
    dv = DVP.get((g['y'], g['pos'], g['opp'][t]), [None] * 18)[k] if g['opp'][t] else None
    return [t - k, k, mkt, mkt_t, prev_ppg.get((g['y'], g['pid'])),
            st.mean(A) if A else None, ewm(A), st.mean(A[-3:]) if A else None, len(A),
            ewm([g['tgt'][w] + g['ru'][w] + (g['pa'][w] if g['pos'] == 'QB' else 0) for w in played]),
            ewm([g['snp'][w] for w in played if g['snp'][w] is not None]),
            ts, ays, (1.5 * ts + 0.7 * ays) if ts is not None and ays is not None else None,
            sh('rz'), dv]

_BUILD = {}
def build(seasons, for_training=True):
    key = (tuple(seasons), for_training)
    if key in _BUILD: return _BUILD[key]
    _BUILD[key] = _build(seasons, for_training); return _BUILD[key]

def _build(seasons, for_training=True):
    X, y_, meta = defaultdict(list), defaultdict(list), defaultdict(list)
    for g in G.values():
        if g['y'] not in seasons: continue
        for k in range(0, 17):
            for t in range(k + 1, 18):
                if g['opp'][t] is None: continue  # bye / not on a team
                if for_training and g['a'][t] is None: continue
                X[g['pos']].append(features(g, k, t)); y_[g['pos']].append(g['a'][t]); meta[g['pos']].append((g['pid'], k, t))
    f = lambda v: np.array([[np.nan if x is None else x for x in r] for r in v], dtype=float)
    return {p: (f(X[p]), np.array([np.nan if v is None else v for v in y_[p]], dtype=float), meta[p]) for p in X}

MI = FEATS.index('mkt')
class OnMarket:
    # Start from the market (Sleeper's latest projection) and learn only the correction. Where there's
    # no market number yet (rare), fall back to a direct model.
    def __init__(self, X, y):
        has = ~np.isnan(X[:, MI])
        kw = dict(max_iter=250, learning_rate=0.04, max_leaf_nodes=15, min_samples_leaf=200, l2_regularization=3.0, random_state=0)
        self.r = HistGradientBoostingRegressor(**kw).fit(X[has], y[has] - X[has, MI])
        self.d = HistGradientBoostingRegressor(**kw).fit(X, y)
    def predict(self, X):
        has = ~np.isnan(X[:, MI]); out = self.d.predict(X)
        if has.any(): out[has] = X[has, MI] + self.r.predict(X[has])
        return out

MODE = os.environ.get('FF_MODE', 'market')
def fit(seasons):
    D = build(seasons); M = {}
    for p, (X, y, _) in D.items():
        M[p] = OnMarket(X, y) if MODE == 'market' else HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, max_leaf_nodes=31,
                                             min_samples_leaf=80, l2_regularization=1.0, random_state=0).fit(X, y)
    return M

def evaluate(models, seasons, label):
    D = build(seasons); res = {}
    for p, (X, y, meta) in D.items():
        pred = models[p].predict(X)
        mk = X[:, FEATS.index('mkt')]; ppg = X[:, FEATS.index('ppg')]; h = X[:, 0]
        rows = []
        for i in range(len(y)):
            base_mkt = mk[i] if not np.isnan(mk[i]) else np.nan
            base_ppg = ppg[i] if not np.isnan(ppg[i]) else base_mkt
            rows.append((int(h[i]), y[i], pred[i], base_mkt, base_ppg))
        out = {}
        for hb, lo, hi in (('1', 1, 1), ('2-3', 2, 3), ('4-6', 4, 6), ('7-10', 7, 10), ('11+', 11, 17), ('all', 1, 17)):
            R = [r for r in rows if lo <= r[0] <= hi and not np.isnan(r[3])]
            if not R: continue
            mae = lambda j: float(np.mean([abs(r[j] - r[1]) for r in R]))
            out[hb] = {'n': len(R), 'model': round(mae(2), 2), 'sleeper_latest': round(mae(3), 2), 'ppg_so_far': round(mae(4), 2),
                       'bias_model': round(float(np.mean([r[2] - r[1] for r in R])), 2), 'avg_pts': round(float(np.mean([r[1] for r in R])), 2)}
        res[p] = out
    print(f'\n== {label}'); [print(p, json.dumps(v.get('all')), '| h=1', json.dumps(v.get('1'))) for p, v in res.items()]
    return res

def resid_sd(models, seasons):  # spread of misses, by position and horizon bucket (for sims)
    D = build(seasons); out = {}
    for p, (X, y, _) in D.items():
        e = models[p].predict(X) - y; h = X[:, 0]; out[p] = {}
        for hb, lo, hi in (('1', 1, 1), ('2-3', 2, 3), ('4-6', 4, 6), ('7+', 7, 17)):
            m = (h >= lo) & (h <= hi)
            out[p][hb] = {'sd': round(float(np.std(e[m])), 2), 'p10': round(float(np.percentile(e[m], 10)), 2), 'p90': round(float(np.percentile(e[m], 90)), 2)}
    return out

M1 = fit(TRAIN)
val = evaluate(M1, VALID, 'validation 2024 (trained 2018-23)')
M2 = fit(TRAIN + VALID)
test = evaluate(M2, TEST, 'test 2025 (trained 2018-24)')
spread = resid_sd(M2, TEST)
MF = fit(TRAIN + VALID + TEST)           # final model for the live season
live = evaluate(MF, LIVE, '2026 weeks played so far (never trained on)')

# importance proxy: drop-one MAE increase on the test season (permutation)
imp = {}
DT = build(TEST)
rng = np.random.default_rng(0)
for p, (X, y, _) in DT.items():
    base = np.mean(np.abs(M2[p].predict(X) - y)); imp[p] = {}
    for j, f in enumerate(FEATS):
        Xp = X.copy(); Xp[:, j] = rng.permutation(Xp[:, j])
        imp[p][f] = round(float(np.mean(np.abs(M2[p].predict(Xp) - y)) - base), 3)

json.dump({'mode': MODE, 'features': FEATS, 'train': TRAIN, 'validation': val, 'test': test, 'live2026': live, 'resid': spread, 'importance': imp,
           'seasons': SEASONS}, open(os.path.join(OUT, 'metrics.json'), 'w'), indent=1)

# ---------------- explorer files: every as-of week's predictions for each player ----------------
roster_ids = {pid for t in SNAP['teams'] for pid in t['players']}
for y in SEASONS:
    mdl = MF if y in LIVE else (M1 if y in VALID else M2 if y in TEST else MF)  # out-of-sample where possible
    players = [g for g in G.values() if g['y'] == y and g['pos'] in POS]
    tot = lambda g: sum(x for x in g['a'][1:] if x is not None)
    keep = sorted(players, key=tot, reverse=True)[:160]
    if y in LIVE: keep = list({g['pid']: g for g in keep + [g for g in players if g['pid'] in roster_ids]}.values())
    rows = []
    for g in keep:
        preds = []
        for k in range(0, 17):
            ts = [t for t in range(k + 1, 18) if g['opp'][t] is not None]
            if not ts: preds.append({}); continue
            X = np.array([[np.nan if v is None else v for v in features(g, k, t)] for t in ts], dtype=float)
            preds.append({str(t): round(float(v), 1) for t, v in zip(ts, mdl[g['pos']].predict(X))})
        rows.append({'id': g['pid'], 'name': g['name'], 'pos': g['pos'], 'team': next((x for x in reversed(g['team']) if x), None),
                     'a': [None if x is None else round(x, 1) for x in g['a']], 'proj': [None if x is None else round(x, 1) for x in g['proj']],
                     'opp': g['opp'], 'pred': preds, 'league': g['pid'] in roster_ids if y in LIVE else None})
    json.dump({'season': y, 'out_of_sample': y not in TRAIN, 'players': rows}, open(os.path.join(OUT, f'explorer-{y}.json'), 'w'))
    print('explorer', y, len(rows))
