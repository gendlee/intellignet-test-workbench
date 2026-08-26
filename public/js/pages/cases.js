/**
 * 案例管理頁：搜索 / 篩選 / 分頁 / 勾選批量 / 行內最近運行 / 單條執行
 * 需求 3（案例維護+審核）、需求 5（最近運行結果/時間/執行人）、需求 6（批量重跑入口）
 */

import { initLayout, loadMeta } from '../layout.js'
import { get, post, del } from '../api.js'
import { esc, fmtAgo, verdictBadge, statusBadge, stateTypeLabel, testTypeLabel, el } from '../util.js'
import { toast, confirmDialog, renderPagination } from '../components.js'
import { exportCasesWord } from '../views/word-export.js'
import { startBatchWithDrawer, onBatchDone } from '../components/batch.js'
import { openVersionPicker } from '../views/version-picker.js'

const state = {
  page: 1,
  pageSize: 10,
  keyword: '',
  status: '',
  module: '',
  version: '',        // 版本篩選：該版本下執行過的案例（預設最新版本）
  total: 0,
  list: [],
  selected: new Set(),
  modules: [],
  versions: [],
}

let rootEl

async function load() {
  const data = await get('/api/cases', {
    page: state.page,
    pageSize: state.pageSize,
    keyword: state.keyword,
    status: state.status,
    module: state.module,
    version: state.version,
  })
  state.total = data.total
  state.list = data.list
  state.selected = new Set([...state.selected].filter((id) => data.list.some((c) => c.id === id)))
  render()
}

function render() {
  rootEl.innerHTML = ''
  rootEl.append(
    renderToolbar(),
    el('div', { class: 'card', style: 'margin-top:14px' }, [
      renderTable(),
      el('div', { class: 'card-body', style: 'padding:0 18px' }, [
        el('div', { id: 'pagination' }),
      ]),
    ])
  )
  renderPagination(document.getElementById('pagination'), {
    page: state.page,
    pageSize: state.pageSize,
    total: state.total,
    onChange: (p) => { state.page = p; load().catch(showErr) },
  })
}

function renderToolbar() {
  const toolbar = el('div', { class: 'card' }, [
    el('div', { class: 'toolbar' }, [
      el('input', {
        class: 'input search',
        placeholder: '搜索交易碼 / 案例名稱…',
        value: state.keyword,
        oninput: debouncedSearch,
      }),
      el('select', { class: 'select', onchange: (e) => { state.status = e.target.value; state.page = 1; load().catch(showErr) } }, [
        el('option', { value: '', text: '全部狀態' }),
        el('option', { value: 'DRAFT', text: '草稿' }),
        el('option', { value: 'PENDING', text: '待審核' }),
        el('option', { value: 'APPROVED', text: '已通過' }),
        el('option', { value: 'REJECTED', text: '已駁回' }),
      ]),
      el('select', { class: 'select', onchange: (e) => { state.module = e.target.value; state.page = 1; load().catch(showErr) } }, [
        el('option', { value: '', text: '全部模組' }),
        ...state.modules.map((m) => el('option', { value: m, text: m })),
      ]),
      el('select', {
        class: 'select',
        title: '篩選該版本下執行過的案例（回溯歷史執行）',
        onchange: (e) => { state.version = e.target.value; state.page = 1; load().catch(showErr) },
      }, [
        el('option', { value: '', text: '全部版本' }),
        ...state.versions.map((v) => el('option', {
          value: v.code,
          text: `${v.code} · ${v.modeLabel}${v.caseCount ? `（${v.caseCount} 案例）` : ''}`,
          selected: v.code === state.version,
        })),
      ]),
      // 當前版本篩選提示
      state.version ? el('span', { class: 'muted', style: 'font-size:12px', text: `版本 ${state.version} 關聯/執行過的案例：${state.total} 個` }) : null,
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn', title: '預留：自動化流量接入（本次僅人工錄入）', onclick: () => toast('自動化流量接入為預留功能，本次演示僅支援人工錄入', 'warn') }, [
        '⚡ 流量接入',
      ]),
      el('button', {
        class: 'btn btn-primary',
        text: '＋ 新增案例',
        onclick: () => location.href = '/case-edit.html',
      }),
    ]),
    // 批量操作列（勾選後浮現）
    el('div', { class: `toolbar${state.selected.size ? '' : ' hidden'}` }, [
      el('span', { class: 'muted', text: `已選 ${state.selected.size} 個案例` }),
      el('button', { class: 'btn', onclick: () => linkCases([...state.selected]) }, ['🔗 加入版本']),
      el('button', { class: 'btn', onclick: () => startBatch() }, ['▶ 批量重跑']),
      el('button', { class: 'btn', onclick: () => batchExportWord() }, ['⬇ 批量導出 Word']),
      el('button', { class: 'btn btn-ghost', text: '取消選取', onclick: () => { state.selected.clear(); render() } }),
    ]),
  ])
  return toolbar
}

