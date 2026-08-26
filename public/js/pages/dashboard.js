/**
 * Dashboard：生命周期流程條、SVG 圖表（狀態環圖/模組條形/7日趨勢）、最近運行、按業務模塊、批量運行橫幅
 */

import { initLayout } from '../layout.js'
import { get } from '../api.js'
import { el, esc, fmtAgo, verdictBadge } from '../util.js'

import { donutChart, barChart, lineChart } from '../views/charts.js'

let rootEl

async function init() {
  initLayout()
  rootEl = document.getElementById('page')
  rootEl.innerHTML = ''
  try {
    const [summary, recent, chartStatus, chartModule, chartTrend, moduleCards] = await Promise.all([
      get('/api/dashboard/summary'),
      get('/api/dashboard/recent-runs', { limit: 10 }),
      get('/api/dashboard/charts', { type: 'status-distribution' }),
      get('/api/dashboard/charts', { type: 'module-distribution' }),
      get('/api/dashboard/charts', { type: 'execution-trend' }),
      get('/api/dashboard/charts', { type: 'module-cards' }),
    ])

    rootEl.append(renderBatchBanner(summary.runningBatch))
    rootEl.append(renderLifecycle(summary))
    rootEl.append(renderModuleCards(moduleCards))

    // 測試概況 | 最近運行：同一層左右平分
    const split = el('div', { class: 'dash-split' })
    split.append(
      renderChartsCard(chartStatus, chartModule, chartTrend),
      renderRecentRuns(recent),
    )
    rootEl.append(split)
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

/** 生命周期流程條：待審核 → 測試案例 → 執行 → 通過率（節點 + 尖頭，體現案例生命周期） */
function renderLifecycle(s) {
  const arrow = () => el('div', { class: 'lc-arrow', 'aria-hidden': 'true' })
  const node = (label, value, cls, sub, clickable = false) => {
    const inner = [
      el('span', { class: `lc-num ${cls}`, text: String(value) }),
      el('div', { style: 'min-width:0' }, [
        el('div', { class: 'lc-name', text: label }),
        el('div', { class: 'lc-sub' }, [sub]),
      ]),
    ]
    if (clickable) inner.push(el('span', { class: 'lc-hint', text: '👆 可點擊查看' }))
    return el(clickable ? 'a' : 'div', {
      class: 'lc-node' + (clickable ? ' lc-clickable' : ''),
      href: clickable ? '/cases.html?status=PENDING' : undefined,
      title: clickable ? '點擊查看待審核案例詳情' : undefined,
    }, inner)
  }
  return el('div', { class: 'lc-flow' }, [
    node('待審核案例', s.pendingReviews, s.pendingReviews ? 'warn' : 'ok',
      s.pendingReviews ? '點擊查看待審詳情 →' : '全部已審核，點擊查看列表', true),
    arrow(),
    node('測試案例', s.totalCases, 'brand', el('span', { class: 'lc-txn', text: `交易碼 ${s.coveredTxnCodes} 個` })),
    arrow(),
    node('執行總數', s.totalRuns, '', '含單條與批量'),
    arrow(),
    node('通過率', `${s.passRate}%`, s.passRate >= 80 ? 'ok' : s.passRate >= 50 ? 'warn' : 'danger', 'PASS / 總執行'),
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

function renderChartsCard(chartStatus, chartModule, chartTrend) {
  const row = el('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px' })
  row.append(
    el('div', { class: 'chart-box' }, [
      el('div', { class: 'chart-title', text: '案例審核狀態分佈' }),
      el('div', { innerHTML: donutChart({ ...chartStatus, centerLabel: '案例' }) }),
    ]),
    el('div', { class: 'chart-box' }, [
      el('div', { class: 'chart-title', text: '按業務模組分佈' }),
      el('div', { innerHTML: barChart({ ...chartModule }) }),
    ]),
  )
  return el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { text: '測試概況' }),
      el('span', { class: 'sub', text: '案例審核狀態 / 業務模組 / 近 7 日執行趨勢' }),
    ]),
    el('div', { class: 'card-body' }, [
      row,
      el('div', { class: 'chart-box', style: 'margin-top:16px' }, [
        el('div', { class: 'chart-title', text: '近 7 日執行趨勢' }),
        el('div', { innerHTML: lineChart({ ...chartTrend, width: 0 }) }),
      ]),
    ]),
  ])
}

function renderRecentRuns(recent) {
  const card = el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { text: '最近運行' }),
      el('span', { class: 'sub', text: '最近一次運行結果 / 時間 / 執行人' }),
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

init()
