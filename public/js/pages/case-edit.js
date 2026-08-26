/**
 * 案例錄入 / 編輯頁
 * - 對比模式（主機 vs 微服務系統）：主機報文（XML/JSON 格式可選）→ AI 生成微服務系統請求 或 手動填寫
 * - 獨立 HTTP 模式：單一請求，判定依據 HTTP 狀態碼
 * - 兩側均支持「原始報文 / 表單模式」切換：字段級增刪改（views/field-editor.js）
 * - 業務模塊下拉（/api/modules），可內嵌新建
 */

import { initLayout } from '../layout.js'
import { get, post, put } from '../api.js'
import { el, isSecretHeader, maskSecret } from '../util.js'
import { openModal, toast } from '../components.js'
import { parseRows, serializeRows, renderFieldForm } from '../views/field-editor.js'

const caseId = new URLSearchParams(location.search).get('id')

const state = {
  existing: null,
  txnCode: '',
  name: '',
  module: '',
  stateType: 'STATELESS',
  precondition: '',
  mode: 'compare',            // compare | http
  hostFormat: 'XML',          // XML | JSON
  hostRaw: '',
  hostFormMode: false,
  hostRows: [],
  newInput: null,             // { url, method, headers[], body }
  bodyFormMode: false,
  bodyRows: [],
  modules: [],
  aiMeta: null,
}

/* ---------- 報文樣板 ---------- */

const XML_TEMPLATES = {
  帳戶查詢: (txn) => `<?xml version="1.0" encoding="UTF-8"?>
<AccountInquiryRequest>
  <Header>
    <TxnCode>${txn}</TxnCode>
    <Channel>EBI</Channel>
    <UserId>TEST01</UserId>
    <TxnTime>2026-08-20T10:00:00.000+08:00</TxnTime>
  </Header>
  <Body>
    <AcctNo>123456789012345678</AcctNo>
    <Currency>HKD</Currency>
  </Body>
</AccountInquiryRequest>`,
  交易明細: (txn) => `<?xml version="1.0" encoding="UTF-8"?>
<TransactionListRequest>
  <Header>
    <TxnCode>${txn}</TxnCode>
    <Channel>EBI</Channel>
    <UserId>TEST01</UserId>
  </Header>
  <Body>
    <AcctNo>123456789012345678</AcctNo>
    <StartDate>20260801</StartDate>
    <EndDate>20260826</EndDate>
  </Body>
</TransactionListRequest>`,
  轉賬: (txn) => `<?xml version="1.0" encoding="UTF-8"?>
<TransferRequest>
  <Header>
    <TxnCode>${txn}</TxnCode>
    <Channel>EBI</Channel>
    <UserId>TEST01</UserId>
  </Header>
  <Body>
    <FromAcctNo>123456789012345678</FromAcctNo>
    <ToAcctNo>876543210987654321</ToAcctNo>
    <Amount>500.00</Amount>
    <Currency>HKD</Currency>
  </Body>
</TransferRequest>`,
  貸款查詢: (txn) => `<?xml version="1.0" encoding="UTF-8"?>
<LoanBalanceRequest>
  <Header>
    <TxnCode>${txn}</TxnCode>
    <Channel>EBI</Channel>
    <UserId>TEST01</UserId>
  </Header>
  <Body>
    <LoanNo>LN2026000012</LoanNo>
  </Body>
</LoanBalanceRequest>`,
}

const JSON_TEMPLATES = {
  帳戶查詢: (txn) => JSON.stringify({
    Header: { TxnCode: txn, Channel: 'EBI', UserId: 'TEST01', TxnTime: '2026-08-20T10:00:00.000+08:00' },
    Body: { AcctNo: '123456789012345678', Currency: 'HKD' },
  }, null, 2),
  交易明細: (txn) => JSON.stringify({
    Header: { TxnCode: txn, Channel: 'EBI', UserId: 'TEST01' },
    Body: { AcctNo: '123456789012345678', StartDate: '20260801', EndDate: '20260826' },
  }, null, 2),
  轉賬: (txn) => JSON.stringify({
    Header: { TxnCode: txn, Channel: 'EBI', UserId: 'TEST01' },
    Body: { FromAcctNo: '123456789012345678', ToAcctNo: '876543210987654321', Amount: 500.0, Currency: 'HKD' },
  }, null, 2),
  貸款查詢: (txn) => JSON.stringify({
    Header: { TxnCode: txn, Channel: 'EBI', UserId: 'TEST01' },
    Body: { LoanNo: 'LN2026000012' },
  }, null, 2),
}

