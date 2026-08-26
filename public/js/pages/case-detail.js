/**
 * 案例詳情頁
 * 需求 4：執行 → 字段級 diff 高亮 + 合理性評估（前端只給可疑度+理由，不自動下結論）
 * Tab 結構：本次結果 / 運行歷史（重看任一次 diff）/ 審核記錄
 * 操作：執行、審核通過/駁回、單條 Word 導出
 */

import { initLayout, loadMeta } from '../layout.js'
import { get, post } from '../api.js'
import { esc, el, fmtTime, verdictBadge, statusBadge, stateTypeLabel, kindLabel, plausibilityLabel, isSecretHeader, maskSecret } from '../util.js'
import { toast, confirmDialog, renderPagination, openModal } from '../components.js'
import { renderRunResult } from '../views/diff-view.js'
import { exportCaseWord } from '../views/word-export.js'
import { openVersionPicker } from '../views/version-picker.js'

const caseId = new URLSearchParams(location.search).get('id')

const state = {
  c: null,
  currentRun: null, // 本次執行結果（含完整 diff）
  histPage: 1,
  hist: [],
  histTotal: 0,
  env: null, // 當前環境 { name, baseUrl }
}

/** 載入當前環境（配置信息卡展示） */
async function loadConfig() {
  try {
    const cfg = await get('/api/config')
    state.env = cfg.environments?.find((e) => e.current) || null
  } catch { /* 環境資訊缺失不阻塞頁面 */ }
}

let rootEl

async function loadCase() {
  state.c = await get(`/api/cases/${caseId}`)
}

function render() {
  const c = state.c
  rootEl.innerHTML = ''
  // 頂部
  const head = el('div', { class: 'detail-head' }, [
    el('span', { class: 'dh-title', text: c.name }),
    el('span', { class: 'dh-txn', text: c.txnCode }),
    el('span', { innerHTML: statusBadge(c.status) }),
    el('span', { class: `badge ${c.stateType === 'STATEFUL' ? 'badge-info' : 'badge-neutral'}`, text: stateTypeLabel[c.stateType] }),
    el('span', { class: 'muted', text: c.module }),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn', text: '編輯', onclick: () => location.href = `/case-edit.html?id=${c.id}` }),
    el('button', { class: 'btn', text: '⬇ 導出 Word', onclick: () => exportCaseWord(c, state.currentRun || c.lastRun) }),
    el('button', { class: 'btn btn-primary', id: 'btn-run', text: '▶ 執行測試', onclick: runNow }),
  ])
  if (c.precondition) {
    head.append(el('div', { style: 'width:100%', class: 'flex' }, [
      el('span', { class: 'badge badge-info', text: '前置條件' }),
      el('span', { class: 'muted', text: c.precondition }),
    ]))
  }
  rootEl.append(head)

  // 審核操作條（PENDING）
  if (c.status === 'PENDING') {
    rootEl.append(renderReviewBar(c))
  } else if (c.review) {
    rootEl.append(el('div', { class: 'plausibility-bar', style: 'margin-bottom:16px' }, [
      el('span', { class: 'pb-label', text: `審核意見（${c.review.reviewer}）` }),
      el('span', { text: c.review.comment || '（無意見）' }),
    ]))
  }

  // 配置信息卡（需求 10：展示該案例調用的接口 URL / 環境 / 請求定義）
  rootEl.append(configCard(c))

  // Tab 結構
  const tabs = el('div', { class: 'tabs' }, [
    tabBtn('本次結果', 'result'),
    tabBtn('運行歷史', 'hist'),
    tabBtn('審核記錄', 'audit'),
  ])
  const panels = {
    result: el('div', { class: 'tab-panel', id: 'panel-result' }),
    hist: el('div', { class: 'tab-panel', id: 'panel-hist' }),
    audit: el('div', { class: 'tab-panel', id: 'panel-audit' }),
  }
  rootEl.append(tabs, panels.result, panels.hist, panels.audit)
  switchTab('result')

  renderResultPanel()
  loadHist()
  renderAuditPanel()
}

function tabBtn(label, key) {
  return el('button', { class: 'tab', id: `tab-${key}`, text: label, onclick: () => switchTab(key) })
}
function switchTab(key) {
  for (const b of document.querySelectorAll('.tabs .tab')) b.classList.toggle('active', b.id === `tab-${key}`)
  for (const p of document.querySelectorAll('.tab-panel')) p.classList.toggle('active', p.id === `panel-${key}`)
}

/* ---------- 配置信息卡（需求 10） ---------- */

