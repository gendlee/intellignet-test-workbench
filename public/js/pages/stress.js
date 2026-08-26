/**
 * 壓力測試頁：計劃 CRUD、審批流程（pending → approved/rejected → running → done）、
 * 計劃詳情抽屜（配置 + 審批 + 運行歷史 + 最近曲線）、啟動執行（輪詢）、結果曲線圖表
 * 曲線：TPS / 延遲（P50）/ 錯誤率 三圖；KPI：TPS、平均延遲、P50-P99、錯誤率、總請求
 */

import { initLayout } from '../layout.js'
import { get, post, put, del } from '../api.js'
import { esc, el, fmtTime } from '../util.js'
import { confirmDialog, openModal, toast } from '../components.js'
import { lineChart } from '../views/charts.js'

let rootEl
const state = { plans: [], activePlan: null, activeRun: null }

async function load() {
  state.plans = await get('/api/stress/plans')
  state.activeRun = null
  render()
}

function render() {
  rootEl.innerHTML = ''
  rootEl.append(
    el('div', { class: 'flex', style: 'margin-bottom:14px' }, [
      el('div', { class: 'section-title', style: 'margin:0', text: '壓測計劃' }),
      el('span', { class: 'count', text: `${state.plans.length} 個` }),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn-primary', text: '＋ 新建壓測計劃', onclick: openPlanModal }),
    ]),
    renderPlanTable(),
    renderResultSection(),
  )
}

function renderPlanTable() {
  const card = el('div', { class: 'card' }, [
    el('div', { class: 'table-wrap' }, [
      el('table', { class: 'tbl' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: '計劃名稱' }), el('th', { text: '接口' }), el('th', { text: '並發' }),
          el('th', { text: '時長' }), el('th', { text: '狀態' }), el('th', { text: '上次運行' }),
          el('th', { text: '操作', style: 'text-align:right' }),
        ])]),
        el('tbody', {}, state.plans.map((p) => {
          const lr = p.lastRun
          const canRun = p.status === 'approved' || p.status === 'done'
          return el('tr', {}, [
            el('td', {}, [el('button', { class: 'plan-name', text: p.name, title: '點擊查看計劃詳情', onclick: () => openPlanDetail(p) })]),
            el('td', {}, [el('span', { class: 'mono', style: 'font-size:11.5px;color:var(--text-2)', text: `${p.method} ${shortUrl(p.url)}` })]),
            el('td', { class: 'num', text: `${p.concurrency}` }),
            el('td', { class: 'num', text: `${p.durationSec}s` }),
            el('td', {}, [statusBadge(p.status)]),
            el('td', {}, lr
              ? el('div', { class: 'flex', style: 'gap:8px' }, [
                  el('span', { class: 'badge badge-info', text: `${lr.summary.tps} TPS` }),
                  el('span', { class: 'muted', style: 'font-size:11.5px', text: fmtTime(lr.startedAt) }),
                ])
              : el('span', { class: 'muted', text: '從未運行' })),
            el('td', { style: 'text-align:right;white-space:nowrap' }, [
              el('button', {
                class: 'btn btn-sm btn-primary',
                text: p.status === 'running' ? '運行中…' : '▶ 啟動',
                disabled: p.status === 'running' || !canRun,
                title: canRun || p.status === 'running' ? '' : '計劃需審批通過後才可啟動',
                onclick: () => startRun(p),
              }),
              el('button', { class: 'btn btn-sm', text: '詳情', onclick: () => openPlanDetail(p) }),
              el('button', { class: 'btn btn-sm', text: '結果', onclick: () => showResult(p), disabled: !lr }),
              el('button', { class: 'btn btn-sm', text: '編輯', onclick: () => openPlanModal(p) }),
              el('button', { class: 'btn btn-sm btn-danger', text: '刪除', onclick: () => deletePlan(p) }),
            ]),
          ])
        })),
      ]),
    ]),
  ])
  return card
}

function statusBadge(s) {
  const map = {
    pending: ['badge-warn', '待審批'],
    approved: ['badge-info', '已批准'],
    rejected: ['badge-danger', '已駁回'],
    running: ['badge-info', '運行中'],
    done: ['badge-ok', '已完成'],
  }
  const [cls, label] = map[s] || ['badge-neutral', s]
  return el('span', { class: `badge ${cls}`, text: label })
}