let rootEl

/* ---------- 渲染 ---------- */

function render() {
  rootEl.innerHTML = ''
  const form = el('div', {})

  form.append(
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { text: caseId ? '編輯案例' : '錄入新案例' }),
        el('span', { class: 'sub', text: '以交易碼唯一標識案例；可選擇對比模式或獨立 HTTP 模式' }),
      ]),
      el('div', { class: 'card-body' }, [
        el('div', { class: 'form-grid' }, [
          field('交易碼（唯一標識）', el('input', { class: 'input', id: 'f-txn', value: state.txnCode, disabled: !!caseId, placeholder: '例：ACCT1001' })),
          field('案例名稱', el('input', { class: 'input', id: 'f-name', value: state.name, placeholder: '例：帳戶查詢 — 基本成功' })),
          field('業務模塊', moduleSelect()),
          field('接口類型', el('select', { class: 'select', id: 'f-state', onchange: (e) => (state.stateType = e.target.value) }, [
            el('option', { value: 'STATELESS', text: '無狀態（同輸入應同輸出）' }),
            el('option', { value: 'STATEFUL', text: '有狀態（結果可能受前置狀態影響）' }),
          ])),
          el('div', { class: 'full' }, [
            field('前置條件（有狀態接口建議填寫）', el('input', { class: 'input', id: 'f-pre', value: state.precondition, placeholder: '例：需先執行開戶 ACCT0001 並產生至少 1 筆交易' })),
          ]),
        ]),
      ]),
    ]),
    el('div', { class: 'card', style: 'margin-top:16px' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { text: '接口定義' }),
        el('span', { class: 'sub', id: 'mode-sub', text: modeSub() }),
      ]),
      el('div', { class: 'card-body' }, [
        el('div', { class: 'flex', style: 'margin-bottom:14px;gap:10px' }, [
          el('label', { class: 'field', style: 'margin:0', text: '案例模式' }),
          el('select', { class: 'select', id: 'f-mode', style: 'width:230px', onchange: (e) => setMode(e.target.value) }, [
            el('option', { value: 'compare', text: '對比模式（主機 vs 微服務系統）' }),
            el('option', { value: 'http', text: '獨立 HTTP 模式（單一請求）' }),
          ]),
        ]),
        state.mode === 'compare'
          ? el('div', { class: 'edit-layout' }, [hostPanel(), newPanel()])
          : el('div', { class: 'edit-layout single' }, [httpPanel()]),
      ]),
    ]),
    el('div', { class: 'flex', style: 'margin-top:20px;gap:12px' }, [
      el('button', { class: 'btn btn-primary', id: 'btn-save', text: caseId ? '保存修改' : '提交審核', onclick: save }),
      el('button', { class: 'btn', text: '取消', onclick: () => location.href = '/cases.html' }),
      el('span', { class: 'spacer' }),
      el('span', { class: 'hint', id: 'save-hint' }),
    ])
  )
  rootEl.append(form)
  // 同步控件值
  form.querySelector('#f-mode').value = state.mode
  form.querySelector('#f-state').value = state.stateType
  if (state.newInput) fillNewInput()
  if (state.existing?.review) {
    rootEl.append(el('div', { class: 'card', style: 'margin-top:14px' }, [
      el('div', { class: 'card-head' }, [el('h2', { text: '上次審核意見' })]),
      el('div', { class: 'card-body', text: `${state.existing.review.reviewer}：${state.existing.review.comment}` }),
    ]))
  }
}

function modeSub() {
  return state.mode === 'compare'
    ? '主機報文 vs 微服務系統 HTTP 請求，AI 可一鍵生成微服務系統側'
    : '單一 HTTP 請求，執行時按 HTTP 狀態碼判定（2xx 為通過）'
}

function field(label, input) {
  return el('div', { class: 'field-row' }, [el('label', { class: 'field', text: label }), input])
}

/* ---------- 主機側面板（對比模式） ---------- */

