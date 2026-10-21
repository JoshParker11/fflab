# Backtest: do early-season talent or early-season matchups predict playoff-week scoring?
#   ./tools/fetch_history.sh 2023 2024 2025 && python3 tools/backtest.py data/hist/
import json, statistics as st, math, sys, os
from collections import defaultdict
D=sys.argv[1] if len(sys.argv)>1 else 'data/hist/'
SC=json.load(open(os.path.join(os.path.dirname(__file__),'..','data','snapshot.json')))['league']['scoring']
def pts(s): return sum(v*SC.get(k,0) for k,v in s.items() if k in SC)
rows=[]
for y in (2023,2024,2025):
  for w in range(1,18):
    S={r['player_id']:r for r in json.load(open(f'{D}s{y}-{w}.json'))}
    Pj={r['player_id']:r for r in json.load(open(f'{D}p{y}-{w}.json'))}
    for pid,r in S.items():
      s=r['stats']; pos=r['player']['position']
      if pos not in ('QB','RB','WR','TE') or not r.get('opponent'): continue
      if not (s.get('off_snp',0)>0 or s.get('pass_att',0)>0 or s.get('rush_att',0)>0 or s.get('rec_tgt',0)>0): continue
      if pos=='QB' and s.get('pass_att',0)<15: continue   # ignore cameo QB games
      pj=pts(Pj[pid]['stats']) if pid in Pj else None
      rows.append(dict(y=y,w=w,pid=pid,pos=pos,opp=r['opponent'],a=pts(s),pj=pj,snp=s.get('off_snp',0),tsnp=s.get('tm_off_snp',0)))
print('rows',len(rows))
def corr(x,y):
  mx,my=st.mean(x),st.mean(y); sx=math.sqrt(sum((a-mx)**2 for a in x)); sy=math.sqrt(sum((b-my)**2 for b in y)); return sum((a-mx)*(b-my) for a,b in zip(x,y))/(sx*sy)
def ols(X,yv):  # tiny OLS with intercept via normal equations
  n=len(yv); k=len(X[0])+1; A=[[0]*k for _ in range(k)]; b=[0]*k
  for xi,yi in zip(X,yv):
    v=[1]+list(xi)
    for i in range(k):
      b[i]+=v[i]*yi
      for j in range(k): A[i][j]+=v[i]*v[j]
  # gaussian elimination
  for i in range(k):
    p=max(range(i,k),key=lambda r:abs(A[r][i])); A[i],A[p]=A[p],A[i]; b[i],b[p]=b[p],b[i]
    for r in range(k):
      if r!=i:
        f=A[r][i]/A[i][i]
        for c in range(i,k): A[r][c]-=f*A[i][c]
        b[r]-=f*b[i]
  return [b[i]/A[i][i] for i in range(k)]
print('\n== 1. How accurate are weekly projections (week-of, matchup included)?')
for pos in ('QB','RB','WR','TE'):
  R=[r for r in rows if r['pos']==pos and r['pj'] and r['pj']>=(12 if pos=='QB' else 6)]
  c=corr([r['pj'] for r in R],[r['a'] for r in R]); mae=st.mean(abs(r['a']-r['pj']) for r in R); sd=st.pstdev([r['a']-r['pj'] for r in R])
  print(f' {pos}: n={len(R):5d}  corr={c:.2f}  R²={c*c:.2f}  avg miss={mae:.1f} pts  sd of miss={sd:.1f}')
# forward-looking: weeks 1-7 info -> weeks 15-17 outcome
print('\n== 2. Using only weeks 1-7: what predicts weeks 15-17 points?')
for pos in ('QB','RB','WR','TE'):
  X=[];Y=[];tal=[];mat=[]
  for y in (2023,2024,2025):
    R=[r for r in rows if r['y']==y and r['pos']==pos]
    early=[r for r in R if r['w']<=7]
    ppg=defaultdict(list); 
    for r in early: ppg[r['pid']].append(r['a'])
    # defense allowed per game to position, early weeks (sum per team-game)
    tg=defaultdict(float)
    for r in early: tg[(r['opp'],r['w'])]+=r['a']
    dv=defaultdict(list)
    for (opp,w),v in tg.items(): dv[opp].append(v)
    lg=st.mean(v for vs in dv.values() for v in vs)
    dvp={o:st.mean(v)-lg for o,v in dv.items()}
    for r in R:
      if r['w']>=15 and len(ppg[r['pid']])>=4 and r['opp'] in dvp:
        t=st.mean(ppg[r['pid']]); m=dvp[r['opp']]
        if pos=='QB': m=m  # QB: one per team, so team total ~ the QB
        X.append((t,m)); Y.append(r['a']); tal.append(t); mat.append(m)
  b=ols(X,Y); ct=corr(tal,Y); cm=corr(mat,Y)
  print(f' {pos}: n={len(Y):4d} | talent (wk1-7 ppg) corr={ct:.2f} | early matchup (opp allowed wk1-7) corr={cm:+.2f} | each +1 pt talent -> {b[1]:+.2f} pts, each +1 pt soft-matchup -> {b[2]:+.3f} pts (sd of matchup {st.pstdev(mat):.1f})')
print('\n== 3. Do defenses stay soft/tough? corr(points allowed wk1-7, wk15-17)')
for pos in ('QB','RB','WR','TE'):
  a=[];b2=[]
  for y in (2023,2024,2025):
    R=[r for r in rows if r['y']==y and r['pos']==pos]
    tg=defaultdict(float)
    for r in R: tg[(r['opp'],r['w'])]+=r['a']
    e=defaultdict(list); l=defaultdict(list)
    for (o,w),v in tg.items(): (e if w<=7 else l if w>=15 else defaultdict(list))[o].append(v)
    for o in e:
      if o in l: a.append(st.mean(e[o])); b2.append(st.mean(l[o]))
  print(f' {pos}: n={len(a)} team-seasons corr={corr(a,b2):.2f}')
print('\n== 4. Same for players: corr(ppg wk1-7, ppg wk15-17)')
for pos in ('QB','RB','WR','TE'):
  a=[];b2=[]
  for y in (2023,2024,2025):
    R=[r for r in rows if r['y']==y and r['pos']==pos]
    e=defaultdict(list); l=defaultdict(list)
    for r in R:
      if r['w']<=7: e[r['pid']].append(r['a'])
      elif r['w']>=15: l[r['pid']].append(r['a'])
    for p in e:
      if len(e[p])>=4 and len(l[p])>=2 and st.mean(e[p])>=(10 if pos=='QB' else 6): a.append(st.mean(e[p])); b2.append(st.mean(l[p]))
  print(f' {pos}: n={len(a)} corr={corr(a,b2):.2f}')