function configCard(c) {
  const env = state.env
  const ni = c.newInput
  const rows = []
  rows.push(el('div', { class: 'cfg-row' }, [
    el('span', { class: 'cfg-label', text: '案例模式' }),
    el('span', { class: `badge ${c.mode === 'http' ? 'badge-info' : 'badge-warn'}`, text: c.mode === 'http' ? '獨立 HTTP 模式' : '對比模式（主機 vs 微服務系統）' }),
    el('span', { class: 'badge badge-neutral', text: `主機格式 ${c.hostFormat || 'XML'}` }),
    el('span', { class: 'badge badge-neutral', text: '請求格式 JSON' }),
  ]))
  if (env) {
    rows.push(el('div', { class: 'cfg-row' }, [
      el('span', { class: 'cfg-label', text: '當前環境' }),
      el('span', { class: 'badge badge-info', text: env.name }),
      el('code', { class: 'cfg-code', text: env.baseUrl }),
    ]))
  }
  if (ni) {
    rows.push(el('div', { class: 'cfg-row' }, [
      el('span', { class: 'cfg-label', text: '接口 URL' }),
      el('span', { class: 'badge badge-neutral', style: 'min-width:60px;text-align:center', text: ni.method || 'POST' }),
      el('code', { class: 'cfg-code', style: 'flex:1', text: ni.url || '—' }),
      el('button', { class: 'btn btn-sm', text: '複製', onclick: () => { navigator.clipboard?.writeText(ni.url || ''); toast('已複製 URL', 'ok') } }),
    ]))
    const headers = ni.headers || []
    if (headers.length) {
      rows.push(el('div', { class: 'cfg-row' }, [
        el('span', { class: 'cfg-label', text: '請求頭' }),
        el('div', { class: 'cfg-kv' }, headers.map((h) => el('code', { class: 'cfg-code', text: `${h.name}: ${isSecretHeader(h) ? maskSecret(h.value) : h.value}` }))),
      ]))
    }
    if (ni.body) {
      rows.push(el('div', { class: 'cfg-row' }, [
        el('span', { class: 'cfg-label', text: '請求體' }),
        el('details', { class: 'cfg-fold', style: 'flex:1' }, [
          el('summary', { text: `查看請求體（${ni.body.length} 字元）` }),
          el('pre', { class: 'cfg-pre', text: ni.body }),
        ]),
      ]))
    }
  }
  if (c.hostInput?.rawXml && c.mode !== 'http') {
    rows.push(el('div', { class: 'cfg-row' }, [
      el('span', { class: 'cfg-label', text: '主機報文' }),
      el('details', { class: 'cfg-fold', style: 'flex:1' }, [
        el('summary', { text: `查看主機報文（${c.hostInput.rawXml.length} 字元）` }),
        el('pre', { class: 'cfg-pre', text: c.hostInput.rawXml }),
      ]),
    ]))
  }
  return el('div', { class: 'card', style: 'margin-bottom:16px' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { text: '配置信息' }),
      el('span', { class: 'sub', text: '該案例執行的接口定義與調用目標' }),
    ]),
    el('div', { class: 'card-body' }, rows),
  ])
}

/* ---------- 執行過程步驟時間線（需求 2） ---------- */

function renderSteps(steps) {
  const tl = el('div', { class: 'timeline' })
  for (const s of steps || []) {
    const cls = s.status === 'ok' ? 'ok' : s.status === 'warn' ? 'warn' : 'danger'
    tl.append(el('div', { class: 'tl-item' }, [
      el('div', { class: `tl-dot ${cls}` }),
      el('div', { class: 'tl-body' }, [
        el('div', { class: 'tl-title', text: s.name }),
        el('div', { class: 'tl-sub', text: s.detail || '' }),
      ]),
      el('div', { class: 'tl-time', text: s.ms != null ? `${s.ms} ms` : '' }),
    ]))
  }
  return tl
}

/* ---------- 本次結果 ---------- */

