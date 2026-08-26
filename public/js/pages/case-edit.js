/**
 * 案例錄入 / 編輯頁
 * 需求 3：人工錄入主機（XML）案例 → AI 自動生成對應新系統（HTTP/JSON）案例
 *        （AI 生成後保留手動編輯選項，可重新生成）
 */

import { initLayout } from '../layout.js'
import { get, post, put } from '../api.js'
import { el } from '../util.js'
import { openModal, toast } from '../components.js'

const caseId = new URLSearchParams(location.search).get('id')
const state = {
  existing: null,
  txnCode: '',
  name: '',
  module: '',
  stateType: 'STATELESS',
  precondition: '',
  hostXml: '',
  newInput: null, // { url, method, headers[], body }
  aiMeta: null,
}

/* ---------- XML 樣板 ---------- */

const TEMPLATES = {
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

let rootEl

/* ---------- 渲染 ---------- */

function render() {
  rootEl.innerHTML = ''
  const form = el('div', {})
  form.append(
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { text: caseId ? '編輯案例' : '錄入新案例' }),
        el('span', { class: 'sub', text: '以交易碼唯一標識案例；主機報文錄入後可一鍵 AI 生成新系統案例' }),
      ]),
      el('div', { class: 'card-body' }, [
        el('div', { class: 'form-grid' }, [
          field('交易碼（唯一標識）', el('input', { class: 'input', id: 'f-txn', value: state.txnCode, disabled: !!caseId, placeholder: '例：ACCT1001' })),
          field('案例名稱', el('input', { class: 'input', id: 'f-name', value: state.name, placeholder: '例：帳戶查詢 — 基本成功' })),
          field('業務模組', el('input', { class: 'input', id: 'f-module', value: state.module, placeholder: '例：帳戶查詢' })),
          field('接口類型', el('div', { class: 'flex' }, [
            (() => {
              const sel = el('select', { class: 'select', id: 'f-state' }, [
                el('option', { value: 'STATELESS', text: '無狀態（同輸入應同輸出）' }),
                el('option', { value: 'STATEFUL', text: '有狀態（結果可能受前置狀態影響）' }),
              ])
              sel.value = state.stateType
              return sel
            })(),
          ])),
          el('div', { class: 'full' }, [
            field('前置條件（有狀態接口建議填寫）', el('input', { class: 'input', id: 'f-pre', value: state.precondition, placeholder: '例：需先執行開戶 ACCT0001 並產生至少 1 筆交易' })),
          ]),
        ]),
      ]),
    ]),
    el('div', { class: 'edit-layout', style: 'margin-top:16px' }, [
      // 主機側
      el('div', {}, [
        el('div', { class: 'flex', style: 'margin-bottom:8px' }, [
          el('label', { class: 'field', style: 'margin:0', text: '主機系統輸入報文（XML）' }),
          el('span', { class: 'spacer' }),
          el('span', { class: 'muted', style: 'font-size:12px', text: '樣板：' }),
          ...Object.keys(TEMPLATES).map((k) => el('button', {
            class: 'btn btn-sm',
            text: k,
            onclick: () => { document.getElementById('f-host').value = TEMPLATES[k](state.txnCode || 'ACCT9001'); markDirty() },
          })),
        ]),
        el('textarea', { class: 'textarea xml-editor', id: 'f-host', oninput: markDirty }),
        el('div', { class: 'ai-bar' }, [
          el('button', {
            class: 'btn btn-primary',
            id: 'btn-ai',
            text: '✨ AI 生成新系統案例',
            onclick: aiGenerate,
          }),
          el('span', { class: 'ai-note', id: 'ai-note' }, [
            el('span', { class: 'spark', text: '✦' }),
            el('span', { text: 'AI 依據主機報文自動生成 HTTP/JSON 案例，生成後可人工微調、可重新生成' }),
          ]),
        ]),
      ]),
      // 新系統側
      el('div', {}, [
        el('div', { class: 'flex', style: 'margin-bottom:8px' }, [
          el('label', { class: 'field', style: 'margin:0', text: '新系統接口（HTTP/JSON）' }),
          el('span', { class: 'spacer' }),
          el('span', { class: 'badge badge-info', id: 'gen-badge', text: '尚未生成' }),
        ]),
        el('div', { class: 'form-grid', style: 'gap:8px' }, [
          field('URL', el('div', { class: 'flex' }, [
            el('select', { class: 'select', id: 'f-method', style: 'width:110px' }, [
              el('option', { text: 'POST' }), el('option', { text: 'GET' }),
              el('option', { text: 'PUT' }), el('option', { text: 'DELETE' }),
            ]),
            el('input', { class: 'input', id: 'f-url', style: 'flex:1', placeholder: 'https://newapi.boc.com.hk/ebp/api/…', disabled: !state.newInput }),
          ])),
          field('請求頭（預設從系統配置帶入）', el('div', { id: 'f-headers', class: 'flex' }, [el('span', { class: 'muted', text: '生成後顯示' })])),
          el('div', { class: 'full' }, [
            field('請求體（JSON）', el('textarea', { class: 'textarea json-editor', id: 'f-body', disabled: !state.newInput, oninput: () => (state.newInput.body = document.getElementById('f-body').value) })),
          ]),
        ]),
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
  if (state.newInput) fillNewInput(state.newInput)
  if (state.existing?.review) {
    rootEl.append(el('div', { class: 'card', style: 'margin-top:14px' }, [
      el('div', { class: 'card-head' }, [el('h2', { text: '上次審核意見' })]),
      el('div', { class: 'card-body', text: `${state.existing.review.reviewer}：${state.existing.review.comment}` }),
    ]))
  }
}

function field(label, input) {
  return el('div', { class: 'field-row' }, [el('label', { class: 'field', text: label }), input])
}

/** 渲染新系統輸入（AI 生成結果或載入既有案例） */
function fillNewInput(ni) {
  state.newInput = ni
  document.getElementById('f-method').value = ni.method || 'POST'
  document.getElementById('f-url').value = ni.url || ''
  document.getElementById('f-url').disabled = false
  document.getElementById('f-body').disabled = false
  document.getElementById('f-body').value = ni.body || ''
  document.getElementById('gen-badge').textContent = state.aiMeta?.source === 'ai' && !state.aiMeta?.refinedByHuman
    ? 'AI 生成（未手動修改）' : state.aiMeta?.refinedByHuman ? 'AI 生成 + 人工微調' : '人工編輯'
  document.getElementById('gen-badge').className = 'badge badge-info'
  // 請求頭
  const box = document.getElementById('f-headers')
  box.innerHTML = ''
  const rows = (ni.headers || []).map((h, i) => headerRow(h, i))
  const addBtn = el('button', {
    class: 'btn btn-sm',
    text: '＋ 請求頭',
    onclick: () => { state.newInput.headers.push({ name: '', value: '' }); fillNewInput(state.newInput) },
  })
  box.append(...rows, addBtn)
}

function headerRow(h, i) {
  const row = el('div', { class: 'header-row', style: 'grid-template-columns:190px 1fr 34px;margin-bottom:6px' }, [
    el('input', {
      class: 'input', style: 'font-family:var(--mono);font-size:12px',
      value: h.name, placeholder: '名稱',
      oninput: (e) => (state.newInput.headers[i].name = e.target.value),
    }),
    el('input', {
      class: 'input', style: 'font-family:var(--mono);font-size:12px',
      value: h.value, placeholder: '值',
      oninput: (e) => (state.newInput.headers[i].value = e.target.value),
    }),
    el('button', {
      class: 'btn btn-sm btn-ghost', text: '✕',
      onclick: () => { state.newInput.headers.splice(i, 1); fillNewInput(state.newInput) },
    }),
  ])
  return row
}

/* ---------- 動作 ---------- */

async function aiGenerate() {
  const btn = document.getElementById('btn-ai')
  const hostXml = document.getElementById('f-host').value.trim()
  if (!hostXml) return toast('請先輸入主機 XML 報文', 'warn')
  btn.disabled = true
  btn.textContent = 'AI 生成中…'
  try {
    const { newInput } = await post('/api/cases/ai-generate', { hostXml })
    state.newInput = newInput
    state.aiMeta = { source: 'ai', generatedAt: new Date().toISOString(), refinedByHuman: false }
    fillNewInput(newInput)
    toast('AI 已生成新系統案例，可手動微調後提交', 'ok')
  } catch (e) {
    toast(e.message, 'err')
  } finally {
    btn.disabled = false
    btn.textContent = '✨ AI 生成新系統案例'
  }
}

function markDirty() {
  const note = document.getElementById('ai-note')
  if (note) note.querySelector('span:last-child').textContent = '主機報文已修改，建議重新生成新系統案例以保持同步'
}

async function save() {
  const payload = {
    txnCode: state.txnCode || document.getElementById('f-txn').value.trim(),
    name: document.getElementById('f-name').value.trim(),
    module: document.getElementById('f-module').value.trim(),
    stateType: document.getElementById('f-state').value,
    precondition: document.getElementById('f-pre').value.trim(),
    hostInput: { rawXml: document.getElementById('f-host').value.trim() },
    newInput: state.newInput || null,
  }
  if (!payload.txnCode) return toast('請填寫交易碼', 'warn')
  if (!payload.name) return toast('請填寫案例名稱', 'warn')
  if (!payload.hostInput.rawXml) return toast('請輸入主機 XML 報文', 'warn')
  const hint = document.getElementById('save-hint')
  if (!payload.newInput) {
    const yes = await confirmAsk('尚未生成新系統案例，僅保存主機側？建議使用 AI 生成以完成案例。', '仍要保存')
    if (!yes) return
  }
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
  state.hostXml = c.hostInput?.rawXml || ''
  state.newInput = c.newInput ? { ...c.newInput } : null
  state.aiMeta = c.aiMeta
  const txn = document.getElementById('f-txn')
  if (txn) txn.value = c.txnCode
  document.getElementById('f-name').value = c.name
  document.getElementById('f-module').value = c.module
  document.getElementById('f-state').value = c.stateType
  document.getElementById('f-pre').value = c.precondition
  document.getElementById('f-host').value = state.hostXml
  if (state.newInput) fillNewInput(state.newInput)
}

/* ---------- 初始化 ---------- */

async function init() {
  initLayout()
  rootEl = document.getElementById('page')
  render()
  if (caseId) {
    try {
      await loadExisting()
    } catch (e) {
      toast(e.message, 'err')
      setTimeout(() => location.href = '/cases.html', 1200)
    }
  }
}

init()