function hostPanel() {
  const fmtSelect = el('select', { class: 'select', id: 'f-hfmt', style: 'width:110px', onchange: (e) => setHostFormat(e.target.value) }, [
    el('option', { value: 'XML', text: 'XML' }),
    el('option', { value: 'JSON', text: 'JSON' }),
  ])
  const templates = (state.hostFormat === 'XML' ? XML_TEMPLATES : JSON_TEMPLATES)
  return el('div', { class: 'panel' }, [
    el('div', { class: 'panel-toolbar' }, [
      el('label', { class: 'field', style: 'margin:0', text: '主機系統輸入報文' }),
      fmtSelect,
      el('span', { class: 'muted', style: 'font-size:12px', text: '樣板：' }),
      ...Object.keys(templates).map((k) => el('button', {
        class: 'btn btn-sm', text: k,
        onclick: () => { state.hostRaw = templates[k](state.txnCode || 'ACCT9001'); markDirty(); render() },
      })),
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn btn-sm', id: 'host-toggle',
        text: state.hostFormMode ? '原始報文' : '表單模式',
        onclick: () => (state.hostFormMode ? exitHostForm() : enterHostForm()),
      }),
    ]),
    state.hostFormMode
      ? el('div', { class: 'fe-wrap' }, [
          renderFieldForm({
            rows: state.hostRows,
            onEdit: (i, patch) => Object.assign(state.hostRows[i], patch),
            onDelete: (i) => { state.hostRows.splice(i, 1); render() },
            onAdd: (path, type, value) => addField(state.hostRows, path, type, value, state.hostFormat),
          }),
        ])
      : el('textarea', {
          class: 'textarea editor', id: 'f-host',
          value: state.hostRaw,
          oninput: (e) => { state.hostRaw = e.target.value; markDirty() },
          placeholder: state.hostFormat === 'XML'
            ? '貼入主機 XML 報文…'
            : '貼入主機 JSON 報文…',
        }),
    el('div', { class: 'ai-bar' }, [
      el('button', {
        class: 'btn btn-primary', id: 'btn-ai',
        text: '✨ AI 生成微服務系統案例',
        onclick: aiGenerate,
      }),
      el('span', { class: 'ai-note', id: 'ai-note' }, [
        el('span', { class: 'spark', text: '✦' }),
        el('span', { text: 'AI 依據主機報文自動生成 HTTP/JSON 請求，生成後可人工微調、可重新生成' }),
      ]),
    ]),
  ])
}

/* ---------- 微服務系統側面板（對比 / HTTP 共用字段） ---------- */

function newPanel() {
  return el('div', { class: 'panel' }, [...reqFields('微服務系統接口（HTTP/JSON）', state.newInput ? 'ai-badge' : '')])
}

function httpPanel() {
  return el('div', { class: 'panel' }, [...reqFields('HTTP 請求（單一請求）', 'badge-info')])
}

function reqFields(title, badgeCls) {
  const hasNi = !!state.newInput
  const bodyFmt = 'JSON'
  return [
    el('div', { class: 'panel-toolbar' }, [
      el('label', { class: 'field', style: 'margin:0', text: title }),
      el('span', { class: 'spacer' }),
      el('span', { class: 'badge ' + badgeCls, id: 'gen-badge', text: state.newInput ? genBadgeText() : '尚未生成' }),
    ]),
    // 與左側主機面板同構：頂部字段行全寬 + 請求體大編輯區鋪滿剩餘高度（需求 4/5）
    el('div', { class: 'panel-body' }, [
      el('div', { class: 'req-row' }, [
        el('label', { class: 'field', style: 'margin:0;white-space:nowrap', text: 'URL' }),
        el('select', { class: 'select', id: 'f-method', style: 'width:104px', disabled: !hasNi, onchange: (e) => (state.newInput.method = e.target.value) }, [
          el('option', { text: 'POST' }), el('option', { text: 'GET' }),
          el('option', { text: 'PUT' }), el('option', { text: 'DELETE' }),
        ]),
        el('input', { class: 'input', id: 'f-url', style: 'flex:1', placeholder: 'https://newapi.boc.com.hk/ebp/api/…', disabled: !hasNi, oninput: (e) => (state.newInput.url = e.target.value) }),
      ]),
      el('div', { class: 'req-row' }, [
        el('label', { class: 'field', style: 'margin:0;white-space:nowrap', text: '請求頭' }),
        el('div', { id: 'f-headers', class: 'flex', style: 'flex:1;gap:8px;flex-wrap:wrap' }, [el('span', { class: 'muted', text: '可增刪請求頭' })]),
      ]),
      el('div', { class: 'req-body' }, [
        el('div', { class: 'flex', style: 'gap:8px;margin-bottom:6px;align-items:center' }, [
          el('label', { class: 'field', style: 'margin:0', text: `請求體（${bodyFmt}）` }),
          el('span', { class: 'spacer' }),
          el('button', {
            class: 'btn btn-sm', id: 'body-toggle', style: 'visibility:' + (state.newInput ? 'visible' : 'hidden'),
            text: state.bodyFormMode ? '原始報文' : '表單模式',
            onclick: () => (state.bodyFormMode ? exitBodyForm() : enterBodyForm()),
          }),
        ]),
        state.bodyFormMode && state.newInput
          ? el('div', { class: 'fe-wrap' }, [
              renderFieldForm({
                rows: state.bodyRows,
                onEdit: (i, patch) => Object.assign(state.bodyRows[i], patch),
                onDelete: (i) => { state.bodyRows.splice(i, 1); render() },
                onAdd: (path, type, value) => addField(state.bodyRows, path, type, value, 'JSON'),
              }),
            ])
          : el('textarea', {
              class: 'textarea editor', id: 'f-body',
              disabled: !hasNi,
              value: state.newInput?.body || '',
              oninput: (e) => (state.newInput.body = e.target.value),
              placeholder: '{\n  "Header": { … },\n  "Body": { … }\n}',
            }),
      ]),
    ]),
  ]
}

