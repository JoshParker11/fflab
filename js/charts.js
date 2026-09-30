// Tiny inline-SVG charts. Colors come from CSS variables so both themes work.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Vertical bars; negative values drop below the zero line. opts.fmt formats labels on bars.
export function bars({ labels, values, height = 150, color, fmt = (v) => v.toFixed(1), sub }) {
  const W = Math.max(280, labels.length * 34), H = height, pad = { t: 16, b: sub ? 32 : 20, l: 4, r: 4 };
  const max = Math.max(0, ...values), min = Math.min(0, ...values), span = max - min || 1;
  const y = (v) => pad.t + ((max - v) / span) * (H - pad.t - pad.b);
  const bw = (W - pad.l - pad.r) / labels.length;
  let g = `<line class="axis" x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}"/>`;
  values.forEach((v, i) => {
    const x = pad.l + i * bw + bw * 0.18, w = bw * 0.64;
    const c = color ? color(v, i) : v >= 0 ? 'var(--good)' : 'var(--bad)';
    const top = Math.min(y(v), y(0)), h = Math.max(1, Math.abs(y(v) - y(0)));
    g += `<rect x="${x}" y="${top}" width="${w}" height="${h}" rx="2" fill="${c}"><title>${esc(labels[i])}: ${fmt(v)}</title></rect>`;
    if (Math.abs(v) > span * 0.04) g += `<text x="${x + w / 2}" y="${v >= 0 ? top - 3 : top + h + 11}" text-anchor="middle">${fmt(v)}</text>`;
    g += `<text x="${x + w / 2}" y="${H - (sub ? 18 : 4)}" text-anchor="middle">${esc(labels[i])}</text>`;
    if (sub) g += `<text x="${x + w / 2}" y="${H - 4}" text-anchor="middle" style="font-size:9.5px">${esc(sub[i] || '')}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${g}</svg>`;
}

// Multi-series lines. series: [{name, values, color}]
export function lines({ labels, series, height = 170, fmt = (v) => v.toFixed(0) }) {
  const W = 560, H = height, pad = { t: 10, b: 22, l: 32, r: 8 };
  const all = series.flatMap((s) => s.values.filter((v) => v != null));
  let max = Math.max(...all), min = Math.min(...all);
  const m = (max - min) * 0.1 || 1; max += m; min = Math.max(0, min - m);
  const x = (i) => pad.l + (i / Math.max(1, labels.length - 1)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + ((max - v) / (max - min)) * (H - pad.t - pad.b);
  let g = '';
  for (let k = 0; k <= 3; k++) {
    const v = min + ((max - min) * k) / 3;
    g += `<line class="axis" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke-dasharray="2 3"/><text x="${pad.l - 4}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
  }
  labels.forEach((l, i) => { if (labels.length < 16 || i % 2 === 0) g += `<text x="${x(i)}" y="${H - 5}" text-anchor="middle">${esc(l)}</text>`; });
  for (const s of series) {
    let d = '', pen = false;
    s.values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? ' L' : ' M'}${x(i)},${y(v)}`; pen = true;
    });
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" ${s.dash ? 'stroke-dasharray="4 3"' : ''}/>`;
    s.values.forEach((v, i) => { if (v != null) g += `<circle cx="${x(i)}" cy="${y(v)}" r="2.6" fill="${s.color}"><title>${esc(s.name)} ${esc(labels[i])}: ${fmt(v)}</title></circle>`; });
  }
  const legend = `<div class="legend">${series.map((s) => `<span style="--c:${s.color}">${esc(s.name)}</span>`).join('')}</div>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${g}</svg>${legend}`;
}

// Inline sparkline for a short series (nulls = didn't play).
export function spark(values, { w = 64, h = 18, color = 'var(--info)' } = {}) {
  const v = values.map((x) => (x == null ? null : x));
  const nums = v.filter((x) => x != null);
  if (!nums.length) return '';
  const max = Math.max(...nums, 1);
  const bw = w / v.length;
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${v.map((x, i) =>
    x == null ? `<rect x="${i * bw + 1}" y="${h - 1}" width="${bw - 2}" height="1" fill="var(--faint)"/>`
      : `<rect x="${i * bw + 1}" y="${h - (x / max) * h}" width="${bw - 2}" height="${Math.max(1, (x / max) * h)}" rx="1" fill="${color}"><title>${x.toFixed(1)}</title></rect>`).join('')}</svg>`;
}

// Renders ```chart JSON blocks inside reports: {"type":"bars"|"lines", ...args}
export function fromSpec(spec) {
  if (spec.type === 'lines') return lines(spec);
  return bars(spec);
}