function shortUrl(u) {
  try {
    const url = new URL(u)
    return url.pathname || u
  } catch {
    return u.length > 50 ? u.slice(0, 50) + '…' : u
  }
}

/* ---------- 計劃詳情抽屜（需求 8） ---------- */

async function openPlanDetail(plan) {
  const mask = el('div', { class: 'drawer-mask', onclick: close })
  const drawer = el('div', { class: 'drawer' })
  const head = el('div', { class: 'drawer-head' }, [
    el('span', { class: 'plan-name', text: plan.name, style: 'font-size:inherit' }),
    el('span', { class: 'spacer' }),
    el('button', { class: 'modal-close', text: '✕', onclick: close }),
  ])
  const body = el('div', { class: 'drawer-body' })
  const foot = el('div', { class: 'drawer-foot' }, [
    el('button', { class: 'btn', text: '關閉', onclick: close }),
  ])
  drawer.append(head, body, foot)
  document.body.append(mask, drawer)

  function close() { mask.remove(); drawer.remove() }

  // 計劃配置
  const cfgRow = (label, val) => el('div', { class: 'cfg-row' }, [
    el('span', { class: 'cfg-label', text: label }),
    typeof val === 'string' ? el('code', { class: 'cfg-code', text: val }) : val,
  ])
  body.append(
    el('div', { class: 'section-title', style: 'margin-top:0' }, [
      el('span', { text: '計劃配置' }),
      el('span', { class: 'count', text: plan.id }),
    ]),
    el('div', {}, [
      cfgRow('狀態', statusBadge(plan.status)),
      cfgRow('接口', `${plan.method} ${plan.url}`),
      cfgRow('並發', `${plan.concurrency} · 時長 ${plan.durationSec}s · Ramp-up ${plan.rampUpSec}s`),
      cfgRow('創建', `${plan.createdBy} · ${fmtTime(plan.createdAt)}`),
      cfgRow('執行次數', `${plan.runCount || 0} 次`),
    ]),
    el('div', { class: 'section-title', style: 'margin-top:20px' }, [el('span', { text: '審批狀態' })]),
    renderApproval(plan, close),
    el('div', { class: 'section-title', style: 'margin-top:20px' }, [el('span', { text: '最近運行' })]),
    plan.lastRun
      ? el('div', { id: 'drawer-run' })
      : el('div', { class: 'empty', text: '尚未執行過' }),
  )
  // 最近曲線
  if (plan.lastRun) {
    const box = document.getElementById('drawer-run')
    box.append(el('div', { class: 'flex', style: 'gap:8px;margin-bottom:10px' }, [
      el('span', { class: 'badge badge-info', text: `${plan.lastRun.summary.tps} TPS` }),
      el('span', { class: 'badge badge-neutral', text: `延遲 ${plan.lastRun.summary.avgLatencyMs}ms · 錯誤率 ${plan.lastRun.summary.errorRate}%` }),
      el('span', { class: 'muted', style: 'font-size:11.5px', text: `${fmtTime(plan.lastRun.startedAt, true)} → ${fmtTime(plan.lastRun.finishedAt, true)}` }),
    ]))
    try {
      const run = await get(`/api/stress/runs/${plan.lastRun.id}`)
      if (run?.series?.length) {
        box.append(el('div', { class: 'chart-box' }, [
          el('div', { class: 'chart-title', text: '吞吐量（TPS）' }),
          el('div', { innerHTML: lineChart({ labels: run.series.map((x) => `${x.tSec}s`), series: [{ name: 'TPS', data: run.series.map((x) => x.tps) }], colors: ['#b3002d'] }) }),
        ]))
      }
    } catch { /* 曲線載入失敗不阻塞 */ }
  }
}