function renderResultPanel() {
  const panel = document.getElementById('panel-result')
  panel.innerHTML = ''
  const run = state.currentRun || state.c.lastRun
  if (!run) {
    panel.append(el('div', { class: 'empty' }, [
      el('div', { class: 'empty-icon', text: '▸' }),
      el('div', { text: '尚未執行，點擊右上「執行測試」開始比對' }),
    ]))
    return
  }
  if (run.diff) {
    // 對比模式：結果總覽 + 執行過程 + diff 細節
    panel.append(el('div', { class: 'card', style: 'padding:18px' }, [
      el('div', { class: 'flex', style: 'margin-bottom:14px;gap:10px' }, [
        el('span', { innerHTML: verdictBadge(run.verdict) }),
        el('span', { class: `rs-title v-${run.verdict === 'PASS' ? 'ok' : 'bad'}`, text: run.verdict === 'PASS' ? '兩側報文一致，執行通過' : run.verdict === 'DIFF' ? '存在差異，請查看字段比對' : '存在高可疑差異，執行失敗' }),
      ]),
      el('div', { class: 'meta-grid' }, [
        mg('執行時間', fmtTime(run.startedAt, true)),
        mg('執行人', run.runBy),
        mg('執行類型', run.type === 'BATCH' ? '批量回歸' : '單條執行'),
        mg('執行版本', run.version ? el('span', { class: 'badge badge-info mono', text: run.version }) : '—'),
        mg('主機狀態', run.hostResult ? `HTTP ${run.hostResult.httpStatus} · ${run.hostResult.latencyMs} ms` : '—'),
        mg('微服務系統狀態', run.newResult ? `HTTP ${run.newResult.httpStatus} · ${run.newResult.latencyMs} ms` : '—'),
        mg('接口類型', stateTypeLabel[run.diff.stateType] || run.diff.stateType),
      ]),
    ]))
    if (run.steps?.length) {
      panel.append(el('div', { class: 'card', style: 'padding:18px;margin-top:14px' }, [
        el('div', { class: 'card-head', style: 'padding:0 0 10px' }, [el('h2', { text: '執行過程' })]),
        renderSteps(run.steps),
      ]))
    }
    panel.append(renderRunResult(run))
  } else if (run.newResult || run.steps) {
    // 獨立 HTTP 模式：判定雙欄 + 執行過程 + 響應報文
    panel.append(el('div', { class: 'card', style: 'padding:18px' }, [
      el('div', { class: 'flex', style: 'margin-bottom:14px;gap:10px' }, [
        el('span', { innerHTML: verdictBadge(run.verdict) }),
        el('span', { class: `rs-title v-${run.verdict === 'PASS' ? 'ok' : 'bad'}`, text: run.verdict === 'PASS' ? 'HTTP 2xx，執行通過' : `HTTP 非 2xx，執行失敗` }),
      ]),
      el('div', { class: 'meta-grid' }, [
        mg('執行時間', fmtTime(run.startedAt, true)),
        mg('執行人', run.runBy),
        mg('執行類型', run.type === 'BATCH' ? '批量回歸' : '單條執行'),
        mg('執行版本', run.version ? el('span', { class: 'badge badge-info mono', text: run.version }) : '—'),
        mg('HTTP 狀態', run.newResult ? `HTTP ${run.newResult.httpStatus}` : run.httpStatus != null ? `HTTP ${run.httpStatus}` : '—'),
        mg('總耗時', run.newResult ? `${run.newResult.latencyMs} ms` : '—'),
        mg('響應大小', run.newResult?.rawBody ? `${String(run.newResult.rawBody).length} 字元` : '—'),
      ]),
    ]))
    if (run.steps?.length) {
      panel.append(el('div', { class: 'card', style: 'padding:18px;margin-top:14px' }, [
        el('div', { class: 'card-head', style: 'padding:0 0 10px' }, [el('h2', { text: '執行過程' })]),
        renderSteps(run.steps),
      ]))
    }
    if (run.newResult?.rawBody != null) {
      panel.append(el('div', { class: 'card', style: 'padding:18px;margin-top:14px' }, [
        el('div', { class: 'card-head', style: 'padding:0 0 10px' }, [el('h2', { text: '響應報文' })]),
        el('pre', { class: 'cfg-pre', style: 'margin:0', text: run.newResult.rawBody }),
      ]))
    }
  } else {
    // 老記錄只有摘要（列表回填場景不會發生，保留相容）
    panel.append(el('div', { class: 'empty', text: '此運行記錄不含完整比對數據' }))
  }
  // 未成功案例：AI 初步分析原因（僅供參考）
  if (run.verdict && run.verdict !== 'PASS') panel.append(renderAiCard(run))
}

/* ---------- AI 初步分析（未成功案例，僅供參考；後端通過配置接入外部 AI API） ---------- */

function renderAiCard(run) {
  const body = el('div', { class: 'ai-body' })
  const card = el('div', { class: 'card', style: 'padding:18px;margin-top:14px' }, [
    el('div', { class: 'flex', style: 'margin-bottom:12px;gap:8px' }, [
      el('span', { class: 'ai-head', text: '🤖 AI 初步分析' }),
      el('span', { class: 'badge badge-neutral', text: '僅供參考' }),
      el('span', { class: 'spacer' }),
      el('span', { class: 'muted', style: 'font-size:11.5px', text: 'AI 基於比對結果初步歸納原因' }),
    ]),
    body,
  ])
  loadAi(card, body)
  return card
}

