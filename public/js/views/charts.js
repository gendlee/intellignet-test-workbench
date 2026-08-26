/**
 * 手繪 SVG 圖表（零依賴）：環圖 / 條形圖 / 折線圖
 * 輸出純 SVG 字串，由呼叫方 innerHTML 或 DOM API 掛載
 */

export const CHART_COLORS = ['#b3002d', '#2563eb', '#b7791f', '#1a7f37', '#6b7280', '#7c3aed', '#0e7490']

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** 環圖（donut）：labels/series 平行陣列；中心顯示 total */
export function donutChart({ labels, series, colors = CHART_COLORS, size = 190, thickness = 26, centerLabel = '' }) {
  const total = series.reduce((a, b) => a + b, 0)
  const r = (size - thickness) / 2
  const cx = size / 2, cy = size / 2
  const circ = 2 * Math.PI * r
  let acc = 0
  const segs = series.map((v, i) => {
    if (!v) return ''
    const frac = v / total
    const dash = frac * circ
    const offset = -acc * circ
    acc += frac
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="${thickness}"
      stroke-dasharray="${dash} ${circ - dash}" stroke-dashoffset="${offset}" transform="rotate(-90 ${cx} ${cy})">
      <title>${esc(labels[i])}：${v}</title></circle>`
  }).join('')
  const legend = labels.map((l, i) => `
    <div class="stat-legend-item">
      <span class="dot" style="background:${colors[i % colors.length]}"></span>
      ${esc(l)} <b>${series[i]}</b>
    </div>`).join('')
  return `
    <div class="flex" style="gap:22px;align-items:center;flex-wrap:wrap">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="圖表">
        ${segs}
        <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="26" font-weight="700" fill="#1f2329">${total}</text>
        <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="11" fill="#8a9099">${esc(centerLabel)}</text>
      </svg>
      <div class="stat-legend" style="flex-direction:column;gap:7px">${legend}</div>
    </div>`
}

/** 條形圖（水平） */
export function barChart({ labels, series, colors = CHART_COLORS, width = 420, rowH = 34, labelW = 92 }) {
  const max = Math.max(1, ...series)
  const rows = labels.map((l, i) => {
    const w = Math.max(2, (series[i] / max) * (width - labelW - 44))
    const color = colors[i % colors.length]
    return `
      <div style="display:flex;align-items:center;height:${rowH}px;gap:8px">
        <span style="width:${labelW}px;font-size:12px;color:#5b616a;text-align:right;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(l)}</span>
        <div style="background:${color};height:16px;border-radius:4px;width:${w}px;min-width:2px"></div>
        <span style="font-size:12px;color:#5b616a;font-variant-numeric:tabular-nums">${series[i]}</span>
      </div>`
  }).join('')
  return `<div style="padding:4px 0">${rows}</div>`
}

/** 折線圖（多系列） */
export function lineChart({ labels, series, colors = ['#1a7f37', '#b7791f', '#c0392b'], width = 520, height = 220, yTicks = 4 }) {
  const padL = 34, padB = 26, padT = 10, padR = 8
  const iw = width - padL - padR
  const ih = height - padT - padB
  const max = Math.max(1, ...series.flatMap((s) => s.data))
  const n = labels.length
  const x = (i) => padL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw)
  const y = (v) => padT + ih - (v / max) * ih

  const grid = []
  for (let t = 0; t <= yTicks; t++) {
    const v = Math.round((max / yTicks) * t)
    const yy = y(v)
    grid.push(`<line x1="${padL}" y1="${yy}" x2="${width - padR}" y2="${yy}" stroke="#e9ebef" stroke-dasharray="3 4"/>
      <text x="${padL - 6}" y="${yy + 4}" text-anchor="end" font-size="10" fill="#8a9099">${v}</text>`)
  }
  const lines = series.map((s, si) => {
    const pts = s.data.map((v, i) => `${x(i)},${y(v)}`).join(' ')
    const area = s.data.length > 1
      ? `<polygon points="${padL},${padT + ih} ${pts} ${x(s.data.length - 1)},${padT + ih}" fill="${colors[si]}" opacity="0.07"/>`
      : ''
    return `${area}<polyline points="${pts}" fill="none" stroke="${colors[si]}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`
  }).join('')
  const dots = series.map((s, si) => s.data.map((v, i) =>
    `<circle cx="${x(i)}" cy="${y(v)}" r="2.8" fill="#fff" stroke="${colors[si]}" stroke-width="1.8"><title>${esc(labels[i])}：${s.name} ${v}</title></circle>`
  ).join('')).join('')
  const xLabels = labels.map((l, i) =>
    `<text x="${x(i)}" y="${height - 8}" text-anchor="middle" font-size="10" fill="#8a9099">${esc(l)}</text>`
  ).join('')
  const legend = series.map((s, i) => `
    <span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;color:#5b616a">
      <span class="dot" style="width:8px;height:8px;border-radius:50%;background:${colors[i]}"></span>${esc(s.name)}
    </span>`).join('')

  return `
    <div>
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="趨勢圖">
        ${grid.join('')}${lines}${dots}${xLabels}
      </svg>
      <div class="stat-legend" style="margin-top:6px">${legend}</div>
    </div>`
}