/** 審批區：pending 顯示審批按鈕，其餘顯示審批意見（需求 11）；審批成功後關閉抽屜 */
function renderApproval(plan, close) {
  const box = el('div', {})
  if (plan.status === 'pending') {
    const comment = el('input', { class: 'input', id: 'ap-comment', placeholder: '審批意見（可選）', style: 'margin-bottom:10px;width:100%' })
    const doReview = async (action) => {
      try {
        await post(`/api/stress/plans/${plan.id}/review`, { action, comment: comment.value.trim() })
        toast(action === 'approve' ? '已批准，可啟動壓測' : '已駁回', 'ok')
        close()
        await load()
      } catch (e) { toast(e.message, 'err') }
    }
    box.append(
      comment,
      el('div', { class: 'flex', style: 'gap:10px' }, [
        el('button', { class: 'btn btn-primary', text: '✓ 批准', onclick: () => doReview('approve') }),
        el('button', { class: 'btn', text: '✕ 駁回', onclick: () => doReview('reject') }),
      ]),
    )
  } else if (plan.review) {
    box.append(
      el('div', { class: 'flex', style: 'gap:8px;align-items:center;margin-bottom:6px' }, [
        statusBadge(plan.status),
        el('span', { class: 'muted', style: 'font-size:12px', text: `審核專員 ${plan.review.reviewer} · ${fmtTime(plan.review.at, true)}` }),
      ]),
      el('div', { class: 'muted', style: 'font-size:12.5px', text: plan.review.comment || '（無意見）' }),
    )
  }
  return box
}

/* ---------- 新建/編輯 ---------- */

function openPlanModal(plan = null) {
  const f = (val) => plan ? (val ?? '') : ''
  const form = el('div', { class: 'form-grid' }, [
    field('計劃名稱', el('input', { class: 'input', id: 'sp-name', value: f(plan?.name), placeholder: '例：帳戶查詢 — 日常峰值壓測' })),
    field('接口地址', el('input', { class: 'input', id: 'sp-url', value: f(plan?.url), placeholder: 'https://newapi.boc.com.hk/ebp/api/v1/…' })),
    field('方法', el('select', { class: 'select', id: 'sp-method' }, [
      el('option', { text: 'POST' }), el('option', { text: 'GET' }), el('option', { text: 'PUT' }), el('option', { text: 'DELETE' }),
    ])),
    field('請求體（JSON）', el('textarea', { class: 'textarea', id: 'sp-body', style: 'min-height:90px', value: f(plan?.body), placeholder: '{"acctNo":"…"}' })),
    field('並發數', el('input', { class: 'input', type: 'number', id: 'sp-conc', value: f(plan?.concurrency) ?? 10, min: 1 })),
    field('時長（秒）', el('input', { class: 'input', type: 'number', id: 'sp-dur', value: f(plan?.durationSec) ?? 60, min: 5 })),
    field('Ramp-up（秒）', el('input', { class: 'input', type: 'number', id: 'sp-ramp', value: f(plan?.rampUpSec) ?? 10, min: 1 })),
  ])
  if (plan) form.querySelector('#sp-method').value = plan.method
  const okBtn = el('button', { class: 'btn btn-primary', text: plan ? '保存' : '建立', onclick: save })
  const cancelBtn = el('button', { class: 'btn', text: '取消', onclick: close })
  const { close } = openModal({
    title: plan ? '編輯壓測計劃' : '新建壓測計劃',
    body: form,
    foot: [cancelBtn, okBtn],
    wide: true,
  })
  async function save() {
    const payload = {
      name: form.querySelector('#sp-name').value.trim(),
      url: form.querySelector('#sp-url').value.trim(),
      method: form.querySelector('#sp-method').value,
      body: form.querySelector('#sp-body').value.trim(),
      concurrency: Number(form.querySelector('#sp-conc').value) || 10,
      durationSec: Number(form.querySelector('#sp-dur').value) || 60,
      rampUpSec: Number(form.querySelector('#sp-ramp').value) || 10,
    }
    if (!payload.name || !payload.url) return toast('計劃名稱與接口地址必填', 'warn')
    try {
      if (plan) await put(`/api/stress/plans/${plan.id}`, payload)
      else await post('/api/stress/plans', payload)
      toast(plan ? '已保存' : '已建立，等待審批', 'ok')
      close()
      await load()
    } catch (e) {
      toast(e.message, 'err')
    }
  }
}

async function deletePlan(p) {
  const ok = await confirmDialog({ title: '刪除壓測計劃', message: `確定刪除「${p.name}」？`, danger: true, okText: '刪除' })
  if (!ok) return
  try {
    await del(`/api/stress/plans/${p.id}`)
    toast('已刪除', 'ok')
    await load()
  } catch (e) {
    toast(e.message, 'err')
  }
}