async function loadAi(card, body) {
  body.replaceChildren(el('div', { class: 'loading-row', style: 'padding:6px 0' }, [
    el('span', { class: 'spinner' }),
    el('span', { text: 'AI 正在初步分析原因…' }),
  ]))
  try {
    const a = await post('/api/ai/analyze', { caseId, runId: state.currentRun?.id })
    body.replaceChildren(
      el('div', { class: 'ai-summary', text: a.summary }),
      a.reasons?.length ? el('ul', { class: 'ai-reasons' }, a.reasons.map((r) =>
        el('li', {}, [
          el('span', { class: `ai-dot ${r.level || 'info'}` }),
          el('span', { text: r.text }),
        ]))) : null,
      el('div', { class: 'ai-foot' }, [
        el('span', { text: `可信度：${a.confidence} · 來源：${a.model || '—'}` }),
        el('span', { class: 'spacer' }),
        el('span', { class: 'ai-disclaimer', text: a.disclaimer }),
      ]),
    )
  } catch (e) {
    body.replaceChildren(
      el('div', { class: 'ai-err', text: `AI 分析暫不可用：${e.message}` }),
      el('div', { class: 'muted', style: 'font-size:12px;margin-top:4px', text: '請檢查系統配置中的 AI 分析設置，或稍後重試' }),
    )
  }
}

/* ---------- 執行 ---------- */

async function runNow() {
  const btn = document.getElementById('btn-run')
  if (state.c.status === 'PENDING') {
    toast('案例尚未審核通過，請先完成審核再執行', 'warn')
    return
  }
  if (state.c.status === 'REJECTED') {
    const ok = await confirmDialog({
      title: '案例已被駁回',
      message: '該案例已被審核駁回。仍要執行測試嗎？',
      okText: '仍要執行',
    })
    if (!ok) return
  }
  // 執行前選擇版本號（案例中心維護，預生成三年）
  const version = await openVersionPicker({ title: `執行測試 — ${state.c.name}` })
  if (!version) return
  btn.disabled = true
  btn.textContent = `執行中…（${version}）`
  const panel = document.getElementById('panel-result')
  panel.innerHTML = `<div class="loading-row"><span class="spinner"></span>正在執行並比對兩側報文…</div>`
  try {
    const run = await post(`/api/cases/${caseId}/run`, { version })
    state.currentRun = run
    state.c.lastRun = run
    toast(`執行完成：${run.verdict === 'PASS' ? '通過' : run.verdict === 'FAIL' ? '失敗（存在高可疑差異）' : '有差異'}`, run.verdict === 'FAIL' ? 'err' : run.verdict === 'DIFF' ? 'warn' : 'ok')
    renderResultPanel()
    render() // 刷新頂部狀態
  } catch (e) {
    panel.innerHTML = `<div class="empty">執行失敗：${esc(e.message)}</div>`
    toast(e.message, 'err')
  } finally {
    const b = document.getElementById('btn-run')
    if (b) { b.disabled = false; b.textContent = '▶ 執行測試' }
  }
}

/* ---------- 運行歷史 ---------- */

async function loadHist() {
  const panel = document.getElementById('panel-hist')
  if (!panel) return
  const data = await get(`/api/cases/${caseId}/runs`, { page: state.histPage, pageSize: 8 })
  state.hist = data.list
  state.histTotal = data.total
  panel.innerHTML = ''
  if (!data.list.length) {
    panel.append(el('div', { class: 'empty', text: '暫無運行記錄' }))
    return
  }
  const t = el('table', { class: 'tbl' }, [
    el('thead', {}, [el('tr', {}, [
      el('th', { text: '時間' }), el('th', { text: '版本' }), el('th', { text: '類型' }), el('th', { text: '判定' }),
      el('th', { text: '差異摘要' }), el('th', { text: '執行人' }), el('th', { text: '' }),
    ])]),
    el('tbody', {}, data.list.map((r) => el('tr', {}, [
      el('td', { text: fmtTime(r.startedAt, true) }),
      el('td', {}, [r.version ? el('span', { class: 'mono', style: 'font-size:12px;color:var(--brand);font-weight:600', text: r.version }) : el('span', { class: 'muted', text: '—' })]),
      el('td', { text: r.type === 'BATCH' ? '批量' : '單條' }),
      el('td', { innerHTML: verdictBadge(r.verdict) }),
      el('td', { class: 'muted', text: r.summary ? `${r.summary.added} 增 · ${r.summary.deleted} 刪 · ${r.summary.modified} 改` : '—' }),
      el('td', { text: r.runBy }),
      el('td', { style: 'text-align:right' }, [el('button', { class: 'btn btn-sm', text: '查看', onclick: () => viewHistRun(r.id) })]),
    ]))),
  ])
  panel.append(el('div', { class: 'table-wrap' }, [t]))
  const pg = el('div', { id: 'hist-pagination' })
  panel.append(pg)
  renderPagination(pg, {
    page: state.histPage, pageSize: 8, total: state.histTotal,
    onChange: (p) => { state.histPage = p; loadHist().catch((e) => toast(e.message, 'err')) },
  })
}