const debouncedSearch = debounceJs((e) => { state.keyword = e.target.value; state.page = 1; load().catch(showErr) }, 320)

function renderTable() {
  const t = el('table', { class: 'tbl case-table' })
  const thead = el('thead', {}, [el('tr', {}, [
    el('th', { class: 'check' }, [
      el('input', { type: 'checkbox', onclick: (e) => {
        state.selected = e.target.checked ? new Set(state.list.map((c) => c.id)) : new Set()
        render()
      } }),
    ]),
    el('th', { text: '交易碼' }),
    el('th', { text: '案例名稱' }),
    el('th', { text: '狀態' }),
    el('th', { text: '接口類型' }),
    el('th', { text: '最近一次運行' }),
    el('th', { text: '操作', style: 'text-align:right' }),
  ])])
  const tbody = el('tbody', {})
  if (!state.list.length) {
    tbody.append(el('tr', {}, [el('td', { colspan: 7 }, [
      el('div', { class: 'empty', text: state.version ? `版本 ${state.version} 暫無關聯或執行記錄（可批量勾選案例「加入版本」或執行該版本）` : '沒有符合條件的案例' }),
    ])]))
  }
  for (const c of state.list) {
    const lr = c.lastRun
    const row = el('tr', {}, [
      el('td', {}, [el('input', {
        type: 'checkbox',
        checked: state.selected.has(c.id),
        onchange: (e) => {
          e.target.checked ? state.selected.add(c.id) : state.selected.delete(c.id)
          render()
        },
      })]),
      el('td', {}, [
        el('span', { class: 'txn', text: c.txnCode }),
        el('div', { class: 'muted', style: 'font-size:11px', text: `#${c.id}` }),
      ]),
      el('td', { class: 'name-cell' }, [
        el('a', { href: `/case-detail.html?id=${c.id}`, text: c.name }),
        el('div', { class: 'sub', text: `${c.module} · ${c.type || 'Regular'} · ${testTypeLabel(c.testType)}` }),
      ]),
      el('td', {}, [dom(statusBadge(c.status))]),
      el('td', {}, [
        el('span', { class: `badge ${c.stateType === 'STATEFUL' ? 'badge-info' : 'badge-neutral'}`, text: stateTypeLabel[c.stateType] }),
      ]),
      el('td', {}, [
        lr ? el('div', { class: 'lastrun' }, [
          el('div', {}, [dom(verdictBadge(lr.verdict))]),
          el('div', { class: 'lr-time', text: `${fmtAgo(lr.startedAt)} · ${lr.runBy}` }),
        ]) : el('span', { class: 'muted', text: '從未運行' }),
      ]),
      el('td', { class: 'actions', style: 'text-align:right;white-space:nowrap' }, [
        el('button', { class: 'btn btn-sm', text: '🔗', title: '關聯到版本', onclick: () => linkCases([c.id]) }),
        el('button', { class: 'btn btn-sm', text: '執行', onclick: () => runCase(c, row) }),
        el('button', { class: 'btn btn-sm', text: '編輯', onclick: () => location.href = `/case-edit.html?id=${c.id}` }),
        el('button', { class: 'btn btn-sm btn-danger', text: '刪除', onclick: () => deleteCase(c) }),
      ]),
    ])
    tbody.append(row)
  }
  t.append(thead, tbody)
  return el('div', { class: 'table-wrap' }, [t])
}