/* ---------- 啟動 + 輪詢 ---------- */

async function startRun(p) {
  try {
    await post(`/api/stress/plans/${p.id}/run`)
    toast(`「${p.name}」壓測已啟動…`, 'ok', 1500)
    await load()
    // 輪詢直到完成
    const t = setInterval(async () => {
      try {
        const cur = await get(`/api/stress/plans/${p.id}`)
        if (cur.status !== 'running') {
          clearInterval(t)
          await load()
          showResult(cur)
        }
      } catch { /* 重試 */ }
    }, 800)
  } catch (e) {
    toast(e.message, 'err')
  }
}

/* ---------- 結果展示 ---------- */

async function showResult(plan) {
  if (!plan?.lastRun) return
  try {
    const run = await get(`/api/stress/runs/${plan.lastRun.id}`)
    state.activePlan = plan
    state.activeRun = run
    renderResultSection(run)
  } catch (e) {
    toast(e.message, 'err')
  }
}

function renderResultSection(run = state.activeRun) {
  const box = el('div', { id: 'stress-result' })
  if (!run) {
    box.append(el('div', { class: 'card' }, [
      el('div', { class: 'empty', text: '選擇一個計劃並點擊「結果」查看壓測曲線' }),
    ]))
    rootEl.append(box)
    return
  }
  const s = run.summary
  const kpi = (label, value, unit = '') => el('div', { class: 'kpi' }, [
    el('div', { class: 'k-label', text: label }),
    el('div', { class: 'k-value', text: `${value}${unit}` }),
  ])
  const kpiRow = el('div', { class: 'stress-kpi', style: 'margin-bottom:16px' }, [
    kpi('平均 TPS', s.tps, ''),
    kpi('平均延遲', s.avgLatencyMs, 'ms'),
    kpi('P50', s.p50, 'ms'),
    kpi('P90', s.p90, 'ms'),
    kpi('P95', s.p95, 'ms'),
    kpi('P99', s.p99, 'ms'),
    kpi('錯誤率', s.errorRate, '%'),
    kpi('總請求數', s.totalRequests.toLocaleString(), ''),
  ])
  const tpsSeries = [{ name: 'TPS', data: run.series.map((x) => x.tps) }]
  const latSeries = [{ name: 'P50 延遲', data: run.series.map((x) => x.latencyP50) }]
  const errSeries = [{ name: '錯誤率 %', data: run.series.map((x) => x.errorRate) }]
  const labels = run.series.map((x) => `${x.tSec}s`)

  box.append(
    el('div', { class: 'section-title', style: 'margin-top:26px' }, [
      el('span', { text: `壓測結果：${state.activePlan?.name || ''}` }),
      el('span', { class: 'count', text: `${fmtTime(run.startedAt, true)} — ${fmtTime(run.finishedAt, true)}` }),
    ]),
    el('div', { class: 'card', style: 'padding:18px' }, [kpiRow]),
    el('div', { class: 'chart-grid', style: 'margin-top:16px' }, [
      el('div', { class: 'card', style: 'padding:18px' }, [
        el('div', { class: 'chart-title', text: '吞吐量（TPS / 秒）' }),
        el('div', { innerHTML: lineChart({ labels, series: tpsSeries, colors: ['#b3002d'] }) }),
      ]),
      el('div', { class: 'card', style: 'padding:18px' }, [
        el('div', { class: 'chart-title', text: '延遲（P50 / 秒）' }),
        el('div', { innerHTML: lineChart({ labels, series: latSeries, colors: ['#2563eb'] }) }),
      ]),
      el('div', { class: 'card', style: 'padding:18px' }, [
        el('div', { class: 'chart-title', text: '錯誤率（%/秒）' }),
        el('div', { innerHTML: lineChart({ labels, series: errSeries, colors: ['#c0392b'] }) }),
      ]),
    ]),
  )
  rootEl.append(box)
}

/* ---------- 工具 ---------- */

function field(label, input) {
  return el('div', { class: 'field-row' }, [el('label', { class: 'field', text: label }), input])
}

async function init() {
  initLayout()
  rootEl = document.getElementById('page')
  try {
    await load()
  } catch (e) {
    rootEl.innerHTML = `<div class="empty">載入失敗：${esc(e.message)}</div>`
  }
}

init()