async function viewHistRun(runId) {
  const run = await get(`/api/runs/${runId}`)
  const { close } = openModal({
    title: `運行記錄 ${run.id} · ${fmtTime(run.startedAt, true)}${run.version ? ` · 版本 ${run.version}` : ''}`,
    wide: true,
    foot: [el('button', { class: 'btn', text: '關閉', onclick: close })],
  })
  const body = document.querySelector('.modal-body')
  body.append(renderRunResult(run, { showRaw: false }))
}

/* ---------- 審核記錄 ---------- */

function renderAuditPanel() {
  const panel = document.getElementById('panel-audit')
  panel.innerHTML = ''
  const logs = state.c.auditLogs || []
  if (!logs.length) {
    panel.append(el('div', { class: 'empty', text: '暫無審核/變更記錄' }))
    return
  }
  const tl = el('div', { class: 'timeline' })
  for (const l of logs) {
    const cls = l.to === 'APPROVED' ? 'ok' : l.to === 'REJECTED' ? 'danger' : 'warn'
    tl.append(el('div', { class: 'tl-item' }, [
      el('div', { class: `tl-dot ${cls}` }),
      el('div', { class: 'tl-body' }, [
        el('div', { class: 'tl-title', text: actionLabel(l.action, l.from, l.to) }),
        el('div', { class: 'tl-sub', text: `${l.operator}${l.comment ? ` — ${l.comment}` : ''}` }),
      ]),
      el('div', { class: 'tl-time', text: fmtTime(l.at) }),
    ]))
  }
  panel.append(tl)
}

function actionLabel(action, from, to) {
  const map = {
    create: '建立案例',
    approve: '審核通過',
    reject: '審核駁回',
    update: '更新案例',
  }
  return map[action] || `${action}${from ? `（${from} → ${to}）` : ''}`
}

/* ---------- 審核操作 ---------- */

function renderReviewBar(c) {
  const bar = el('div', { class: 'plausibility-bar', style: 'margin-bottom:16px;background:var(--warn-bg)' }, [
    el('span', { class: 'pb-label', text: '等待審核' }),
    el('span', { class: 'muted', text: '請確認主機/微服務系統案例內容後審核' }),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn', onclick: () => review('reject') }, ['✕ 駁回']),
    el('button', { class: 'btn btn-primary', onclick: () => review('approve') }, ['✓ 審核通過']),
  ])
  return bar
}

async function review(action) {
  let comment = ''
  if (action === 'reject') {
    const ok = await confirmDialog({ title: '駁回案例', message: '駁回後案例回到可編輯狀態，需修改後重新提交審核。確定駁回？', danger: true, okText: '駁回' })
    if (!ok) return
    comment = '審核駁回：案例內容需修改'
  } else {
    comment = '審核通過，案例有效'
  }
  try {
    await post(`/api/cases/${caseId}/review`, { action, comment })
    toast(action === 'approve' ? '已審核通過' : '已駁回', 'ok')
    state.c = await get(`/api/cases/${caseId}`)
    render()
  } catch (e) {
    toast(e.message, 'err')
  }
}

/* ---------- 工具 ---------- */

function mg(label, value) {
  return el('div', { class: 'mg-item' }, [
    el('div', { class: 'mg-label', text: label }),
    el('div', { class: 'mg-value' }, [value]),
  ])
}

async function init() {
  initLayout()
  rootEl = document.getElementById('page')
  if (!caseId) {
    rootEl.innerHTML = `<div class="empty">缺少案例 ID</div>`
    return
  }
  try {
    await loadCase()
    await loadConfig()
    render()
  } catch (e) {
    rootEl.innerHTML = `<div class="empty">載入失敗：${esc(e.message)}</div>`
  }
}

init()