function genBadgeText() {
  if (state.mode === 'http') return '獨立 HTTP 模式'
  const m = state.aiMeta
  if (!m) return '人工編輯'
  return m.refinedByHuman ? 'AI 生成 + 人工微調' : 'AI 生成（未手動修改）'
}

/** 渲染微服務系統請求字段值（AI 生成結果或載入既有案例） */
function fillNewInput() {
  const ni = state.newInput
  document.getElementById('f-method').value = ni.method || 'POST'
  const url = document.getElementById('f-url')
  url.value = ni.url || ''
  url.disabled = false
  document.getElementById('f-method').disabled = false
  const body = document.getElementById('f-body')
  if (body) {
    body.disabled = false
    body.value = ni.body || ''
  }
  const badge = document.getElementById('gen-badge')
  if (badge) {
    badge.textContent = genBadgeText()
    badge.className = 'badge ' + (state.mode === 'http' ? 'badge-info' : (state.aiMeta?.refinedByHuman ? 'badge-warn' : 'badge-info'))
  }
  const box = document.getElementById('f-headers')
  box.innerHTML = ''
  box.append(
    ...(ni.headers || []).map((h, i) => headerRow(h, i)),
    el('button', {
      class: 'btn btn-sm', text: '＋ 請求頭',
      onclick: () => { state.newInput.headers.push({ name: '', value: '' }); fillNewInput() },
    })
  )
}

function headerRow(h, i) {
  const secret = isSecretHeader(h)
  let reveal = false
  const valInput = el('input', {
    class: 'input', style: 'font-family:var(--mono);font-size:12px',
    value: secret ? maskSecret(h.value) : h.value, placeholder: '值',
    readOnly: secret,
    title: secret ? '密鑰欄位，已脫敏顯示' : '',
    oninput: (e) => (state.newInput.headers[i].value = e.target.value),
  })
  const eye = el('button', {
    class: 'btn btn-sm btn-ghost', text: '👁', title: '顯示 / 隱藏密鑰',
    style: secret ? '' : 'visibility:hidden',
    onclick: () => {
      reveal = !reveal
      valInput.value = reveal ? h.value : maskSecret(h.value)
      valInput.readOnly = !reveal
    },
  })
  return el('div', { class: 'header-row', style: 'grid-template-columns:190px 1fr 28px 28px;margin-bottom:6px' }, [
    el('input', {
      class: 'input', style: 'font-family:var(--mono);font-size:12px',
      value: h.name, placeholder: '名稱',
      oninput: (e) => (state.newInput.headers[i].name = e.target.value),
    }),
    valInput,
    eye,
    el('button', {
      class: 'btn btn-sm btn-ghost', text: '✕',
      onclick: () => { state.newInput.headers.splice(i, 1); fillNewInput() },
    }),
  ])
}

/* ---------- 模式 / 格式 / 表單模式切換 ---------- */

function setMode(mode) {
  if (mode === state.mode) return
  state.mode = mode
  if (mode === 'http' && !state.newInput) {
    state.newInput = { url: '', method: 'POST', headers: [], body: '' }
  }
  if (mode === 'compare' && state.newInput && !state.newInput.url && !state.newInput.body) {
    // 空請求體退回未生成狀態
    state.newInput = null
  }
  render()
}