/** 單條執行：選版本 → 行內 loading → 更新 lastRun */
async function runCase(c, row) {
  // 執行前選擇版本號（預選當前篩選版本）
  const version = await openVersionPicker({ title: `執行測試 — ${c.name}`, selected: state.version || null })
  if (!version) return
  const btn = row.querySelector('.btn')
  btn.disabled = true
  btn.textContent = `執行中…（${version}）`
  try {
    const run = await post(`/api/cases/${c.id}/run`, { version })
    toast(`執行完成：${c.txnCode} → ${run.verdict === 'PASS' ? '通過' : run.verdict === 'FAIL' ? '失敗' : '有差異'}`, run.verdict === 'FAIL' ? 'err' : run.verdict === 'DIFF' ? 'warn' : 'ok')
    await load()
  } catch (e) {
    toast(e.message, 'err')
    btn.disabled = false
    btn.textContent = '執行'
  }
}

/** 關聯版本：勾選的案例加入指定版本（幂等） */
async function linkCases(ids) {
  if (!ids.length) return toast('請先勾選案例', 'warn')
  const version = await openVersionPicker({ title: `將 ${ids.length} 個案例加入版本`, selected: state.version || null, okText: '確認關聯' })
  if (!version) return
  try {
    const r = await post('/api/cases/batch-link', { caseIds: ids, version })
    toast(`已將 ${r.linked} 個案例加入版本 ${version}${r.skipped ? `，${r.skipped} 個已在此版本中` : ''}`, 'ok')
    state.selected.clear()
    await load()
  } catch (e) {
    toast(e.message, 'err')
  }
}

async function deleteCase(c) {
  const ok = await confirmDialog({
    title: '刪除案例',
    message: `確定刪除案例「${c.name}」（${c.txnCode}）？此操作不可撤銷。`,
    danger: true,
    okText: '刪除',
  })
  if (!ok) return
  try {
    await del(`/api/cases/${c.id}`)
    toast('案例已刪除', 'ok')
    state.selected.delete(c.id)
    await load()
  } catch (e) {
    toast(e.message, 'err')
  }
}

async function startBatch() {
  if (!state.selected.size) return toast('請先勾選案例', 'warn')
  const ids = [...state.selected]
  state.selected.clear()
  render()
  await startBatchWithDrawer(ids)
  await load()
}

// 批量完成後自動刷新列表（內聯 lastRun 更新）
onBatchDone(() => load().catch(showErr))

async function batchExportWord() {
  if (!state.selected.size) return toast('請先勾選案例', 'warn')
  const ids = [...state.selected]
  const cases = []
  const runsMap = new Map()
  toast('正在收集案例數據…', 'info', 1600)
  try {
    for (const id of ids) {
      const c = await get(`/api/cases/${id}`)
      cases.push(c)
      if (c.lastRun) {
        try { runsMap.set(c.id, await get(`/api/runs/${c.lastRun.id}`)) } catch { /* 舊記錄無詳情則跳過 */ }
      }
    }
    exportCasesWord(cases, runsMap)
    toast(`已導出 ${cases.length} 個案例的 Word 報告`, 'ok')
  } catch (e) {
    toast(e.message, 'err')
  }
}

function showErr(e) {
  toast(e.message, 'err')
}

/* ---------- 工具 ---------- */
function dom(html) { const d = document.createElement('span'); d.innerHTML = html; return d }
function debounceJs(fn, ms) {
  let t
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) }
}

async function init() {
  initLayout()
  rootEl = document.getElementById('page')
  const params = new URLSearchParams(location.search)
  // 支持 ?module= 進入即選定模塊（儀表板模塊卡跳轉用）
  const mod = params.get('module')
  if (mod) state.module = mod
  // 支持 ?version= 進入即選定版本（版本管理頁「執行記錄」跳轉用）
  const ver = params.get('version')
  if (ver) state.version = ver
  try {
    await loadMeta()
    // 模塊下拉用預定義業務模塊（/api/modules），而非當前頁列表
    const mods = await get('/api/modules')
    state.modules = mods.map((m) => m.name)
    // 版本下拉：預設最新版本（無 ?version= 時）
    const versions = await get('/api/versions')
    state.versions = Array.isArray(versions) ? versions : []
    if (!state.version) state.version = state.versions[0]?.code || ''
    await load()
  } catch (e) {
    showErr(e)
    rootEl.innerHTML = `<div class="empty">載入失敗：${esc(e.message)}</div>`
  }
}

init()
