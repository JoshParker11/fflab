# Fit the site's projection blend: Sleeper's week-of projection, adjusted by betting markets and
# recent production, back-fit on 2018–2024, tested on 2025 and on our league's 2026 weeks.
#   python3 tools/blend_fit.py   ->  data/blend.json
#
# prediction = a + b·sleeper + Σ c_i·signal_i, with every signal centered so it reads as
# "points above/below what Sleeper says":
#   vegas_move   this week's team implied total minus the team's average so far (betting market)
#   vegas_level  team implied total minus league average (is this a strong offense this week?)
#   form         last-3 ppg minus Sleeper's projection
#   season       season ppg so far minus Sleeper's projection
#   last_year    last season's ppg minus Sleeper's projection
import csv, json, os, statistics as st
from collections import defaultdict
import numpy as np
from sklearn.linear_model import Ridge

ROOT = os.path.join(os.path.dirname(__file__), '..'); H = os.path.join(ROOT, 'data', 'hist')
SC = json.load(open(os.path.join(ROOT, 'data', 'snapshot.json')))['league']['scoring']
POS = ('QB', 'RB', 'WR', 'TE')
SEASONS = [y for y in range(2018, 2027) if os.path.exists(os.path.join(H, f's{y}-1.json'))]
TEAM = {'LA': 'LAR', 'STL': 'LAR', 'SD': 'LAC', 'OAK': 'LV', 'WSH': 'WAS', 'JAC': 'JAX'}
team = lambda t: TEAM.get(t, t) if t else t
pts = lambda s: sum(v * SC.get(k, 0) for k, v in s.items() if k in SC)
SIG = ['vegas_move', 'vegas_level', 'form', 'season', 'last_year']

implied = {}
for g in csv.DictReader(open(os.path.join(H, 'games.csv'))):
    try:
        if g['game_type'] != 'REG' or not g['total_line'] or not g['spread_line']: continue
        y, w, tot, spr = int(g['season']), int(g['week']), float(g['total_line']), float(g['spread_line'])
        implied[(y, w, team(g['home_team']))] = tot / 2 + spr / 2; implied[(y, w, team(g['away_team']))] = tot / 2 - spr / 2
    except ValueError: pass

hist = defaultdict(list)   # (y, pid) -> [(w, pts)]
rows = []
prev = {}
for y in SEASONS:
    lg = defaultdict(list)
    for (yy, w, t), v in implied.items():
        if yy == y: lg[w].append(v)
    for w in range(1, 18):
        P = {r['player_id']: r for r in json.load(open(os.path.join(H, f'p{y}-{w}.json')))}
        for r in json.load(open(os.path.join(H, f's{y}-{w}.json'))):
            m = r.get('player') or {}; s = r['stats']; pos = m.get('position')
            if pos not in POS or not r.get('opponent'): continue
            if not (s.get('off_snp', 0) > 0 or s.get('snp', 0) > 0 or s.get('pass_att', 0) > 0 or s.get('rush_att', 0) > 0 or s.get('rec_tgt', 0) > 0): continue
            if pos == 'QB' and s.get('pass_att', 0) < 10: continue
            pid, a, tm = r['player_id'], pts(s), team(r.get('team'))
            h = hist[(y, pid)]
            pr = P.get(pid); sl = pts(pr['stats']) if pr else None
            it = implied.get((y, w, tm))
            if sl and sl >= 3 and it is not None:
                past = [implied[(y, ww, tm)] for ww in range(1, w) if (y, ww, tm) in implied]
                A = [x for _, x in h]
                rows.append(dict(y=y, w=w, pos=pos, a=a, sl=sl,
                    vegas_move=(it - st.mean(past)) if past else 0.0,
                    vegas_level=it - st.mean(lg[w]) if lg[w] else 0.0,
                    form=(st.mean(A[-3:]) - sl) if len(A) >= 2 else 0.0,
                    season=(st.mean(A) - sl) if len(A) >= 2 else 0.0,
                    last_year=(prev.get((y, pid), sl) - sl)))
            h.append((w, a))
    for (yy, pid), h in list(hist.items()):
        if yy == y and len(h) >= 4: prev[(y + 1, pid)] = st.mean(x for _, x in h)
print(len(rows), 'rows with a Sleeper projection and a Vegas line')

out = {'signals': SIG, 'positions': {}, 'fit': '2018-2024', 'note': 'prediction = a + b*sleeper + sum(c*signal); signals are points relative to Sleeper'}
for pos in POS:
    R = [r for r in rows if r['pos'] == pos]
    tr = [r for r in R if r['y'] <= 2024]
    X = lambda rs: np.array([[r['sl']] + [r[k] for k in SIG] for r in rs]); Y = lambda rs: np.array([r['a'] for r in rs])
    m = Ridge(alpha=50.0).fit(X(tr), Y(tr))
    ev = {}
    for name, sel in (('2025', lambda r: r['y'] == 2025), ('2026 (your season)', lambda r: r['y'] == 2026)):
        T = [r for r in R if sel(r)]
        if not T: continue
        pb = m.predict(X(T)); y_ = Y(T); sl = np.array([r['sl'] for r in T])
        ev[name] = {'n': len(T), 'sleeper_mae': round(float(np.mean(np.abs(sl - y_))), 3), 'blend_mae': round(float(np.mean(np.abs(pb - y_))), 3),
                    'improvement_pct': round(float(100 * (1 - np.mean(np.abs(pb - y_)) / np.mean(np.abs(sl - y_)))), 2)}
    # how big each signal's typical push is (coef × typical size), so the UI can explain it
    push = {k: round(float(abs(c) * np.std([r[k] for r in tr])), 2) for k, c in zip(SIG, m.coef_[1:])}
    out['positions'][pos] = {'a': round(float(m.intercept_), 3), 'b': round(float(m.coef_[0]), 3),
                             'c': {k: round(float(c), 4) for k, c in zip(SIG, m.coef_[1:])}, 'typical_push': push, 'eval': ev}
    print(pos, json.dumps(out['positions'][pos]))
json.dump(out, open(os.path.join(ROOT, 'data', 'blend.json'), 'w'), indent=1)

# Ship it only where it beat Sleeper in BOTH test seasons; elsewhere the site uses Sleeper as-is.
use = [p for p, v in out['positions'].items() if all(e['improvement_pct'] > 0 for e in v['eval'].values())]
js = {p: {'a': v['a'], 'b': v['b'], 'c': v['c']} for p, v in out['positions'].items() if p in use}
with open(os.path.join(ROOT, 'js', 'blend.js'), 'w') as f:
    f.write('// Generated by tools/blend_fit.py — projection blend coefficients (league scoring).\n')
    f.write('// Applied only to positions where the blend beat Sleeper in both test seasons (2025, 2026).\n')
    f.write(f'export const BLEND = {json.dumps(js)};\n')
    f.write(f'export const BLEND_EVAL = {json.dumps({p: v["eval"] for p, v in out["positions"].items()})};\n')
print('blend used for', use)
