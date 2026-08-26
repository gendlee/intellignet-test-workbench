/**
 * Dashboard：KPI 卡、SVG 圖表（狀態環圖/模組條形/7日趨勢）、最近運行、待審核、批量運行橫幅
 */

import { initLayout } from '../layout.js'
import { get } from '../api.js'
import { el, esc, fmtAgo, fmtTime, verdictBadge, statusBadge, stateTypeLabel } from '../util.js'
import { donutChart, barChart, lineChart } from '../views/charts.js'

let rootEl

async function init() {
  initLayout()
  rootEl = document.getElementById('page')
  rootEl.innerHTML = ''
  try {
    const [summary, recent, pending, chartStatus, chartModule, chartTrend, moduleCards] = await Promise.all([
      get('/api/dashboard/summary'),
      get('/api/dashboard/recent-runs', { limit: 10 }),
      get('/api/dashboard/pending-reviews', { limit: 8 }),
      get('/api/dashboard/charts', { type: 'status-distribution' }),
      get('/api/dashboard/charts', { type: 'module-distribution' }),
      get('/api/dashboard/charts', { type: 'execution-trend' }),
      get('/api/dashboard/charts', { type: 'module-cards' }),
    ])

    rootEl.append(renderBatchBanner(summary.runningBatch))
    rootEl.append(renderKpis(summary))
    rootEl.append(renderModuleCards(moduleCards))
    const grid = el('div', { class: 'dash-grid', style: 'margin-top:16px' })
    const col1 = el('div', { class: 'col' })
    const col2 = el('div', { class: 'col' })

    // 圖表行
    const chartsRow = el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('h2', { text: '測試概況' })]),
      el('div', { class: 'card-body' }, [
        renderCharts([chartStatus, chartModule]),
        renderTrendChart(chartTrend),
      ]),
    ])
    col1.append(chartsRow, renderRecentRuns(recent))

    col2.append(
      renderPendingReviews(pending),
      renderQuickLinks()
    )
    grid.append(col1, col2)
    rootEl.append(grid)
  } catch (e) {
    rootEl.innerHTML = `<div class="empty">載入失敗：${esc(e.message)}</div>`
  }
}

function renderBatchBanner(runningBatch) {
  if (runningBatch) {
    const p = runningBatch.progress
    const pct = Math.round((p.finished / Math.max(1, p.total)) * 100)
    return el('div', { class: 'batch-banner' }, [
      el('div', { style: 'width:34px;height:34px;display:flex;align-items:center;justify-content:center' }, [el('span', { class: 'spinner', style: 'border-color:rgba(255,255,255,.35);border-top-color:#fff' })]),
      el('div', { style: 'flex:1' }, [
        el('div', { class: 'bb-title', text: `批量回歸執行中：${runningBatch.name}` }),
        el('div', { class: 'bb-sub', text: `${p.finished}/${p.total} 完成 · 通過 ${p.pass} · 差異 ${p.diff} · 失敗 ${p.fail}（${pct}%）` }),
      ]),
      el('a', { class: 'btn', href: '/cases.html', text: '前往案例管理追蹤' }),
    ])
  }
  return el('div', { class: 'batch-banner' }, [
    el('div', { class: 'bb-title', text: '批量回歸測試' }),
    el('div', { class: 'bb-sub', style: 'flex:1', text: '一鍵重跑全部已通過案例，實現快速回歸' }),
    el('a', { class: 'btn', href: '/cases.html', text: '選擇案例開始' }),
  ])
}

function renderKpis(s) {
  const kpi = (label, value, cls, sub) => el('div', { class: 'kpi' }, [
    el('div', { class: 'k-label', text: label }),
    el('div', { class: `k-value ${cls}`, text: String(value) }),
    el('div', { class: 'k-sub', text: sub }),
  ])
  return el('div', { class: 'kpi-grid' }, [
    kpi('測試案例', s.totalCases, 'brand', `${s.coveredTxnCodes} 個交易碼覆蓋`),
    kpi('執行總數', s.totalRuns, '', '含單條與批量'),
    kpi('通過率', `${s.passRate}%`, s.passRate >= 80 ? 'ok' : s.passRate >= 50 ? 'warn' : 'danger', 'PASS / 總執行'),
    kpi('待審核案例', s.pendingReviews, s.pendingReviews ? 'warn' : 'ok', s.pendingReviews ? '需要人工確認' : '全部已審核'),
  ])
}

