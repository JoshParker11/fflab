// Bakes data/snapshot.json (all-season projections, stats, usage, market values) and appends
// to data/changes.json. The site overlays live data on top of this every time it loads.
//   node tools/snapshot.mjs          then commit data/ and push
// Set NTFY_TOPIC to push alerts for changes that matter.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { getJSON, compact, diffChanges } from '../js/sources.js';
import { buildSnapshot } from '../js/build.js';

const allPlayers = await getJSON('https://api.sleeper.app/v1/players/nfl'); // full names/ages in Node
const snap = await buildSnapshot({ allPlayers });
const { teams, players, games, week: cur } = snap;

// ---------- what changed since the last snapshot ----------
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
const path = new URL('../data/snapshot.json', import.meta.url);
const logPath = new URL('../data/changes.json', import.meta.url);
let prev = null, log = [];
try { prev = compact(JSON.parse(await readFile(path, 'utf8'))); } catch {}
try { log = JSON.parse(await readFile(logPath, 'utf8')); } catch {}
const changes = diffChanges(prev, snap).map((c) => ({ ...c, at: snap.generated }));
log = [...changes, ...log].filter((c) => Date.parse(c.at) > Date.now() - 7 * 864e5).slice(0, 500);

await writeFile(path, JSON.stringify(snap));
await writeFile(logPath, JSON.stringify(log));
console.log(`week ${cur} · ${Object.keys(players).length} players · ${Object.keys(games).length / 2} games · ${snap.news.length} news · ${changes.length} changes`);

// ---------- push alerts ----------
const topic = process.env.NTFY_TOPIC;
const urgent = changes.filter((c) => (c.kind === 'injury' && c.rel >= 2) || (c.kind === 'trend' && c.rel >= 1) || (c.kind === 'move' && c.rel >= 1 && c.to));
if (topic && urgent.length) {
  const nm = (id) => players[id]?.name || id;
  const own = (rid) => teams.find((t) => t.rid === rid)?.owner || 'FA';
  const lines = urgent.slice(0, 8).map((c) => (c.kind === 'injury' ? `${nm(c.id)}: ${c.from || 'healthy'} → ${c.to || 'healthy'}`
    : c.kind === 'trend' ? `${nm(c.id)} trending: +${c.to.toLocaleString()} adds/6h` : `${nm(c.id)} → ${own(c.to)}`));
  await fetch(`https://ntfy.sh/${topic}`, { method: 'POST', body: lines.join('\n'),
    headers: { Title: 'FF Lab', Click: 'https://joshparker11.github.io/fflab/' } }).catch(() => {});
}