function setHostFormat(fmt) {
  const cur = state.hostRaw
  if (state.hostFormMode) {
    const out = serializeRows(state.hostFormat, state.hostRows)
    const res = parseRows(fmt, out)
    if (res.error) return toast(`無法切換格式：${res.error}`, 'warn')
    state.hostRows = res.rows
  } else if (cur.trim()) {
    const res = parseRows(fmt, cur)
    if (res.error) {
      // 舊報文與新格式不兼容：提示後清空（樣板/手貼均可重建）
      if (!window.confirm(`當前報文與「${fmt}」格式不匹配（${res.error}）。\n切換後報文將被清空，是否繼續？`)) {
        const sel = document.getElementById('f-hfmt')
        if (sel) sel.value = state.hostFormat
        return
      }
      state.hostRaw = ''
    }
  }
  state.hostFormat = fmt
  render()
}

function enterHostForm() {
  const res = parseRows(state.hostFormat, state.hostRaw)
  if (res.error) return toast(`無法解析為表單：${res.error}`, 'warn')
  state.hostRows = res.rows
  state.hostFormMode = true
  render()
}

function exitHostForm() {
  state.hostRaw = serializeRows(state.hostFormat, state.hostRows)
  state.hostFormMode = false
  render()
}

function enterBodyForm() {
  const raw = state.newInput?.body || ''
  const res = parseRows('JSON', raw)
  if (res.error) return toast(`無法解析為表單：${res.error}`, 'warn')
  state.bodyRows = res.rows
  state.bodyFormMode = true
  render()
}

function exitBodyForm() {
  state.newInput.body = serializeRows('JSON', state.bodyRows)
  state.bodyFormMode = false
  render()
}

/** 表單模式新增字段：點分路徑 → 行（format 用於 XML 根標籤校驗） */
function addField(rows, path, type, value, format) {
  const segs = path.split('.').map((s) => s.trim()).filter(Boolean)
  if (!segs.length) return
  if (format === 'XML' && rows.length && segs[0] !== rows[0].path[0]) {
    return toast(`XML 路徑需以根標籤 ${rows[0].path[0]} 開頭`, 'warn')
  }
  rows.push({ path: segs, key: segs[segs.length - 1], type, raw: value })
  render()
}

/* ---------- 業務模塊下拉 ---------- */

function moduleSelect() {
  const opts = state.modules.map((m) =>
    el('option', { value: m.name, text: `${m.code} · ${m.name}`, selected: state.module === m.name })
  )
  if (state.module && !state.modules.some((m) => m.name === state.module)) {
    opts.push(el('option', { value: state.module, text: state.module + '（未登記）', selected: true }))
  }
  opts.push(el('option', { value: '__new__', text: '＋ 新增業務模塊…' }))
  return el('select', {
    class: 'select', id: 'f-module',
    onchange: (e) => { if (e.target.value === '__new__') { openNewModule() } else state.module = e.target.value },
  }, opts)
}

function openNewModule() {
  const form = el('div', { class: 'form-grid' }, [
    el('div', { class: 'field-row' }, [
      el('label', { class: 'field', text: '模塊代碼（唯一）' }),
      el('input', { class: 'input mono', id: 'nm-code', placeholder: '例：ACCT' }),
    ]),
    el('div', { class: 'field-row' }, [
      el('label', { class: 'field', text: '模塊名稱' }),
      el('input', { class: 'input', id: 'nm-name', placeholder: '例：帳戶查詢' }),
    ]),
  ])
  const okBtn = el('button', {
    class: 'btn btn-primary', text: '建立', onclick: async () => {
      const code = form.querySelector('#nm-code').value.trim()
      const name = form.querySelector('#nm-name').value.trim()
      if (!code || !name) return toast('代碼與名稱必填', 'warn')
      try {
        await post('/api/modules', { code, name, description: '' })
        state.modules = await get('/api/modules')
        state.module = name
        close()
        render()
        toast('模塊已建立', 'ok')
      } catch (e) { toast(e.message, 'err') }
    },
  })
  const cancelBtn = el('button', { class: 'btn', text: '取消', onclick: close })
  const { close } = openModal({ title: '新增業務模塊', body: form, foot: [cancelBtn, okBtn] })
}

/* ---------- AI 生成 ---------- */