/** 按業務模塊卡片網格（需求 1）：點擊跳轉案例列表並預篩模塊 */
function renderModuleCards(cards) {
  const card = el('div', { class: 'card', style: 'margin-top:16px' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { text: '按業務模塊' }),
      el('span', { class: 'sub', text: '各模塊案例數 / 執行數 / 通過率 / 最近判定，點擊卡片篩選該模塊案例' }),
    ]),
    el('div', { class: 'card-body' }, [
      el('div', { class: 'mod-grid' }, (cards || []).length
        ? cards.map((m) => el('a', { class: 'mod-card', href: `/cases.html?module=${encodeURIComponent(m.module)}` }, [
            el('div', { class: 'mod-head' }, [
              el('span', { class: 'mod-name', text: m.module }),
              el('span', { class: 'mod-count', text: `${m.caseCount} 案例` }),
            ]),
            el('div', { class: 'mod-row' }, [
              el('span', { text: `執行 ${m.runCount} 次` }),
              el('span', { text: `通過率 ${m.passRate}%` }),
            ]),
            el('div', { class: 'mod-bar' }, [
              el('div', { class: 'mod-bar-fill', style: `width:${Math.max(0, Math.min(100, m.passRate))}%` }),
            ]),
            el('div', { class: 'mod-foot' }, [
              m.lastVerdict ? el('span', { innerHTML: verdictBadge(m.lastVerdict) }) : el('span', { class: 'muted', text: '未執行' }),
              el('span', { class: 'muted', text: m.lastRunAt ? fmtAgo(m.lastRunAt) : '' }),
              el('span', { class: 'spacer' }),
              el('span', { class: 'mod-arrow', text: '→' }),
            ]),
          ]))
        : el('div', { class: 'empty', text: '暫無模塊數據' })),
    ]),
  ])
  return card
}

function renderCharts(charts) {
  const [status, module, trend] = charts
  const row = el('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px' })
  row.append(
    el('div', { class: 'chart-box' }, [
      el('div', { class: 'chart-title', text: '案例審核狀態分佈' }),
      el('div', { innerHTML: donutChart({ ...status, centerLabel: '案例' }) }),
    ]),
    el('div', { class: 'chart-box' }, [
      el('div', { class: 'chart-title', text: '按業務模組分佈' }),
      el('div', { innerHTML: barChart({ ...module }) }),
    ]),
  )
  return row
}

function renderTrendChart(trend) {
  return el('div', { class: 'chart-box' }, [
    el('div', { class: 'chart-title', text: '近 7 日執行趨勢' }),
    el('div', { innerHTML: lineChart({ ...trend, width: 560 }) }),
  ])
}

function renderRecentRuns(recent) {
  const card = el('div', { class: 'card', style: 'margin-top:16px' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { text: '最近運行' }),
      el('span', { class: 'sub', text: '展示最近一次運行結果 / 時間 / 執行人' }),
      el('span', { class: 'spacer' }),
      el('a', { class: 'btn btn-sm', href: '/cases.html', text: '全部案例 →' }),
    ]),
    el('div', { class: 'table-wrap' }, [
      el('table', { class: 'tbl' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: '交易碼' }), el('th', { text: '案例' }), el('th', { text: '判定' }),
          el('th', { text: '差異' }), el('th', { text: '執行人' }), el('th', { text: '時間' }),
        ])]),
        el('tbody', {}, recent.map((r) => el('tr', {}, [
          el('td', {}, [el('a', { href: `/case-detail.html?id=${r.caseId}`, class: 'txn', style: 'font-family:var(--mono);font-weight:600;font-size:12.5px;color:var(--brand)', text: r.txnCode })]),
          el('td', { text: r.caseName }),
          el('td', { innerHTML: verdictBadge(r.verdict) }),
          el('td', { class: 'muted', text: r.summary ? `${r.summary.added} 增 / ${r.summary.deleted} 刪 / ${r.summary.modified} 改` : '—' }),
          el('td', { text: r.runBy }),
          el('td', { class: 'muted', style: 'white-space:nowrap', text: fmtAgo(r.startedAt) }),
        ]))),
      ]),
    ]),
  ])
  return card
}

function renderPendingReviews(pending) {
  const card = el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { text: '待審核案例' }),
      el('span', { class: 'sub', text: '人工確認後方可執行' }),
      el('span', { class: 'spacer' }),
      el('a', { class: 'btn btn-sm', href: '/cases.html?status=PENDING', text: '全部 →' }),
    ]),
    el('div', {}, pending.length
      ? pending.map((c) => el('div', { style: 'padding:11px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px' }, [
        el('span', { class: 'badge badge-warn', text: '待審核' }),
        el('a', { href: `/case-detail.html?id=${c.id}`, style: 'flex:1;font-weight:600;color:var(--text)', text: `${c.txnCode} ${c.name}` }),
        el('span', { class: 'muted', style: 'font-size:12px', text: `${c.module} · ${c.createdBy}` }),
      ]))
      : el('div', { class: 'empty', text: '沒有待審核案例 🎉' }),
    ),
  ])
  return card
}

function renderQuickLinks() {
  const card = el('div', { class: 'card', style: 'margin-top:16px' }, [
    el('div', { class: 'card-head' }, [el('h2', { text: '常用功能' })]),
    el('div', { class: 'card-body' }, [
      el('div', { class: 'grid', style: 'grid-template-columns:1fr 1fr;gap:10px' }, [
        el('a', { class: 'btn', style: 'justify-content:center', href: '/case-edit.html', text: '＋ 錄入案例（AI 生成）' }),
        el('a', { class: 'btn', style: 'justify-content:center', href: '/stress.html', text: '⚡ 壓力測試設計' }),
        el('a', { class: 'btn', style: 'justify-content:center', href: '/test-diff.html', text: '🧪 Diff 引擎自測' }),
        el('a', { class: 'btn', style: 'justify-content:center', href: '/config.html', text: '⚙ 系統配置' }),
      ]),
    ]),
  ])
  return card
}

init()