async function aiGenerate() {
  const btn = document.getElementById('btn-ai')
  if (!state.hostRaw.trim()) return toast('請先輸入主機報文', 'warn')
  if (state.hostFormat !== 'XML') return toast('AI 生成目前支援 XML 主機報文，請切換格式', 'warn')
  btn.disabled = true
  btn.textContent = 'AI 生成中…'
  try {
    const { newInput } = await post('/api/cases/ai-generate', { hostXml: state.hostRaw })
    state.newInput = newInput
    state.aiMeta = { source: 'ai', generatedAt: new Date().toISOString(), refinedByHuman: false }
    render()
    toast('AI 已生成微服務系統案例，可手動微調後提交', 'ok')
  } catch (e) {
    toast(e.message, 'err')
  } finally {
    btn.disabled = false
    btn.textContent = '✨ AI 生成微服務系統案例'
  }
}

function markDirty() {
  const note = document.getElementById('ai-note')
  if (note && !state.hostFormMode) note.querySelector('span:last-child').textContent = '主機報文已修改，建議重新生成微服務系統案例以保持同步'
}

/* ---------- 保存 ---------- */

async function save() {
  // 表單模式下先序列化回報文
  if (state.hostFormMode) {
    state.hostRaw = serializeRows(state.hostFormat, state.hostRows)
    state.hostFormMode = false
  }
  if (state.bodyFormMode && state.newInput) {
    state.newInput.body = serializeRows('JSON', state.bodyRows)
    state.bodyFormMode = false
  }
  const payload = {
    txnCode: state.txnCode || document.getElementById('f-txn').value.trim(),
    name: document.getElementById('f-name').value.trim(),
    module: state.module,
    stateType: state.stateType,
    precondition: document.getElementById('f-pre').value.trim(),
    mode: state.mode,
    hostFormat: state.hostFormat,
    hostInput: state.mode === 'compare' ? { rawXml: state.hostRaw } : null,
    newInput: state.newInput,
  }
  if (!payload.txnCode) return toast('請填寫交易碼', 'warn')
  if (!payload.name) return toast('請填寫案例名稱', 'warn')
  if (state.mode === 'compare') {
    if (!state.hostRaw.trim()) return toast('請輸入主機報文', 'warn')
    if (!payload.newInput) {
      const yes = await confirmAsk('尚未生成微服務系統請求，僅保存主機側？建議使用 AI 生成以完成案例。', '仍要保存')
      if (!yes) return
    }
  } else if (!payload.newInput?.url.trim()) {
    return toast('請填寫請求 URL', 'warn')
  }
  const hint = document.getElementById('save-hint')
  hint.textContent = '保存中…'
  try {
    let rec
    if (caseId) {
      rec = await put(`/api/cases/${caseId}`, payload)
      toast('已保存修改，案例重新回到待審核狀態', 'ok')
    } else {
      rec = await post('/api/cases', payload)
      toast('案例已提交，等待審核', 'ok')
    }
    setTimeout(() => location.href = `/case-detail.html?id=${rec.id}`, 400)
  } catch (e) {
    hint.textContent = ''
    toast(e.message, 'err')
  }
}

function confirmAsk(message, okText) {
  return new Promise((resolve) => {
    const ok = el('button', { class: 'btn btn-primary', text: okText, onclick: () => { close(); resolve(true) } })
    const cancel = el('button', { class: 'btn', text: '返回補全', onclick: () => { close(); resolve(false) } })
    const { close } = openModal({ title: '確認', body: el('div', { text: message }), foot: [cancel, ok] })
  })
}

/* ---------- 載入既有案例 ---------- */

async function loadExisting() {
  const c = await get(`/api/cases/${caseId}`)
  state.existing = c
  state.txnCode = c.txnCode
  state.name = c.name
  state.module = c.module
  state.stateType = c.stateType
  state.precondition = c.precondition
  state.mode = c.mode === 'http' ? 'http' : 'compare'
  state.hostFormat = c.hostFormat === 'JSON' ? 'JSON' : 'XML'
  state.hostRaw = c.hostInput?.rawXml || ''
  state.newInput = c.newInput ? { ...c.newInput, headers: [...(c.newInput.headers || [])] } : null
  state.aiMeta = c.aiMeta
}

/* ---------- 初始化 ---------- */

async function init() {
  initLayout()
  rootEl = document.getElementById('page')
  try {
    state.modules = await get('/api/modules')
  } catch { /* 模塊載入失敗不阻塞錄入 */ }
  render()
  if (caseId) {
    try {
      await loadExisting()
      render()
    } catch (e) {
      toast(e.message, 'err')
      setTimeout(() => location.href = '/cases.html', 1200)
    }
  }
}

init()
